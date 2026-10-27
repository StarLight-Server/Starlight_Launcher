use crate::api::Result;
use crate::update_policy::{
    UpdateTarget, is_remote_newer, is_rollback, requires_update,
};
use futures::StreamExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use tauri::http::HeaderValue;
use tauri::http::header::ACCEPT;
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_http::reqwest;
use tauri_plugin_http::reqwest::ClientBuilder;
use tauri_plugin_updater::{Error, Update, UpdaterExt};
use theseus::{
    LoadingBarType, emit_loading, init_loading, launcher_user_agent,
};
use tokio::time::Instant;
use url::Url;

const STARLIGHT_UPDATE_LATEST_URL: &str =
    "https://skin.starlight.cool/starlight/launcher/latest";
const STARLIGHT_UPDATE_VERSIONS_URL: &str =
    "https://skin.starlight.cool/starlight/launcher/versions";
const STARLIGHT_UPDATE_BASE_URL: &str = "https://skin.starlight.cool/";

// The updater plugin builds `Update` with no request timeout, so a stalled
// connection would hang the download forever. Bound the whole download.
const UPDATE_DOWNLOAD_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(15 * 60);

// ── Shared types ─────────────────────────────────────────────────

/// The channel the update comes from. Present when it differs from the
/// active channel, so the frontend can migrate the channel setting after
/// installing (a beta client updating to a final release graduates to
/// the release channel).
#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateChannelOrigin {
    Release,
    Beta,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    force_update: bool,
    rollback: bool,
    channel_origin: Option<UpdateChannelOrigin>,
    raw_json: serde_json::Value,
}

#[derive(Default)]
pub struct PendingUpdateData(pub Mutex<UpdateTarget<(Arc<Update>, Vec<u8>)>>);

// ── Update Server API types ─────────────────────────────────────

#[derive(Deserialize)]
struct VersionsResponse {
    versions: Vec<VersionEntry>,
}

#[derive(Deserialize)]
struct VersionEntry {
    version: String,
    artifacts: Vec<ArtifactEntry>,
}

#[derive(Deserialize)]
struct ArtifactEntry {
    kind: String,
    #[serde(default)]
    variant: Option<String>,
    platform: String,
    architecture: String,
    #[serde(default)]
    relative_path: Option<String>,
    #[serde(default)]
    download_url: Option<String>,
    #[serde(default)]
    sha256: Option<String>,
    #[serde(default)]
    size: u64,
}

/// The .deb asset for an apt-managed Linux update, from the Update Server
/// catalog (`/api/versions`). The deb has no minisign signature, so its
/// integrity is verified with the catalog's sha256 and size instead.
struct AptDebAsset {
    url: Url,
    sha256: String,
    size: u64,
}

fn apt_deb_arch() -> Result<&'static str> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("amd64"),
        "aarch64" => Ok("arm64"),
        arch => Err(theseus::Error::from(theseus::ErrorKind::OtherError(
            format!("Unsupported architecture for apt updates: {arch}"),
        ))
        .into()),
    }
}

async fn fetch_apt_deb_asset(version: &str) -> Result<AptDebAsset> {
    let response = ClientBuilder::new()
        .user_agent(launcher_user_agent())
        .timeout(UPDATE_DOWNLOAD_TIMEOUT)
        .build()?
        .get(STARLIGHT_UPDATE_VERSIONS_URL)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(Error::Network(format!(
            "Failed to fetch update catalog: {}",
            response.status()
        ))
        .into());
    }

    let catalog: VersionsResponse = response.json().await?;
    let release = catalog
        .versions
        .iter()
        .find(|entry| entry.version == version)
        .ok_or_else(|| {
            theseus::Error::from(theseus::ErrorKind::OtherError(format!(
                "Update catalog has no entry for version {version}"
            )))
        })?;

    let arch = std::env::consts::ARCH;
    let artifact = release
        .artifacts
        .iter()
        .find(|entry| {
            entry.kind == "installer"
                && entry.variant.as_deref() == Some("deb")
                && entry.platform == "linux"
                && entry.architecture == arch
        })
        .ok_or_else(|| {
            theseus::Error::from(theseus::ErrorKind::OtherError(format!(
                "Update catalog has no deb artifact for {version} on {arch}"
            )))
        })?;

    let sha256 = artifact.sha256.clone().ok_or_else(|| {
        theseus::Error::from(theseus::ErrorKind::OtherError(format!(
            "Update catalog has no sha256 for the deb artifact of {version}"
        )))
    })?;

    let url = artifact_download_url(artifact)?;

    Ok(AptDebAsset {
        url,
        sha256,
        size: artifact.size,
    })
}

