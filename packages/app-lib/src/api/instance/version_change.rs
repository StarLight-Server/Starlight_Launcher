use crate::state::{ModLoader, State};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VersionEnvironment {
    pub game_version: String,
    pub mod_loader: ModLoader,
    pub mod_loader_version: Option<String>,
}

impl From<&crate::state::InstanceUpgradeEnvironment> for VersionEnvironment {
    fn from(value: &crate::state::InstanceUpgradeEnvironment) -> Self {
        Self {
            game_version: value.game_version.clone(),
            mod_loader: value.mod_loader,
            mod_loader_version: value.mod_loader_version.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionChangePreview {
    pub source: VersionEnvironment,
    pub target: VersionEnvironment,
    pub linked_instance: bool,
    pub requires_downgrade_confirmation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionChangeConfirmation {
    pub source: VersionEnvironment,
    pub linked_instance: bool,
    pub loader_downgrade: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionChangeRequest {
    pub target: VersionEnvironment,
    pub confirmation: VersionChangeConfirmation,
}

fn invalid(message: &str) -> crate::Error {
    crate::ErrorKind::InputError(message.to_string()).into()
}

pub(crate) fn patch_changes_environment(
    source: &VersionEnvironment,
    patch: &crate::state::AppliedContentSetPatch,
) -> bool {
    patch
        .game_version
        .as_ref()
        .is_some_and(|version| version != &source.game_version)
        || patch
            .loader
            .is_some_and(|loader| loader != source.mod_loader)
        || patch
            .loader_version
            .as_ref()
            .is_some_and(|version| version != &source.mod_loader_version)
}

pub(crate) fn requires_downgrade(
    source: &VersionEnvironment,
    target: &VersionEnvironment,
) -> bool {
    if source.mod_loader != target.mod_loader
        || source.mod_loader == ModLoader::Vanilla
        || source.mod_loader_version == target.mod_loader_version
    {
        return false;
    }
    let numeric = |value: &Option<String>| -> Option<Vec<u64>> {
        value
            .as_ref()?
            .split('.')
            .map(str::parse::<u64>)
            .collect::<Result<Vec<_>, _>>()
            .ok()
    };
    match (
        numeric(&source.mod_loader_version),
        numeric(&target.mod_loader_version),
    ) {
        (Some(mut old), Some(mut new)) => {
            let size = old.len().max(new.len());
            old.resize(size, 0);
            new.resize(size, 0);
            new < old
        }
        _ => true,
    }
}

pub(crate) fn validate_confirmation(
    preview: &VersionChangePreview,
    confirmation: Option<&VersionChangeConfirmation>,
) -> crate::Result<()> {
    let Some(confirmation) = confirmation else {
        return if preview.linked_instance
            || preview.requires_downgrade_confirmation
        {
            Err(invalid("Version change requires confirmation"))
        } else {
            Ok(())
        };
    };
    if preview.source != confirmation.source {
        return Err(invalid(
            "Instance version changed; preview and confirm again",
        ));
    }
    if preview.linked_instance && !confirmation.linked_instance {
        return Err(invalid(
            "Linked instance modification requires confirmation",
        ));
    }
    if preview.requires_downgrade_confirmation && !confirmation.loader_downgrade
    {
        return Err(invalid("Loader downgrade requires separate confirmation"));
    }
    Ok(())
}

pub(crate) fn linked_launch(
    instance: &crate::state::Instance,
) -> crate::Result<Option<crate::launcher::DirectLinkedLaunch>> {
    Ok(crate::launcher::instance_runtime::InstanceRuntimeAdapter::external_for_instance(instance)?.and_then(|adapter| adapter.direct_link().cloned()))
}

pub(crate) fn linked_environment(
    instance: &crate::state::Instance,
    fallback_game: &str,
) -> crate::Result<Option<VersionEnvironment>> {
    let Some(direct) = linked_launch(instance)? else {
        return Ok(None);
    };
    let resolved = direct.resolve()?;
    let value = serde_json::to_value(&resolved.merged)?;
    let path = direct.version_json.clone().map(Ok).unwrap_or_else(|| {
        crate::launcher::local_version::discover_version_json(
            &direct.dot_minecraft,
            &direct.version_id,
        )
    })?;
    let raw: serde_json::Value = serde_json::from_slice(&std::fs::read(path)?)?;
    Ok(Some(environment_from_linked_documents(
        &raw,
        &value,
        fallback_game,
    )?))
}

fn environment_from_linked_documents(
    raw: &serde_json::Value,
    merged: &serde_json::Value,
    fallback_game: &str,
) -> crate::Result<VersionEnvironment> {
    let content = serde_json::to_string(merged)?;
    let release_identity = |value: &&str| {
        value.split('.').count() >= 2
            && value.split('.').all(|part| {
                !part.is_empty()
                    && part.bytes().all(|byte| byte.is_ascii_digit())
            })
    };
    let game_version = raw
        .get("clientVersion")
        .and_then(|v| v.as_str())
        .or_else(|| {
            raw.get("patches")
                .and_then(|v| v.as_array())
                .and_then(|patches| {
                    patches
                        .iter()
                        .find(|patch| {
                            patch.get("id").and_then(|v| v.as_str())
                                == Some("game")
                        })
                        .and_then(|patch| patch.get("version"))
                        .and_then(|v| v.as_str())
                })
        })
        .or_else(|| {
            merged
                .get("arguments")
                .and_then(|v| v.get("game"))
                .and_then(|v| v.as_array())
                .and_then(|args| {
                    args.windows(2)
                        .find(|pair| {
                            pair[0].as_str() == Some("--fml.mcVersion")
                        })
                        .and_then(|pair| pair[1].as_str())
                })
        })
        .or_else(|| {
            merged.get("libraries").and_then(|v| v.as_array()).and_then(
                |libs| {
                    libs.iter()
                        .filter_map(|lib| {
                            lib.get("name").and_then(|v| v.as_str())
                        })
                        .find_map(|name| {
                            name.strip_prefix("net.fabricmc:intermediary:")
                                .or_else(|| {
                                    name.strip_prefix(
                                        "net.legacyfabric:intermediary:",
                                    )
                                })
                        })
                },
            )
        })
        .or_else(|| {
            raw.get("inheritsFrom")
                .and_then(|v| v.as_str())
                .filter(release_identity)
        })
        .or_else(|| {
            merged
                .get("jar")
                .and_then(|v| v.as_str())
                .filter(release_identity)
        })
        .unwrap_or(fallback_game)
        .to_string();
    let detected = crate::api::pack::import::instance_json::detect_loader(
        &content, merged,
    );
    let (mod_loader, mod_loader_version) = match detected {
		Some((loader, version)) => (ModLoader::try_from_string(&loader)?, version.map(|version| crate::api::pack::import::instance_json::normalize_imported_loader_version(&loader, &game_version, &version))),
		None => (ModLoader::Vanilla, None),
	};
    Ok(VersionEnvironment {
        game_version,
        mod_loader,
        mod_loader_version,
    })
}

pub async fn preview_version_change(
    instance_id: &str,
    target: Option<VersionEnvironment>,
) -> crate::Result<VersionChangePreview> {
    let state = State::get().await?;
    let metadata = crate::state::instances::commands::get_instance_metadata(
        instance_id,
        &state.pool,
    )
    .await?
    .ok_or_else(|| invalid("Unknown instance"))?;
    let content = &metadata.applied_content_set;
    let source = linked_environment(&metadata.instance, &content.game_version)?
        .unwrap_or_else(|| VersionEnvironment {
            game_version: content.game_version.clone(),
            mod_loader: content.loader,
            mod_loader_version: content.loader_version.clone(),
        });
    let target = if let Some(mut target) = target {
        let loader = crate::launcher::get_loader_version_from_profile(
            &target.game_version,
            target.mod_loader,
            target.mod_loader_version.as_deref(),
        )
        .await?;
        if target.mod_loader != ModLoader::Vanilla && loader.is_none() {
            return Err(invalid("Target loader version is unavailable"));
        }
        target.mod_loader_version = loader.map(|loader| loader.id);
        target
    } else {
        source.clone()
    };
    Ok(VersionChangePreview {
        requires_downgrade_confirmation: requires_downgrade(&source, &target),
        source,
        target,
        linked_instance: linked_launch(&metadata.instance)?.is_some(),
    })
}

pub(crate) async fn validate_version_change(
    instance_id: &str,
    request: &VersionChangeRequest,
) -> crate::Result<VersionChangePreview> {
    if crate::pack::hosted::instance_mode(instance_id).await?
        == crate::state::InstanceMode::StarLight
    {
        return Err(invalid(
            "StarLight instance versions are managed by the server",
        ));
    }
    let state = State::get().await?;
    if state
        .process_manager
        .get_all()
        .iter()
        .any(|process| process.instance_id == instance_id)
    {
        return Err(invalid("Instance is currently running"));
    }
    let preview =
        preview_version_change(instance_id, Some(request.target.clone()))
            .await?;
    if preview.target != request.target {
        return Err(invalid(
            "Target version changed; preview and confirm again",
        ));
    }
    validate_confirmation(&preview, Some(&request.confirmation))?;
    Ok(preview)
}

pub async fn change_version(
    instance_id: String,
    target: VersionEnvironment,
    confirmation: VersionChangeConfirmation,
) -> crate::Result<crate::install::InstallJobSnapshot> {
    let request = VersionChangeRequest {
        target,
        confirmation,
    };
    validate_version_change(&instance_id, &request).await?;
    crate::install::runner::change_instance_version(instance_id, request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_external_override_uses_real_profile_without_stored_loader() {
        let directory = tempfile::tempdir().unwrap();
        let version_dir = directory.path().join("versions").join("custom-name");
        std::fs::create_dir_all(&version_dir).unwrap();
        std::fs::write(version_dir.join("custom-name.json"), serde_json::to_vec(&serde_json::json!({
			"id":"custom-name", "clientVersion":"26.1.2", "mainClass":"net.fabricmc.loader.impl.launch.knot.KnotClient", "libraries":[{"name":"net.fabricmc:fabric-loader:0.18.4"}]
		})).unwrap()).unwrap();
        let now = chrono::Utc::now();
        let instance = crate::state::Instance {
            id: "legacy".into(),
            path: "legacy".into(),
            applied_content_set_id: None,
            install_stage: crate::state::InstanceInstallStage::Installed,
            launcher_feature_version:
                crate::state::LauncherFeatureVersion::MOST_RECENT,
            update_channel: crate::state::ReleaseChannel::Release,
            name: "Misleading 1.20.1 name".into(),
            icon_path: None,
            symlink_target: None,
            linked_launcher: None,
            linked_launcher_root: None,
            linked_dot_minecraft: None,
            linked_version_id: None,
            linked_version_json_path: None,
            linked_game_dir_mode: None,
            game_dir_override: Some(version_dir.to_string_lossy().into_owned()),
            created: now,
            modified: now,
            last_played: None,
            pinned_at: None,
            submitted_time_played: 0,
            recent_time_played: 0,
        };
        assert!(linked_launch(&instance).unwrap().is_some());
        let actual = linked_environment(&instance, "1.20.1").unwrap().unwrap();
        assert_eq!(actual.game_version, "26.1.2");
        assert_eq!(actual.mod_loader_version.as_deref(), Some("0.18.4"));
    }
    #[test]
    fn metadata_edit_cannot_bypass_version_change_consent() {
        let source = environment("0.16.10");
        let mut patch = crate::state::AppliedContentSetPatch::default();
        assert!(!patch_changes_environment(&source, &patch));
        patch.loader_version = Some(Some("0.16.10".into()));
        assert!(!patch_changes_environment(&source, &patch));
        patch.loader_version = Some(Some("0.15.11".into()));
        assert!(patch_changes_environment(&source, &patch));
        patch.loader_version = Some(None);
        assert!(patch_changes_environment(&source, &patch));
    }
    #[test]
    fn actual_linked_profile_reads_modern_parent_and_loader_without_stored_version()
     {
        let raw = serde_json::json!({"id":"My custom instance", "inheritsFrom":"26.1.2"});
        let merged = serde_json::json!({"libraries":[{"name":"net.fabricmc:fabric-loader:0.18.4"}], "jar":"26.1.2"});
        let actual =
            environment_from_linked_documents(&raw, &merged, "1.20.1").unwrap();
        assert_eq!(actual.game_version, "26.1.2");
        assert_eq!(actual.mod_loader, ModLoader::Fabric);
        assert_eq!(actual.mod_loader_version.as_deref(), Some("0.18.4"));
        let changed = serde_json::json!({"id":"My custom instance", "inheritsFrom":"26.3"});
        assert_eq!(
            environment_from_linked_documents(&changed, &merged, "1.20.1")
                .unwrap()
                .game_version,
            "26.3"
        );
    }
    fn environment(version: &str) -> VersionEnvironment {
        VersionEnvironment {
            game_version: "1.20.1".into(),
            mod_loader: crate::state::ModLoader::Fabric,
            mod_loader_version: Some(version.into()),
        }
    }
    #[test]
    fn linked_consent_does_not_authorize_downgrade() {
        let preview = VersionChangePreview {
            source: environment("0.16.10"),
            target: environment("0.15.11"),
            linked_instance: true,
            requires_downgrade_confirmation: true,
        };
        let mut confirmation = VersionChangeConfirmation {
            source: preview.source.clone(),
            linked_instance: true,
            loader_downgrade: false,
        };
        assert!(validate_confirmation(&preview, Some(&confirmation)).is_err());
        confirmation.loader_downgrade = true;
        assert!(validate_confirmation(&preview, Some(&confirmation)).is_ok());
        confirmation.source = environment("0.16.9");
        assert!(validate_confirmation(&preview, Some(&confirmation)).is_err());
    }
    #[test]
    fn loader_order_is_numeric_and_unknown_is_conservative() {
        assert!(requires_downgrade(
            &environment("0.16.10"),
            &environment("0.16.9")
        ));
        assert!(!requires_downgrade(
            &environment("0.16.9"),
            &environment("0.16.10")
        ));
        assert!(requires_downgrade(
            &environment("custom-new"),
            &environment("custom-old")
        ));
        assert!(!requires_downgrade(
            &environment("0.16.10"),
            &environment("0.16.10")
        ));
    }
}
