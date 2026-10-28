use super::*;
use crate::event::{
    LoadingBarType,
    emit::{fail_hosted_loading, init_loading, set_loading},
};
use futures::{StreamExt, stream};
use std::time::{Duration, Instant};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TaggedFile {
    mod_id: String,
    mod_ids: Vec<String>,
    path: String,
    sha256: String,
    size: u64,
}

#[derive(Deserialize)]
pub(super) struct TaggedManifest {
    files: Vec<TaggedFile>,
    replaces: Vec<String>,
}

impl TaggedManifest {
    pub fn includes_content(&self, file: &PackFile) -> bool {
        self.files.iter().any(|tagged| tagged.sha256 == file.sha256)
    }

    pub fn validate(&self) -> crate::Result<()> {
        if self.files.len() > 8192 {
            return Err(invalid("标签 Mod 数量过多"));
        }
        let mut ids = HashSet::new();
        for file in &self.files {
            if file.mod_id.is_empty()
                || file.mod_id.len() > 128
                || !file
                    .mod_id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
                || file.path != format!("mods/{}.starlight.jar", file.mod_id)
                || !ids.insert(file.mod_id.to_ascii_lowercase())
            {
                return Err(invalid("标签 Mod 清单包含无效或重复标识"));
            }
            if !file.mod_ids.contains(&file.mod_id) || file.mod_ids.is_empty() {
                return Err(invalid("标签 Mod 缺少完整的 Mod 标识"));
            }
        }
        let all_ids: Vec<_> =
            self.files.iter().flat_map(|file| &file.mod_ids).collect();
        if all_ids.iter().any(|id| {
            id.is_empty()
                || id.len() > 128
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
        }) {
            return Err(invalid("标签 Mod 包含无效标识"));
        }
        if all_ids.iter().collect::<HashSet<_>>().len() != all_ids.len() {
            return Err(invalid("标签 Mod 存在重复标识"));
        }
        super::validate(
            &self
                .files
                .iter()
                .map(TaggedFile::pack_file)
                .collect::<Vec<_>>(),
        )?;
        for path in &self.replaces {
            safe_path(path)?;
            if !is_mod_path(path) {
                return Err(invalid("标签 Mod 替换路径无效"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn manifest() -> TaggedManifest {
        TaggedManifest {
            files: vec![TaggedFile {
                mod_id: "example".into(),
                mod_ids: vec!["example".into()],
                path: "mods/example.starlight.jar".into(),
                sha256: "a".repeat(64),
                size: 10,
            }],
            replaces: vec![],
        }
    }

    fn write_mod(root: &Path, name: &str, id: &str) -> PathBuf {
        let path = root.join("mods").join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut zip =
            zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        zip.set_comment(name.to_owned());
        zip.start_file(
            "fabric.mod.json",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(
            format!(r#"{{"schemaVersion":1,"id":"{id}","version":"1"}}"#)
                .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();
        path
    }

    #[tokio::test]
    async fn untracked_auto_mod_sync_files_survive_without_selected_tags() {
        let root = tempfile::tempdir().unwrap();
        let stale = write_mod(root.path(), "example.starlight.jar", "example");
        let personal = write_mod(root.path(), "personal.jar", "personal");
        let actions = merge(
            root.path(),
            &root.path().join("cache"),
            &mut vec![],
            &mut BTreeMap::new(),
            &TaggedManifest {
                files: vec![],
                replaces: vec![],
            },
        )
        .await
        .unwrap();
        assert!(actions.is_empty());
        assert!(stale.is_file());
        assert!(personal.is_file());
    }

    #[tokio::test]
    async fn untracked_auto_mod_sync_files_survive_unrelated_tag_updates() {
        let root = tempfile::tempdir().unwrap();
        let local = write_mod(
            root.path(),
            "Server Addon.starlight.jar",
            "server_addon",
        );
        let actions = merge(
            root.path(),
            &root.path().join("cache"),
            &mut vec![],
            &mut BTreeMap::new(),
            &manifest(),
        )
        .await
        .unwrap();
        assert!(actions.is_empty());
        assert!(local.is_file());
    }

    #[tokio::test]
    async fn verified_auto_mod_sync_filename_is_kept_through_staged_reconciliation()
     {
        let root = tempfile::tempdir().unwrap();
        let local =
            write_mod(root.path(), "Example 1.0.starlight.jar", "example");
        let mut tagged = manifest();
        tagged.files[0].sha256 = hash(&local).await.unwrap().unwrap();
        tagged.files[0].size = std::fs::metadata(&local).unwrap().len();
        let cache = root.path().join("cache");
        let mut files = vec![];
        let mut sources = BTreeMap::new();
        merge(root.path(), &cache, &mut files, &mut sources, &tagged)
            .await
            .unwrap();
        let borrowed = local_mods::LocalMods::new(root.path())
            .adopt_paths(&mut files, &mut sources, None)
            .await
            .unwrap();
        let mut actions = vec![];
        let duplicates = reconcile_staged(
            root.path(),
            &cache,
            &mut files,
            &mut sources,
            &tagged,
            &mut actions,
        )
        .await
        .unwrap();
        assert!(actions.is_empty());
        assert!(duplicates.is_empty());
        assert_eq!(files[0].path, "mods/Example 1.0.starlight.jar");
        assert!(borrowed.contains(&files[0].path));
        assert!(tagged.includes_content(&files[0]));
        assert!(sources[&files[0].path].contains("/tagged-files/"));
        assert!(local.is_file());
        assert!(!cache.exists());
        assert!(!root.path().join("mods/example.starlight.jar").exists());
    }

    #[tokio::test]
    async fn replaces_installed_pack_mod_when_identity_and_cache_are_missing() {
        let root = tempfile::tempdir().unwrap();
        let local = write_mod(root.path(), "example-old.jar", "example");
        let mut files = vec![PackFile {
            mod_ids: vec![],
            external: None,
            path: "mods/example-old.jar".into(),
            sha256: hash(&local).await.unwrap().unwrap(),
            size: std::fs::metadata(&local).unwrap().len(),
            force: true,
            preserve: false,
        }];
        let actions = merge(
            root.path(),
            &root.path().join("cache"),
            &mut files,
            &mut BTreeMap::new(),
            &manifest(),
        )
        .await
        .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "mods/example.starlight.jar");
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].path, "mods/example-old.jar");
    }

    #[tokio::test]
    async fn fresh_install_reconciles_newly_downloaded_jars_before_applying() {
        let root = tempfile::tempdir().unwrap();
        let fixture = tempfile::tempdir().unwrap();
        let cache = root.path().join("cache");
        std::fs::create_dir(&cache).unwrap();
        let old_jar = write_mod(fixture.path(), "old.jar", "example");
        let old = PackFile {
            mod_ids: vec![],
            external: None,
            path: "mods/old.jar".into(),
            sha256: hash(&old_jar).await.unwrap().unwrap(),
            size: std::fs::metadata(&old_jar).unwrap().len(),
            force: true,
            preserve: false,
        };
        let mut files = vec![old.clone()];
        let mut sources = BTreeMap::new();
        let replacement = write_mod(fixture.path(), "new.jar", "example");
        let mut tagged = manifest();
        tagged.files[0].sha256 = hash(&replacement).await.unwrap().unwrap();
        tagged.files[0].size = std::fs::metadata(&replacement).unwrap().len();
        merge(root.path(), &cache, &mut files, &mut sources, &tagged)
            .await
            .unwrap();
        assert_eq!(files.len(), 2, "uncached legacy manifests have no IDs yet");
        let mut actions: Vec<_> = files
            .iter()
            .map(|file| Action {
                path: file.path.clone(),
                old_hash: None,
                next_hash: Some(file.sha256.clone()),
            })
            .collect();
        // Downloads complete in the cache, not the live mods directory.
        std::fs::copy(&old_jar, cache.join(&old.sha256)).unwrap();
        std::fs::copy(&replacement, cache.join(&tagged.files[0].sha256))
            .unwrap();
        let duplicates = reconcile_staged(
            root.path(),
            &cache,
            &mut files,
            &mut sources,
            &tagged,
            &mut actions,
        )
        .await
        .unwrap();
        assert!(duplicates.is_empty());
        assert_eq!(files.len(), 1);
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].path, "mods/example.starlight.jar");
        apply_files(
            root.path(),
            &cache,
            ".starlight-pack-backup-fresh-test",
            &actions,
        )
        .await
        .unwrap();
        assert!(root.path().join("mods/example.starlight.jar").is_file());
        assert!(!root.path().join("mods/old.jar").exists());
    }

    #[tokio::test]
    async fn desired_managed_file_is_kept_without_selected_tags() {
        let root = tempfile::tempdir().unwrap();
        let local = write_mod(root.path(), "example.starlight.jar", "example");
        let mut files = vec![PackFile {
            mod_ids: vec!["example".into()],
            external: None,
            path: "mods/example.starlight.jar".into(),
            sha256: hash(&local).await.unwrap().unwrap(),
            size: std::fs::metadata(&local).unwrap().len(),
            force: true,
            preserve: false,
        }];
        let actions = merge(
            root.path(),
            &root.path().join("cache"),
            &mut files,
            &mut BTreeMap::new(),
            &TaggedManifest {
                files: vec![],
                replaces: vec![],
            },
        )
        .await
        .unwrap();
        assert!(actions.is_empty());
        assert_eq!(files.len(), 1);
        assert!(local.is_file());
    }

    #[tokio::test]
    async fn modified_local_file_is_not_used_as_the_pack_identity() {
        let root = tempfile::tempdir().unwrap();
        let local = write_mod(root.path(), "personal.jar", "example");
        let mut files = vec![PackFile {
            mod_ids: vec![],
            external: None,
            path: "mods/personal.jar".into(),
            sha256: "b".repeat(64),
            size: 10,
            force: true,
            preserve: false,
        }];
        let actions = merge(
            root.path(),
            &root.path().join("cache"),
            &mut files,
            &mut BTreeMap::new(),
            &manifest(),
        )
        .await
        .unwrap();
        assert!(actions.is_empty());
        assert_eq!(files.len(), 2);
        assert!(local.is_file());
    }

    #[tokio::test]
    async fn replaces_external_mod_using_saved_identity_when_cache_is_missing()
    {
        let root = tempfile::tempdir().unwrap();
        let cache = root.path().join("cache");
        let original = PackFile {
            mod_ids: vec!["example".into()],
            external: Some(External {
                project_id: 1,
                file_id: 2,
            }),
            path: "mods/old.jar".into(),
            sha256: "b".repeat(64),
            size: 12,
            force: true,
            preserve: false,
        };
        let mut files = vec![original.clone()];
        let mut sources = BTreeMap::new();
        let manifest = manifest();
        manifest.validate().unwrap();
        let actions =
            merge(root.path(), &cache, &mut files, &mut sources, &manifest)
                .await
                .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "mods/example.starlight.jar");
        assert!(actions.is_empty());
        assert!(sources[&files[0].path].contains("/tagged-files/"));
        let persisted = serde_json::to_vec(&original).unwrap();
        let mut restored =
            vec![serde_json::from_slice::<PackFile>(&persisted).unwrap()];
        merge(
            root.path(),
            &cache,
            &mut restored,
            &mut sources,
            &TaggedManifest {
                files: vec![],
                replaces: vec![],
            },
        )
        .await
        .unwrap();
        assert_eq!(restored[0].external.as_ref().unwrap().file_id, 2);
        assert_eq!(restored[0].path, "mods/old.jar");
    }

    #[tokio::test]
    async fn local_duplicate_is_only_planned_for_removal_and_unrelated_mod_is_kept()
     {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("mods")).unwrap();
        for (name, id) in [("old.jar", "example"), ("personal.jar", "personal")]
        {
            let mut zip = zip::ZipWriter::new(
                std::fs::File::create(root.path().join("mods").join(name))
                    .unwrap(),
            );
            zip.start_file(
                "fabric.mod.json",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
            zip.write_all(
                format!(r#"{{"schemaVersion":1,"id":"{id}","version":"1"}}"#)
                    .as_bytes(),
            )
            .unwrap();
            zip.finish().unwrap();
        }
        let actions = merge(
            root.path(),
            &root.path().join("cache"),
            &mut vec![],
            &mut BTreeMap::new(),
            &manifest(),
        )
        .await
        .unwrap();
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].path, "mods/old.jar");
        assert!(actions[0].next_hash.is_none());
        assert!(root.path().join("mods/old.jar").is_file());
        assert!(root.path().join("mods/personal.jar").is_file());
    }

    #[tokio::test]
    async fn identical_tagged_mod_keeps_the_modpack_file() {
        let root = tempfile::tempdir().unwrap();
        let original = PackFile {
            mod_ids: vec![],
            external: None,
            path: "mods/example-from-pack.jar".into(),
            sha256: "a".repeat(64),
            size: 10,
            force: true,
            preserve: false,
        };
        let mut files = vec![original.clone()];
        let mut sources = BTreeMap::from([(
            original.path.clone(),
            "https://example.invalid/pack-file".into(),
        )]);
        let mut tagged = manifest();
        tagged.replaces.push(original.path.clone());

        let actions = merge(
            root.path(),
            &root.path().join("cache"),
            &mut files,
            &mut sources,
            &tagged,
        )
        .await
        .unwrap();

        assert!(actions.is_empty());
        assert_eq!(files, vec![original]);
        assert!(!sources.contains_key("mods/example.starlight.jar"));
    }

    #[test]
    fn multi_mod_jar_cannot_be_partially_replaced() {
        let declared = vec!["example".into(), "companion".into()];
        assert!(replaces_ids(&declared, &HashSet::from(["example"])).is_err());
        assert!(
            replaces_ids(&declared, &HashSet::from(["example", "companion"]))
                .unwrap()
        );
        assert!(!replaces_ids(&declared, &HashSet::from(["other"])).unwrap());
        let mut bad = manifest();
        bad.files[0].mod_ids.push("../escape".into());
        assert!(bad.validate().is_err());
    }
}

impl TaggedFile {
    fn pack_file(&self) -> PackFile {
        PackFile {
            mod_ids: self.mod_ids.clone(),
            external: None,
            path: self.path.clone(),
            sha256: self.sha256.clone(),
            size: self.size,
            force: true,
            preserve: false,
        }
    }
}

pub(super) fn is_mod_path(path: &str) -> bool {
    path.starts_with("mods/")
        && path.to_ascii_lowercase().ends_with(".jar")
        && path.split('/').count() == 2
}

fn replaces_ids(
    declared: &[String],
    selected: &HashSet<&str>,
) -> crate::Result<bool> {
    let overlaps = declared.iter().any(|id| selected.contains(id.as_str()));
    if overlaps && !declared.iter().all(|id| selected.contains(id.as_str())) {
        return Err(invalid(
            "旧 JAR 同时包含多个 Mod，标签未覆盖全部标识，无法安全替换。请管理员更新完整 JAR 或整合包。",
        ));
    }
    Ok(overlaps)
}

pub(super) async fn mod_ids(path: PathBuf) -> crate::Result<Vec<String>> {
    Ok(tokio::task::spawn_blocking(move || {
        crate::mod_metadata::read_mod_ids(&path)
    })
    .await?)
}

pub(super) async fn merge(
    root: &Path,
    cache: &Path,
    files: &mut Vec<PackFile>,
    sources: &mut BTreeMap<String, String>,
    manifest: &TaggedManifest,
) -> crate::Result<Vec<Action>> {
    let ids: HashSet<_> = manifest
        .files
        .iter()
        .flat_map(|file| file.mod_ids.iter().map(String::as_str))
        .collect();

    // The modpack is the installation baseline. A tagged snapshot with the
    // same content already passes verification, even when the skin site uses
    // a canonical filename. Keep the pack's file and only replace it when the
    // tagged JAR is actually different.
    let satisfied_pack_paths: HashSet<String> = manifest
        .files
        .iter()
        .filter_map(|tagged| {
            files
                .iter()
                .find(|file| {
                    is_mod_path(&file.path) && file.sha256 == tagged.sha256
                })
                .map(|file| file.path.clone())
        })
        .collect();
    let mut replaced: HashSet<String> = manifest
        .replaces
        .iter()
        .filter(|path| !ids.is_empty() && !satisfied_pack_paths.contains(*path))
        .cloned()
        .collect();
    for file in files
        .iter()
        .filter(|file| !ids.is_empty() && is_mod_path(&file.path))
    {
        if satisfied_pack_paths.contains(&file.path)
            || replaced.contains(&file.path)
        {
            continue;
        }
        let object = target(cache, &file.sha256)?;
        let declared = if !file.mod_ids.is_empty() {
            file.mod_ids.clone()
        } else {
            let cached = mod_ids(object).await?;
            if cached.is_empty() {
                let local = target(root, &file.path)?;
                // An installed pack is still identifiable after its cache was
                // cleared. Do not use a user-modified JAR as the pack identity.
                if hash(&local).await?.as_deref() == Some(&file.sha256) {
                    mod_ids(local).await?
                } else {
                    cached
                }
            } else {
                cached
            }
        };
        if replaces_ids(&declared, &ids)? {
            replaced.insert(file.path.clone());
        }
    }
    files.retain(|file| !replaced.contains(&file.path));
    for file in &manifest.files {
        if files.iter().any(|existing| {
            is_mod_path(&existing.path) && existing.sha256 == file.sha256
        }) {
            continue;
        }
        if files
            .iter()
            .any(|existing| existing.path.eq_ignore_ascii_case(&file.path))
        {
            return Err(invalid(format!(
                "标签 Mod 与整合包文件冲突：{}",
                file.path
            )));
        }
        sources.insert(
            file.path.clone(),
            format!("{API}/tagged-files/{}", file.sha256),
        );
        files.push(file.pack_file());
    }
    let desired_paths: HashSet<_> = files
        .iter()
        .filter(|file| is_mod_path(&file.path))
        .map(|file| file.path.to_ascii_lowercase())
        .collect();
    let mut duplicate_actions = Vec::new();
    let mods_dir = target(root, "mods")?;
    if mods_dir.is_dir() {
        let mut entries = tokio::fs::read_dir(&mods_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let Some(name) = entry.file_name().to_str().map(str::to_owned)
            else {
                continue;
            };
            let path = format!("mods/{name}");
            if !is_mod_path(&path)
                || desired_paths.contains(&path.to_ascii_lowercase())
            {
                continue;
            }
            let local = target(root, &path)?;
            // AutoModSync shares the suffix. Only a confirmed identity
            // conflict with desired tags authorizes duplicate replacement;
            // obsolete launcher-owned files are handled by the saved binding.
            if !ids.is_empty()
                && replaces_ids(&mod_ids(local.clone()).await?, &ids)?
            {
                duplicate_actions.push(Action {
                    path,
                    old_hash: hash(&local).await?,
                    next_hash: None,
                });
            }
        }
    }
    Ok(duplicate_actions)
}

/// The first pass may not know IDs of uncached pack JARs. Reconcile once they
/// are staged, before journaling or modifying the instance, and drop installs
/// of pack files now superseded by a tagged Mod.
pub(super) async fn reconcile_staged(
    root: &Path,
    cache: &Path,
    files: &mut Vec<PackFile>,
    sources: &mut BTreeMap<String, String>,
    manifest: &TaggedManifest,
    actions: &mut Vec<Action>,
) -> crate::Result<Vec<Action>> {
    let duplicates = merge(root, cache, files, sources, manifest).await?;
    let desired: HashSet<_> =
        files.iter().map(|file| file.path.as_str()).collect();
    actions.retain(|action| {
        action.next_hash.is_none() || desired.contains(action.path.as_str())
    });
    Ok(duplicates)
}

pub(super) async fn download(
    instance_id: &str,
    instance_name: &str,
    files: Vec<(PackFile, String, PathBuf)>,
    auth: &str,
    progress: &PackProgress,
) -> crate::Result<u64> {
    if files.is_empty() {
        return Ok(0);
    }
    let state = State::get().await?;
    let concurrency = crate::api::settings::get()
        .await?
        .effective_max_concurrent_downloads()
        .clamp(1, 16);
    let batch_id = uuid::Uuid::new_v4().to_string();
    let total = files.iter().map(|(file, _, _)| file.size).sum::<u64>();
    let current = std::sync::Mutex::new(BTreeMap::<String, u64>::new());
    let mut work = Vec::new();
    for (file, url, object) in files {
        let bar = init_loading(
            LoadingBarType::HostedModDownload {
                instance_id: instance_id.into(),
                instance_name: instance_name.into(),
                batch_id: batch_id.clone(),
                file_name: file.path.clone(),
                error: None,
            },
            file.size as f64,
            "等待下载",
        )
        .await?;
        set_loading(&bar, 0, file.size, "等待下载")?;
        work.push((file, url, object, bar));
    }
    control::collect_downloads(
        stream::iter(work.into_iter().map(|(file, url, object, bar)| {
            let current = &current;
            let state = &state;
            async move {
                let result = async {
                    ensure_session(auth).await?;
                    set_loading(&bar, 0, file.size, "正在下载")?;
                    let mut last = Instant::now() - Duration::from_secs(1);
                    let mut report = |received: u64, _: u64| {
                        if last.elapsed() >= Duration::from_millis(200)
                            || received >= file.size
                        {
                            last = Instant::now();
                            let _ = set_loading(
                                &bar,
                                received,
                                file.size,
                                "正在下载",
                            );
                            let mut bytes = current.lock().unwrap();
                            bytes.insert(
                                file.path.clone(),
                                received.min(file.size),
                            );
                            progress.download(
                                bytes.values().sum(),
                                total,
                                "标签 Mod",
                                false,
                            );
                        }
                        futures::future::ready(Ok(())).boxed()
                    };
                    download_to_path(
                        DownloadRequest::new(url, ResourceClass::Modpack)
                            .with_header("Authorization", auth.to_owned())
                            .with_integrity(Integrity {
                                size: Some(file.size),
                                sha256: Some(file.sha256),
                                ..Default::default()
                            }),
                        &object,
                        &state.fetch_semaphore,
                        &state.pool,
                        Some(&mut report),
                    )
                    .await?;
                    ensure_session(auth).await?;
                    set_loading(&bar, file.size, file.size, "下载完成")?;
                    Ok::<_, crate::Error>(file.size)
                }
                .await;
                if let Err(error) = &result {
                    fail_hosted_loading(&bar, &error.user_facing_message());
                }
                result
            }
        }))
        .buffer_unordered(concurrency),
    )
    .await
}