fn artifact_download_url(artifact: &ArtifactEntry) -> Result<Url> {
    if let Some(download_url) = artifact.download_url.as_deref() {
        return Url::parse(download_url).map_err(|error| {
            theseus::Error::from(theseus::ErrorKind::OtherError(
                error.to_string(),
            ))
            .into()
        });
    }

    let relative_path = artifact.relative_path.as_deref().ok_or_else(|| {
        theseus::Error::from(theseus::ErrorKind::OtherError(
            "Update catalog artifact has no download URL".to_string(),
        ))
    })?;
    Url::parse(STARLIGHT_UPDATE_BASE_URL)
        .and_then(|base| base.join(relative_path))
        .map_err(|error| {
            theseus::Error::from(theseus::ErrorKind::OtherError(
                error.to_string(),
            ))
            .into()
        })
}

// ── Updater plugin helpers ───────────────────────────────────────

fn update_channel(channel: &str) -> Result<&str> {
    match channel {
        "release" | "beta" => Ok(channel),
        _ => Err(theseus::Error::from(theseus::ErrorKind::OtherError(
            format!("Unknown update channel: {channel}"),
        ))
        .into()),
    }
}

fn update_platform() -> Result<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok("windows-x86_64"),
        ("linux", "x86_64") => Ok("linux-x86_64"),
        ("linux", "aarch64") => Ok("linux-aarch64"),
        ("macos", "x86_64") => Ok("darwin-x86_64"),
        ("macos", "aarch64") => Ok("darwin-aarch64"),
        (os, arch) => {
            Err(theseus::Error::from(theseus::ErrorKind::OtherError(format!(
                "Unsupported updater platform: {os}-{arch}"
            )))
            .into())
        }
    }
}

fn update_endpoint() -> Result<Url> {
    Url::parse(STARLIGHT_UPDATE_LATEST_URL).map_err(|error| {
        theseus::Error::from(theseus::ErrorKind::OtherError(error.to_string()))
            .into()
    })
}

/// Build the platform-updater with the given endpoints and run a check.
async fn check_with_endpoints<R: Runtime>(
    webview: &Webview<R>,
    channel: &str,
) -> Result<Option<Update>> {
    let channel = update_channel(channel)?;
    let platform = update_platform()?;
    let current_version =
        webview.app_handle().package_info().version.to_string();
    let mut updater = webview
        .updater_builder()
        .endpoints(vec![update_endpoint()?])?
        .header("Accept", "application/json")?
        .header("X-Axolotl-Channel", channel)?
        .header("X-Axolotl-Platform", platform)?
        .header("X-Axolotl-Version", current_version)?
        .version_comparator(|current, release| {
            requires_update(&current, &release.version)
        });

    #[cfg(target_os = "windows")]
    {
        let install_dir = std::env::current_exe()
            .map_err(|error| {
                theseus::Error::from(theseus::ErrorKind::OtherError(format!(
                    "Failed to resolve current executable: {error}"
                )))
            })?
            .parent()
            .ok_or_else(|| {
                theseus::Error::from(theseus::ErrorKind::OtherError(
                    "Current executable has no parent directory".to_string(),
                ))
            })?
            .to_path_buf();

        tracing::debug!(
            install_dir = %install_dir.display(),
            "Using current executable directory for Windows app updates"
        );
        updater = updater.installer_arg(format!(
            "/INSTALL_DIR=\"{}\"",
            install_dir.display()
        ));
    }

    let updater = updater.build()?;
    updater.check().await.map_err(Into::into)
}

