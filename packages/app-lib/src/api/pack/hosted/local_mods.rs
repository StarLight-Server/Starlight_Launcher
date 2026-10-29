//! Reuse verified AutoModSync/local JARs without relying on their filenames.

use super::*;
use crate::util::fetch::verify_file;
use std::collections::{BTreeSet, HashMap};

pub(super) struct LocalMods {
    root: PathBuf,
    by_size: Option<BTreeMap<u64, Vec<String>>>,
}

impl LocalMods {
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.into(),
            by_size: None,
        }
    }

    async fn index(&mut self) -> crate::Result<()> {
        if self.by_size.is_some() {
            return Ok(());
        }
        let mut by_size = BTreeMap::<u64, Vec<String>>::new();
        let mods = target(&self.root, "mods")?;
        let mut entries = match tokio::fs::read_dir(&mods).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                self.by_size = Some(by_size);
                return Ok(());
            }
            Err(error) => {
                return Err(
                    crate::util::io::IOError::with_path(error, &mods).into()
                );
            }
        };
        while let Some(entry) = entries.next_entry().await? {
            if !entry.file_type().await?.is_file() {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_owned)
            else {
                continue;
            };
            let relative = format!("mods/{name}");
            if !tagged::is_mod_path(&relative) {
                continue;
            }
            let path = target(&self.root, &relative)?;
            by_size
                .entry(tokio::fs::metadata(path).await?.len())
                .or_default()
                .push(relative);
        }
        for paths in by_size.values_mut() {
            paths.sort_by_key(|path| {
                (
                    !path.to_ascii_lowercase().ends_with(".starlight.jar"),
                    path.clone(),
                )
            });
        }
        self.by_size = Some(by_size);
        Ok(())
    }

    async fn find(
        &mut self,
        integrity: &Integrity,
        excluded: &HashSet<String>,
    ) -> crate::Result<Option<String>> {
        if !integrity.supports_resume() {
            return Ok(None);
        }
        self.index().await?;
        let candidates = self
            .by_size
            .as_ref()
            .unwrap()
            .get(&integrity.size.unwrap())
            .cloned()
            .unwrap_or_default();
        for relative in candidates {
            if excluded.contains(&relative.to_ascii_lowercase()) {
                continue;
            }
            let path = target(&self.root, &relative)?;
            if verify_file(&path, integrity).await.is_ok() {
                return Ok(Some(relative));
            }
        }
        Ok(None)
    }

    /// Keep an already installed, verified filename. AutoModSync accepts any
    /// managed filename and compares bytes, so canonical renames are needless.
    pub async fn adopt_paths(
        &mut self,
        files: &mut [PackFile],
        sources: &mut BTreeMap<String, String>,
        previous: Option<&Binding>,
    ) -> crate::Result<BTreeSet<String>> {
        let mut reserved: HashSet<_> = files
            .iter()
            .map(|file| file.path.to_ascii_lowercase())
            .collect();
        let mut borrowed = BTreeSet::new();
        for file in files {
            if !tagged::is_mod_path(&file.path) {
                continue;
            }
            let integrity = Integrity {
                size: Some(file.size),
                sha256: Some(file.sha256.clone()),
                ..Default::default()
            };
            let path = target(&self.root, &file.path)?;
            if tokio::fs::try_exists(&path).await? {
                let owned = previous.is_some_and(|binding| {
                    !binding.borrowed_files.contains(&file.path)
                        && binding.files.iter().any(|prior| {
                            prior.path == file.path
                                && prior.sha256 == file.sha256
                        })
                });
                if !owned && verify_file(&path, &integrity).await.is_ok() {
                    borrowed.insert(file.path.clone());
                }
                continue;
            }
            if let Some(relative) = self.find(&integrity, &reserved).await? {
                let old_path = std::mem::replace(&mut file.path, relative);
                reserved.remove(&old_path.to_ascii_lowercase());
                reserved.insert(file.path.to_ascii_lowercase());
                if let Some(url) = sources.remove(&old_path) {
                    sources.insert(file.path.clone(), url);
                }
                borrowed.insert(file.path.clone());
            }
        }
        Ok(borrowed)
    }

    /// Cache a verified local candidate when the intended path is occupied by
    /// different bytes. Live files remain untouched until the normal journal
    /// transaction applies the replacement.
    pub async fn stage(
        &mut self,
        destination: &Path,
        integrity: &Integrity,
    ) -> crate::Result<bool> {
        let Some(relative) = self.find(integrity, &HashSet::new()).await?
        else {
            return Ok(false);
        };
        let source = target(&self.root, &relative)?;
        let parent = destination
            .parent()
            .ok_or_else(|| invalid("Missing Mod cache directory"))?;
        tokio::fs::create_dir_all(parent).await?;
        let staged = tempfile::NamedTempFile::new_in(parent)?;
        tokio::fs::copy(&source, staged.path()).await?;
        // The file may have changed after discovery. Never publish unverified
        // copied bytes as a content-addressed cache object.
        if verify_file(staged.path(), integrity).await.is_err() {
            return Ok(false);
        }
        staged.persist(destination).map_err(|error| {
            crate::util::io::IOError::with_path(error.error, destination)
        })?;
        Ok(true)
    }
}

