use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedProfileRollback {
    pub path: PathBuf,
    pub original: Vec<u8>,
    pub replacement: Option<Vec<u8>>,
}

fn conflict() -> crate::Error {
    crate::ErrorKind::InputError(
        "Linked version profile changed externally; preview and confirm again"
            .into(),
    )
    .into()
}

fn replace_file(path: &std::path::Path, bytes: &[u8]) -> crate::Result<()> {
    use std::io::Write;
    let parent = path.parent().ok_or_else(conflict)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary
        .into_temp_path()
        .persist(path)
        .map_err(|error| crate::ErrorKind::FSError(error.to_string()))?;
    Ok(())
}

fn publish_profile(snapshot: &LinkedProfileRollback) -> crate::Result<()> {
    if std::fs::read(&snapshot.path)? != snapshot.original {
        return Err(conflict());
    }
    let replacement = snapshot.replacement.as_ref().ok_or_else(conflict)?;
    replace_file(&snapshot.path, replacement)
}

pub(crate) fn restore_profile(
    snapshot: &LinkedProfileRollback,
) -> crate::Result<()> {
    if snapshot.replacement.is_none() {
        return Ok(());
    }
    let current = std::fs::read(&snapshot.path)?;
    if current == snapshot.original {
        return Ok(());
    }
    if snapshot.replacement.as_ref() != Some(&current) {
        return Err(conflict());
    }
    replace_file(&snapshot.path, &snapshot.original)
}

pub(crate) async fn prepare(
    job_id: uuid::Uuid,
    job: &mut crate::install::model::InstallJobState,
    state: &crate::State,
    instance_id: &str,
) -> crate::Result<()> {
    let metadata = crate::state::get_instance(instance_id, &state.pool)
        .await?
        .ok_or_else(conflict)?;
    let Some(direct) = crate::api::instance::version_change::linked_launch(
        &metadata.instance,
    )?
    else {
        return Ok(());
    };
    let path = direct.version_json.clone().map(Ok).unwrap_or_else(|| {
        super::local_version::discover_version_json(
            &direct.dot_minecraft,
            &direct.version_id,
        )
    })?;
    let original = std::fs::read(&path)?;
    let backup = path.with_extension(format!("json.starlight-backup-{job_id}"));
    if !backup.exists() {
        std::fs::write(&backup, &original)?;
    }
    let rollback = job.rollback.as_mut().ok_or_else(conflict)?;
    rollback.linked_profile = Some(LinkedProfileRollback {
        path,
        original,
        replacement: None,
    });
    crate::install::store::update_state(job_id, job, state).await?;
    crate::install::InstallProgressReporter::new(job_id, job.clone())
        .set_rollback(job.rollback.clone())
        .await
}

pub(crate) async fn finish(
    instance: &crate::state::Instance,
    game_version: &str,
    version_jar: &str,
    version_info: &daedalus::minecraft::VersionInfo,
    java_arch: &str,
    minecraft_updated: bool,
    reporter: Option<&crate::install::InstallProgressReporter>,
    state: &crate::State,
) -> crate::Result<()> {
    let Some(reporter) = reporter else {
        return Ok(());
    };
    let mut job = reporter.current_state().await?;
    let Some(rollback) = job.rollback.as_mut() else {
        return Ok(());
    };
    let Some(snapshot) = rollback.linked_profile.as_mut() else {
        return Ok(());
    };
    let Some(direct) =
        crate::api::instance::version_change::linked_launch(instance)?
    else {
        return Err(conflict());
    };
    if std::fs::read(&snapshot.path)? != snapshot.original {
        return Err(conflict());
    }
    let runtime_id = format!("starlight-runtime-{}", uuid::Uuid::new_v4());
    let mut staged = direct.clone();
    staged.version_id = runtime_id.clone();
    staged.version_json = None;
    let runtime_dir = staged.version_dir();
    tokio::fs::create_dir_all(&runtime_dir).await?;
    let source_jar = state
        .directories
        .version_dir(version_jar)
        .join(format!("{version_jar}.jar"));
    tokio::fs::copy(&source_jar, runtime_dir.join(format!("{runtime_id}.jar")))
        .await?;
    let libraries: Vec<super::local_version::LinkedLibrary> = version_info
        .libraries
        .iter()
        .cloned()
        .map(|library| super::local_version::LinkedLibrary {
            library,
            hint: None,
            filename: None,
        })
        .collect();
    for library in &libraries {
        let relative = library.classpath_relative_path()?;
        if relative.is_absolute()
            || relative
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            return Err(conflict());
        }
        let source = state.directories.libraries_dir().join(&relative);
        let destination = direct.libraries_dir().join(&relative);
        if source.is_file() && !destination.exists() {
            if let Some(parent) = destination.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::copy(source, destination).await?;
        }
    }
    super::direct_ensure::ensure_direct_launch_dependencies(
        state,
        &staged,
        &libraries,
        version_info,
        java_arch,
        minecraft_updated,
    )
    .await?;
    let mut replacement = serde_json::to_value(version_info)?;
    let original: serde_json::Value =
        serde_json::from_slice(&snapshot.original)?;
    let object = replacement.as_object_mut().ok_or_else(conflict)?;
    object.insert(
        "id".into(),
        original
            .get("id")
            .cloned()
            .unwrap_or_else(|| direct.version_id.clone().into()),
    );
    object.insert("jar".into(), runtime_id.into());
    object.insert("clientVersion".into(), game_version.into());
    object.remove("inheritsFrom");
    for key in [
        "javaArgs",
        "minMemory",
        "maxMemory",
        "permSize",
        "width",
        "height",
        "fullscreen",
        "serverIp",
        "serverPort",
    ] {
        if let Some(value) = original.get(key) {
            object.insert(key.into(), value.clone());
        }
    }
    snapshot.replacement = Some(serde_json::to_vec(&replacement)?);
    let snapshot = snapshot.clone();
    reporter.set_rollback(job.rollback).await?;
    if reporter.cancellation_token().is_cancelled() {
        return Err(crate::ErrorKind::InputError(
            "Version change was canceled".into(),
        )
        .into());
    }
    publish_profile(&snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profile_replacement_preserves_backup_and_rejects_external_edits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("profile.json");
        std::fs::write(&path, b"original").unwrap();
        let snapshot = LinkedProfileRollback {
            path: path.clone(),
            original: b"original".to_vec(),
            replacement: Some(b"replacement".to_vec()),
        };
        publish_profile(&snapshot).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"replacement");
        restore_profile(&snapshot).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        std::fs::write(&path, b"external change").unwrap();
        assert!(publish_profile(&snapshot).is_err());
        assert!(restore_profile(&snapshot).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"external change");
    }
}
