//! Administrator-approved skin-site packs. Only content-addressed changed files cross the network.
mod control;
mod local_mods;
mod progress;
pub use control::{HostedTaskState, cancel, pause, resume};
mod tagged;
mod transport;
use crate::{
    State,
    state::{
        AppliedContentSetPatch, Credentials, EditInstance,
        InstanceInstallStage, InstanceLaunchOverridesPatch, InstanceMode,
        MinecraftAccountType, ModLoader,
    },
    util::fetch::{
        DownloadRequest, Integrity, ResourceClass, configured_client,
        download_to_path,
    },
};
use futures::{FutureExt, StreamExt, stream};
use progress::PackProgress;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Arc, LazyLock,
        atomic::{AtomicUsize, Ordering},
    },
};
use tokio::{
    io::AsyncReadExt,
    sync::{Mutex, OwnedMutexGuard},
};

const API: &str = "https://mod-download.starlight.cool/starlight/mod/packs";
const STARLIGHT_YGGDRASIL_API_ROOT: &str =
    "https://skin.starlight.cool/yggdrasil";
const ACCOUNT_REQUIRED_MESSAGE: &str = "您需要登录正版或皮肤站账号后才能操作";
const BINDING: &str = ".starlight-pack.json";
const JOURNAL: &str = ".starlight-pack-pending.json";
const MAX_HOSTED_CONCURRENT_FILES: usize = 8;
static GATES: LazyLock<dashmap::DashMap<String, Arc<Mutex<()>>>> =
    LazyLock::new(dashmap::DashMap::new);
static SESSION: Mutex<Option<DownloadSession>> = Mutex::const_new(None);

struct DownloadSession {
    authorization: String,
    updated: std::time::Instant,
}

impl DownloadSession {
    fn new(token: String) -> crate::Result<Self> {
        if token.is_empty()
            || token.len() > 16_384
            || token.bytes().any(|b| !b.is_ascii_graphic())
        {
            return Err(invalid("StarLight 登录凭据无效，请重新登录"));
        }
        Ok(Self {
            authorization: format!("Bearer {token}"),
            updated: std::time::Instant::now(),
        })
    }

    fn authorization(&self) -> crate::Result<String> {
        if self.updated.elapsed() > std::time::Duration::from_secs(90) {
            return Err(invalid("StarLight 登录状态需要刷新，请重试"));
        }
        Ok(self.authorization.clone())
    }
}

/// The embedded skin site's JWT is held in memory only; the server validates it.
pub async fn set_session(token: Option<String>) -> crate::Result<()> {
    let mut session = SESSION.lock().await;
    *session = None;
    *session = token.map(DownloadSession::new).transpose()?;
    Ok(())
}