/// Retaining an externally managed file must not install a second version of
/// the same Mod beside it. This runs after deliberate replacements have been
/// removed from `preserved`, before the live-file transaction starts.
pub(super) async fn ensure_preserved_compatible(
    root: &Path,
    cache: &Path,
    files: &[PackFile],
    preserved: &[String],
) -> crate::Result<()> {
    let desired_paths: HashSet<_> = files
        .iter()
        .map(|file| file.path.to_ascii_lowercase())
        .collect();
    let mut preserved_ids = HashMap::new();
    for relative in preserved {
        if !tagged::is_mod_path(relative)
            || desired_paths.contains(&relative.to_ascii_lowercase())
        {
            continue;
        }
        for id in tagged::mod_ids(target(root, relative)?).await? {
            preserved_ids.insert(id, relative);
        }
    }
    if preserved_ids.is_empty() {
        return Ok(());
    }
    for file in files.iter().filter(|file| tagged::is_mod_path(&file.path)) {
        let integrity = Integrity {
            size: Some(file.size),
            sha256: Some(file.sha256.clone()),
            ..Default::default()
        };
        let object = target(cache, &file.sha256)?;
        let live = target(root, &file.path)?;
        let verified = if verify_file(&object, &integrity).await.is_ok() {
            object
        } else if verify_file(&live, &integrity).await.is_ok() {
            live
        } else {
            // An unchanged baseline may intentionally have no staged copy.
            // It is not being restored, so cannot introduce a new duplicate.
            continue;
        };
        for id in tagged::mod_ids(verified).await? {
            if let Some(preserved_path) = preserved_ids.get(&id) {
                return Err(invalid(format!(
                    "保留的 Mod「{preserved_path}」与整合包文件「{}」重复声明了「{id}」。请先统一 AutoModSync 与整合包的版本或规则，再重试。",
                    file.path
                )));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ABC_SHA256: &str =
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    fn file(path: &str) -> PackFile {
        PackFile {
            path: path.into(),
            sha256: ABC_SHA256.into(),
            size: 3,
            mod_ids: vec!["example".into()],
            external: None,
            force: true,
            preserve: false,
        }
    }

    fn binding(files: Vec<PackFile>, borrowed: Vec<String>) -> Binding {
        serde_json::from_value(serde_json::json!({
            "publication":{"packId":"pack", "releaseId":1, "manifest":{
                "schemaVersion":1,"name":"Pack","version":"1","format":"multimc",
                "runtime":{"gameVersion":"1.21.1","loader":"vanilla"},"files":[]}},
            "files":files,"borrowedFiles":borrowed
        })).unwrap()
    }

    async fn write(root: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = root.join("mods").join(name);
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&path, bytes).await.unwrap();
        path
    }

    #[tokio::test]
    async fn adopts_auto_mod_sync_filename_without_writing_live_files_or_cache()
    {
        let root = tempfile::tempdir().unwrap();
        let local =
            write(root.path(), "Example 1.0.starlight.jar", b"abc").await;
        let mut files = vec![file("mods/example.starlight.jar")];
        let mut sources = BTreeMap::from([(
            files[0].path.clone(),
            "https://example.invalid/immutable".into(),
        )]);
        let borrowed = LocalMods::new(root.path())
            .adopt_paths(&mut files, &mut sources, None)
            .await
            .unwrap();
        assert_eq!(files[0].path, "mods/Example 1.0.starlight.jar");
        assert_eq!(borrowed, BTreeSet::from([files[0].path.clone()]));
        assert_eq!(
            sources[&files[0].path],
            "https://example.invalid/immutable"
        );
        assert_eq!(tokio::fs::read(&local).await.unwrap(), b"abc");
        assert!(!root.path().join("mods/example.starlight.jar").exists());
        assert!(!root.path().join("cache").exists());
    }

    #[tokio::test]
    async fn borrowed_ownership_survives_repeated_sync_and_launcher_files_stay_owned()
     {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "example.starlight.jar", b"abc").await;
        let original = file("mods/example.starlight.jar");
        for borrowed in [vec![], vec![original.path.clone()]] {
            let previous = binding(vec![original.clone()], borrowed.clone());
            let mut files = vec![original.clone()];
            let actual = LocalMods::new(root.path())
                .adopt_paths(&mut files, &mut BTreeMap::new(), Some(&previous))
                .await
                .unwrap();
            assert_eq!(actual, borrowed.into_iter().collect());
        }
    }

    #[tokio::test]
    async fn missing_borrowed_file_becomes_launcher_owned_when_it_must_be_downloaded()
     {
        let root = tempfile::tempdir().unwrap();
        let original = file("mods/example.starlight.jar");
        let previous =
            binding(vec![original.clone()], vec![original.path.clone()]);
        let mut files = vec![original];
        let borrowed = LocalMods::new(root.path())
            .adopt_paths(&mut files, &mut BTreeMap::new(), Some(&previous))
            .await
            .unwrap();
        assert!(borrowed.is_empty());
    }

    #[tokio::test]
    async fn wrong_bytes_are_not_reused_and_do_not_become_borrowed() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "Example.starlight.jar", b"xyz").await;
        let mut files = vec![file("mods/example.starlight.jar")];
        let mut inventory = LocalMods::new(root.path());
        let borrowed = inventory
            .adopt_paths(&mut files, &mut BTreeMap::new(), None)
            .await
            .unwrap();
        assert_eq!(files[0].path, "mods/example.starlight.jar");
        assert!(borrowed.is_empty());
        let cache = root.path().join("cache/object");
        assert!(
            !inventory
                .stage(
                    &cache,
                    &Integrity {
                        size: Some(3),
                        sha256: Some(ABC_SHA256.into()),
                        ..Default::default()
                    }
                )
                .await
                .unwrap()
        );
        assert!(!cache.exists());
    }

    #[tokio::test]
    async fn stages_sha256_and_curseforge_sha1_without_changing_the_source() {
        let root = tempfile::tempdir().unwrap();
        let source =
            write(root.path(), "Downloaded Name.starlight.jar", b"abc").await;
        for integrity in [
            Integrity {
                size: Some(3),
                sha256: Some(ABC_SHA256.into()),
                ..Default::default()
            },
            Integrity::sha1("a9993e364706816aba3e25717850c26c9cd0d89d")
                .with_size(3),
        ] {
            let cache = root.path().join("cache/object");
            tokio::fs::create_dir_all(cache.parent().unwrap())
                .await
                .unwrap();
            tokio::fs::write(&cache, b"bad").await.unwrap();
            assert!(
                LocalMods::new(root.path())
                    .stage(&cache, &integrity)
                    .await
                    .unwrap()
            );
            assert_eq!(tokio::fs::read(&cache).await.unwrap(), b"abc");
            assert_eq!(tokio::fs::read(&source).await.unwrap(), b"abc");
        }
    }

    #[tokio::test]
    async fn ignores_disabled_jars_directories_and_size_only_matches() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "example.jar.disabled", b"abc").await;
        tokio::fs::create_dir(root.path().join("mods/fake.jar"))
            .await
            .unwrap();
        let destination = root.path().join("cache/object");
        let mut inventory = LocalMods::new(root.path());
        assert!(
            !inventory
                .stage(
                    &destination,
                    &Integrity {
                        size: Some(3),
                        sha256: Some(ABC_SHA256.into()),
                        ..Default::default()
                    }
                )
                .await
                .unwrap()
        );
        write(root.path(), "plain.jar", b"abc").await;
        assert!(
            !LocalMods::new(root.path())
                .stage(&destination, &Integrity::default().with_size(3))
                .await
                .unwrap()
        );
        assert!(!destination.exists());
    }

    #[tokio::test]
    async fn a_local_alias_is_not_assigned_to_two_different_manifest_paths() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "Local.starlight.jar", b"abc").await;
        let mut files = vec![file("mods/a.jar"), file("mods/b.jar")];
        let borrowed = LocalMods::new(root.path())
            .adopt_paths(&mut files, &mut BTreeMap::new(), None)
            .await
            .unwrap();
        assert_eq!(borrowed.len(), 1);
        assert_ne!(files[0].path, files[1].path);
    }

    fn write_jar(root: &Path, name: &str, ids: &[&str]) -> PathBuf {
        use std::io::Write;
        let path = root.join("mods").join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut zip =
            zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        zip.set_comment(name.to_owned());
        zip.start_file(
            "META-INF/neoforge.mods.toml",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        for id in ids {
            zip.write_all(
                format!("[[mods]]\nmodId = \"{id}\"\nversion = \"1\"\n")
                    .as_bytes(),
            )
            .unwrap();
        }
        zip.finish().unwrap();
        path
    }

    #[tokio::test]
    async fn canceling_a_tag_does_not_restore_a_duplicate_beside_a_borrowed_multi_mod_jar()
     {
        let root = tempfile::tempdir().unwrap();
        let fixture = tempfile::tempdir().unwrap();
        let borrowed = write_jar(
            root.path(),
            "Server Mods.starlight.jar",
            &["companion", "example"],
        );
        let baseline =
            write_jar(fixture.path(), "old-example.jar", &["example"]);
        let expected = hash(&baseline).await.unwrap().unwrap();
        let cache = root.path().join("cache");
        std::fs::create_dir(&cache).unwrap();
        std::fs::copy(&baseline, cache.join(&expected)).unwrap();
        let mut wanted = file("mods/old-example.jar");
        wanted.sha256 = expected;
        wanted.size = std::fs::metadata(&baseline).unwrap().len();
        let preserved = vec!["mods/Server Mods.starlight.jar".into()];
        let error = ensure_preserved_compatible(
            root.path(),
            &cache,
            &[wanted],
            &preserved,
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("example"));
        assert!(error.to_string().contains("Server Mods.starlight.jar"));
        assert!(borrowed.exists());
        assert!(!root.path().join("mods/old-example.jar").exists());
        assert!(!root.path().join(JOURNAL).exists());
    }

    #[tokio::test]
    async fn unrelated_preserved_mods_do_not_block_baseline_restoration() {
        let root = tempfile::tempdir().unwrap();
        write_jar(root.path(), "Server Addon.starlight.jar", &["addon"]);
        let local = write_jar(root.path(), "example.jar", &["example"]);
        let mut wanted = file("mods/example.jar");
        wanted.sha256 = hash(&local).await.unwrap().unwrap();
        wanted.size = std::fs::metadata(&local).unwrap().len();
        ensure_preserved_compatible(
            root.path(),
            &root.path().join("cache"),
            &[wanted],
            &["mods/Server Addon.starlight.jar".into()],
        )
        .await
        .unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlinked_candidates_are_not_read_or_reused() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let source = write(outside.path(), "outside.jar", b"abc").await;
        tokio::fs::create_dir(root.path().join("mods"))
            .await
            .unwrap();
        std::os::unix::fs::symlink(source, root.path().join("mods/link.jar"))
            .unwrap();
        let destination = root.path().join("cache/object");
        assert!(
            !LocalMods::new(root.path())
                .stage(
                    &destination,
                    &Integrity {
                        size: Some(3),
                        sha256: Some(ABC_SHA256.into()),
                        ..Default::default()
                    }
                )
                .await
                .unwrap()
        );
        assert!(!destination.exists());
    }
}