/// Check the updater manifest through the configured Update Server endpoint.
async fn check_with_updater<R: Runtime>(
    webview: &Webview<R>,
    channel: &str,
) -> Result<Option<UpdateMetadata>> {
    let pending_data = webview.state::<PendingUpdateData>();
    let revision = pending_data.0.lock().unwrap().begin_check();
    let checked = check_with_endpoints(webview, channel).await?;
    let checked = match checked {
        Some(update) => Some(update),
        // Beta-channel clients also graduate to final releases: the release
        // channel's latest outranks the current prerelease once a final
        // version ships, even though the server keys `latest` per channel.
        None if channel == "beta" => {
            match check_with_endpoints(webview, "release").await {
                Ok(Some(release_update)) => {
                    let current =
                        webview.app_handle().package_info().version.clone();
                    let release_version = semver::Version::parse(
                        &release_update.version,
                    )
                    .map_err(|error| {
                        theseus::Error::from(theseus::ErrorKind::OtherError(
                            format!(
                                "Invalid release-channel version '{}': {error}",
                                release_update.version
                            ),
                        ))
                    })?;
                    if is_remote_newer(&current, &release_version) {
                        Some(release_update)
                    } else {
                        None
                    }
                }
                Ok(None) => None,
                // The release-channel probe is best-effort: report "no update"
                // rather than failing a check that succeeded on the beta channel.
                Err(error) => {
                    tracing::warn!(
                        "Release-channel graduation probe failed: {error}"
                    );
                    None
                }
            }
        }
        None => None,
    };
    if !pending_data.0.lock().unwrap().select_checked(
        revision,
        checked.as_ref().map(|update| update.version.as_str()),
    ) {
        return Err(theseus::Error::from(theseus::ErrorKind::OtherError(
            "A newer launcher update check superseded this response"
                .to_string(),
        ))
        .into());
    }
    let Some(mut update) = checked else {
        return Ok(None);
    };
    update.timeout = Some(UPDATE_DOWNLOAD_TIMEOUT);

    // On Debian and derivatives the plugin's minisign signature check cannot
    // validate the unsigned .deb, so point the download at the deb from the
    // Update Server catalog instead of the AppImage artifact. Its integrity
    // is verified with the catalog's sha256/size during the download.
    if is_apt_linux() {
        update.download_url = fetch_apt_deb_asset(&update.version).await?.url;
    }

    let published_at = update
        .raw_json
        .get("published_at")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let force_update = update
        .raw_json
        .get("force_update")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let current_parsed =
        Version::parse(&update.current_version).map_err(Error::from)?;
    let target_parsed = Version::parse(&update.version).map_err(Error::from)?;
    // A beta-channel client being offered a final release (no prerelease
    // suffix) is graduating to the release channel.
    let channel_origin = if channel == "beta" && target_parsed.pre.is_empty() {
        Some(UpdateChannelOrigin::Release)
    } else {
        None
    };
    let metadata = UpdateMetadata {
        rollback: is_rollback(&current_parsed, &target_parsed),
        rid: webview.resources_table().add(update.clone()),
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: None,
        body: update.body.clone(),
        published_at,
        force_update,
        channel_origin,
        raw_json: update.raw_json,
    };

    Ok(Some(metadata))
}

// ── Tauri commands ───────────────────────────────────────────────

#[tauri::command]
pub async fn check_app_update<R: Runtime>(
    webview: Webview<R>,
    channel: String,
) -> Result<Option<UpdateMetadata>> {
    check_with_updater(&webview, &channel).await
}

// Reimplementation of Update::download mostly, minus the actual download part
#[tauri::command]
pub async fn get_update_size<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<Option<u64>> {
    let update = webview.resources_table().get::<Update>(rid)?;

    let mut headers = update.headers.clone();
    if !headers.contains_key(ACCEPT) {
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/octet-stream"),
        );
    }

    let mut request = ClientBuilder::new().user_agent(launcher_user_agent());
    if let Some(timeout) = update.timeout {
        request = request.timeout(timeout);
    }
    if let Some(ref proxy) = update.proxy {
        let proxy = reqwest::Proxy::all(proxy.as_str())?;
        request = request.proxy(proxy);
    }
    let response = request
        .build()?
        .head(update.download_url.clone())
        .headers(headers)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(Error::Network(format!(
            "Download request failed with status: {}",
            response.status()
        ))
        .into());
    }

    let content_length = response
        .headers()
        .get("Content-Length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok());

    Ok(content_length)
}

#[tauri::command]
pub async fn enqueue_update_for_installation<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
) -> Result<()> {
    let pending_data = webview.state::<PendingUpdateData>().inner();

    let update = webview.resources_table().get::<Update>(rid)?;

    if !pending_data.0.lock().unwrap().is_selected(&update.version) {
        return Err(theseus::Error::from(theseus::ErrorKind::OtherError(
            "The server-selected launcher version changed; check for updates again".to_string(),
        )).into());
    }

    let progress = init_loading(
        LoadingBarType::LauncherUpdate {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
        },
        1.0,
        "Downloading update...",
    )
    .await?;

    let download_start = Instant::now();
    let update_data = if is_apt_linux() {
        // The .deb carries no minisign signature, so the plugin's signed
        // download cannot be used. Fetch the catalog entry and verify the
        // downloaded bytes against its sha256 and size instead.
        let asset = fetch_apt_deb_asset(&update.version).await?;

        let mut headers = update.headers.clone();
        if !headers.contains_key(ACCEPT) {
            headers.insert(
                ACCEPT,
                HeaderValue::from_static("application/octet-stream"),
            );
        }

        let mut request =
            ClientBuilder::new().user_agent(launcher_user_agent());
        if let Some(timeout) = update.timeout {
            request = request.timeout(timeout);
        }
        if let Some(ref proxy) = update.proxy {
            let proxy = reqwest::Proxy::all(proxy.as_str())?;
            request = request.proxy(proxy);
        }
        let response = request
            .build()?
            .get(update.download_url.clone())
            .headers(headers)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(Error::Network(format!(
                "Download request failed with status: {}",
                response.status()
            ))
            .into());
        }

        let total_size = response.content_length().unwrap_or(asset.size);
        let mut buffer = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            buffer.extend_from_slice(&chunk);
            if total_size > 0 {
                if let Err(e) = emit_loading(
                    &progress,
                    buffer.len() as f64 / total_size as f64,
                    None,
                ) {
                    tracing::error!(
                        "Failed to update download progress bar: {e}"
                    );
                }
            }
        }

        if buffer.len() as u64 != asset.size {
            return Err(theseus::Error::from(theseus::ErrorKind::OtherError(
                format!(
                    "Downloaded deb size mismatch: expected {}, got {}",
                    asset.size,
                    buffer.len()
                ),
            ))
            .into());
        }

        let digest = Sha256::digest(&buffer);
        let digest_hex = digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        if digest_hex != asset.sha256 {
            return Err(theseus::Error::from(theseus::ErrorKind::OtherError(
                "Downloaded deb sha256 mismatch".to_string(),
            ))
            .into());
        }

        buffer
    } else {
        update
            .download(
                |chunk_size, total_size| {
                    let Some(total_size) = total_size else {
                        return;
                    };
                    if let Err(e) = emit_loading(
                        &progress,
                        chunk_size as f64 / total_size as f64,
                        None,
                    ) {
                        tracing::error!(
                            "Failed to update download progress bar: {e}"
                        );
                    }
                },
                || {},
            )
            .await?
    };
    let download_duration = download_start.elapsed();
    tracing::info!("Downloaded update in {download_duration:?}");

    let version = update.version.clone();
    if !pending_data
        .0
        .lock()
        .unwrap()
        .enqueue(&version, (update, update_data))
    {
        return Err(theseus::Error::from(theseus::ErrorKind::OtherError(
            "The server-selected launcher version changed during download"
                .to_string(),
        ))
        .into());
    }

    Ok(())
}

