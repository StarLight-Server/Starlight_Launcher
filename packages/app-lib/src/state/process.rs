use crate::event::emit::{emit_instance, emit_process};
use crate::event::{InstancePayloadType, ProcessPayloadType};
#[cfg(feature = "tauri")]
use crate::event::{LogEvent, LogPayload};
use crate::util::io::IOError;
use crate::util::rpc::RpcServer;
use chrono::{DateTime, Duration, NaiveDateTime, TimeZone, Utc};
use dashmap::DashMap;
use quick_xml::Reader;
use quick_xml::events::Event;
use serde::Deserialize;
use serde::Serialize;
use std::collections::{BTreeMap, VecDeque};
use std::fmt::Debug;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::sync::LazyLock;
use std::time::Instant;
#[cfg(feature = "tauri")]
use tauri::Emitter;
use tempfile::TempDir;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use uuid::Uuid;

const LAUNCHER_LOG_PATH: &str = "launcher_log.txt";
const LOG_BUFFER_CAPACITY: usize = 10_000;
const LOG_BUFFER_BYTE_CAPACITY: usize = 4 * 1024 * 1024;
const MAX_LIVE_LOG_LINE_BYTES: usize = 64 * 1024;
const MAX_PERSISTED_LOG_LINE_BYTES: usize = 256 * 1024;
const LOG_TRUNCATION_MARKER: &str = " … [log output truncated by Axolotl] … ";
const PROCESS_INITIALIZATION_TIMEOUT: std::time::Duration =
    std::time::Duration::from_secs(15);

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct CrashReportSnapshot {
    readable: bool,
    files: BTreeMap<String, (u64, Option<std::time::SystemTime>)>,
}

async fn snapshot_crash_reports(path: &Path) -> CrashReportSnapshot {
    let mut snapshot = CrashReportSnapshot {
        readable: true,
        files: BTreeMap::new(),
    };
    let mut entries = match tokio::fs::read_dir(path).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return snapshot;
        }
        Err(error) => {
            tracing::warn!(
                "Failed to read crash reports directory {}: {error}",
                path.display()
            );
            snapshot.readable = false;
            return snapshot;
        }
    };
    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => break,
            Err(error) => {
                tracing::warn!(
                    "Failed to scan crash reports directory {}: {error}",
                    path.display()
                );
                snapshot.readable = false;
                break;
            }
        };
        let metadata = match entry.metadata().await {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => continue,
            Err(_) => {
                snapshot.readable = false;
                continue;
            }
        };
        snapshot.files.insert(
            entry.file_name().to_string_lossy().to_string(),
            (metadata.len(), metadata.modified().ok()),
        );
    }
    snapshot
}

fn crash_reports_changed(
    before: &CrashReportSnapshot,
    after: &CrashReportSnapshot,
) -> bool {
    !before.readable || !after.readable || before.files != after.files
}

async fn record_post_upgrade_launch_best_effort(
    instance_id: &str,
    clean: bool,
) {
    let Ok(state) = crate::State::get().await else {
        return;
    };
    if let Err(error) =
        crate::state::instances::commands::record_instance_post_upgrade_launch(
            instance_id,
            clean,
            &state.pool,
        )
        .await
    {
        tracing::warn!(
            "Failed to update post-upgrade launch state for {instance_id}: {error}"
        );
    }
}