fn instance_gate(instance_id: &str) -> Arc<Mutex<()>> {
    GATES.entry(instance_id.to_owned()).or_default().clone()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub game_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackFile {
    #[serde(default)]
    pub mod_ids: Vec<String>,
    #[serde(default)]
    pub external: Option<External>,
    pub path: String,
    pub sha256: String,
    pub size: u64,
    #[serde(default)]
    pub force: bool,
    #[serde(default)]
    pub preserve: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct External {
    pub project_id: u32,
    pub file_id: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: u32,
    pub name: String,
    pub version: String,
    pub format: String,
    pub runtime: Runtime,
    pub files: Vec<PackFile>,
    #[serde(default)]
    pub external: Vec<External>,
    #[serde(default)]
    pub java_arguments: Vec<String>,
    #[serde(default)]
    pub game_arguments: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Publication {
    pub pack_id: String,
    pub release_id: u64,
    pub manifest: Manifest,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub publication: Publication,
    pub files: Vec<PackFile>,
    #[serde(default)]
    pub sync_marker: Option<String>,
    #[serde(default)]
    pub resolved_external: Vec<PackFile>,
    /// Verified pre-existing Mods borrowed from AutoModSync or the user.
    #[serde(default)]
    pub borrowed_files: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncState {
    pack_id: String,
    release_id: u64,
    marker: String,
}

fn marker_matches(previous: &Binding, state: &SyncState) -> bool {
    previous.sync_marker.as_deref() == Some(state.marker.as_str())
        && state.marker == format!("{}:{}", state.pack_id, state.release_id)
        && previous.publication.pack_id == state.pack_id
        && previous.publication.release_id == state.release_id
}
#[derive(Deserialize)]
struct Response<T> {
    payload: T,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub instance_id: String,
    pub version: String,
    pub downloaded_bytes: u64,
    pub changed_files: usize,
    pub preserved_files: Vec<String>,
}

fn invalid(message: impl Into<String>) -> crate::Error {
    crate::ErrorKind::InputError(message.into()).into()
}
fn safe_path(path: &str) -> crate::Result<()> {
    if path.is_empty()
        || path.len() > 1024
        || path.contains('\\')
        || path.to_ascii_lowercase().starts_with(".starlight-")
        || path.split('/').any(|part| {
            let stem =
                part.split('.').next().unwrap_or("").to_ascii_lowercase();
            part.is_empty()
                || part == "."
                || part == ".."
                || part.ends_with(['.', ' '])
                || part
                    .chars()
                    .any(|c| c.is_control() || ":*?\"<>|".contains(c))
                || matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
                || (stem.len() == 4
                    && (stem.starts_with("com") || stem.starts_with("lpt"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        })
    {
        return Err(invalid(format!("Unsafe modpack path: {path}")));
    }
    Ok(())
}
fn validate(files: &[PackFile]) -> crate::Result<()> {
    if files.iter().map(|f| u128::from(f.size)).sum::<u128>()
        > 16 * 1024 * 1024 * 1024
        || files.len() > 100_000
    {
        return Err(invalid("Modpack has too many files"));
    }
    let mut paths = HashSet::new();
    for f in files {
        safe_path(&f.path)?;
        if f.sha256.len() != 64
            || !f
                .sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || f.size > 2 * 1024 * 1024 * 1024
            || !paths.insert(f.path.to_lowercase())
        {
            return Err(invalid(
                "Invalid hash, size or duplicate modpack path",
            ));
        }
    }
    for f in files {
        let mut p = Path::new(&f.path).parent();
        while let Some(parent) = p {
            if paths.contains(
                &parent.to_string_lossy().replace('\\', "/").to_lowercase(),
            ) {
                return Err(invalid("Modpack file/directory conflict"));
            }
            p = parent.parent();
        }
    }
    Ok(())
}
/// Reject symlinks and junctions in every existing ancestor, including internal state files.
#[cfg(windows)]
fn filesystem_path(path: &Path) -> PathBuf {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    if !path.is_absolute() {
        return path.to_path_buf();
    }

    let path = path.as_os_str().encode_wide().collect::<Vec<_>>();
    const BACKSLASH: u16 = b'\\' as u16;
    const QUESTION_MARK: u16 = b'?' as u16;
    if path.starts_with(&[BACKSLASH, BACKSLASH, QUESTION_MARK, BACKSLASH]) {
        return PathBuf::from(OsString::from_wide(&path));
    }

    let mut extended = "\\\\?\\".encode_utf16().collect::<Vec<_>>();
    if path.starts_with(&[BACKSLASH, BACKSLASH]) {
        extended.extend("UNC\\".encode_utf16());
        extended.extend_from_slice(&path[2..]);
    } else {
        extended.extend_from_slice(&path);
    }
    PathBuf::from(OsString::from_wide(&extended))
}

#[cfg(not(windows))]
fn filesystem_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn target(root: &Path, relative: &str) -> crate::Result<PathBuf> {
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        path.push(part);
        match std::fs::symlink_metadata(filesystem_path(&path)) {
            Ok(meta) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes() & 0x400 != 0 {
                        return Err(invalid(
                            "Modpack path is a junction or symlink",
                        ));
                    }
                }
                if meta.file_type().is_symlink() {
                    return Err(invalid("Modpack path is a symlink"));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => {
                return Err(
                    crate::util::io::IOError::with_path(e, &path).into()
                );
            }
        }
    }
    // Windows' legacy Win32 path parser reports ERROR_PATH_NOT_FOUND once a
    // perfectly valid pack path exceeds MAX_PATH. Extended-length paths keep
    // deep KubeJS/data-pack trees addressable without changing their layout.
    Ok(filesystem_path(&path))
}
async fn hash(path: &Path) -> crate::Result<Option<String>> {
    let mut input = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(crate::util::io::IOError::with_path(e, path).into());
        }
    };
    let mut digest = Sha256::new();
    let mut buffer = vec![0; 64 * 1024];
    loop {
        let n = input.read(&mut buffer).await.map_err(|error| {
            crate::util::io::IOError::with_path(error, path)
        })?;
        if n == 0 {
            break;
        }
        digest.update(&buffer[..n]);
    }
    Ok(Some(format!("{:x}", digest.finalize())))
}

fn obsolete_file_action(
    prior: &PackFile,
    local_hash: String,
    borrowed: bool,
) -> Option<Action> {
    if borrowed || prior.preserve || local_hash != prior.sha256 {
        return None;
    }
    Some(Action {
        path: prior.path.clone(),
        old_hash: Some(local_hash),
        next_hash: None,
    })
}
async fn read_json<T: serde::de::DeserializeOwned>(
    root: &Path,
    name: &str,
) -> crate::Result<Option<T>> {
    let path = target(root, name)?;
    match tokio::fs::read(&path).await {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(crate::util::io::IOError::with_path(e, &path).into()),
    }
}
fn write_json<T: Serialize>(
    root: &Path,
    name: &str,
    value: &T,
) -> crate::Result<()> {
    use std::io::Write;
    let dest = target(root, name)?;
    let mut file = tempfile::NamedTempFile::new_in(root).map_err(|error| {
        crate::Error::from(crate::util::io::IOError::with_path(error, root))
            .with_context(format!("创建 {name} 的临时文件失败"))
    })?;
    let temporary = file.path().to_path_buf();
    file.write_all(&serde_json::to_vec(value)?)
        .map_err(|error| {
            crate::Error::from(crate::util::io::IOError::with_path(
                error, &temporary,
            ))
            .with_context(format!("写入 {name} 的临时文件失败"))
        })?;
    file.as_file().sync_all().map_err(|error| {
        crate::Error::from(crate::util::io::IOError::with_path(
            error, &temporary,
        ))
        .with_context(format!("同步 {name} 的临时文件失败"))
    })?;
    file.persist(&dest).map_err(|error| {
        crate::Error::from(error.error).with_context(format!(
            "提交 {name} 失败；临时文件：{}；目标文件：{}",
            temporary.display(),
            dest.display()
        ))
    })?;
    Ok(())
}
async fn authorization() -> crate::Result<String> {
    SESSION
        .lock()
        .await
        .as_ref()
        .ok_or_else(|| {
            invalid("请先登录 StarLight 皮肤站，再下载整合包；无需选择玩家")
        })?
        .authorization()
}

async fn ensure_session(auth: &str) -> crate::Result<()> {
    if !SESSION
        .lock()
        .await
        .as_ref()
        .is_some_and(|session| session.authorization == auth)
    {
        return Err(invalid("StarLight 登录状态已变化，请重试整合包同步"));
    }
    Ok(())
}

async fn request<T: serde::de::DeserializeOwned>(
    suffix: &str,
) -> crate::Result<T> {
    let auth = authorization().await?;
    request_authorized(suffix, &auth).await
}

async fn request_authorized<T: serde::de::DeserializeOwned>(
    suffix: &str,
    auth: &str,
) -> crate::Result<T> {
    ensure_session(auth).await?;
    let client = configured_client().await?;
    let response =
        transport::metadata_request(&client, &format!("{API}{suffix}"), auth)
            .await?;
    if !response.status().is_success() {
        let message = transport::response_failure(
            &client,
            response,
            "https://skin.starlight.cool/starlight/user",
            suffix,
            auth,
        )
        .await;
        ensure_session(auth).await?;
        tracing::warn!("{message}");
        return Err(invalid(message));
    }
    let data: Response<T> = response.error_for_status()?.json().await?;
    ensure_session(auth).await?;
    Ok(data.payload)
}

pub async fn default_publication() -> crate::Result<Publication> {
    request::<Option<Publication>>("/default")
        .await?
        .ok_or_else(|| {
            invalid("管理员尚未指定已发布的默认整合包，请联系服务器管理员")
        })
}

fn is_supported_game_account(
    account_type: MinecraftAccountType,
    yggdrasil_api_root: Option<&str>,
) -> bool {
    account_type == MinecraftAccountType::Microsoft
        || (account_type == MinecraftAccountType::Yggdrasil
            && yggdrasil_api_root.map(|value| value.trim_end_matches('/'))
                == Some(STARLIGHT_YGGDRASIL_API_ROOT))
}

async fn has_game_account_in(state: &State) -> crate::Result<bool> {
    let accounts = Credentials::get_all_without_refresh(&state.pool).await?;
    Ok(accounts.iter().any(|account| {
        let account = account.value();
        is_supported_game_account(
            account.account_type,
            account
                .yggdrasil
                .as_ref()
                .map(|value| value.api_root.as_str()),
        )
    }))
}

pub async fn has_game_account() -> crate::Result<bool> {
    let state = State::get().await?;
    has_game_account_in(&state).await
}

async fn require_game_account(state: &State) -> crate::Result<()> {
    if !has_game_account_in(state).await? {
        return Err(invalid(ACCOUNT_REQUIRED_MESSAGE));
    }
    Ok(())
}

pub async fn create(game_dir_root: Option<String>) -> crate::Result<String> {
    let state = State::get().await?;
    require_game_account(&state).await?;
    let publication = default_publication().await?;
    let runtime = &publication.manifest.runtime;
    // The pack's game files live in their own folder under the chosen root,
    // e.g. `<root>/<pack name>`. Avoid a `versions/<name>` layout: that shape
    // is reserved for externally linked launcher instances and would make the
    // launcher expect a Minecraft version JSON beside the pack.
    let game_dir_override = match game_dir_root
        .as_deref()
        .map(str::trim)
        .filter(|root| !root.is_empty())
    {
        Some(root) => {
            // The pack's game files live in their own folder under the chosen
            // root, e.g. `<root>/<pack name>`. If that folder already exists
            // (a previous install of the same pack, or a name clash), pick a
            // suffixed sibling instead of sharing the folder with another
            // instance.
            let base = Path::new(root).join(&publication.manifest.name);
            let resolved = unique_game_dir(&base);
            Some(resolved.to_string_lossy().into_owned())
        }
        None => None,
    };
    let instance = crate::state::create_instance(
        crate::state::CreateInstance {
            name: publication.manifest.name.clone(),
            path: None,
            game_version: runtime.game_version.clone(),
            loader: ModLoader::try_from_string(&runtime.loader)?,
            loader_version: runtime.loader_version.clone(),
            icon_path: None,
            link: crate::state::InstanceLink::Unmanaged,
            symlink_target: None,
            game_dir_override,
        },
        &state,
    )
    .await?;
    crate::instance::edit(
        &instance.id,
        EditInstance {
            launch_overrides: Some(InstanceLaunchOverridesPatch {
                instance_mode: Some(InstanceMode::StarLight),
                ..Default::default()
            }),
            ..Default::default()
        },
    )
    .await?;
    crate::event::emit::emit_instance(
        &instance.id,
        crate::event::InstancePayloadType::Created,
    )
    .await?;
    Ok(instance.id)
}

/// Returns `base` when its directory does not exist yet; otherwise returns the
/// first `base (n)` (n = 1, 2, …) whose directory is still free. Mirrors the
/// instance-folder de-duplication in `create_instance::resolve_instance_path`,
/// so re-installing the same hosted pack no longer makes two instances share a
/// single game folder.
fn unique_game_dir(base: &Path) -> PathBuf {
    if !base.exists() {
        return base.to_path_buf();
    }
    let parent = base.parent().unwrap_or_else(|| Path::new(""));
    let name = base
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "instance".to_string());
    let mut which = 1u32;
    loop {
        let candidate = parent.join(format!("{name} ({which})"));
        if !candidate.exists() {
            return candidate;
        }
        which += 1;
    }
}
pub async fn binding(instance_id: &str) -> crate::Result<Option<Binding>> {
    read_json(&crate::instance::get_full_path(instance_id).await?, BINDING)
        .await
}
pub async fn java_arguments(instance_id: &str) -> crate::Result<Vec<String>> {
    Ok(binding(instance_id)
        .await?
        .map(|b| b.publication.manifest.java_arguments)
        .unwrap_or_default())
}
pub async fn game_arguments(instance_id: &str) -> crate::Result<Vec<String>> {
    Ok(binding(instance_id)
        .await?
        .map(|b| b.publication.manifest.game_arguments)
        .unwrap_or_default())
}

#[derive(Serialize, Deserialize)]
struct Action {
    path: String,
    old_hash: Option<String>,
    next_hash: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct Journal {
    backup: String,
    actions: Vec<Action>,
    previous: Option<Binding>,
    metadata: crate::state::InstanceMetadata,
}

async fn apply_files(
    root: &Path,
    cache: &Path,
    backup_dir: &str,
    actions: &[Action],
) -> crate::Result<()> {
    for action in actions {
        let live = target(root, &action.path)?;
        if hash(&live).await.map_err(|error| {
            error.with_context(format!(
                "检查整合包目标文件失败：{}",
                live.display()
            ))
        })? != action.old_hash
        {
            return Err(invalid(format!(
                "File changed during sync: {}",
                action.path
            )));
        }
        if action.old_hash.is_some() {
            let backup =
                target(root, &format!("{}/{}", backup_dir, action.path))?;
            let backup_parent = backup.parent().unwrap();
            tokio::fs::create_dir_all(backup_parent).await.map_err(
                |error| {
                    crate::Error::from(crate::util::io::IOError::with_path(
                        error,
                        backup_parent,
                    ))
                    .with_context(format!(
                        "创建整合包备份目录失败：{}",
                        backup_parent.display()
                    ))
                },
            )?;
            tokio::fs::rename(&live, &backup).await.map_err(|error| {
                crate::Error::from(error).with_context(format!(
                    "备份整合包文件失败；源文件：{}；目标文件：{}",
                    live.display(),
                    backup.display()
                ))
            })?;
        }
        if let Some(next) = &action.next_hash {
            let live_parent = live.parent().unwrap();
            tokio::fs::create_dir_all(live_parent)
                .await
                .map_err(|error| {
                    crate::Error::from(crate::util::io::IOError::with_path(
                        error,
                        live_parent,
                    ))
                    .with_context(format!(
                        "创建整合包目标目录失败：{}",
                        live_parent.display()
                    ))
                })?;
            let staged = tempfile::NamedTempFile::new_in(live_parent).map_err(
                |error| {
                    crate::Error::from(crate::util::io::IOError::with_path(
                        error,
                        live_parent,
                    ))
                    .with_context(format!(
                        "创建整合包临时文件失败：{}",
                        live.display()
                    ))
                },
            )?;
            let staged_path = staged.path().to_path_buf();
            let cache_object = target(cache, next)?;
            tokio::fs::copy(&cache_object, &staged_path)
                .await
                .map_err(|error| {
                    crate::Error::from(error).with_context(format!(
                        "复制整合包缓存文件失败；缓存文件：{}；临时文件：{}；目标文件：{}",
                        cache_object.display(),
                        staged_path.display(),
                        live.display()
                    ))
                })?;
            staged.as_file().sync_all().map_err(|error| {
                crate::Error::from(crate::util::io::IOError::with_path(
                    error,
                    &staged_path,
                ))
                .with_context(format!(
                    "同步整合包临时文件失败：{}",
                    staged_path.display()
                ))
            })?;
            staged.persist(&live).map_err(|error| {
                crate::Error::from(error.error).with_context(format!(
                    "提交整合包文件失败；临时文件：{}；目标文件：{}",
                    staged_path.display(),
                    live.display()
                ))
            })?;
        }
    }
    Ok(())
}

async fn restore_files(
    root: &Path,
    backup_dir: &str,
    actions: &[Action],
) -> crate::Result<()> {
    // A durable journal is written before touching live files; it also recovers interrupted runs.
    if !backup_dir.starts_with(".starlight-pack-backup-")
        || backup_dir.contains(['/', '\\'])
    {
        return Err(invalid("Invalid modpack recovery directory"));
    }
    for action in actions.iter().rev() {
        safe_path(&action.path)?;
        let live = target(root, &action.path)?;
        let backup = target(root, &format!("{}/{}", backup_dir, action.path))?;
        if backup.is_file() {
            if live.exists() {
                tokio::fs::remove_file(&live).await?;
            }
            tokio::fs::create_dir_all(live.parent().unwrap()).await?;
            tokio::fs::rename(backup, live).await?;
        } else if action.old_hash.is_none()
            && action.next_hash.is_some()
            && hash(&live).await? == action.next_hash
        {
            tokio::fs::remove_file(live).await?;
        }
    }
    Ok(())
}

async fn restore(root: &Path, journal: &Journal) -> crate::Result<()> {
    restore_files(root, &journal.backup, &journal.actions).await?;
    let state = State::get().await?;
    crate::state::instances::commands::restore_instance_metadata(
        &journal.metadata,
        &state.pool,
    )
    .await?;
    if let Some(old) = &journal.previous {
        write_json(root, BINDING, old)?;
    } else if target(root, BINDING)?.exists() {
        tokio::fs::remove_file(target(root, BINDING)?).await?;
    }
    tokio::fs::remove_file(target(root, JOURNAL)?).await?;
    Ok(())
}
async fn ensure_idle(instance_id: &str) -> crate::Result<()> {
    if !crate::process::get_by_instance_id(instance_id)
        .await?
        .is_empty()
    {
        return Err(invalid(
            "Close Minecraft before synchronizing its modpack",
        ));
    }
    if crate::install::list_jobs(false).await?.iter().any(|job| {
        job.instance_id.as_deref() == Some(instance_id)
            && matches!(
                job.status,
                crate::install::InstallJobStatus::Running
                    | crate::install::InstallJobStatus::Canceling
                    | crate::install::InstallJobStatus::Queued
                    | crate::install::InstallJobStatus::WaitingForUser
            )
    }) {
        return Err(invalid("An installation is already using this instance"));
    }
    Ok(())
}
async fn recover(instance_id: &str) -> crate::Result<()> {
    let root = crate::instance::get_full_path(instance_id).await?;
    if let Some(journal) = read_json::<Journal>(&root, JOURNAL).await? {
        if journal.metadata.instance.id != instance_id {
            return Err(invalid(
                "Recovery journal belongs to another instance",
            ));
        }
        ensure_idle(instance_id).await?;
        restore(&root, &journal).await?;
    }
    Ok(())
}

pub async fn synchronize(instance_id: &str) -> crate::Result<SyncResult> {
    let state = State::get().await?;
    require_game_account(&state).await?;
    let _guard = instance_gate(instance_id).lock_owned().await;
    if instance_mode(instance_id).await? != InstanceMode::StarLight {
        return Err(invalid(
            "请先将实例类型设为 StarLight 实例，再同步官方整合包",
        ));
    }
    synchronize_locked(instance_id).await
}

fn effective_mode(
    explicit: Option<InstanceMode>,
    has_binding: bool,
) -> InstanceMode {
    explicit.unwrap_or(if has_binding {
        InstanceMode::StarLight
    } else {
        InstanceMode::Local
    })
}

pub async fn instance_mode(instance_id: &str) -> crate::Result<InstanceMode> {
    let metadata = crate::instance::get(instance_id)
        .await?
        .ok_or_else(|| invalid("Unknown instance"))?;
    if let Some(mode) = metadata.launch_overrides.instance_mode {
        return Ok(mode);
    }
    Ok(effective_mode(None, binding(instance_id).await?.is_some()))
}

pub async fn set_instance_mode(
    instance_id: &str,
    mode: InstanceMode,
) -> crate::Result<()> {
    let _guard = instance_gate(instance_id).lock_owned().await;
    ensure_idle(instance_id).await?;
    recover(instance_id).await?;
    let metadata = crate::instance::get(instance_id)
        .await?
        .ok_or_else(|| invalid("Unknown instance"))?;
    if mode == InstanceMode::StarLight
        && (metadata.instance.linked_launcher.is_some()
            || metadata.instance.symlink_target.is_some()
            || !matches!(
                metadata.link,
                crate::state::InstanceLink::Unmanaged
                    | crate::state::InstanceLink::ImportedModpack { .. }
            ))
    {
        return Err(invalid(
            "外部关联、共享目录或由第三方整合包平台管理的实例不能开启 StarLight 自动同步，请创建独立实例",
        ));
    }
    if mode == InstanceMode::StarLight {
        synchronize_locked(instance_id).await?;
    }
    crate::instance::edit(
        instance_id,
        EditInstance {
            launch_overrides: Some(InstanceLaunchOverridesPatch {
                instance_mode: Some(mode),
                ..Default::default()
            }),
            ..Default::default()
        },
    )
    .await?;
    Ok(())
}
/// Held through process creation so a manual sync cannot race a launch.
pub async fn prepare_launch(
    instance_id: &str,
    offline: bool,
) -> crate::Result<OwnedMutexGuard<()>> {
    let guard = instance_gate(instance_id).lock_owned().await;
    recover(instance_id).await?;
    if instance_mode(instance_id).await? == InstanceMode::StarLight {
        if offline {
            return Err(invalid(
                "StarLight 实例必须登录并联网检查更新后才能启动；离线游玩请使用本地实例",
            ));
        }
        if crate::process::get_by_instance_id(instance_id)
            .await?
            .is_empty()
        {
            synchronize_locked(instance_id).await?;
        } else {
            check_running_pack(instance_id).await?;
        }
    }
    Ok(guard)
}

async fn check_running_pack(instance_id: &str) -> crate::Result<()> {
    let auth = authorization().await?;
    let root = crate::instance::get_full_path(instance_id).await?;
    let previous: Binding = read_json(&root, BINDING)
        .await?
        .ok_or_else(|| invalid("请先关闭该实例的所有游戏窗口，再同步整合包"))?;
    let remote = request_authorized::<Option<SyncState>>("/sync-state", &auth)
        .await?
        .ok_or_else(|| {
            invalid("管理员尚未指定已发布的默认整合包，请联系服务器管理员")
        })?;
    if !marker_matches(&previous, &remote) {
        return Err(invalid(
            "整合包有更新，请先关闭该实例的所有游戏窗口，更新完成后再多开",
        ));
    }
    let tagged = request_authorized::<tagged::TaggedManifest>(
        &format!("/tagged-mods/{}", previous.publication.release_id),
        &auth,
    )
    .await?;
    tagged.validate()?;
    if !running_pack_matches(&root, &previous, &tagged).await? {
        return Err(invalid(
            "整合包 Mod 有变更，请先关闭该实例的所有游戏窗口，更新完成后再多开",
        ));
    }
    ensure_session(&auth).await
}

async fn running_pack_matches(
    root: &Path,
    previous: &Binding,
    tagged: &tagged::TaggedManifest,
) -> crate::Result<bool> {
    let mut desired = previous.publication.manifest.files.clone();
    desired.extend(previous.resolved_external.iter().cloned());
    tagged::merge(
        root,
        &target(root, ".starlight-pack-cache")?,
        &mut desired,
        &mut BTreeMap::new(),
        tagged,
    )
    .await?;
    let mut local_mods = local_mods::LocalMods::new(root);
    local_mods
        .adopt_paths(&mut desired, &mut BTreeMap::new(), Some(previous))
        .await?;
    let duplicates = tagged::merge(
        root,
        &target(root, ".starlight-pack-cache")?,
        &mut desired,
        &mut BTreeMap::new(),
        tagged,
    )
    .await?;
    let mut previous_files = previous.files.clone();
    local_mods
        .adopt_paths(&mut previous_files, &mut BTreeMap::new(), Some(previous))
        .await?;
    validate(&desired)?;
    let inventory = |files: &[PackFile]| {
        files
            .iter()
            .map(|file| (file.path.clone(), file.sha256.clone()))
            .collect::<BTreeMap<_, _>>()
    };
    if !duplicates.is_empty()
        || inventory(&desired) != inventory(&previous_files)
    {
        return Ok(false);
    }
    for file in desired.iter().filter(|file| tagged.includes_content(file)) {
        if hash(&target(root, &file.path)?).await?.as_deref()
            != Some(&file.sha256)
        {
            return Ok(false);
        }
    }
    Ok(true)
}

async fn synchronize_locked(instance_id: &str) -> crate::Result<SyncResult> {
    ensure_idle(instance_id).await?;
    recover(instance_id).await?;
    let metadata = crate::instance::get(instance_id)
        .await?
        .ok_or_else(|| invalid("Unknown instance"))?;
    let task = control::Registration::new(instance_id)?;
    let progress =
        PackProgress::new(instance_id, &metadata.instance.name).await?;
    let result = task
        .control
        .run(|| {
            synchronize_with_progress(
                instance_id,
                metadata.clone(),
                &progress,
                &task.control,
            )
        })
        .await;
    if let Err(error) = &result {
        progress.fail(error);
    }
    result
}

async fn synchronize_with_progress(
    instance_id: &str,
    metadata: crate::state::InstanceMetadata,
    progress: &PackProgress,
    control: &control::Control,
) -> crate::Result<SyncResult> {
    if metadata.instance.linked_launcher.is_some()
        || metadata.instance.symlink_target.is_some()
        || !matches!(
            metadata.link,
            crate::state::InstanceLink::Unmanaged
                | crate::state::InstanceLink::ImportedModpack { .. }
        )
    {
        return Err(invalid(
            "Hosted modpacks require a launcher-managed instance",
        ));
    }
    let root = crate::instance::get_full_path(instance_id).await?;
    let previous: Option<Binding> = read_json(&root, BINDING).await?;
    let auth = authorization().await?;
    let sync_state =
        request_authorized::<Option<SyncState>>("/sync-state", &auth)
            .await?
            .ok_or_else(|| {
                invalid("管理员尚未指定已发布的默认整合包，请联系服务器管理员")
            })?;
    let pack_unchanged = previous
        .as_ref()
        .is_some_and(|binding| marker_matches(binding, &sync_state))
        && metadata.instance.install_stage == InstanceInstallStage::Installed;
    let publication = if pack_unchanged {
        progress.update(0, 0, "整合包已是最新，正在检查标签 Mod", true);
        previous.as_ref().unwrap().publication.clone()
    } else {
        request_authorized::<Option<Publication>>("/default", &auth)
            .await?
            .ok_or_else(|| {
                invalid("管理员尚未指定已发布的默认整合包，请联系服务器管理员")
            })?
    };
    let sync_marker =
        format!("{}:{}", publication.pack_id, publication.release_id);
    uuid::Uuid::parse_str(&publication.pack_id)
        .map_err(|_| invalid("Invalid modpack ID"))?;
    if publication.manifest.schema_version != 1 {
        return Err(invalid("Invalid modpack publication"));
    }
    if previous.as_ref().is_some_and(|b| {
        b.publication.pack_id == publication.pack_id
            && b.publication.release_id > publication.release_id
    }) {
        return Err(invalid("Server returned an older modpack publication"));
    }
    let manifest = &publication.manifest;
    let loader = ModLoader::try_from_string(&manifest.runtime.loader)?;
    let resolved_loader = if pack_unchanged {
        metadata.applied_content_set.loader_version.clone()
    } else if loader == ModLoader::Vanilla {
        None
    } else {
        Some(crate::launcher::get_loader_version_from_profile(&manifest.runtime.game_version, loader, manifest.runtime.loader_version.as_deref()).await?.ok_or_else(|| invalid("Modpack loader version is unavailable for this Minecraft version"))?.id)
    };
    let runtime_changed = metadata.applied_content_set.game_version
        != manifest.runtime.game_version
        || metadata.applied_content_set.loader != loader
        || metadata.applied_content_set.loader_version != resolved_loader;

    let cache = target(&root, ".starlight-pack-cache")?;
    tokio::fs::create_dir_all(&cache).await?;
    let state = State::get().await?;
    let mut local_mods = local_mods::LocalMods::new(&root);
    let mut files = manifest.files.clone();
    let tagged_manifest = request_authorized::<tagged::TaggedManifest>(
        &format!("/tagged-mods/{}", publication.release_id),
        &auth,
    )
    .await?;
    tagged_manifest.validate()?;
    let mut resolved_external = Vec::new();
    if pack_unchanged {
        resolved_external =
            previous.as_ref().unwrap().resolved_external.clone();
        files.extend(resolved_external.iter().cloned());
    }
    validate(&files)?;
    let mut downloaded = 0;
    let mut sources = BTreeMap::new();
    for f in &files {
        sources.insert(
            f.path.clone(),
            format!("{API}/files/{}/{}", publication.release_id, f.sha256),
        );
    }
    // Resolve CurseForge references using the launcher's existing API and integrity checks.
    for (external_index, external) in manifest.external.iter().enumerate() {
        if pack_unchanged {
            break;
        }
        progress.update(
            0,
            0,
            &format!(
                "正在解析外部模组 {}/{}",
                external_index + 1,
                manifest.external.len()
            ),
            true,
        );
        let cf = crate::api::curseforge::get_file(
            external.project_id,
            external.file_id,
        )
        .await?;
        if cf.mod_id != external.project_id || cf.id != external.file_id {
            return Err(invalid("CurseForge returned a mismatched file"));
        }
        safe_path(&cf.file_name)?;
        if cf.file_name.contains('/') {
            return Err(invalid("Invalid CurseForge filename"));
        }
        let path = format!("mods/{}", cf.file_name);
        if files.iter().any(|f| f.path.eq_ignore_ascii_case(&path)) {
            continue;
        } // overrides take precedence
        let sha1 = cf
            .hashes
            .iter()
            .find(|h| h.algo == 1)
            .map(|h| h.value.clone())
            .ok_or_else(|| invalid("CurseForge file has no SHA-1"))?;
        let staged = target(
            &cache,
            &format!("cf-{}-{}", external.project_id, external.file_id),
        )?;
        if !staged.exists() {
            local_mods
                .stage(
                    &staged,
                    &Integrity::sha1(sha1.clone()).with_size(cf.file_length),
                )
                .await?;
        }
        if !staged.exists() {
            let url = match cf.download_url {
                Some(url) => url,
                None => crate::api::curseforge::get_download_url(
                    external.project_id,
                    external.file_id,
                )
                .await?
                .ok_or_else(|| {
                    invalid("This CurseForge file requires a manual download")
                })?,
            };
            let label = format!(
                "外部模组 {}/{} · {}",
                external_index + 1,
                manifest.external.len(),
                cf.file_name
            );
            let mut transferred = 0;
            let mut on_progress = |received: u64, _total: u64| {
                transferred = received.min(cf.file_length);
                progress.download(transferred, cf.file_length, &label, false);
                futures::future::ready(Ok(())).boxed()
            };
            progress.download(0, cf.file_length, &label, true);
            download_to_path(
                DownloadRequest::new(url, ResourceClass::CurseForge)
                    .with_integrity(
                        Integrity::sha1(sha1.clone()).with_size(cf.file_length),
                    ),
                &staged,
                &state.fetch_semaphore,
                &state.pool,
                Some(&mut on_progress),
            )
            .await?;
            progress.download(cf.file_length, cf.file_length, &label, true);
            downloaded += cf.file_length;
        } else if crate::util::fetch::sha1_file_async(&staged).await?
            != (cf.file_length, sha1)
        {
            return Err(invalid("Cached CurseForge file failed verification"));
        }
        let sha256 = hash(&staged)
            .await?
            .ok_or_else(|| invalid("CurseForge download is missing"))?;
        let object = target(&cache, &sha256)?;
        if !object.exists() {
            tokio::fs::copy(&staged, object).await?;
        }
        let resolved = PackFile {
            mod_ids: tagged::mod_ids(target(&cache, &sha256)?).await?,
            external: Some(external.clone()),
            path,
            sha256,
            size: cf.file_length,
            force: true,
            preserve: false,
        };
        resolved_external.push(resolved.clone());
        files.push(resolved);
    }
    tagged::merge(&root, &cache, &mut files, &mut sources, &tagged_manifest)
        .await?;
    let mut borrowed_files = local_mods
        .adopt_paths(&mut files, &mut sources, previous.as_ref())
        .await?;
    validate(&files)?;
    if let Some(old) = &previous {
        validate(&old.files)?;
    }
    let old: BTreeMap<_, _> = previous
        .as_ref()
        .map(|b| b.files.iter().map(|f| (f.path.as_str(), f)).collect())
        .unwrap_or_default();
    let mut actions = Vec::new();
    let mut pending_downloads = BTreeMap::new();
    let mut preserved = Vec::new();
    let next_paths: BTreeMap<_, _> = files
        .iter()
        .map(|f| (f.path.to_ascii_lowercase(), f.path.as_str()))
        .collect();
    for prior in old.values() {
        if next_paths
            .get(&prior.path.to_ascii_lowercase())
            .is_some_and(|next| **next != prior.path)
        {
            return Err(invalid(
                "Case-only filename changes require a new instance",
            ));
        }
    }
    for (index, f) in files.iter().enumerate() {
        if pack_unchanged
            && !tagged_manifest.includes_content(f)
            && old
                .get(f.path.as_str())
                .is_some_and(|prior| prior.sha256 == f.sha256)
        {
            continue;
        }
        progress.update(
            index as u64,
            files.len() as u64,
            &format!("正在检查文件 · {}", f.path),
            false,
        );
        let live = target(&root, &f.path)?;
        let local = hash(&live).await?;
        if local.as_deref() == Some(&f.sha256) {
            continue;
        }
        let prior = old.get(f.path.as_str());
        if local.is_some()
            && (f.preserve
                || (!f.force
                    && prior
                        .is_some_and(|p| local.as_deref() != Some(&p.sha256))))
        {
            preserved.push(f.path.clone());
            continue;
        }
        if previous.is_none() && local.is_some() {
            return Err(invalid(format!(
                "Existing file conflicts with the modpack: {}. Use an empty instance.",
                f.path
            )));
        }
        let object = target(&cache, &f.sha256)?;
        if hash(&object).await?.as_deref() != Some(&f.sha256)
            && !local_mods
                .stage(
                    &object,
                    &Integrity {
                        size: Some(f.size),
                        sha256: Some(f.sha256.clone()),
                        ..Default::default()
                    },
                )
                .await?
        {
            let url = sources
                .get(&f.path)
                .ok_or_else(|| invalid("Missing modpack download source"))?;
            pending_downloads
                .entry(f.sha256.clone())
                .or_insert_with(|| (f.clone(), url.clone(), object));
        }
        actions.push(Action {
            path: f.path.clone(),
            old_hash: local,
            next_hash: Some(f.sha256.clone()),
        });
    }
    for prior in old.values() {
        if !next_paths.contains_key(&prior.path.to_ascii_lowercase()) {
            let local = hash(&target(&root, &prior.path)?).await?;
            if local.is_none() {
                continue;
            }
            let borrowed = previous.as_ref().is_some_and(|binding| {
                binding.borrowed_files.contains(&prior.path)
            });
            if let Some(action) =
                obsolete_file_action(prior, local.unwrap(), borrowed)
            {
                actions.push(action);
            } else {
                preserved.push(prior.path.clone());
            }
        }
    }
    let mut tagged_downloads = Vec::new();
    pending_downloads.retain(|_, (file, url, object)| {
        if tagged_manifest.includes_content(file) {
            tagged_downloads.push((file.clone(), url.clone(), object.clone()));
            false
        } else {
            true
        }
    });
    let total_bytes = pending_downloads
        .values()
        .map(|(file, _, _)| file.size)
        .sum::<u64>();
    let total_files = pending_downloads.len();
    if total_files > 0 {
        let concurrency = crate::api::settings::get()
            .await?
            .effective_max_concurrent_downloads()
            .clamp(1, MAX_HOSTED_CONCURRENT_FILES);
        let current = std::sync::Mutex::new(BTreeMap::<String, u64>::new());
        let completed = AtomicUsize::new(0);
        progress.download(
            0,
            total_bytes,
            &format!("文件 0/{total_files}"),
            true,
        );
        downloaded += control::collect_downloads(stream::iter(pending_downloads.into_values().map(
            |(file, url, object)| {
                let current = &current;
                let completed = &completed;
                let state = &state;
                let auth = &auth;
                async move {
                    ensure_session(auth).await?;
                    let url = if let Some(external) = &file.external {
                        match crate::api::curseforge::get_file(
                            external.project_id,
                            external.file_id,
                        )
                        .await?
                        .download_url
                        {
                            Some(url) => url,
                            None => crate::api::curseforge::get_download_url(
                                external.project_id,
                                external.file_id,
                            )
                            .await?
                            .ok_or_else(|| {
                                invalid(
                                    "This CurseForge file requires a manual download",
                                )
                            })?,
                        }
                    } else {
                        url
                    };
                    let file_size = file.size;
                    let file_path = file.path.clone();
                    let progress_key = file.path.clone();
                    let mut on_progress = |received: u64, _total: u64| {
                        let mut bytes = current
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        bytes.insert(progress_key.clone(), received.min(file_size));
                        progress.download(
                            bytes.values().sum(),
                            total_bytes,
                            &format!(
                                "文件 {}/{} · {}",
                                completed.load(Ordering::Relaxed),
                                total_files,
                                file_path
                            ),
                            false,
                        );
                        futures::future::ready(Ok(())).boxed()
                    };
                    let mut request =
                        DownloadRequest::new(&url, ResourceClass::Modpack)
                            // The batch already downloads several files in
                            // parallel. Do not let an HTTP/1 fallback multiply
                            // every large file into another four connections.
                            .with_http1_segmented_download(false)
                            .with_integrity(Integrity {
                                size: Some(file_size),
                                sha256: Some(file.sha256),
                                ..Default::default()
                            });
                    if url.starts_with(&format!("{API}/files/")) {
                        request = request
                            .with_header("Authorization", auth.clone());
                    }
                    download_to_path(
                        request.clone(),
                        &object,
                        &state.fetch_semaphore,
                        &state.pool,
                        Some(&mut on_progress),
                    )
                    .await.map_err(|error| error.with_context(format!("下载整合包文件失败：{file_path}")))?;
                    let completed_files =
                        completed.fetch_add(1, Ordering::Relaxed) + 1;
                    let completed_bytes = {
                        let mut bytes = current
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        bytes.insert(progress_key, file_size);
                        bytes.values().sum()
                    };
                    progress.download(
                        completed_bytes,
                        total_bytes,
                        &format!(
                            "文件 {completed_files}/{total_files} · {file_path}"
                        ),
                        completed_files == total_files,
                    );
                    Ok::<_, crate::Error>(file_size)
                }
            },
        ))
        .buffer_unordered(concurrency)).await?;
    }
    ensure_session(&auth).await?;
    downloaded += tagged::download(
        instance_id,
        &metadata.instance.name,
        tagged_downloads,
        &auth,
        progress,
    )
    .await?;
    ensure_session(&auth).await?;
    let duplicate_mods = tagged::reconcile_staged(
        &root,
        &cache,
        &mut files,
        &mut sources,
        &tagged_manifest,
        &mut actions,
    )
    .await?;
    borrowed_files.retain(|path| files.iter().any(|file| &file.path == path));
    let borrowed_files = borrowed_files.into_iter().collect::<Vec<_>>();
    for action in duplicate_mods {
        preserved.retain(|path| path != &action.path);
        if !actions.iter().any(|existing| existing.path == action.path) {
            actions.push(action);
        }
    }
    local_mods::ensure_preserved_compatible(&root, &cache, &files, &preserved)
        .await?;
    if actions.is_empty()
        && !runtime_changed
        && metadata.instance.install_stage == InstanceInstallStage::Installed
        && previous.as_ref().is_some_and(|b| {
            b.sync_marker.as_deref() == Some(sync_marker.as_str())
                && b.files == files
                && b.resolved_external == resolved_external
                && b.borrowed_files == borrowed_files
        })
    {
        return Ok(SyncResult {
            instance_id: instance_id.into(),
            version: manifest.version.clone(),
            downloaded_bytes: downloaded,
            changed_files: 0,
            preserved_files: preserved,
        });
    }
    let journal = Journal {
        backup: format!(".starlight-pack-backup-{}", uuid::Uuid::new_v4()),
        actions,
        previous,
        metadata,
    };
    // From this atomic boundary onward the rollback/runtime transaction must finish.
    control.begin_finalizing()?;
    write_json(&root, JOURNAL, &journal)?;
    let result = async {
        progress.update(0, 0, "正在安装游戏组件", true);
        // Stage all content before changing the game/runtime. The journal blocks launch until recovery.
        crate::instance::edit(instance_id, EditInstance {
            install_stage: Some(InstanceInstallStage::PackInstalling),
            content_set_patch: Some(AppliedContentSetPatch { game_version: Some(manifest.runtime.game_version.clone()), loader: Some(loader), loader_version: Some(resolved_loader.clone()), ..Default::default() }),
            ..Default::default()
        }).await?;
        if runtime_changed || journal.metadata.instance.install_stage != InstanceInstallStage::Installed {
            let mut job = crate::install::install_existing_instance(instance_id.to_string(), false).await?;
            loop {
                progress.install(&job);
                use crate::install::InstallJobStatus::*;
                match job.status {
                    Succeeded => break,
                    Queued | Running => { tokio::time::sleep(std::time::Duration::from_millis(250)).await; job = crate::install::get_job(job.job_id).await?; }
                    status => {
                        let details = job
                            .error
                            .as_ref()
                            .or(job.rollback_error.as_ref())
                            .map(|error| error.message.as_str())
                            .unwrap_or(match status {
                                WaitingForUser => "安装任务正在等待用户处理",
                                Interrupted => "安装任务意外中断",
                                Canceled | Canceling => "安装任务已取消",
                                Failed => "安装任务失败",
                                _ => "安装任务未能完成",
                            });
                        if status == WaitingForUser {
                            let _ = crate::install::cancel_job(job.job_id).await;
                        }
                        return Err(invalid(format!(
                            "Minecraft 游戏组件安装失败：{details}；请在“下载”中查看详情后重试"
                        )));
                    }
                }
            }
        }
        ensure_session(&auth).await?;
        progress.update(0, 0, "正在应用更新", true);
        apply_files(&root, &cache, &journal.backup, &journal.actions)
            .await
            .map_err(|error| error.with_context(format!(
                "应用 StarLight 整合包文件失败；实例目录：{}",
                root.display()
            )))?;
        progress.update(0, 0, "正在完成安装", true);
        write_json(&root, BINDING, &Binding { publication: publication.clone(), files, sync_marker: Some(sync_marker), resolved_external, borrowed_files })
            .map_err(|error| error.with_context(format!(
                "写入 StarLight 整合包绑定信息失败；实例目录：{}",
                root.display()
            )))?;
        crate::instance::edit(instance_id, EditInstance { install_stage: Some(InstanceInstallStage::Installed), ..Default::default() }).await?;
        crate::instance::sync_content_files(instance_id).await.map_err(|error| {
            error.with_context(format!(
                "扫描 StarLight 整合包内容失败；实例目录：{}",
                root.display()
            ))
        })?;
        let journal_path = target(&root, JOURNAL)?;
        tokio::fs::remove_file(&journal_path).await.map_err(|error| {
            crate::Error::from(crate::util::io::IOError::with_path(
                error,
                &journal_path,
            ))
            .with_context("清理 StarLight 整合包安装日志失败")
        })?;
        Ok::<_, crate::Error>(())
    }.await;
    if let Err(error) = result {
        progress.update(0, 0, "正在恢复安装前的文件", true);
        ensure_idle(instance_id).await.map_err(|busy| invalid(format!("Sync failed: {error}; recovery is pending until the active installation stops: {busy}")))?;
        restore(&root, &journal).await.map_err(|recovery| invalid(format!("Sync failed: {error}; recovery failed: {recovery}. Retry before launching.")))?;
        return Err(error);
    }
    Ok(SyncResult {
        instance_id: instance_id.to_string(),
        version: publication.manifest.version,
        downloaded_bytes: downloaded,
        changed_files: journal.actions.len(),
        preserved_files: preserved,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosted_operations_accept_only_microsoft_or_starlight_accounts() {
        assert!(is_supported_game_account(
            MinecraftAccountType::Microsoft,
            None
        ));
        assert!(is_supported_game_account(
            MinecraftAccountType::Yggdrasil,
            Some("https://skin.starlight.cool/yggdrasil/")
        ));
        assert!(!is_supported_game_account(
            MinecraftAccountType::Yggdrasil,
            Some("https://auth.example.com/yggdrasil")
        ));
        assert!(!is_supported_game_account(
            MinecraftAccountType::Offline,
            None
        ));
    }

    #[tokio::test]
    async fn running_pack_checks_tag_changes_without_writing_live_files() {
        let root = tempfile::tempdir().unwrap();
        tokio::fs::create_dir(root.path().join("mods"))
            .await
            .unwrap();
        let path = root.path().join("mods/example.starlight.jar");
        tokio::fs::write(&path, b"installed").await.unwrap();
        let sha = hash(&path).await.unwrap().unwrap();
        let file = serde_json::json!({"path":"mods/example.starlight.jar", "sha256":sha, "size":9,
            "modIds":["example"], "force":true});
        let previous: Binding = serde_json::from_value(serde_json::json!({
            "publication":{"packId":"pack", "releaseId":1, "manifest":{
                "schemaVersion":1, "name":"Pack", "version":"1", "format":"multimc",
                "runtime":{"gameVersion":"1.21.1", "loader":"vanilla"}, "files":[]
            }}, "files":[file], "syncMarker":"pack:1"
        })).unwrap();
        let manifest = |sha: &str| {
            serde_json::from_value::<tagged::TaggedManifest>(serde_json::json!({
            "files":[{"modId":"example", "modIds":["example"], "path":"mods/example.starlight.jar", "sha256":sha, "size":9}],
            "replaces":[]
        })).unwrap()
        };
        assert!(
            running_pack_matches(root.path(), &previous, &manifest(&sha))
                .await
                .unwrap()
        );
        assert!(
            !running_pack_matches(
                root.path(),
                &previous,
                &manifest(&"a".repeat(64))
            )
            .await
            .unwrap()
        );
        let empty = serde_json::from_value(
            serde_json::json!({"files":[], "replaces":[]}),
        )
        .unwrap();
        assert!(
            !running_pack_matches(root.path(), &previous, &empty)
                .await
                .unwrap()
        );
        assert_eq!(tokio::fs::read(&path).await.unwrap(), b"installed");
        assert!(!root.path().join(JOURNAL).exists());
        tokio::fs::write(&path, b"modified").await.unwrap();
        assert!(
            !running_pack_matches(root.path(), &previous, &manifest(&sha))
                .await
                .unwrap()
        );
    }

    #[test]
    fn sync_marker_requires_an_installed_publication_and_changes_on_default_or_release()
     {
        let mut binding: Binding = serde_json::from_value(serde_json::json!({
            "publication": {"packId":"pack", "releaseId":3, "manifest": {
                "schemaVersion":1, "name":"Pack", "version":"1", "format":"multimc",
                "runtime":{"gameVersion":"1.20.1", "loader":"vanilla", "loaderVersion":null}, "files":[]
            }}, "files":[]
        })).unwrap();
        let mut state = SyncState {
            pack_id: "pack".into(),
            release_id: 3,
            marker: "pack:3".into(),
        };
        assert!(!marker_matches(&binding, &state));
        binding.sync_marker = Some("pack:3".into());
        assert!(marker_matches(&binding, &state));
        state.release_id = 4;
        assert!(!marker_matches(&binding, &state));
        state.release_id = 3;
        state.pack_id = "other".into();
        assert!(!marker_matches(&binding, &state));
        state.pack_id = "pack".into();
        state.marker = "pack:4".into();
        assert!(!marker_matches(&binding, &state));
    }

    #[tokio::test]
    async fn running_pack_accepts_verified_auto_mod_sync_renames() {
        use std::io::Write;
        let root = tempfile::tempdir().unwrap();
        let mods = root.path().join("mods");
        std::fs::create_dir(&mods).unwrap();
        let original = mods.join("example.starlight.jar");
        let mut zip =
            zip::ZipWriter::new(std::fs::File::create(&original).unwrap());
        zip.start_file(
            "fabric.mod.json",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(br#"{"schemaVersion":1,"id":"example","version":"1"}"#)
            .unwrap();
        zip.finish().unwrap();
        let sha = hash(&original).await.unwrap().unwrap();
        let size = std::fs::metadata(&original).unwrap().len();
        let previous: Binding = serde_json::from_value(serde_json::json!({
            "publication":{"packId":"pack","releaseId":1,"manifest":{
                "schemaVersion":1,"name":"Pack","version":"1","format":"multimc",
                "runtime":{"gameVersion":"1.21.1","loader":"vanilla"},"files":[]}},
            "files":[{"path":"mods/example.starlight.jar","sha256":sha,"size":size,"modIds":["example"],"force":true}]
        })).unwrap();
        let tagged: tagged::TaggedManifest = serde_json::from_value(serde_json::json!({
            "files":[{"modId":"example","modIds":["example"],"path":"mods/example.starlight.jar","sha256":sha,"size":size}],
            "replaces":[]
        })).unwrap();
        let renamed = mods.join("Example 1.0.starlight.jar");
        tokio::fs::rename(&original, &renamed).await.unwrap();
        assert!(
            running_pack_matches(root.path(), &previous, &tagged)
                .await
                .unwrap()
        );
        assert!(renamed.is_file());
        assert!(!original.exists());
        assert!(!root.path().join(JOURNAL).exists());
        assert!(!root.path().join(".starlight-pack-cache").exists());
    }

    #[tokio::test]
    async fn obsolete_cleanup_preserves_borrowed_or_changed_files_and_remains_recoverable()
     {
        let root = tempfile::tempdir().unwrap();
        let mods = root.path().join("mods");
        tokio::fs::create_dir(&mods).await.unwrap();
        let local = mods.join("example.starlight.jar");
        tokio::fs::write(&local, b"installed").await.unwrap();
        let sha = hash(&local).await.unwrap().unwrap();
        let mut prior = PackFile {
            path: "mods/example.starlight.jar".into(),
            sha256: sha.clone(),
            size: 9,
            mod_ids: vec!["example".into()],
            external: None,
            force: true,
            preserve: false,
        };
        assert!(obsolete_file_action(&prior, sha.clone(), true).is_none());
        assert!(
            obsolete_file_action(&prior, "different".into(), false).is_none()
        );
        prior.preserve = true;
        assert!(obsolete_file_action(&prior, sha.clone(), false).is_none());
        prior.preserve = false;
        let action = obsolete_file_action(&prior, sha, false).unwrap();
        let actions = [action];
        let backup = ".starlight-pack-backup-owned-test";
        apply_files(root.path(), &root.path().join("cache"), backup, &actions)
            .await
            .unwrap();
        assert!(!local.exists());
        assert!(root.path().join(backup).join(&prior.path).is_file());
        restore_files(root.path(), backup, &actions).await.unwrap();
        assert_eq!(tokio::fs::read(local).await.unwrap(), b"installed");
    }
    #[test]
    fn download_session_uses_site_token_without_a_game_profile() {
        let mut session =
            DownloadSession::new("site.jwt.token".into()).unwrap();
        assert_eq!(session.authorization().unwrap(), "Bearer site.jwt.token");
        session.updated -= std::time::Duration::from_secs(91);
        assert!(session.authorization().is_err());
        assert!(DownloadSession::new(String::new()).is_err());
        assert!(
            DownloadSession::new("token\r\nInjected: header".into()).is_err()
        );
    }

    #[tokio::test]
    async fn logout_and_invalid_replacement_clear_download_authorization() {
        set_session(Some("first.jwt.token".into())).await.unwrap();
        assert_eq!(authorization().await.unwrap(), "Bearer first.jwt.token");
        let old = authorization().await.unwrap();
        set_session(None).await.unwrap();
        assert!(authorization().await.is_err());
        assert!(ensure_session(&old).await.is_err());
        set_session(Some("second.jwt.token".into())).await.unwrap();
        assert!(ensure_session(&old).await.is_err());
        assert!(set_session(Some("bad token".into())).await.is_err());
        assert!(authorization().await.is_err());
    }
    #[tokio::test]
    async fn instance_operations_exclude_each_other_without_blocking_other_instances()
     {
        let first = instance_gate("mode-test-first");
        let held = first.lock_owned().await;
        assert!(instance_gate("mode-test-first").try_lock_owned().is_err());
        assert!(instance_gate("mode-test-second").try_lock_owned().is_ok());
        drop(held);
        assert!(instance_gate("mode-test-first").try_lock_owned().is_ok());
    }
    #[test]
    fn explicit_local_disables_legacy_binding_sync() {
        assert_eq!(effective_mode(None, false), InstanceMode::Local);
        assert_eq!(effective_mode(None, true), InstanceMode::StarLight);
        assert_eq!(
            effective_mode(Some(InstanceMode::Local), true),
            InstanceMode::Local
        );
        assert_eq!(
            effective_mode(Some(InstanceMode::StarLight), false),
            InstanceMode::StarLight
        );
    }
    #[tokio::test]
    async fn partial_update_recovers_modified_added_and_removed_files() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let cache = root.join(".starlight-pack-cache");
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::write(root.join("old.jar"), b"old").unwrap();
        std::fs::write(root.join("removed.jar"), b"removed").unwrap();
        std::fs::write(cache.join("next"), b"next").unwrap();
        let next = hash(&cache.join("next")).await.unwrap().unwrap();
        std::fs::rename(cache.join("next"), cache.join(&next)).unwrap();
        let actions = vec![
            Action {
                path: "old.jar".into(),
                old_hash: hash(&root.join("old.jar")).await.unwrap(),
                next_hash: Some(next.clone()),
            },
            Action {
                path: "new.jar".into(),
                old_hash: None,
                next_hash: Some(next.clone()),
            },
            Action {
                path: "removed.jar".into(),
                old_hash: hash(&root.join("removed.jar")).await.unwrap(),
                next_hash: None,
            },
            Action {
                path: "missing.jar".into(),
                old_hash: None,
                next_hash: Some("0".repeat(64)),
            },
        ];
        let backup = ".starlight-pack-backup-test";
        assert!(apply_files(root, &cache, backup, &actions).await.is_err());
        assert_eq!(hash(&root.join("old.jar")).await.unwrap(), Some(next));
        assert!(!root.join("removed.jar").exists());
        restore_files(root, backup, &actions).await.unwrap();
        assert_eq!(std::fs::read(root.join("old.jar")).unwrap(), b"old");
        assert_eq!(
            std::fs::read(root.join("removed.jar")).unwrap(),
            b"removed"
        );
        assert!(!root.join("new.jar").exists());
        assert!(!root.join("missing.jar").exists());
        restore_files(root, backup, &actions).await.unwrap();
    }
    #[test]
    fn rejects_cross_platform_escape_paths() {
        for path in [
            "../mods/a",
            "/mods/a",
            "C:/a",
            "mods\\a",
            "mods/NUL.jar",
            "mods/a.",
            "mods//a",
            ".starlight-pack.json",
        ] {
            assert!(safe_path(path).is_err(), "{path}");
        }
        assert!(safe_path("mods/中文.jar").is_ok());
    }
    #[test]
    fn rejects_case_and_ancestor_collisions() {
        let make = |p: &str| PackFile {
            mod_ids: Vec::new(),
            external: None,
            path: p.into(),
            sha256: "a".repeat(64),
            size: 1,
            force: true,
            preserve: false,
        };
        assert!(validate(&[make("mods/a.jar"), make("mods/A.jar")]).is_err());
        assert!(validate(&[make("config/a"), make("config/a/b")]).is_err());
    }
}