#[tauri::command]
pub fn remove_enqueued_update<R: Runtime>(webview: Webview<R>) {
    let pending_data = webview.state::<PendingUpdateData>().inner();
    let mut pending = pending_data.0.lock().unwrap();
    pending.begin_check();
    pending.select(None);
}

// ── Debian / derivatives apt update ─────────────────────────────

/// Whether this Linux system updates Axolotl through apt (Debian and its
/// derivatives) and has `pkexec` available for a single privileged prompt.
#[tauri::command]
pub fn is_apt_linux() -> bool {
    #[cfg(target_os = "linux")]
    {
        let debian_like = std::path::Path::new("/etc/debian_version").exists()
            || std::path::Path::new("/etc/apt").is_dir()
            || std::path::Path::new("/usr/bin/apt-get").exists();
        let has_pkexec = ["/usr/bin/pkexec", "/bin/pkexec"]
            .iter()
            .any(|path| std::path::Path::new(path).exists());
        debian_like && has_pkexec
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Install the downloaded .deb on Debian and its derivatives, prompting for
/// root once via `pkexec`. The package is installed from the absolute path
/// of a temporary file, which is removed afterwards.
pub async fn install_apt_package(version: &str, data: &[u8]) -> Result<()> {
    if !is_apt_linux() {
        return Err(theseus::Error::from(theseus::ErrorKind::OtherError(
            "apt updates are only supported on Debian-based Linux systems with pkexec"
                .to_string(),
        ))
        .into());
    }

    let arch = apt_deb_arch()?;
    let deb_path = std::env::temp_dir()
        .join(format!("Axolotl.Launcher_{version}_{arch}.deb"));
    std::fs::write(&deb_path, data).map_err(|io| {
        theseus::Error::from(theseus::ErrorKind::OtherError(format!(
            "Failed to write the downloaded deb: {io}"
        )))
    })?;
    let _deb_cleanup = TempDebFile(deb_path.clone());

    let install_path = deb_path.clone();
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("pkexec")
            .arg("apt")
            .arg("install")
            .arg("-y")
            .arg("--allow-downgrades")
            .arg(&install_path)
            .output()
    })
    .await
    .map_err(|join| {
        theseus::Error::from(theseus::ErrorKind::OtherError(format!(
            "Failed to run the apt updater: {join}"
        )))
    })?
    .map_err(|io| {
        theseus::Error::from(theseus::ErrorKind::OtherError(format!(
            "Failed to start pkexec: {io}"
        )))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(theseus::Error::from(theseus::ErrorKind::OtherError(
            format!("apt install failed: {}", stderr.trim()),
        ))
        .into());
    }

    Ok(())
}

/// Removes a temporary Debian package when installation finishes or fails.
///
/// The installer awaits a blocking task and has several fallible operations
/// after creating the file. Keeping cleanup in `Drop` makes every return path
/// (including task and process-launch errors) remove the package.
struct TempDebFile(std::path::PathBuf);

impl Drop for TempDebFile {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_file(&self.0) {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    path = %self.0.display(),
                    error = %error,
                    "Failed to remove temporary deb file"
                );
            }
        }
    }
}