struct LogRingBuffer {
    lines: VecDeque<SequencedLogLine>,
    byte_len: usize,
    last_sequence: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SequencedLogLine {
    pub sequence: u64,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiveLogSnapshot {
    pub lines: Vec<SequencedLogLine>,
    pub last_sequence: u64,
}

impl LogRingBuffer {
    fn new() -> Self {
        Self {
            lines: VecDeque::new(),
            byte_len: 0,
            last_sequence: 0,
        }
    }

    fn push(&mut self, message: String) -> u64 {
        self.last_sequence = self.last_sequence.saturating_add(1);
        let sequence = self.last_sequence;
        let line = SequencedLogLine { sequence, message };
        let line_len = line.message.len();
        while self.lines.len() >= LOG_BUFFER_CAPACITY
            || self.byte_len.saturating_add(line_len) > LOG_BUFFER_BYTE_CAPACITY
        {
            let Some(removed) = self.lines.pop_front() else {
                break;
            };
            self.byte_len = self.byte_len.saturating_sub(removed.message.len());
        }
        self.byte_len += line_len;
        self.lines.push_back(line);
        sequence
    }

    fn get_all(&self) -> Vec<String> {
        self.lines.iter().map(|line| line.message.clone()).collect()
    }

    fn snapshot(&self) -> LiveLogSnapshot {
        LiveLogSnapshot {
            lines: self.lines.iter().cloned().collect(),
            last_sequence: self.last_sequence,
        }
    }

    fn clear(&mut self) {
        self.lines.clear();
        self.byte_len = 0;
    }
}

static LOG_BUFFERS: LazyLock<DashMap<String, LogRingBuffer>> =
    LazyLock::new(DashMap::new);

pub fn push_log_line(instance_id: &str, line: String) {
    push_log_lines(instance_id, std::iter::once(line));
}

fn push_log_lines(
    instance_id: &str,
    lines: impl IntoIterator<Item = String>,
) -> Option<(u64, u64)> {
    let mut buffer = LOG_BUFFERS
        .entry(instance_id.to_string())
        .or_insert_with(LogRingBuffer::new);
    let mut first_sequence = None;
    let mut last_sequence = 0;
    for line in lines {
        let sequence = buffer.push(truncate_live_log_text(&line));
        first_sequence.get_or_insert(sequence);
        last_sequence = sequence;
    }
    first_sequence.map(|first| (first, last_sequence))
}

fn truncate_live_log_text(value: &str) -> String {
    if value.len() <= MAX_LIVE_LOG_LINE_BYTES {
        return value.to_string();
    }

    let retained_bytes =
        MAX_LIVE_LOG_LINE_BYTES.saturating_sub(LOG_TRUNCATION_MARKER.len());
    let prefix_end = char_boundary_before(value, retained_bytes / 2);
    let suffix_start = char_boundary_after(
        value,
        value.len().saturating_sub(retained_bytes - prefix_end),
    );
    format!(
        "{}{}{}",
        &value[..prefix_end],
        LOG_TRUNCATION_MARKER,
        &value[suffix_start..]
    )
}

fn char_boundary_before(value: &str, mut index: usize) -> usize {
    index = index.min(value.len());
    while index > 0 && !value.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn char_boundary_after(value: &str, mut index: usize) -> usize {
    index = index.min(value.len());
    while index < value.len() && !value.is_char_boundary(index) {
        index += 1;
    }
    index
}

fn append_bounded_log4j_content(buffer: &mut String, text: &str) {
    let retained_bytes = MAX_PERSISTED_LOG_LINE_BYTES
        .saturating_sub(LOG_TRUNCATION_MARKER.len());
    if buffer.len() >= retained_bytes {
        if !buffer.ends_with(LOG_TRUNCATION_MARKER) {
            buffer.push_str(LOG_TRUNCATION_MARKER);
        }
        return;
    }

    let available = retained_bytes.saturating_sub(buffer.len());
    if text.len() <= available {
        buffer.push_str(text);
        return;
    }

    let end = char_boundary_before(text, available);
    buffer.push_str(&text[..end]);
    buffer.push_str(LOG_TRUNCATION_MARKER);
}

pub fn get_log_buffer(instance_id: &str) -> Vec<String> {
    LOG_BUFFERS
        .get(instance_id)
        .map(|buf| buf.get_all())
        .unwrap_or_default()
}

pub fn get_live_log_snapshot(instance_id: &str) -> LiveLogSnapshot {
    LOG_BUFFERS
        .get(instance_id)
        .map(|buffer| buffer.snapshot())
        .unwrap_or(LiveLogSnapshot {
            lines: Vec::new(),
            last_sequence: 0,
        })
}

pub fn clear_log_buffer(instance_id: &str) {
    if let Some(mut buf) = LOG_BUFFERS.get_mut(instance_id) {
        buf.clear();
    }
}

pub fn remove_log_buffer(instance_id: &str) {
    LOG_BUFFERS.remove(instance_id);
}

pub struct ProcessManager {
    processes: DashMap<Uuid, Process>,
    manual_kills: DashMap<String, Instant>,
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            processes: DashMap::new(),
            manual_kills: DashMap::new(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_new_process(
        &self,
        instance_id: &str,
        instance_path: &str,
        instance_name: &str,
        mut mc_command: Command,
        post_exit_command: Option<String>,
        maximize_window: bool,
        window_title: Option<String>,
        game_dir: PathBuf,
        logs_folder: PathBuf,
        xml_logging: bool,
        main_class_keep_alive: TempDir,
        rpc_server: RpcServer,
        post_process_init: impl AsyncFnOnce(
            &ProcessMetadata,
            &RpcServer,
        ) -> crate::Result<()>,
    ) -> crate::Result<ProcessMetadata> {
        mc_command.stdout(std::process::Stdio::piped());
        mc_command.stderr(std::process::Stdio::piped());
        mc_command.stdin(std::process::Stdio::piped());

        let mut mc_proc = mc_command.spawn().map_err(IOError::from)?;

        let stdout = mc_proc.stdout.take();
        let stderr = mc_proc.stderr.take();

        let mut process = Process {
            metadata: ProcessMetadata {
                uuid: Uuid::new_v4(),
                pid: mc_proc.id().unwrap_or_default(),
                maximize_window,
                window_title: window_title.clone(),
                start_time: Utc::now(),
                instance_id: instance_id.to_string(),
                instance_path: instance_path.to_string(),
                instance_name: instance_name.to_string(),
            },
            child: mc_proc,
            manually_killed: false,
            output_tasks: Vec::new(),
            rpc_server,
            _main_class_keep_alive: main_class_keep_alive,
        };

        let metadata = process.metadata.clone();

        if !logs_folder.exists() {
            tokio::fs::create_dir_all(&logs_folder)
                .await
                .map_err(|e| IOError::with_path(e, &logs_folder))?;
        }

        let log_path = logs_folder.join(LAUNCHER_LOG_PATH);

        let already_running = self
            .get_all()
            .iter()
            .any(|process| process.instance_id == instance_id);
        if !already_running {
            clear_log_buffer(instance_id);
        }

        {
            let mut log_file = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(!already_running)
                .append(already_running)
                .open(&log_path)
                .map_err(|e| IOError::with_path(e, &log_path))?;

            // Initialize with timestamp header
            let now = chrono::Local::now();
            writeln!(
                log_file,
                "# Minecraft launcher log started at {}",
                now.format("%Y-%m-%d %H:%M:%S")
            )
            .map_err(|e| IOError::with_path(e, &log_path))?;
            writeln!(log_file, "# Instance: {instance_path} \n")
                .map_err(|e| IOError::with_path(e, &log_path))?;
            writeln!(log_file).map_err(|e| IOError::with_path(e, &log_path))?;
        }

        if let Some(stdout) = stdout {
            let log_path_clone = log_path.clone();

            let instance_id = metadata.instance_id.clone();
            let instance_path = metadata.instance_path.clone();
            let instance_name = metadata.instance_name.clone();
            let process_id = metadata.uuid.to_string();
            process.output_tasks.push(tokio::spawn(async move {
                Process::process_output(
                    &instance_id,
                    &instance_path,
                    &instance_name,
                    &process_id,
                    stdout,
                    log_path_clone,
                    xml_logging,
                )
                .await;
            }));
        }

        if let Some(stderr) = stderr {
            let log_path_clone = log_path.clone();

            let instance_id = metadata.instance_id.clone();
            let instance_path = metadata.instance_path.clone();
            let instance_name = metadata.instance_name.clone();
            let process_id = metadata.uuid.to_string();
            process.output_tasks.push(tokio::spawn(async move {
                Process::process_output(
                    &instance_id,
                    &instance_path,
                    &instance_name,
                    &process_id,
                    stderr,
                    log_path_clone,
                    xml_logging,
                )
                .await;
            }));
        }

        let initialization_result = {
            let initialization_metadata = process.metadata.clone();
            let initialization_rpc = process.rpc_server.clone();
            let initialization = post_process_init(
                &initialization_metadata,
                &initialization_rpc,
            );
            tokio::pin!(initialization);
            tokio::select! {
                result = &mut initialization => result,
                exit_status = process.child.wait() => {
                    let exit_status = exit_status.map_err(IOError::from)?;
                    for output_task in process.output_tasks.drain(..) {
                        if let Err(error) = output_task.await {
                            tracing::warn!(%error, "Minecraft output task failed");
                        }
                    }
                    let _ = Process::append_to_log_file(
                        &log_path,
                        &format!("\n# Process exited with status: {exit_status}\n"),
                    );
                    record_post_upgrade_launch_best_effort(instance_id, false).await;
                    return Err(crate::ErrorKind::LauncherError(format!(
                        "Minecraft exited before launcher initialization completed ({exit_status}). Check the selected Java version, wrapper command, and launcher log.",
                    ))
                    .as_error());
                }
                _ = tokio::time::sleep(PROCESS_INITIALIZATION_TIMEOUT) => {
                    let _ = process.child.kill().await;
                    record_post_upgrade_launch_best_effort(instance_id, false).await;
                    return Err(crate::ErrorKind::LauncherError(
                        "Minecraft launcher initialization did not respond within 15 seconds. Check the selected Java version and wrapper command."
                            .to_string(),
                    )
                    .as_error());
                }
            }
        };
        if let Err(error) = initialization_result {
            tracing::error!("Failed to run post-process init: {error}");
            let _ = process.child.kill().await;
            record_post_upgrade_launch_best_effort(instance_id, false).await;
            return Err(error);
        }

        let crash_reports_before = match crate::State::get().await {
            Ok(state) => Some(
                snapshot_crash_reports(
                    &state.directories.game_crash_reports_dir(&game_dir),
                )
                .await,
            ),
            Err(error) => {
                tracing::warn!(
                    "Failed to snapshot crash reports before launch: {error}"
                );
                None
            }
        };

        self.processes.insert(process.metadata.uuid, process);

        tokio::spawn(Process::sequential_process_manager(
            instance_id.to_string(),
            instance_path.to_string(),
            game_dir,
            logs_folder,
            post_exit_command,
            metadata.uuid,
            metadata.pid,
            metadata.maximize_window,
            crash_reports_before,
        ));

        emit_process(
            instance_id,
            metadata.uuid,
            metadata.pid,
            metadata.maximize_window,
            metadata.window_title.clone(),
            ProcessPayloadType::Launched,
            "Launched Minecraft",
            None,
        )
        .await?;

        Ok(metadata)
    }

    pub fn get(&self, id: Uuid) -> Option<ProcessMetadata> {
        self.processes.get(&id).map(|x| x.metadata.clone())
    }

    pub fn get_rpc(&self, id: Uuid) -> Option<RpcServer> {
        self.processes.get(&id).map(|x| x.rpc_server.clone())
    }

    pub fn get_all(&self) -> Vec<ProcessMetadata> {
        self.processes
            .iter()
            .map(|x| x.value().metadata.clone())
            .collect()
    }

    /// Whether any tracked process belongs to the given instance.
    pub fn has_instance_process(&self, instance_id: &str) -> bool {
        self.processes
            .iter()
            .any(|entry| entry.value().metadata.instance_id == instance_id)
    }

    pub fn try_wait(
        &self,
        id: Uuid,
    ) -> crate::Result<Option<Option<ExitStatus>>> {
        if let Some(mut process) = self.processes.get_mut(&id) {
            Ok(Some(process.child.try_wait()?))
        } else {
            Ok(None)
        }
    }

    pub async fn wait_for(&self, id: Uuid) -> crate::Result<()> {
        while matches!(self.try_wait(id)?, Some(None)) {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        Ok(())
    }

    pub async fn kill(&self, id: Uuid) -> crate::Result<()> {
        if let Some(mut process) = self.processes.get_mut(&id) {
            process.manually_killed = true;
            if let Err(error) = process.child.start_kill() {
                process.manually_killed = false;
                return Err(error.into());
            }
            self.manual_kills
                .insert(process.metadata.instance_id.clone(), Instant::now());
        }

        Ok(())
    }

    /// Whether the given instance was stopped by the user recently enough
    /// that crash-report files written during shutdown should be ignored.
    pub fn instance_was_manually_killed(&self, instance_id: &str) -> bool {
        self.manual_kills
            .get(instance_id)
            .is_some_and(|killed| killed.elapsed() < std::time::Duration::from_secs(120))
    }

    fn remove(&self, id: Uuid) -> Option<Process> {
        self.processes.remove(&id).map(|(_, process)| process)
    }

    fn was_manually_killed(&self, id: Uuid) -> bool {
        self.processes
            .get(&id)
            .is_some_and(|process| process.manually_killed)
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ProcessMetadata {
    pub uuid: Uuid,
    pub pid: u32,
    pub maximize_window: bool,
    pub window_title: Option<String>,
    pub instance_id: String,
    pub instance_path: String,
    pub instance_name: String,
    pub start_time: DateTime<Utc>,
}

#[derive(Debug)]
struct Process {
    metadata: ProcessMetadata,
    child: Child,
    manually_killed: bool,
    output_tasks: Vec<tokio::task::JoinHandle<()>>,
    _main_class_keep_alive: TempDir,
    rpc_server: RpcServer,
}

#[derive(Debug, Default, Serialize, Clone)]
pub struct Log4jEvent {
    pub timestamp_millis: Option<i64>,
    pub logger_name: Option<String>,
    pub level: Option<String>,
    pub thread_name: Option<String>,
    pub message: Option<String>,
    pub throwable: Option<String>,
}

impl Process {
    async fn read_bounded_output_line<R>(
        reader: &mut R,
    ) -> std::io::Result<Option<String>>
    where
        R: AsyncBufRead + Unpin,
    {
        let mut line = Vec::new();
        let mut saw_bytes = false;
        let mut truncated = false;

        loop {
            let (consumed, reached_line_end) = {
                let available = reader.fill_buf().await?;
                if available.is_empty() {
                    if !saw_bytes {
                        return Ok(None);
                    }
                    break;
                }

                saw_bytes = true;
                let consumed = available
                    .iter()
                    .position(|byte| *byte == b'\n')
                    .map_or(available.len(), |index| index + 1);
                let maximum_content_bytes = MAX_PERSISTED_LOG_LINE_BYTES
                    .saturating_sub(LOG_TRUNCATION_MARKER.len() + 1);
                let remaining =
                    maximum_content_bytes.saturating_sub(line.len());
                let copied = remaining.min(consumed);
                line.extend_from_slice(&available[..copied]);
                truncated |= copied < consumed;
                (consumed, available[consumed - 1] == b'\n')
            };
            reader.consume(consumed);
            if reached_line_end {
                break;
            }
        }

        if truncated {
            while matches!(line.last(), Some(b'\r' | b'\n')) {
                line.pop();
            }
            line.extend_from_slice(LOG_TRUNCATION_MARKER.as_bytes());
            line.push(b'\n');
        }

        Ok(Some(String::from_utf8_lossy(&line).into_owned()))
    }

    async fn process_output<R>(
        instance_id: &str,
        _instance_path: &str,
        instance_name: &str,
        process_id: &str,
        reader: R,
        log_path: impl AsRef<Path>,
        xml_logging: bool,
    ) where
        R: tokio::io::AsyncRead + Unpin,
    {
        let mut buf_reader = BufReader::new(reader);

        if xml_logging {
            // NOTE: we deliberately do NOT use quick-xml's streaming async reader
            // here. Its parser marks itself `ParseState::Done` permanently after
            // any I/O/parse error or a transient `Eof` (see quick-xml #513), so a
            // single split XML frame on the live pipe would silently kill all
            // further log forwarding — which is exactly the "logs stop after the
            // client finished starting" bug.
            //
            // Instead we accumulate raw bytes into a buffer and cut out complete
            // `<log4j:Event ...>…</log4j:Event>` frames, parsing each frame in one
            // synchronous pass. Malformed or partial frames are skipped without
            // poisoning the stream, so forwarding always continues.
            let mut pending = String::new();
            let mut chunk = [0u8; 8192];

            loop {
                let read = match tokio::io::AsyncReadExt::read(
                    &mut buf_reader,
                    &mut chunk,
                )
                .await
                {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(e) => {
                        tracing::warn!("Live log read error: {e}");
                        break;
                    }
                };

                pending.push_str(&String::from_utf8_lossy(&chunk[..read]));

                // Mods can write plain text to either pipe even when the
                // launcher selected XML logging. Forward it as soon as a line
                // is complete instead of retaining it until the game exits.
                while let Some(output) = take_next_log_output(&mut pending) {
                    match output {
                        LogOutput::Xml(frame) => {
                            Self::handle_log4j_frame(
                                instance_id,
                                instance_name,
                                process_id,
                                log_path.as_ref(),
                                &frame,
                            )
                            .await;
                        }
                        LogOutput::Legacy(text) => {
                            if let Err(e) =
                                Self::append_to_log_file(&log_path, &text)
                            {
                                tracing::warn!(
                                    "Failed to write to log file: {e}"
                                );
                            }
                            if !text.trim_end().is_empty() {
                                Self::emit_legacy_log(
                                    instance_id,
                                    text.trim_end(),
                                );
                            }
                        }
                    }
                }

                // Guard against a runaway buffer if no frame delimiters ever
                // appear (e.g. raw non-XML output on a logging-configured
                // instance). Flush it as legacy text so it is not lost.
                if pending.len() > MAX_PERSISTED_LOG_LINE_BYTES {
                    let text = std::mem::take(&mut pending);
                    if let Err(e) = Self::append_to_log_file(&log_path, &text) {
                        tracing::warn!("Failed to write to log file: {e}");
                    }
                    Self::emit_legacy_log(instance_id, text.trim_end());
                }
            }

            // Flush any trailing partial content on stream end.
            if !pending.trim().is_empty() {
                if let Err(e) = Self::append_to_log_file(&log_path, &pending) {
                    tracing::warn!("Failed to write to log file: {e}");
                }
                Self::emit_legacy_log(instance_id, pending.trim_end());
            }
        } else {
            while let Ok(Some(line)) =
                Self::read_bounded_output_line(&mut buf_reader).await
            {
                if !line.is_empty() {
                    if let Err(e) = Self::append_to_log_file(&log_path, &line) {
                        tracing::warn!("Failed to write to log file: {}", e);
                    }
                    Self::emit_legacy_log(instance_id, line.trim_ascii_end());
                    crate::api::multiplayer::observe_minecraft_log(
                        instance_id,
                        instance_name,
                        process_id,
                        line.trim_ascii_end(),
                    )
                    .await;
                    if let Err(e) = Self::maybe_handle_old_server_join_logging(
                        instance_id,
                        line.trim_ascii_end(),
                    )
                    .await
                    {
                        tracing::error!(
                            "Failed to handle old server join logging: {e}"
                        );
                    }
                }
            }
        }
    }

    /// Parses one complete `<log4j:Event …>…</log4j:Event>` frame and forwards
    /// its content to the log file / frontend. A frame that fails to parse is
    /// logged and dropped; it never stops the reader loop.
    async fn handle_log4j_frame(
        instance_id: &str,
        instance_name: &str,
        process_id: &str,
        log_path: &Path,
        frame: &str,
    ) {
        let mut reader = Reader::from_str(frame);
        reader.config_mut().enable_all_checks(false);

        let mut current_event = Log4jEvent::default();
        let mut in_message = false;
        let mut in_throwable = false;
        let mut current_content = String::new();

        let mut buf = Vec::new();
        loop {
            match reader.read_event_into(&mut buf) {
                Err(e) => {
                    tracing::warn!("Malformed live log frame: {e}");
                    break;
                }
                Ok(Event::Eof) => break,
                Ok(Event::Start(e)) => match e.name().as_ref() {
                    b"log4j:Event" => {
                        current_event = Log4jEvent::default();
                        for attr in e.attributes().flatten() {
                            let key =
                                String::from_utf8_lossy(attr.key.into_inner())
                                    .to_string();
                            let value = String::from_utf8_lossy(&attr.value)
                                .to_string();
                            match key.as_str() {
                                "logger" => {
                                    current_event.logger_name = Some(value)
                                }
                                "level" => current_event.level = Some(value),
                                "thread" => {
                                    current_event.thread_name = Some(value)
                                }
                                "timestamp" => {
                                    current_event.timestamp_millis =
                                        value.parse::<i64>().ok()
                                }
                                _ => {}
                            }
                        }
                    }
                    b"log4j:Message" => {
                        in_message = true;
                        current_content = String::new();
                    }
                    b"log4j:Throwable" => {
                        in_throwable = true;
                        current_content = String::new();
                    }
                    _ => {}
                },
                Ok(Event::End(e)) => match e.name().as_ref() {
                    b"log4j:Message" => {
                        in_message = false;
                        current_event.message = Some(current_content.clone());
                    }
                    b"log4j:Throwable" => {
                        in_throwable = false;
                        current_event.throwable = if current_content.is_empty()
                        {
                            None
                        } else {
                            Some(current_content.clone())
                        };
                    }
                    b"log4j:Event" => {
                        if let Some(formatted) =
                            Self::format_log4j_entry(&current_event)
                        {
                            if let Err(e) =
                                Self::append_to_log_file(log_path, &formatted)
                            {
                                tracing::error!(
                                    "Failed to write to log file: {e}"
                                );
                            }
                            if let Some(ref throwable) = current_event.throwable
                                && let Err(e) = Self::append_to_log_file(
                                    log_path, throwable,
                                )
                            {
                                tracing::error!(
                                    "Failed to write throwable to log file: {e}"
                                );
                            }

                            if let Some(timestamp_millis) =
                                current_event.timestamp_millis
                            {
                                let timestamp = timestamp_millis.to_string();
                                let message = current_event
                                    .message
                                    .as_deref()
                                    .unwrap_or("")
                                    .trim();
                                crate::api::multiplayer::observe_minecraft_log(
                                    instance_id,
                                    instance_name,
                                    process_id,
                                    message,
                                )
                                .await;
                                if let Err(e) =
                                    Self::maybe_handle_server_join_logging(
                                        instance_id,
                                        &timestamp,
                                        message,
                                    )
                                    .await
                                {
                                    tracing::error!(
                                        "Failed to handle server join logging: {e}"
                                    );
                                }
                            }

                            Self::emit_log4j_event(instance_id, &current_event);
                        }
                    }
                    _ => {}
                },
                Ok(Event::Text(e)) => {
                    if (in_message || in_throwable)
                        && let Ok(text) = e.xml_content()
                    {
                        append_bounded_log4j_content(
                            &mut current_content,
                            &text,
                        );
                    }
                }
                Ok(Event::CData(e)) => {
                    if (in_message || in_throwable)
                        && let Ok(text) = e.xml_content()
                    {
                        append_bounded_log4j_content(
                            &mut current_content,
                            &text,
                        );
                    }
                }
                _ => (),
            }
            buf.clear();
        }
    }

    fn format_timestamp(timestamp_millis: Option<i64>) -> String {
        if let Some(timestamp_val) = timestamp_millis {
            let datetime_utc = if timestamp_val > i32::MAX as i64 {
                let secs = timestamp_val / 1000;
                let nsecs = ((timestamp_val % 1000) * 1_000_000) as u32;

                chrono::DateTime::<Utc>::from_timestamp(secs, nsecs)
                    .unwrap_or_default()
            } else {
                chrono::DateTime::<Utc>::from_timestamp_secs(timestamp_val)
                    .unwrap_or_default()
            };

            let datetime_local = datetime_utc.with_timezone(&chrono::Local);
            format!("[{}]", datetime_local.format("%H:%M:%S"))
        } else {
            "[??:??:??]".to_string()
        }
    }

    fn format_log4j_entry(event: &Log4jEvent) -> Option<String> {
        let message = event.message.as_ref()?;
        let thread = event.thread_name.as_deref().unwrap_or("");
        let level = event.level.as_deref().unwrap_or("");
        let logger = event.logger_name.as_deref().unwrap_or("");
        let formatted_time = Self::format_timestamp(event.timestamp_millis);

        Some(format!(
            "{} [{}] [{}{}]: {}\n",
            formatted_time,
            thread,
            if !logger.is_empty() {
                format!("{logger}/")
            } else {
                String::new()
            },
            level,
            message.trim()
        ))
    }

    fn emit_log4j_event(instance_id: &str, event: &Log4jEvent) {
        let mut event = event.clone();
        event.message = event.message.as_deref().map(truncate_live_log_text);
        event.throwable =
            event.throwable.as_deref().map(truncate_live_log_text);

        let mut lines = Vec::new();
        if let Some(formatted) = Self::format_log4j_entry(&event) {
            lines.push(formatted.trim_end().to_string());
        }
        if let Some(ref throwable) = event.throwable {
            for line in throwable.lines().filter(|l| !l.is_empty()) {
                lines.push(line.to_string());
            }
        }
        let Some((first_sequence, last_sequence)) =
            push_log_lines(instance_id, lines)
        else {
            return;
        };

        #[cfg(feature = "tauri")]
        {
            if let Ok(event_state) = crate::EventState::get() {
                let _ = event_state.app.emit(
                    "log",
                    LogPayload {
                        instance_id: instance_id.to_string(),
                        first_sequence,
                        last_sequence,
                        event: LogEvent::Log4j(event),
                    },
                );
            }
        }
        #[cfg(not(feature = "tauri"))]
        {
            let _ = (instance_id, event, first_sequence, last_sequence);
        }
    }

    fn emit_legacy_log(instance_id: &str, message: &str) {
        let message = truncate_live_log_text(message);
        let Some((first_sequence, last_sequence)) =
            push_log_lines(instance_id, std::iter::once(message.clone()))
        else {
            return;
        };

        #[cfg(feature = "tauri")]
        {
            if let Ok(event_state) = crate::EventState::get() {
                let _ = event_state.app.emit(
                    "log",
                    LogPayload {
                        instance_id: instance_id.to_string(),
                        first_sequence,
                        last_sequence,
                        event: LogEvent::Legacy { message },
                    },
                );
            }
        }
        #[cfg(not(feature = "tauri"))]
        {
            let _ = (instance_id, message, first_sequence, last_sequence);
        }
    }

    fn append_to_log_file(
        path: impl AsRef<Path>,
        line: &str,
    ) -> std::io::Result<()> {
        let mut file =
            OpenOptions::new().append(true).create(true).open(path)?;

        file.write_all(line.as_bytes())?;
        Ok(())
    }

    async fn maybe_handle_server_join_logging(
        instance_id: &str,
        timestamp: &str,
        message: &str,
    ) -> crate::Result<()> {
        let timestamp = timestamp
            .parse::<i64>()
            .map(|x| x / 1000)
            .map_err(|x| {
                crate::ErrorKind::OtherError(format!(
                    "Failed to parse timestamp: {x}"
                ))
            })
            .and_then(|x| {
                Utc.timestamp_opt(x, 0).single().ok_or_else(|| {
                    crate::ErrorKind::OtherError(
                        "Failed to convert timestamp to DateTime".to_string(),
                    )
                })
            })?;
        Self::parse_and_insert_server_join(instance_id, message, timestamp)
            .await
    }

    async fn maybe_handle_old_server_join_logging(
        instance_id: &str,
        line: &str,
    ) -> crate::Result<()> {
        if let Some((timestamp, message)) = line.split_once(" [CLIENT] [INFO] ")
        {
            let timestamp =
                NaiveDateTime::parse_from_str(timestamp, "%Y-%m-%d %H:%M:%S")?
                    .and_local_timezone(chrono::Local)
                    .map(|x| x.to_utc())
                    .single()
                    .unwrap_or_else(Utc::now);
            Self::parse_and_insert_server_join(instance_id, message, timestamp)
                .await
        } else {
            Self::parse_and_insert_server_join(instance_id, line, Utc::now())
                .await
        }
    }

    async fn parse_and_insert_server_join(
        instance_id: &str,
        message: &str,
        timestamp: DateTime<Utc>,
    ) -> crate::Result<()> {
        let Some(host_port_string) = message.strip_prefix("Connecting to ")
        else {
            return Ok(());
        };
        let Some((host, port_string)) = host_port_string.rsplit_once(", ")
        else {
            return Ok(());
        };
        let Some(port) = port_string.parse::<u16>().ok() else {
            return Ok(());
        };

        let state = crate::State::get().await?;
        crate::state::server_join_log::JoinLogEntry {
            instance_id: instance_id.to_owned(),
            host: host.to_string(),
            port,
            join_time: timestamp,
        }
        .upsert(&state.pool)
        .await?;
        {
            let instance_id = instance_id.to_owned();
            let host = host.to_owned();
            tokio::spawn(async move {
                let _ = emit_instance(
                    &instance_id,
                    InstancePayloadType::ServerJoined {
                        host,
                        port,
                        timestamp,
                    },
                )
                .await;
            });
        }

        Ok(())
    }

    // Spawns a new child process and inserts it into the hashmap
    // Also, as the process ends, it spawns the follow-up process if it exists
    // By convention, ExitStatus is last command's exit status, and we exit on the first non-zero exit status
    async fn sequential_process_manager(
        instance_id: String,
        instance_path: String,
        game_dir: PathBuf,
        logs_folder: PathBuf,
        post_exit_command: Option<String>,
        uuid: Uuid,
        pid: u32,
        _maximize_window: bool,
        crash_reports_before: Option<CrashReportSnapshot>,
    ) -> crate::Result<()> {
        async fn update_playtime(
            last_updated_playtime: &mut Instant,
            instance_id: &str,
            force_update: bool,
        ) {
            let elapsed = last_updated_playtime.elapsed().as_secs();
            if elapsed == 0 || (!force_update && elapsed < 60) {
                return;
            }

            let state = match crate::State::get().await {
                Ok(state) => state,
                Err(e) => {
                    tracing::warn!(
                        "Failed to get state for playtime update on instance {}: {}",
                        instance_id,
                        e
                    );
                    return;
                }
            };
            let ended_at = Utc::now();
            let elapsed_duration =
                Duration::seconds(elapsed.min(i64::MAX as u64) as i64);
            let started_at = ended_at - elapsed_duration;
            if let Err(e) =
                crate::state::instances::commands::add_instance_recent_playtime(
                    instance_id,
                    elapsed,
                    &state.pool,
                )
                .await
            {
                tracing::warn!(
                    "Failed to update playtime for instance {}: {}",
                    instance_id,
                    e
                );
            }
            if let Err(e) =
				crate::state::instances::commands::record_instance_daily_playtime(
					instance_id,
					started_at,
					ended_at,
					&state.pool,
				)
				.await
			{
				tracing::warn!(
					"Failed to record daily playtime for instance {}: {}",
					instance_id,
					e
				);
			}
            *last_updated_playtime = Instant::now();
        }

        // Wait on current Minecraft Child
        let mc_exit_status;
        let mut process_missing = false;
        let mut last_updated_playtime = Instant::now();

        let state = crate::State::get().await?;
        if let Err(e) =
            crate::state::instances::commands::record_instance_play_session(
                &instance_id,
                &state.pool,
            )
            .await
        {
            tracing::warn!(
                "Failed to record play session for instance {}: {}",
                instance_id,
                e
            );
        }
        loop {
            if let Some(process) = state.process_manager.try_wait(uuid)? {
                if let Some(t) = process {
                    mc_exit_status = t;
                    break;
                }
            } else {
                mc_exit_status = ExitStatus::default();
                process_missing = true;
                break;
            }

            // sleep for 10ms
            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

            // Auto-update playtime every minute
            update_playtime(&mut last_updated_playtime, &instance_id, false)
                .await;
        }

        let manually_killed = state.process_manager.was_manually_killed(uuid);
        if let Some(mut process) = state.process_manager.remove(uuid) {
            for output_task in process.output_tasks.drain(..) {
                if let Err(error) = output_task.await {
                    tracing::warn!(%error, "Minecraft output task failed");
                }
            }
        }
        if !state
            .process_manager
            .get_all()
            .iter()
            .any(|process| process.instance_id == instance_id)
        {
            crate::api::multiplayer::minecraft_process_finished(&instance_id)
                .await;
        }

        // Now fully complete- update playtime one last time
        update_playtime(&mut last_updated_playtime, &instance_id, true).await;

        let crash_reports_after = snapshot_crash_reports(
            &state.directories.game_crash_reports_dir(&game_dir),
        )
        .await;
        let clean_launch = mc_exit_status.success()
            && !manually_killed
            && !process_missing
            && crash_reports_before.as_ref().is_some_and(|before| {
                !crash_reports_changed(before, &crash_reports_after)
            });
        record_post_upgrade_launch_best_effort(&instance_id, clean_launch)
            .await;

        let log_path = logs_folder.join(LAUNCHER_LOG_PATH);

        if log_path.exists()
            && let Err(e) = Process::append_to_log_file(
                &log_path,
                &format!("\n# Process exited with status: {mc_exit_status}\n"),
            )
        {
            tracing::warn!("Failed to write exit status to log file: {}", e);
        }

        if mc_exit_status.success()
            && !manually_killed
            && let Err(error) =
                crate::api::logs::save_successful_mod_snapshot(&instance_id)
                    .await
        {
            tracing::warn!(
                %error,
                instance = %instance_id,
                "Failed to save successful launch Mod snapshot"
            );
        }

        emit_process(
            &instance_id,
            uuid,
            pid,
            false,
            None,
            ProcessPayloadType::Finished,
            "Exited process",
            Some(!mc_exit_status.success() && !manually_killed),
        )
        .await?;

        if mc_exit_status.success() {
            // We do not wait on the post exist command to finish running! We let it spawn + run on its own.
            // This behaviour may be changed in the future
            if let Some(hook) = post_exit_command {
                let mut cmd = shlex::split(&hook)
                    .ok_or_else(|| {
                        crate::ErrorKind::LauncherError(format!(
                            "Invalid post-exit command: {hook}",
                        ))
                    })?
                    .into_iter();

                if let Some(command) = cmd.next() {
                    // The post-exit hook runs in the instance's game working
                    // directory, which honours a per-instance override.
                    let game_dir = crate::state::instances::adapters::sqlite::instance_rows::get_instance_path_and_game_dir_override_by_id(
                        &instance_id,
                        &state.pool,
                    )
                    .await?
                    .map(|(path, override_dir)| {
                        state
                            .directories
                            .resolve_game_dir(&path, override_dir.as_deref())
                    })
                    .unwrap_or_else(|| {
                        state.directories.instances_dir().join(&instance_path)
                    });
                    let mut command = Command::new(command);
                    command.args(cmd).current_dir(game_dir);
                    command.spawn().map_err(IOError::from)?;
                }
            }
        }

        Ok(())
    }
}
#[derive(Debug, Eq, PartialEq)]
enum LogOutput {
    Xml(String),
    Legacy(String),
}

/// Drains complete XML frames or plain text in stream order. Partial frames
/// and plain text lines remain buffered until their next chunk arrives.
fn take_next_log_output(buffer: &mut String) -> Option<LogOutput> {
    const OPEN: &str = "<log4j:Event";
    const CLOSE: &str = "</log4j:Event>";

    match buffer.find(OPEN) {
        Some(0) => {
            let close = buffer.find(CLOSE)?;
            let end = close + CLOSE.len();
            Some(LogOutput::Xml(buffer.drain(..end).collect()))
        }
        Some(start) => Some(LogOutput::Legacy(buffer.drain(..start).collect())),
        None => {
            let end = buffer.find('\n')? + 1;
            Some(LogOutput::Legacy(buffer.drain(..end).collect()))
        }
    }
}
#[cfg(test)]
mod post_upgrade_tests {
    use super::*;

    #[test]
    fn mixed_log_output_keeps_partial_xml_and_multiline_messages() {
        let mut pending = "raw\n<log4j:Ev".to_string();
        assert_eq!(
            take_next_log_output(&mut pending),
            Some(LogOutput::Legacy("raw\n".into()))
        );
        assert_eq!(take_next_log_output(&mut pending), None);
        pending.push_str("ent><log4j:Message><![CDATA[first\nsecond");
        assert_eq!(take_next_log_output(&mut pending), None);
        pending.push_str("]]></log4j:Message></log4j:Event>\nafter\n");
        assert_eq!(take_next_log_output(&mut pending), Some(LogOutput::Xml("<log4j:Event><log4j:Message><![CDATA[first\nsecond]]></log4j:Message></log4j:Event>".into())));
        assert_eq!(
            take_next_log_output(&mut pending),
            Some(LogOutput::Legacy("\n".into()))
        );
        assert_eq!(
            take_next_log_output(&mut pending),
            Some(LogOutput::Legacy("after\n".into()))
        );
        assert!(pending.is_empty());
    }

    #[tokio::test]
    async fn xml_logging_forwards_plain_text_before_pipe_closes() {
        use tokio::io::AsyncWriteExt;

        let instance_id = Uuid::new_v4().to_string();
        let directory = tempfile::tempdir().unwrap();
        let log_path = directory.path().join("live.log");
        let (mut writer, reader) = tokio::io::duplex(1024);
        let output = Process::process_output(
            &instance_id,
            "instance",
            "Instance",
            "process",
            reader,
            &log_path,
            true,
        );
        tokio::pin!(output);
        writer.write_all(b"mod output\n").await.unwrap();
        let forwarded = async {
            loop {
                if get_log_buffer(&instance_id) == ["mod output"] {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        };
        tokio::select! {
            _ = &mut output => panic!("reader ended while writer is still open"),
            result = tokio::time::timeout(std::time::Duration::from_secs(1), forwarded) => {
                result.expect("plain text was buffered until EOF");
            }
        }
        assert_eq!(std::fs::read_to_string(&log_path).unwrap(), "mod output\n");
        drop(writer);
        output.await;
        remove_log_buffer(&instance_id);
    }

    #[tokio::test]
    async fn xml_logging_preserves_plain_text_before_xml_frames() {
        let instance_id = Uuid::new_v4().to_string();
        let directory = tempfile::tempdir().unwrap();
        let log_path = directory.path().join("mixed.log");
        let input = "mod output\n<log4j:Event level=\"INFO\"><log4j:Message><![CDATA[xml output]]></log4j:Message></log4j:Event>\n";
        Process::process_output(
            &instance_id,
            "instance",
            "Instance",
            "process",
            std::io::Cursor::new(input),
            &log_path,
            true,
        )
        .await;
        let lines = get_log_buffer(&instance_id);
        assert_eq!(lines.first().map(String::as_str), Some("mod output"));
        assert!(lines.iter().any(|line| line.contains("xml output")));
        remove_log_buffer(&instance_id);
    }

    #[test]
    fn live_log_snapshot_sequences_batches_and_preserves_position_after_clear()
    {
        let instance_id = Uuid::new_v4().to_string();
        assert_eq!(
            push_log_lines(
                &instance_id,
                ["first".to_string(), "second".to_string()]
            ),
            Some((1, 2))
        );
        assert_eq!(
            get_live_log_snapshot(&instance_id),
            LiveLogSnapshot {
                lines: vec![
                    SequencedLogLine {
                        sequence: 1,
                        message: "first".to_string(),
                    },
                    SequencedLogLine {
                        sequence: 2,
                        message: "second".to_string(),
                    },
                ],
                last_sequence: 2,
            }
        );

        clear_log_buffer(&instance_id);
        push_log_line(&instance_id, "third".to_string());
        assert_eq!(
            get_live_log_snapshot(&instance_id),
            LiveLogSnapshot {
                lines: vec![SequencedLogLine {
                    sequence: 3,
                    message: "third".to_string(),
                }],
                last_sequence: 3,
            }
        );
        remove_log_buffer(&instance_id);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn waiting_for_one_process_leaves_registry_available() {
        let manager = ProcessManager::new();
        let mut child = Command::new("powershell.exe");
        child
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ])
            .creation_flags(0x08000000)
            .kill_on_drop(true);
        let child = child.spawn().unwrap();
        let uuid = Uuid::new_v4();
        let rpc = crate::util::rpc::RpcServerBuilder::new()
            .launch()
            .await
            .unwrap();
        manager.processes.insert(
            uuid,
            Process {
                metadata: ProcessMetadata {
                    uuid,
                    pid: child.id().unwrap(),
                    maximize_window: false,
                    window_title: None,
                    instance_id: "first".into(),
                    instance_path: "first".into(),
                    instance_name: "First".into(),
                    start_time: Utc::now(),
                },
                child,
                manually_killed: false,
                output_tasks: Vec::new(),
                _main_class_keep_alive: tempfile::tempdir().unwrap(),
                rpc_server: rpc,
            },
        );
        let waiting = manager.wait_for(uuid);
        tokio::pin!(waiting);
        assert!(futures::poll!(&mut waiting).is_pending());
        assert!(!manager.processes.try_get(&uuid).is_locked());
        assert_eq!(manager.get_all().len(), 1);
        manager.kill(uuid).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), waiting)
            .await
            .unwrap()
            .unwrap();
        assert!(manager.was_manually_killed(uuid));
    }

    #[test]
    fn live_log_lines_are_truncated_on_character_boundaries() {
        let line = format!("prefix{}suffix", "你".repeat(40_000));
        let truncated = truncate_live_log_text(&line);

        assert!(truncated.is_char_boundary(truncated.len()));
        assert!(truncated.len() <= MAX_LIVE_LOG_LINE_BYTES);
        assert!(truncated.contains("truncated by Axolotl"));
        assert!(truncated.starts_with("prefix"));
        assert!(truncated.ends_with("suffix"));
    }

    #[test]
    fn log4j_content_stops_growing_after_the_limit() {
        let mut content = String::new();
        append_bounded_log4j_content(
            &mut content,
            &"你".repeat(MAX_PERSISTED_LOG_LINE_BYTES),
        );
        let length_after_overflow = content.len();
        append_bounded_log4j_content(&mut content, "ignored");

        assert!(content.len() <= MAX_PERSISTED_LOG_LINE_BYTES);
        assert_eq!(content.len(), length_after_overflow);
        assert!(content.contains("truncated by Axolotl"));
    }

    #[tokio::test]
    async fn bounded_output_reader_consumes_oversized_line() {
        let input =
            format!("{}\nnext\n", "x".repeat(MAX_PERSISTED_LOG_LINE_BYTES * 2));
        let mut reader = BufReader::new(std::io::Cursor::new(input));

        let first = Process::read_bounded_output_line(&mut reader)
            .await
            .unwrap()
            .unwrap();
        let second = Process::read_bounded_output_line(&mut reader)
            .await
            .unwrap()
            .unwrap();

        assert!(first.contains("truncated by Axolotl"));
        assert!(first.len() <= MAX_PERSISTED_LOG_LINE_BYTES);
        assert_eq!(second, "next\n");
    }

    #[test]
    fn new_or_modified_crash_report_marks_session_changed() {
        let before = CrashReportSnapshot {
            readable: true,
            files: BTreeMap::from([("old.txt".to_string(), (10, None))]),
        };
        let unchanged = before.clone();
        let mut added = before.clone();
        added.files.insert("new.txt".to_string(), (20, None));
        let mut modified = before.clone();
        modified.files.insert("old.txt".to_string(), (11, None));

        assert!(!crash_reports_changed(&before, &unchanged));
        assert!(crash_reports_changed(&before, &added));
        assert!(crash_reports_changed(&before, &modified));
    }
}
