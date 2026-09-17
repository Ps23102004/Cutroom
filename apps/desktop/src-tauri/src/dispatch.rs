use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use cutroom_core::{
    Asset, AssetInput, Clip, ClipColor, ClipInput, Composition, CompositionMutation, CoreError,
    Database, JobEnqueue, JobRecord, NativeReceipt, NativeReceiptLookup, OutputSpec, Project,
    ProjectInput, RationalTime, RationalTimeBase, Revision, TimelineOperation, Track, TrackInput,
};
use cutroom_jobs::JobEngine;
use cutroom_media::{CancellationToken, MediaEngine};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NativeRequest {
    pub command: String,
    #[serde(default)]
    pub operation_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub expected_version: Option<i64>,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NativeErrorPayload {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NativeResponse {
    Ok { ok: bool, data: Value },
    Err { ok: bool, error: NativeErrorPayload },
}

impl NativeResponse {
    fn success<T: Serialize>(data: T) -> Self {
        match serde_json::to_value(data) {
            Ok(data) => Self::Ok { ok: true, data },
            Err(error) => Self::failure("INTERNAL_ERROR", error.to_string()),
        }
    }

    fn failure(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Err {
            ok: false,
            error: NativeErrorPayload {
                code: code.into(),
                message: message.into(),
                details: None,
            },
        }
    }
}

pub struct AppState {
    inner: Mutex<NativeState>,
    registry_path: Option<PathBuf>,
    registry_receipts_path: Option<PathBuf>,
    native_runtime: bool,
}

struct NativeState {
    active_project_id: Option<String>,
    projects: HashMap<String, ProjectSession>,
    registry: HashMap<String, RegisteredProject>,
    registry_receipts: HashMap<String, RegistryReceipt>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct RegisteredProject {
    id: String,
    path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct RegistryReceipt {
    command: String,
    request_hash: String,
    response: Value,
}

struct ProjectSession {
    database: Arc<Mutex<Database>>,
    jobs: JobEngine,
    media: MediaEngine,
    asset_fps: HashMap<String, RationalTimeBase>,
    worker: OwnedWorker,
}

struct OwnedWorker {
    stop: Arc<AtomicBool>,
    join: Option<thread::JoinHandle<()>>,
}

impl OwnedWorker {
    fn start(jobs: JobEngine) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let join = thread::spawn(move || {
            while !worker_stop.load(Ordering::Acquire) {
                match jobs.run_once() {
                    Ok(Some(_)) => {}
                    Ok(None) => thread::sleep(Duration::from_millis(100)),
                    Err(cutroom_jobs::JobsError::Shutdown) => break,
                    // Persisted job failures are represented in the job row. A transient
                    // dispatcher failure must not kill the owned worker or strand later work.
                    Err(_) => thread::sleep(Duration::from_millis(100)),
                }
            }
        });
        Self {
            stop,
            join: Some(join),
        }
    }

    fn stop_and_wait(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

impl ProjectSession {
    fn shutdown(&mut self) {
        let _ = self.jobs.shutdown();
        self.worker.stop_and_wait();
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    /// Pure Rust tests intentionally get no discovery store. Production must use
    /// `try_with_registry_path` so project discovery survives a native restart.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(NativeState {
                active_project_id: None,
                projects: HashMap::new(),
                registry: HashMap::new(),
                registry_receipts: HashMap::new(),
            }),
            registry_path: None,
            registry_receipts_path: None,
            native_runtime: false,
        }
    }

    pub fn try_with_registry_path(path: PathBuf) -> io::Result<Self> {
        let registry = load_registry(&path)?;
        let receipts_path = registry_receipts_path(&path);
        let registry_receipts = load_registry_receipts(&receipts_path)?;
        Ok(Self {
            inner: Mutex::new(NativeState {
                active_project_id: None,
                projects: HashMap::new(),
                registry,
                registry_receipts,
            }),
            registry_path: Some(path),
            registry_receipts_path: Some(receipts_path),
            native_runtime: true,
        })
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        if let Ok(native) = self.inner.get_mut() {
            for session in native.projects.values_mut() {
                session.shutdown();
            }
        }
    }
}

fn load_registry(path: &Path) -> io::Result<HashMap<String, RegisteredProject>> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(error),
    };
    let projects: Vec<RegisteredProject> = serde_json::from_slice(&bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let mut registry = HashMap::new();
    for project in projects {
        if Uuid::parse_str(&project.id).is_err() || project.path.trim().is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "project registry contains an invalid entry",
            ));
        }
        if registry.insert(project.id.clone(), project).is_some() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "project registry contains duplicate project IDs",
            ));
        }
    }
    Ok(registry)
}

fn persist_registry(
    registry_path: Option<&PathBuf>,
    registry: &HashMap<String, RegisteredProject>,
) -> Result<(), DispatchError> {
    let Some(path) = registry_path else {
        return Ok(());
    };
    let parent = path.parent().ok_or_else(|| {
        DispatchError::new("INTERNAL_ERROR", "project registry has no parent directory")
    })?;
    fs::create_dir_all(parent)
        .map_err(|error| DispatchError::new("INTERNAL_ERROR", error.to_string()))?;
    let mut entries: Vec<_> = registry.values().cloned().collect();
    entries.sort_by(|left, right| left.id.cmp(&right.id));
    let encoded = serde_json::to_vec(&entries)
        .map_err(|error| DispatchError::new("INTERNAL_ERROR", error.to_string()))?;
    let temporary = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    fs::write(&temporary, encoded)
        .map_err(|error| DispatchError::new("INTERNAL_ERROR", error.to_string()))?;
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        DispatchError::new("INTERNAL_ERROR", error.to_string())
    })
}

/// The registry is a discovery index rather than the authority for project
/// contents. Reserving its deterministic native project ID before SQLite work
/// gives restart preflight a path to reconcile a committed project receipt.
fn reserve_project_registry(
    state: &AppState,
    operation_id: &str,
    path: &str,
) -> Result<bool, DispatchError> {
    let mut native = state
        .inner
        .lock()
        .map_err(|_| DispatchError::new("INTERNAL_ERROR", "native state mutex poisoned"))?;
    match native.registry.get(operation_id) {
        Some(existing) if existing.path == path => return Ok(false),
        Some(_) => {
            return Err(DispatchError::new(
                "IDEMPOTENCY_CONFLICT",
                "operation_id was already reserved for another project folder",
            ));
        }
        None => {}
    }
    let mut next = native.registry.clone();
    next.insert(
        operation_id.to_owned(),
        RegisteredProject {
            id: operation_id.to_owned(),
            path: path.to_owned(),
        },
    );
    persist_registry(state.registry_path.as_ref(), &next)?;
    native.registry = next;
    Ok(true)
}

fn release_project_reservation(state: &AppState, operation_id: &str, path: &str) {
    let Ok(mut native) = state.inner.lock() else {
        return;
    };
    if native
        .registry
        .get(operation_id)
        .is_some_and(|entry| entry.path == path)
    {
        let mut next = native.registry.clone();
        next.remove(operation_id);
        if persist_registry(state.registry_path.as_ref(), &next).is_ok() {
            native.registry = next;
        }
    }
}

fn registry_receipts_path(registry_path: &Path) -> PathBuf {
    registry_path.with_extension("receipts.json")
}

fn load_registry_receipts(path: &Path) -> io::Result<HashMap<String, RegistryReceipt>> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(error),
    };
    let receipts: HashMap<String, RegistryReceipt> = serde_json::from_slice(&bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    for (operation_id, receipt) in &receipts {
        if Uuid::parse_str(operation_id).is_err()
            || receipt.command != "project.create"
            || receipt.request_hash.is_empty()
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "project receipt registry contains an invalid entry",
            ));
        }
    }
    Ok(receipts)
}

fn persist_registry_receipts(
    receipts_path: Option<&PathBuf>,
    receipts: &HashMap<String, RegistryReceipt>,
) -> Result<(), DispatchError> {
    let Some(path) = receipts_path else {
        return Ok(());
    };
    let parent = path.parent().ok_or_else(|| {
        DispatchError::new(
            "INTERNAL_ERROR",
            "project receipt registry has no parent directory",
        )
    })?;
    fs::create_dir_all(parent)
        .map_err(|error| DispatchError::new("INTERNAL_ERROR", error.to_string()))?;
    let encoded = serde_json::to_vec(receipts)
        .map_err(|error| DispatchError::new("INTERNAL_ERROR", error.to_string()))?;
    let temporary = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    fs::write(&temporary, encoded)
        .map_err(|error| DispatchError::new("INTERNAL_ERROR", error.to_string()))?;
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        DispatchError::new("INTERNAL_ERROR", error.to_string())
    })
}

fn existing_project_database_path(project_path: &str) -> Result<PathBuf, DispatchError> {
    let root = Path::new(project_path);
    let database = root.join(".cutroom").join("project.cutroom");
    match fs::symlink_metadata(&database) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(DispatchError::new(
                "PROJECT_NOT_FOUND",
                "registered project database is invalid",
            ))
        }
        Ok(_) => Ok(database),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Err(DispatchError::new(
            "PROJECT_NOT_FOUND",
            "registered project database is missing",
        )),
        Err(error) => Err(DispatchError::new("INTERNAL_ERROR", error.to_string())),
    }
}

/// Pure dispatch entrypoint used by tests and registered by the desktop host as
/// its one native command. It always serializes domain failures as NativeResponse.
pub fn dispatch(state: &AppState, request: NativeRequest) -> NativeResponse {
    dispatch_with_authorized_selection(state, request, None)
}

/// Production Tauri code passes the user-approved selection out-of-band. The
/// pure dispatch entrypoint deliberately has no such capability and remains
/// test-only for fixture path injection.
pub fn dispatch_with_authorized_selection(
    state: &AppState,
    request: NativeRequest,
    authorized_selection: Option<PathBuf>,
) -> NativeResponse {
    match dispatch_inner(state, request, authorized_selection.as_deref()) {
        Ok(data) => NativeResponse::success(data),
        Err(error) => NativeResponse::failure(error.code(), error.to_string()),
    }
}

#[derive(Debug)]
struct DispatchError {
    code: &'static str,
    message: String,
}

impl DispatchError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn code(&self) -> &'static str {
        self.code
    }
}

impl std::fmt::Display for DispatchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

fn dispatch_inner(
    state: &AppState,
    request: NativeRequest,
    authorized_selection: Option<&Path>,
) -> Result<Value, DispatchError> {
    match request.command.as_str() {
        "health.get" => health(state),
        "project.create" => project_create(state, &request, authorized_selection),
        "project.open" => project_open(state, &request),
        "project.list" => project_list(state),
        "asset.import" => asset_import(state, &request, authorized_selection),
        "asset.list" => asset_list(state, &request),
        "composition.get" => composition_get(state, &request),
        "composition.apply" => composition_apply(state, &request),
        "revision.create" => revision_create(state, &request),
        "revision.list" => revision_list(state, &request),
        "revision.restore" => revision_restore(state, &request),
        "render.enqueue" => render_enqueue(state, &request),
        "lut.pick" => lut_pick(state, &request, authorized_selection),
        "job.list" => job_list(state, &request),
        "job.cancel" => job_cancel(state, &request),
        "job.retry" => job_retry(state, &request),
        "brief.get" => brief_get(state, &request),
        "brief.set" => brief_set(state, &request),
        _ => Err(DispatchError::new(
            "INTERNAL_ERROR",
            format!("unsupported native command: {}", request.command),
        )),
    }
}

fn health(state: &AppState) -> Result<Value, DispatchError> {
    let engine = MediaEngine::discover().ok();
    let ffmpeg_available = engine.is_some();
    let ffmpeg_version = engine.as_ref().and_then(|engine| {
        std::process::Command::new(engine.ffmpeg_path())
            .arg("-version")
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .and_then(|output| {
                output
                    .lines()
                    .next()
                    .and_then(|line| line.strip_prefix("ffmpeg version "))
                    .map(|version| {
                        version
                            .split_whitespace()
                            .next()
                            .unwrap_or(version)
                            .to_owned()
                    })
            })
    });
    Ok(json!({
        "tauriConnected": state.native_runtime,
        "ffmpegAvailable": ffmpeg_available,
        "ffmpegVersion": ffmpeg_version,
        // The standard library has no portable free-space API. Report unavailable
        // rather than fabricating zero bytes of capacity.
        "storageFreeBytes": Value::Null,
        "modelsInstalled": []
    }))
}

fn project_create(
    state: &AppState,
    request: &NativeRequest,
    authorized_selection: Option<&Path>,
) -> Result<Value, DispatchError> {
    let operation_id = require_operation_id(request)?;
    if let Some(response) = project_create_replay(
        state,
        request,
        &operation_id,
        authorized_selection.is_some(),
    )? {
        return Ok(response);
    }
    let name = required_string(&request.payload, "name")?;
    let path = match authorized_selection {
        Some(p) => p.to_string_lossy().into_owned(),
        None => match request.payload.get("path").and_then(Value::as_str) {
            Some(p) if !p.trim().is_empty() => p.to_string(),
            _ => {
                let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
                let safe_name: String = name.chars().filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-').collect();
                let folder = if safe_name.is_empty() { "Untitled_Project".to_string() } else { safe_name };
                let p = PathBuf::from(home).join("Movies").join("Cutroom Projects").join(&folder);
                let _ = std::fs::create_dir_all(&p);
                p.to_string_lossy().into_owned()
            }
        },
    };
    let aspect_ratio = required_string(&request.payload, "aspectRatio")?;
    let fps_numerator = required_i64(&request.payload, "fpsNumerator")?;
    let fps_denominator = required_i64(&request.payload, "fpsDenominator")?;
    let database_path = Path::new(&path).join(".cutroom").join("project.cutroom");
    let receipt = native_receipt_for_request(request, authorized_selection.is_some())?;
    let project_input = ProjectInput {
        name,
        path: path.clone(),
        aspect_ratio,
        fps: RationalTimeBase::new(fps_numerator, fps_denominator).map_err(map_core_error)?,
    };
    let reservation_created = reserve_project_registry(state, &operation_id, &path)?;
    let mut database = match Database::open(&database_path) {
        Ok(database) => database,
        Err(error) => {
            if reservation_created {
                release_project_reservation(state, &operation_id, &path);
            }
            return Err(map_core_error(error));
        }
    };
    let response = match database.projects().create_with_native_receipt(
        project_input,
        &receipt,
        project_create_dto,
    ) {
        Ok(response) => response,
        Err(error) => {
            drop(database);
            if reservation_created {
                release_project_reservation(state, &operation_id, &path);
            }
            return Err(map_core_error(error));
        }
    };
    let project_id = response["id"]
        .as_str()
        .ok_or_else(|| DispatchError::new("INTERNAL_ERROR", "project receipt has no project ID"))?
        .to_owned();
    let project_path = response["path"]
        .as_str()
        .ok_or_else(|| DispatchError::new("INTERNAL_ERROR", "project receipt has no project path"))?
        .to_owned();
    let session = session_for(database)?;
    let mut native = state
        .inner
        .lock()
        .map_err(|_| DispatchError::new("INTERNAL_ERROR", "native state mutex poisoned"))?;
    // SQLite is authoritative. Keep the completed cache live even if its
    // best-effort sidecar write fails; the pre-committed registry reservation
    // lets a future launch recover the same response from SQLite.
    let mut next_registry = native.registry.clone();
    next_registry.insert(
        project_id.clone(),
        RegisteredProject {
            id: project_id.clone(),
            path: project_path,
        },
    );
    let mut next_receipts = native.registry_receipts.clone();
    next_receipts.insert(
        operation_id,
        RegistryReceipt {
            command: request.command.clone(),
            request_hash: canonical_request_hash(request, authorized_selection.is_some())?,
            response: response.clone(),
        },
    );
    native.registry = next_registry;
    native.registry_receipts = next_receipts;
    native.active_project_id = Some(project_id.clone());
    native.projects.insert(project_id, session);
    let _ = persist_registry(state.registry_path.as_ref(), &native.registry);
    let _ = persist_registry_receipts(
        state.registry_receipts_path.as_ref(),
        &native.registry_receipts,
    );
    Ok(response)
}

fn project_open(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    let mut native = state
        .inner
        .lock()
        .map_err(|_| DispatchError::new("INTERNAL_ERROR", "native state mutex poisoned"))?;
    if !native.projects.contains_key(&project_id) {
        let registered = native.registry.get(&project_id).cloned().ok_or_else(|| {
            DispatchError::new(
                "PROJECT_NOT_FOUND",
                format!("project is not in the durable registry: {project_id}"),
            )
        })?;
        let database_path = match existing_project_database_path(&registered.path) {
            Ok(path) => path,
            Err(error) => {
                native.registry.remove(&project_id);
                persist_registry(state.registry_path.as_ref(), &native.registry)?;
                return Err(error);
            }
        };
        let database = Database::open(database_path).map_err(map_core_error)?;
        native
            .projects
            .insert(project_id.clone(), session_for(database)?);
    }
    let dto = {
        let session = native
            .projects
            .get_mut(&project_id)
            .expect("inserted or existing session");
        let project = with_database(&session.database, |database| {
            database.projects().open(&project_id)
        })?;
        project_dto(&project, session)?
    };
    native.active_project_id = Some(project_id);
    Ok(dto)
}

fn project_list(state: &AppState) -> Result<Value, DispatchError> {
    let mut native = state
        .inner
        .lock()
        .map_err(|_| DispatchError::new("INTERNAL_ERROR", "native state mutex poisoned"))?;
    let registered: Vec<_> = native.registry.values().cloned().collect();
    let mut stale_ids = Vec::new();
    for registered_project in registered {
        if native.projects.contains_key(&registered_project.id) {
            continue;
        }
        let database_path = match existing_project_database_path(&registered_project.path) {
            Ok(path) => path,
            Err(_) => {
                stale_ids.push(registered_project.id);
                continue;
            }
        };
        let database = Database::open(database_path).map_err(map_core_error)?;
        native
            .projects
            .insert(registered_project.id, session_for(database)?);
    }
    if !stale_ids.is_empty() {
        for project_id in stale_ids {
            native.registry.remove(&project_id);
        }
        persist_registry(state.registry_path.as_ref(), &native.registry)?;
    }
    let mut projects = Vec::new();
    for session in native.projects.values_mut() {
        let listed = with_database(&session.database, |database| database.projects().list())?;
        for project in listed {
            projects.push(project_dto(&project, session)?);
        }
    }
    projects.sort_by(|left, right| left["createdAt"].as_str().cmp(&right["createdAt"].as_str()));
    Ok(Value::Array(projects))
}

fn asset_import(
    state: &AppState,
    request: &NativeRequest,
    authorized_selection: Option<&Path>,
) -> Result<Value, DispatchError> {
    let operation_id = require_operation_id(request)?;
    let project_id = required_project_id(request)?;
    if let Some(response) =
        native_replay_for_request(state, request, authorized_selection.is_some())?
    {
        return Ok(response);
    }
    let selected_path = match authorized_selection
        .map(|path| path.to_string_lossy().into_owned())
        .or(optional_string(&request.payload, "path")?)
    {
        Some(path) => path,
        None if request
            .payload
            .get("openFileDialog")
            .and_then(Value::as_bool)
            .unwrap_or(false) =>
        {
            return Err(DispatchError::new(
                "UNSUPPORTED_MEDIA",
                "the pure dispatch host requires a trusted test path injection",
            ));
        }
        None => {
            return Err(DispatchError::new(
                "UNSUPPORTED_MEDIA",
                "asset selection is required",
            ));
        }
    };
    let import_type = required_string(&request.payload, "importType")?;
    if !matches!(import_type.as_str(), "managed" | "linked") {
        return Err(DispatchError::new(
            "UNSUPPORTED_MEDIA",
            "importType must be managed or linked",
        ));
    }
    let mut native = state
        .inner
        .lock()
        .map_err(|_| DispatchError::new("INTERNAL_ERROR", "native state mutex poisoned"))?;
    let session = session_mut(&mut native, &project_id)?;
    let receipt = native_receipt_for_request(request, authorized_selection.is_some())?;
    if let Some(response) = with_database(&session.database, |database| {
        replay_native_receipt(database, &receipt)
    })? {
        return Ok(response);
    }
    let project = with_database(&session.database, |database| {
        database.projects().open(&project_id)
    })?;
    let source_probe = session
        .media
        .probe(Path::new(&selected_path), &CancellationToken::new())
        .map_err(map_media_error)?;
    let probe = if import_type == "managed" {
        let destination = copy_managed_source(&project.path, &source_probe.source, &operation_id)?;
        match session.media.probe(&destination, &CancellationToken::new()) {
            Ok(copied) if copied.sha256 == source_probe.sha256 => copied,
            Ok(_) => {
                let _ = fs::remove_file(&destination);
                return Err(DispatchError::new(
                    "UNSUPPORTED_MEDIA",
                    "managed copy failed source-integrity verification",
                ));
            }
            Err(error) => {
                let _ = fs::remove_file(&destination);
                return Err(map_media_error(error));
            }
        }
    } else {
        source_probe
    };
    let name = optional_string(&request.payload, "name")?.unwrap_or_else(|| {
        probe
            .source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Imported media")
            .to_owned()
    });
    let size_bytes = fs::metadata(&probe.source)
        .map_err(|error| DispatchError::new("UNSUPPORTED_MEDIA", error.to_string()))?
        .len() as i64;
    let fps = probe.video.frame_rate.clone();
    let response = with_database(&session.database, |database| {
        database.assets().create_with_native_receipt(
            AssetInput {
                project_id: project_id.clone(),
                name,
                path: probe.source.display().to_string(),
                size_bytes,
                duration: probe.video.duration.clone(),
                width: i64::from(probe.video.width),
                height: i64::from(probe.video.height),
                format: file_format(&probe.source),
                codec: probe.video.codec.clone(),
                audio_channels: probe
                    .audio
                    .as_ref()
                    .map_or(0, |audio| i64::from(audio.channels)),
                import_type,
                sha256: Some(probe.sha256.clone()),
            },
            &receipt,
            |asset| asset_dto_with_fps(asset, &fps),
        )
    })?;
    let asset_id = response["id"]
        .as_str()
        .ok_or_else(|| DispatchError::new("INTERNAL_ERROR", "asset receipt has no asset ID"))?
        .to_owned();
    session.asset_fps.insert(asset_id, fps);
    Ok(response)
}

fn asset_list(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    let mut native = state
        .inner
        .lock()
        .map_err(|_| DispatchError::new("INTERNAL_ERROR", "native state mutex poisoned"))?;
    let session = session_mut(&mut native, &project_id)?;
    let assets = with_database(&session.database, |database| {
        database.assets().list(&project_id)
    })?;
    for asset in &assets {
        // Frame rate is probe-derived rather than guessed from the duration timebase.
        // Re-probing on session hydration makes this metadata truthful after restart.
        let probe = session
            .media
            .probe(Path::new(&asset.path), &CancellationToken::new())
            .map_err(map_media_error)?;
        session
            .asset_fps
            .insert(asset.id.clone(), probe.video.frame_rate);
    }
    assets
        .iter()
        .map(|asset| asset_dto(asset, session))
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn composition_get(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    let session = session(state, &project_id)?;
    let composition = with_database(&session.database, |database| {
        database.compositions().get(&project_id)
    })?;
    Ok(composition_dto(&composition))
}

fn composition_apply(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    if let Some(response) = native_replay_for_request(state, request, false)? {
        return Ok(response);
    }
    let expected_version = require_expected_version(request)?;
    let action = required_string(&request.payload, "action")?;
    let session = session(state, &project_id)?;
    let receipt = native_receipt_for_request(request, false)?;
    with_database(&session.database, |database| {
        if let Some(response) = replay_native_receipt(database, &receipt)? {
            return Ok(response);
        }
        let composition = database.compositions().get(&project_id)?;
        let mutation = build_mutation(database, &composition, &request.payload, &action)?;
        database.compositions().apply_mutation_with_native_receipt(
            &project_id,
            &composition.id,
            expected_version,
            &mutation,
            &receipt,
            |result| composition_dto(&result.composition),
        )
    })
}

fn revision_create(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    if let Some(response) = native_replay_for_request(state, request, false)? {
        return Ok(response);
    }
    let expected_version = require_expected_version(request)?;
    let commit_note = required_string(&request.payload, "commitNote")?;
    let session = session(state, &project_id)?;
    let receipt = native_receipt_for_request(request, false)?;
    with_database(&session.database, |database| {
        database.revisions().create_with_native_receipt(
            &project_id,
            expected_version,
            &commit_note,
            "Cutroom Desktop",
            &receipt,
            revision_dto,
        )
    })
}

fn revision_list(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    let session = session(state, &project_id)?;
    let revisions = with_database(&session.database, |database| {
        database.revisions().list(&project_id)
    })?;
    Ok(Value::Array(revisions.iter().map(revision_dto).collect()))
}

fn revision_restore(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    if let Some(response) = native_replay_for_request(state, request, false)? {
        return Ok(response);
    }
    let expected_version = require_expected_version(request)?;
    let revision_id = required_string(&request.payload, "revisionId")?;
    let session = session(state, &project_id)?;
    let receipt = native_receipt_for_request(request, false)?;
    with_database(&session.database, |database| {
        database.revisions().restore_with_native_receipt(
            &project_id,
            &revision_id,
            expected_version,
            &receipt,
            revision_dto,
        )
    })
}

fn render_enqueue(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    let operation_id = require_operation_id(request)?;
    if let Some(response) = native_replay_for_request(state, request, false)? {
        return Ok(response);
    }
    let expected_version = require_expected_version(request)?;
    let preset = required_string(&request.payload, "preset")?;
    let output = OutputSpec::preset(&preset).ok_or_else(|| {
        DispatchError::new(
            "UNSUPPORTED_MEDIA",
            format!(
                "unknown render preset '{preset}'; supported: {}",
                OutputSpec::preset_names().join(", ")
            ),
        )
    })?;
    let revision_id = required_string(&request.payload, "revisionId")?;
    let session = session(state, &project_id)?;
    let receipt = native_receipt_for_request(request, false)?;
    session
        .jobs
        .enqueue_render_with_native_receipt(
            JobEnqueue {
                operation_id,
                project_id,
                revision_id,
                dependency_job_id: None,
                output: Some(output),
            },
            expected_version,
            &receipt,
            job_dto,
        )
        .map_err(map_jobs_error)
}

fn lut_pick(
    _state: &AppState,
    request: &NativeRequest,
    authorized_selection: Option<&Path>,
) -> Result<Value, DispatchError> {
    let _project_id = required_project_id(request)?;
    let selected_path = authorized_selection
        .map(|path| path.to_string_lossy().into_owned())
        .or(optional_string(&request.payload, "path")?)
        .ok_or_else(|| DispatchError::new("INVALID_INPUT", "LUT file path is required"))?;
    let canonical = fs::canonicalize(&selected_path).map_err(|error| {
        DispatchError::new(
            "INVALID_INPUT",
            format!("LUT path is not a readable local file: {error}"),
        )
    })?;
    let info = MediaEngine::validate_lut(&canonical)
        .map_err(|error| DispatchError::new("UNSUPPORTED_MEDIA", error.to_string()))?;
    Ok(json!({
        "path": canonical.to_string_lossy(),
        "sha256": info.sha256,
        "size": info.size,
        "title": info.title,
    }))
}

fn job_list(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    let session = session(state, &project_id)?;
    let jobs = session.jobs.list(&project_id).map_err(map_jobs_error)?;
    Ok(Value::Array(jobs.iter().map(job_dto).collect()))
}

fn job_cancel(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    if let Some(response) = native_replay_for_request(state, request, false)? {
        return Ok(response);
    }
    let job_id = required_string(&request.payload, "jobId")?;
    let session = session(state, &project_id)?;
    let receipt = native_receipt_for_request(request, false)?;
    session
        .jobs
        .cancel_with_native_receipt(&project_id, &job_id, &receipt, job_dto)
        .map_err(map_jobs_error)
}

fn job_retry(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    if let Some(response) = native_replay_for_request(state, request, false)? {
        return Ok(response);
    }
    let job_id = required_string(&request.payload, "jobId")?;
    let session = session(state, &project_id)?;
    let receipt = native_receipt_for_request(request, false)?;
    session
        .jobs
        .retry_with_native_receipt(&project_id, &job_id, &receipt, job_dto)
        .map_err(map_jobs_error)
}

fn brief_get(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    let session = session(state, &project_id)?;
    let (db_path, project) = with_database(&session.database, |db| {
        let p = db.projects().get(&project_id)?;
        Ok((db.path().to_path_buf(), p))
    })?;
    let project_dir = db_path.parent().ok_or_else(|| {
        DispatchError::new("INTERNAL_ERROR", "invalid project database path")
    })?;
    let brief_path = project_dir.join("brief.json");
    if brief_path.is_file() {
        let content = fs::read_to_string(&brief_path).map_err(|e| {
            DispatchError::new("IO_ERROR", format!("failed to read brief: {e}"))
        })?;
        let parsed: Value = serde_json::from_str(&content).map_err(|e| {
            DispatchError::new("INVALID_DATA", format!("corrupt brief json: {e}"))
        })?;
        Ok(parsed)
    } else {
        Ok(json!({
            "goal": "",
            "audience": "",
            "targetDurationSeconds": 60,
            "aspectRatio": project.aspect_ratio,
            "requiredSegments": "",
            "excludedSegments": "",
            "tone": "Direct, informative",
            "style": "Fast-paced, modern",
            "cta": "",
            "updatedAt": cutroom_core::now_utc_iso()
        }))
    }
}

fn brief_set(state: &AppState, request: &NativeRequest) -> Result<Value, DispatchError> {
    let project_id = required_project_id(request)?;
    let session = session(state, &project_id)?;
    let db_path = with_database(&session.database, |db| Ok(db.path().to_path_buf()))?;
    let project_dir = db_path.parent().ok_or_else(|| {
        DispatchError::new("INTERNAL_ERROR", "invalid project database path")
    })?;

    let payload = if let Some(b) = request.payload.get("brief").and_then(Value::as_object) {
        Value::Object(b.clone())
    } else {
        request.payload.clone()
    };

    let goal = payload.get("goal").and_then(Value::as_str).unwrap_or("").to_string();
    let audience = payload.get("audience").and_then(Value::as_str).unwrap_or("").to_string();
    let target_duration_seconds = payload.get("targetDurationSeconds").and_then(Value::as_i64).unwrap_or(60);
    let aspect_ratio = payload.get("aspectRatio").and_then(Value::as_str).unwrap_or("16:9").to_string();
    let required_segments = payload.get("requiredSegments").and_then(Value::as_str).unwrap_or("").to_string();
    let excluded_segments = payload.get("excludedSegments").and_then(Value::as_str).unwrap_or("").to_string();
    let tone = payload.get("tone").and_then(Value::as_str).unwrap_or("Direct, informative").to_string();
    let style = payload.get("style").and_then(Value::as_str).unwrap_or("Fast-paced, modern").to_string();
    let cta = payload.get("cta").and_then(Value::as_str).unwrap_or("").to_string();

    let brief_obj = json!({
        "goal": goal,
        "audience": audience,
        "targetDurationSeconds": target_duration_seconds,
        "aspectRatio": aspect_ratio,
        "requiredSegments": required_segments,
        "excludedSegments": excluded_segments,
        "tone": tone,
        "style": style,
        "cta": cta,
        "updatedAt": cutroom_core::now_utc_iso()
    });

    let tmp_name = format!("brief.json.tmp.{}", Uuid::new_v4());
    let tmp_path = project_dir.join(tmp_name);
    let final_path = project_dir.join("brief.json");

    let formatted = serde_json::to_string_pretty(&brief_obj).map_err(|e| {
        DispatchError::new("INTERNAL_ERROR", format!("failed to format brief: {e}"))
    })?;

    fs::write(&tmp_path, formatted.as_bytes()).map_err(|e| {
        DispatchError::new("IO_ERROR", format!("failed to write temporary brief file: {e}"))
    })?;

    fs::rename(&tmp_path, &final_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        DispatchError::new("IO_ERROR", format!("failed to commit brief file: {e}"))
    })?;

    Ok(brief_obj)
}

/// Checks durable project-scoped receipts without evaluating a mutator. The
/// native host uses this before showing a picker, so a completed intent never
/// causes a second user interaction.
fn native_replay_for_request(
    state: &AppState,
    request: &NativeRequest,
    has_authorized_selection: bool,
) -> Result<Option<Value>, DispatchError> {
    let operation_id = require_operation_id(request)?;
    let project_id = required_project_id(request)?;
    let session = session(state, &project_id)?;
    let request_hash = canonical_request_hash(request, has_authorized_selection)?;
    with_database(&session.database, |database| {
        match database.native_receipts().lookup(
            &operation_id,
            &request.command,
            Some(&project_id),
            &request_hash,
        )? {
            NativeReceiptLookup::Missing => Ok(None),
            NativeReceiptLookup::Replay(response) => {
                let value = serde_json::from_str(&response).map_err(CoreError::from)?;
                Ok(Some(value))
            }
        }
    })
}

/// Host-only picker preflight; JSON errors remain inside the normal native envelope.
pub fn native_replay_for_host(
    state: &AppState,
    request: &NativeRequest,
    has_authorized_selection: bool,
) -> Result<Option<Value>, String> {
    native_replay_for_request(state, request, has_authorized_selection)
        .map_err(|error| error.to_string())
}

/// Project creation has no project ID until its first successful write, so its
/// durable receipt lives in the native registry rather than a project database.
/// The production host calls this before it opens another directory picker.
pub fn project_create_replay_for_host(
    state: &AppState,
    request: &NativeRequest,
) -> Result<Option<Value>, String> {
    let operation_id = require_operation_id(request).map_err(|error| error.to_string())?;
    project_create_replay(state, request, &operation_id, false).map_err(|error| error.to_string())
}

fn project_create_replay(
    state: &AppState,
    request: &NativeRequest,
    operation_id: &str,
    has_authorized_selection: bool,
) -> Result<Option<Value>, DispatchError> {
    let request_hash = canonical_request_hash(request, has_authorized_selection)?;
    let registered = {
        let native = state
            .inner
            .lock()
            .map_err(|_| DispatchError::new("INTERNAL_ERROR", "native state mutex poisoned"))?;
        match native.registry_receipts.get(operation_id) {
            Some(receipt)
                if receipt.command == request.command && receipt.request_hash == request_hash =>
            {
                return Ok(Some(receipt.response.clone()));
            }
            Some(_) => {
                return Err(DispatchError::new(
                    "IDEMPOTENCY_CONFLICT",
                    "operation_id was already used for a different project.create intent",
                ));
            }
            None => native.registry.get(operation_id).cloned(),
        }
    };
    let Some(registered) = registered else {
        return Ok(None);
    };
    if registered.id != operation_id {
        return Err(DispatchError::new(
            "IDEMPOTENCY_CONFLICT",
            "operation_id is reserved for an invalid project registry entry",
        ));
    }

    // A registry reservation is persisted before SQLite creation. On restart it
    // points us to the project-local authoritative receipt without reopening a
    // picker. `existing_project_database_path` keeps this recovery from creating
    // or migrating an arbitrary missing location.
    let database_path = match existing_project_database_path(&registered.path) {
        Ok(path) => path,
        Err(DispatchError {
            code: "PROJECT_NOT_FOUND",
            ..
        }) => {
            release_project_reservation(state, operation_id, &registered.path);
            return Ok(None);
        }
        Err(error) => return Err(error),
    };
    let mut database = Database::open(database_path).map_err(map_core_error)?;
    let receipt = NativeReceipt::new(
        operation_id.to_owned(),
        request.command.clone(),
        None,
        request_hash,
    );
    let Some(response) = replay_native_receipt(&mut database, &receipt).map_err(map_core_error)?
    else {
        let project_count = database.projects().list().map_err(map_core_error)?.len();
        if project_count == 0 {
            drop(database);
            release_project_reservation(state, operation_id, &registered.path);
            return Ok(None);
        }
        return Err(DispatchError::new(
            "IDEMPOTENCY_CONFLICT",
            "a Cutroom project already exists in this folder for another intent",
        ));
    };
    if response["id"].as_str() != Some(registered.id.as_str())
        || response["path"].as_str() != Some(registered.path.as_str())
    {
        return Err(DispatchError::new(
            "INTERNAL_ERROR",
            "project receipt does not match its durable registry reservation",
        ));
    }
    let mut native = state
        .inner
        .lock()
        .map_err(|_| DispatchError::new("INTERNAL_ERROR", "native state mutex poisoned"))?;
    native.registry_receipts.insert(
        operation_id.to_owned(),
        RegistryReceipt {
            command: request.command.clone(),
            request_hash: receipt.request_hash,
            response: response.clone(),
        },
    );
    // SQLite is already authoritative; failure to refresh this cache must not
    // turn a committed project into a reported failure. The reservation remains
    // available for the same deterministic reconciliation next restart.
    let _ = persist_registry_receipts(
        state.registry_receipts_path.as_ref(),
        &native.registry_receipts,
    );
    Ok(Some(response))
}

fn native_receipt_for_request(
    request: &NativeRequest,
    has_authorized_selection: bool,
) -> Result<NativeReceipt, DispatchError> {
    Ok(NativeReceipt::new(
        require_operation_id(request)?,
        request.command.clone(),
        request.project_id.clone(),
        canonical_request_hash(request, has_authorized_selection)?,
    ))
}

fn replay_native_receipt(
    database: &mut Database,
    receipt: &NativeReceipt,
) -> cutroom_core::Result<Option<Value>> {
    match database.native_receipts().lookup(
        &receipt.operation_id,
        &receipt.command,
        receipt.project_id.as_deref(),
        &receipt.request_hash,
    )? {
        NativeReceiptLookup::Missing => Ok(None),
        NativeReceiptLookup::Replay(response) => Ok(Some(serde_json::from_str(&response)?)),
    }
}

fn canonical_request_hash(
    request: &NativeRequest,
    has_authorized_selection: bool,
) -> Result<String, DispatchError> {
    let mut payload = request.payload.clone();
    if has_authorized_selection {
        let object = payload.as_object_mut().ok_or_else(|| {
            DispatchError::new("INTERNAL_ERROR", "native command payload must be an object")
        })?;
        // The selected path is host authority, never caller-controlled request
        // material. It must not turn a replay into another picker invocation.
        object.remove("path");
    }
    let canonical = json!({
        "command": request.command,
        "projectId": request.project_id,
        "expectedVersion": request.expected_version,
        "payload": payload,
    });
    let bytes = serde_json::to_vec(&canonical)
        .map_err(|error| DispatchError::new("INTERNAL_ERROR", error.to_string()))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn session_for(database: Database) -> Result<ProjectSession, DispatchError> {
    let database = Arc::new(Mutex::new(database));
    let media = MediaEngine::discover().map_err(map_media_error)?;
    let jobs = JobEngine::new(Arc::clone(&database), media.clone());
    // Recovery precedes the worker so stale leases are durably reconciled before
    // any queued render can be claimed by this native host.
    jobs.recover_startup().map_err(map_jobs_error)?;
    let worker = OwnedWorker::start(jobs.clone());
    Ok(ProjectSession {
        database,
        jobs,
        media,
        asset_fps: HashMap::new(),
        worker,
    })
}

fn session(state: &AppState, project_id: &str) -> Result<ProjectSessionRef, DispatchError> {
    let native = state
        .inner
        .lock()
        .map_err(|_| DispatchError::new("INTERNAL_ERROR", "native state mutex poisoned"))?;
    let session = native.projects.get(project_id).ok_or_else(|| {
        DispatchError::new(
            "PROJECT_NOT_FOUND",
            format!("project not registered: {project_id}"),
        )
    })?;
    Ok(ProjectSessionRef {
        database: Arc::clone(&session.database),
        jobs: session.jobs.clone(),
    })
}

struct ProjectSessionRef {
    database: Arc<Mutex<Database>>,
    jobs: JobEngine,
}

fn session_mut<'a>(
    state: &'a mut NativeState,
    project_id: &str,
) -> Result<&'a mut ProjectSession, DispatchError> {
    state.projects.get_mut(project_id).ok_or_else(|| {
        DispatchError::new(
            "PROJECT_NOT_FOUND",
            format!("project not registered: {project_id}"),
        )
    })
}

fn with_database<T>(
    database: &Arc<Mutex<Database>>,
    operation: impl FnOnce(&mut Database) -> cutroom_core::Result<T>,
) -> Result<T, DispatchError> {
    let mut database = database
        .lock()
        .map_err(|_| DispatchError::new("INTERNAL_ERROR", "project database mutex poisoned"))?;
    operation(&mut database).map_err(map_core_error)
}

fn build_mutation(
    database: &mut Database,
    composition: &Composition,
    payload: &Value,
    action: &str,
) -> cutroom_core::Result<CompositionMutation> {
    match action {
        "add" => mutation_add(database, composition, payload),
        "split" => mutation_split(database, composition, payload),
        "trim" => mutation_trim(database, composition, payload),
        "replace" => mutation_replace(database, composition, payload),
        "reorder" => mutation_reorder(database, composition, payload),
        "remove" => mutation_remove(database, composition, payload),
        "setColor" => mutation_set_color(composition, payload),
        _ => Err(CoreError::InvalidInput(format!(
            "unsupported composition action: {action}"
        ))),
    }
}

fn mutation_add(
    database: &mut Database,
    composition: &Composition,
    payload: &Value,
) -> cutroom_core::Result<CompositionMutation> {
    let asset_id = required_string_core(payload, "assetId")?;
    let asset = database.assets().get(&asset_id)?;
    let source_in = RationalTime::new(
        required_string_core(payload, "sourceInTicks")?,
        asset.duration.time_base.clone(),
    )?;
    let source_out = RationalTime::new(
        required_string_core(payload, "sourceOutTicks")?,
        asset.duration.time_base.clone(),
    )?;
    let timeline_start = RationalTime::new(
        optional_string_core(payload, "timelineStartTicks")?
            .unwrap_or_else(|| composition.duration_ticks.clone()),
        composition.time_base.clone(),
    )?;
    let track_id = optional_string_core(payload, "trackId")?.or_else(|| {
        composition
            .tracks
            .iter()
            .find(|track| track.kind == "primary_video")
            .map(|track| track.id.clone())
    });
    let mut operations = Vec::new();
    let track_id = match track_id {
        Some(track_id) => track_id,
        None => {
            let track_id = Uuid::new_v4().to_string();
            operations.push(TimelineOperation::AddTrack {
                track: TrackInput {
                    id: Some(track_id.clone()),
                    kind: "primary_video".into(),
                    label: "V1".into(),
                    sort_order: 0,
                    is_muted: false,
                    is_locked: false,
                },
            });
            track_id
        }
    };
    let in_ticks = source_in.ticks_i128()?;
    let out_ticks = source_out.ticks_i128()?;
    let source_duration = RationalTime::from_ticks(
        out_ticks
            .checked_sub(in_ticks)
            .ok_or(CoreError::ArithmeticOverflow)?,
        asset.duration.time_base.clone(),
    )?;
    let timeline_duration = RationalTime::new(
        source_duration.exact_ticks_in(&composition.time_base)?,
        composition.time_base.clone(),
    )?;
    // Ranks are track-local. Using the composition-wide clip count could reuse a
    // rank after a removal on this track, so allocate after this track's maximum.
    let sort_order = composition
        .clips
        .iter()
        .filter(|clip| clip.track_id == track_id)
        .map(|clip| clip.sort_order)
        .max()
        .map(|rank| rank.checked_add(1).ok_or(CoreError::ArithmeticOverflow))
        .transpose()?
        .unwrap_or(0);
    operations.push(TimelineOperation::AddClip {
        clip: ClipInput {
            id: Some(Uuid::new_v4().to_string()),
            track_id,
            asset_id,
            name: asset.name,
            in_time: source_in,
            out_time: source_out,
            timeline_start,
            timeline_duration,
            sort_order,
            color: ClipColor::default(),
        },
    });
    Ok(CompositionMutation { operations })
}

fn mutation_trim(
    database: &mut Database,
    composition: &Composition,
    payload: &Value,
) -> cutroom_core::Result<CompositionMutation> {
    let target = find_clip(composition, &required_string_core(payload, "clipId")?)?;
    let asset = database.assets().get(&target.asset_id)?;
    let in_time = RationalTime::new(
        required_string_core(payload, "newInTicks")?,
        asset.duration.time_base.clone(),
    )?;
    let out_time = RationalTime::new(
        required_string_core(payload, "newOutTicks")?,
        asset.duration.time_base.clone(),
    )?;
    let trimmed = clip_input(target, &asset, in_time, out_time, composition)?;
    let target_start = canonical_timeline_ticks(
        &target.timeline_start_ticks,
        composition,
        "stored clip start",
    )?;
    let old_duration = canonical_timeline_ticks(
        &target.timeline_duration_ticks,
        composition,
        "stored clip duration",
    )?;
    let duration_delta = trimmed
        .timeline_duration
        .ticks_i128()?
        .checked_sub(old_duration)
        .ok_or(CoreError::ArithmeticOverflow)?;
    let mut operations = vec![TimelineOperation::UpdateClip { clip: trimmed }];
    let mut following = Vec::new();
    for clip in &composition.clips {
        if clip.track_id != target.track_id || clip.id == target.id {
            continue;
        }
        let start =
            canonical_timeline_ticks(&clip.timeline_start_ticks, composition, "stored clip start")?;
        if start > target_start {
            following.push((start, clip));
        }
    }
    following.sort_by(|(left_start, left), (right_start, right)| {
        left_start
            .cmp(right_start)
            .then_with(|| left.sort_order.cmp(&right.sort_order))
            .then_with(|| left.id.cmp(&right.id))
    });
    for (start, clip) in following {
        let clip_asset = database.assets().get(&clip.asset_id)?;
        let mut updated = existing_clip_input(clip, &clip_asset, composition)?;
        // Ripple by the duration delta rather than rebuilding starts from the
        // trimmed end. That keeps any unrelated pre-existing gaps intact.
        let shifted_start = start
            .checked_add(duration_delta)
            .ok_or(CoreError::ArithmeticOverflow)?;
        updated.timeline_start =
            RationalTime::from_ticks(shifted_start, composition.time_base.clone())?;
        operations.push(TimelineOperation::UpdateClip { clip: updated });
    }
    Ok(CompositionMutation { operations })
}

fn mutation_replace(
    database: &mut Database,
    composition: &Composition,
    payload: &Value,
) -> cutroom_core::Result<CompositionMutation> {
    let target = find_clip(composition, &required_string_core(payload, "clipId")?)?;
    let asset_id = required_string_core(payload, "assetId")?;
    let asset = database.assets().get(&asset_id)?;
    let in_time = RationalTime::new(
        required_string_core(payload, "sourceInTicks")?,
        asset.duration.time_base.clone(),
    )?;
    let out_time = RationalTime::new(
        required_string_core(payload, "sourceOutTicks")?,
        asset.duration.time_base.clone(),
    )?;
    if out_time.ticks_i128()? <= in_time.ticks_i128()? {
        return Err(CoreError::InvalidInput(
            "source out-point must be greater than the in-point".into(),
        ));
    }
    if out_time.ticks_i128()? > asset.duration.ticks_i128()? {
        return Err(CoreError::InvalidInput(
            "source out-point exceeds the asset duration".into(),
        ));
    }
    let mut replacement = clip_input(target, &asset, in_time, out_time, composition)?;
    replacement.asset_id = asset_id;
    replacement.name = asset.name.clone();
    let target_start = canonical_timeline_ticks(
        &target.timeline_start_ticks,
        composition,
        "stored clip start",
    )?;
    let old_duration = canonical_timeline_ticks(
        &target.timeline_duration_ticks,
        composition,
        "stored clip duration",
    )?;
    let duration_delta = replacement
        .timeline_duration
        .ticks_i128()?
        .checked_sub(old_duration)
        .ok_or(CoreError::ArithmeticOverflow)?;
    let mut operations = vec![TimelineOperation::UpdateClip { clip: replacement }];
    let mut following = Vec::new();
    for clip in &composition.clips {
        if clip.track_id != target.track_id || clip.id == target.id {
            continue;
        }
        let start =
            canonical_timeline_ticks(&clip.timeline_start_ticks, composition, "stored clip start")?;
        if start > target_start {
            following.push((start, clip));
        }
    }
    following.sort_by(|(left_start, left), (right_start, right)| {
        left_start
            .cmp(right_start)
            .then_with(|| left.sort_order.cmp(&right.sort_order))
            .then_with(|| left.id.cmp(&right.id))
    });
    for (start, clip) in following {
        let clip_asset = database.assets().get(&clip.asset_id)?;
        let mut updated = existing_clip_input(clip, &clip_asset, composition)?;
        // Ripple by the duration delta rather than rebuilding starts from the
        // replacement end. That keeps any unrelated pre-existing gaps intact.
        let shifted_start = start
            .checked_add(duration_delta)
            .ok_or(CoreError::ArithmeticOverflow)?;
        updated.timeline_start =
            RationalTime::from_ticks(shifted_start, composition.time_base.clone())?;
        operations.push(TimelineOperation::UpdateClip { clip: updated });
    }
    Ok(CompositionMutation { operations })
}

fn mutation_split(
    database: &mut Database,
    composition: &Composition,
    payload: &Value,
) -> cutroom_core::Result<CompositionMutation> {
    let target = find_clip(composition, &required_string_core(payload, "clipId")?)?;
    let split = canonical_timeline_ticks(
        &required_string_core(payload, "splitPointTicks")?,
        composition,
        "splitPointTicks",
    )?;
    let timeline_start = canonical_timeline_ticks(
        &target.timeline_start_ticks,
        composition,
        "stored clip start",
    )?;
    let timeline_duration = canonical_timeline_ticks(
        &target.timeline_duration_ticks,
        composition,
        "stored clip duration",
    )?;
    if split <= timeline_start
        || split
            >= timeline_start
                .checked_add(timeline_duration)
                .ok_or(CoreError::ArithmeticOverflow)?
    {
        return Err(CoreError::InvalidInput(
            "split point must be strictly inside the clip".into(),
        ));
    }
    let siblings = ordered_track_clips(composition, &target.track_id)?;
    let target_index = siblings
        .iter()
        .position(|clip| clip.id == target.id)
        .ok_or_else(|| CoreError::InvalidInput("clip is not on its track".into()))?;
    let asset = database.assets().get(&target.asset_id)?;
    let offset = RationalTime::from_ticks(
        split
            .checked_sub(timeline_start)
            .ok_or(CoreError::ArithmeticOverflow)?,
        composition.time_base.clone(),
    )?;
    let source_offset = offset.exact_ticks_in(&asset.duration.time_base)?;
    let source_offset =
        RationalTime::new(source_offset, asset.duration.time_base.clone())?.ticks_i128()?;
    let source_in = RationalTime::new(target.in_ticks.clone(), asset.duration.time_base.clone())?
        .ticks_i128()?;
    let source_split = source_in
        .checked_add(source_offset)
        .ok_or(CoreError::ArithmeticOverflow)?;
    let old_out = RationalTime::new(target.out_ticks.clone(), asset.duration.time_base.clone())?;
    let mut first = clip_input(
        target,
        &asset,
        RationalTime::new(target.in_ticks.clone(), asset.duration.time_base.clone())?,
        RationalTime::from_ticks(source_split, asset.duration.time_base.clone())?,
        composition,
    )?;
    first.sort_order = dense_rank(target_index)?;
    let mut second = clip_input(
        target,
        &asset,
        RationalTime::from_ticks(source_split, asset.duration.time_base.clone())?,
        old_out,
        composition,
    )?;
    second.id = Some(Uuid::new_v4().to_string());
    second.timeline_start = RationalTime::from_ticks(split, composition.time_base.clone())?;
    second.sort_order = dense_rank(
        target_index
            .checked_add(1)
            .ok_or(CoreError::ArithmeticOverflow)?,
    )?;

    // A split inserts one sibling. Dense checked ranks prevent the new half from
    // colliding with a later sibling and make subsequent add allocation safe.
    let mut operations = vec![
        TimelineOperation::UpdateClip { clip: first },
        TimelineOperation::AddClip { clip: second },
    ];
    for (index, clip) in siblings.iter().enumerate() {
        if clip.id == target.id {
            continue;
        }
        let mut updated =
            existing_clip_input(clip, &database.assets().get(&clip.asset_id)?, composition)?;
        let new_index = if index < target_index {
            index
        } else {
            index.checked_add(1).ok_or(CoreError::ArithmeticOverflow)?
        };
        updated.sort_order = dense_rank(new_index)?;
        operations.push(TimelineOperation::UpdateClip { clip: updated });
    }
    Ok(CompositionMutation { operations })
}

fn mutation_reorder(
    database: &mut Database,
    composition: &Composition,
    payload: &Value,
) -> cutroom_core::Result<CompositionMutation> {
    let clip_id = required_string_core(payload, "clipId")?;
    let direction = required_string_core(payload, "direction")?;
    let target = find_clip(composition, &clip_id)?;
    let siblings = contiguous_track_clips(composition, &target.track_id)?;
    let index = siblings
        .iter()
        .position(|clip| clip.id == target.id)
        .ok_or_else(|| CoreError::InvalidInput("clip is not on its track".into()))?;
    let other_index = match direction.as_str() {
        "left" if index > 0 => index - 1,
        "right" if index + 1 < siblings.len() => index + 1,
        "left" | "right" => {
            return Err(CoreError::InvalidInput(
                "clip is already at the requested track boundary".into(),
            ));
        }
        _ => {
            return Err(CoreError::InvalidInput(
                "direction must be left or right".into(),
            ));
        }
    };
    let other = siblings[other_index];
    let leading_index = index.min(other_index);
    let leading = siblings[leading_index];
    let leading_start = canonical_timeline_ticks(
        &leading.timeline_start_ticks,
        composition,
        "stored clip start",
    )?;
    let target_asset = database.assets().get(&target.asset_id)?;
    let other_asset = database.assets().get(&other.asset_id)?;
    let mut target_input = existing_clip_input(target, &target_asset, composition)?;
    let mut other_input = existing_clip_input(other, &other_asset, composition)?;
    let target_duration = target_input.timeline_duration.ticks_i128()?;
    let other_duration = other_input.timeline_duration.ticks_i128()?;

    // A B0 reorder supports an adjacent swap only on a rank-ordered contiguous
    // track. Recalculate both starts from the numeric leading start; swapping
    // ranks alone produces overlaps or gaps whenever the ranges differ.
    if target.id == leading.id {
        other_input.timeline_start =
            RationalTime::from_ticks(leading_start, composition.time_base.clone())?;
        target_input.timeline_start = RationalTime::from_ticks(
            leading_start
                .checked_add(other_duration)
                .ok_or(CoreError::ArithmeticOverflow)?,
            composition.time_base.clone(),
        )?;
    } else {
        target_input.timeline_start =
            RationalTime::from_ticks(leading_start, composition.time_base.clone())?;
        other_input.timeline_start = RationalTime::from_ticks(
            leading_start
                .checked_add(target_duration)
                .ok_or(CoreError::ArithmeticOverflow)?,
            composition.time_base.clone(),
        )?;
    }
    std::mem::swap(&mut target_input.sort_order, &mut other_input.sort_order);
    Ok(CompositionMutation {
        operations: vec![
            TimelineOperation::UpdateClip { clip: target_input },
            TimelineOperation::UpdateClip { clip: other_input },
        ],
    })
}

fn mutation_set_color(
    composition: &Composition,
    payload: &Value,
) -> cutroom_core::Result<CompositionMutation> {
    let clip_id = required_string_core(payload, "clipId")?;
    if !composition.clips.iter().any(|clip| clip.id == clip_id) {
        return Err(CoreError::InvalidInput(
            "clip does not belong to the composition".into(),
        ));
    }
    let color: ClipColor = serde_json::from_value(
        payload.get("color").cloned().unwrap_or(Value::Null),
    )
    .map_err(|error| CoreError::InvalidInput(format!("invalid clip color: {error}")))?;
    color.validate()?;
    Ok(CompositionMutation {
        operations: vec![TimelineOperation::SetClipColor { clip_id, color }],
    })
}

fn mutation_remove(
    database: &mut Database,
    composition: &Composition,
    payload: &Value,
) -> cutroom_core::Result<CompositionMutation> {
    let target = find_clip(composition, &required_string_core(payload, "clipId")?)?;
    let siblings = ordered_track_clips(composition, &target.track_id)?;
    let target_index = siblings
        .iter()
        .position(|clip| clip.id == target.id)
        .ok_or_else(|| CoreError::InvalidInput("clip is not on its track".into()))?;
    let target_start = canonical_timeline_ticks(
        &target.timeline_start_ticks,
        composition,
        "stored clip start",
    )?;
    let duration = canonical_timeline_ticks(
        &target.timeline_duration_ticks,
        composition,
        "stored clip duration",
    )?;
    let mut operations = vec![TimelineOperation::RemoveClip {
        clip_id: target.id.clone(),
    }];
    for (index, clip) in siblings.iter().enumerate() {
        if clip.id == target.id {
            continue;
        }
        let asset = database.assets().get(&clip.asset_id)?;
        let mut updated = existing_clip_input(clip, &asset, composition)?;
        let start =
            canonical_timeline_ticks(&clip.timeline_start_ticks, composition, "stored clip start")?;
        if start > target_start {
            // Shift all later clips by exactly the removed duration. This retains
            // existing gaps between later clips instead of collapsing the track.
            updated.timeline_start = RationalTime::from_ticks(
                start
                    .checked_sub(duration)
                    .ok_or(CoreError::ArithmeticOverflow)?,
                composition.time_base.clone(),
            )?;
        }
        let new_index = if index < target_index {
            index
        } else {
            index.checked_sub(1).ok_or(CoreError::ArithmeticOverflow)?
        };
        updated.sort_order = dense_rank(new_index)?;
        operations.push(TimelineOperation::UpdateClip { clip: updated });
    }
    Ok(CompositionMutation { operations })
}

fn canonical_timeline_ticks(
    ticks: &str,
    composition: &Composition,
    field: &str,
) -> cutroom_core::Result<i128> {
    RationalTime::new(ticks.to_owned(), composition.time_base.clone())
        .and_then(|time| time.ticks_i128())
        .map_err(|_| CoreError::InvalidInput(format!("{field} must be canonical integer ticks")))
}

fn dense_rank(index: usize) -> cutroom_core::Result<i64> {
    i64::try_from(index).map_err(|_| CoreError::ArithmeticOverflow)
}

fn ordered_track_clips<'a>(
    composition: &'a Composition,
    track_id: &str,
) -> cutroom_core::Result<Vec<&'a Clip>> {
    let mut clips: Vec<_> = composition
        .clips
        .iter()
        .filter(|clip| clip.track_id == track_id)
        .collect();
    clips.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.id.cmp(&right.id))
    });
    if clips
        .windows(2)
        .any(|pair| pair[0].sort_order == pair[1].sort_order)
    {
        return Err(CoreError::InvalidInput(
            "B0 timeline operation requires unique track ranks".into(),
        ));
    }
    Ok(clips)
}

fn contiguous_track_clips<'a>(
    composition: &'a Composition,
    track_id: &str,
) -> cutroom_core::Result<Vec<&'a Clip>> {
    let clips = ordered_track_clips(composition, track_id)?;
    let mut expected_start = None;
    for clip in &clips {
        let start =
            canonical_timeline_ticks(&clip.timeline_start_ticks, composition, "stored clip start")?;
        if expected_start.is_some_and(|expected| start != expected) {
            return Err(CoreError::InvalidInput(
                "B0 reorder requires a contiguous rank-ordered track".into(),
            ));
        }
        let duration = canonical_timeline_ticks(
            &clip.timeline_duration_ticks,
            composition,
            "stored clip duration",
        )?;
        expected_start = Some(
            start
                .checked_add(duration)
                .ok_or(CoreError::ArithmeticOverflow)?,
        );
    }
    Ok(clips)
}

fn existing_clip_input(
    clip: &Clip,
    asset: &Asset,
    composition: &Composition,
) -> cutroom_core::Result<ClipInput> {
    clip_input(
        clip,
        asset,
        RationalTime::new(clip.in_ticks.clone(), asset.duration.time_base.clone())?,
        RationalTime::new(clip.out_ticks.clone(), asset.duration.time_base.clone())?,
        composition,
    )
}

fn clip_input(
    clip: &Clip,
    asset: &Asset,
    in_time: RationalTime,
    out_time: RationalTime,
    composition: &Composition,
) -> cutroom_core::Result<ClipInput> {
    let duration = out_time
        .ticks_i128()?
        .checked_sub(in_time.ticks_i128()?)
        .ok_or(CoreError::ArithmeticOverflow)?;
    let timeline_duration = RationalTime::new(
        RationalTime::from_ticks(duration, asset.duration.time_base.clone())?
            .exact_ticks_in(&composition.time_base)?,
        composition.time_base.clone(),
    )?;
    Ok(ClipInput {
        id: Some(clip.id.clone()),
        track_id: clip.track_id.clone(),
        asset_id: clip.asset_id.clone(),
        name: clip.name.clone(),
        in_time,
        out_time,
        timeline_start: RationalTime::new(
            clip.timeline_start_ticks.clone(),
            composition.time_base.clone(),
        )?,
        timeline_duration,
        sort_order: clip.sort_order,
        color: clip.color.clone(),
    })
}

fn find_clip<'a>(composition: &'a Composition, clip_id: &str) -> cutroom_core::Result<&'a Clip> {
    composition
        .clips
        .iter()
        .find(|clip| clip.id == clip_id)
        .ok_or_else(|| CoreError::InvalidInput("clip not found in composition".into()))
}

fn project_create_dto(project: &Project) -> Value {
    json!({
        "id": project.id,
        "name": project.name,
        "path": project.path,
        "fpsNumerator": project.fps.num,
        "fpsDenominator": project.fps.den,
        "aspectRatio": project.aspect_ratio,
        "createdAt": project.created_at,
        "updatedAt": project.updated_at,
        "revisionCount": 0,
        "latestRevisionId": Value::Null,
        "status": project.status,
    })
}

fn project_dto(project: &Project, session: &ProjectSession) -> Result<Value, DispatchError> {
    let revisions = with_database(&session.database, |database| {
        database.revisions().list(&project.id)
    })?;
    let latest = revisions.last();
    Ok(json!({
        "id": project.id,
        "name": project.name,
        "path": project.path,
        "fpsNumerator": project.fps.num,
        "fpsDenominator": project.fps.den,
        "aspectRatio": project.aspect_ratio,
        "createdAt": project.created_at,
        "updatedAt": project.updated_at,
        "revisionCount": revisions.len(),
        "latestRevisionId": latest.map(|revision| revision.id.clone()),
        "status": project.status,
    }))
}

fn asset_dto_with_fps(asset: &Asset, fps: &RationalTimeBase) -> Value {
    json!({
        "id": asset.id,
        "projectId": asset.project_id,
        "name": asset.name,
        "path": asset.path,
        "sizeBytes": asset.size_bytes,
        "durationTicks": asset.duration.ticks,
        "timeBase": { "num": asset.duration.time_base.num, "den": asset.duration.time_base.den },
        "width": asset.width,
        "height": asset.height,
        "fpsNumerator": fps.num,
        "fpsDenominator": fps.den,
        "format": asset.format,
        "codec": asset.codec,
        "audioChannels": asset.audio_channels,
        "importType": asset.import_type,
        "proxyStatus": asset.proxy_status,
        "sha256": asset.sha256,
    })
}

fn asset_dto(asset: &Asset, session: &ProjectSession) -> Result<Value, DispatchError> {
    let fps = session.asset_fps.get(&asset.id).cloned().ok_or_else(|| {
        DispatchError::new(
            "UNSUPPORTED_MEDIA",
            "asset frame rate has not been probed in this native session",
        )
    })?;
    Ok(asset_dto_with_fps(asset, &fps))
}

fn composition_dto(composition: &Composition) -> Value {
    json!({
        "id": composition.id,
        "projectId": composition.project_id,
        "version": composition.version,
        "durationTicks": composition.duration_ticks,
        "timeBase": { "num": composition.time_base.num, "den": composition.time_base.den },
        "tracks": composition.tracks.iter().map(track_dto).collect::<Vec<_>>(),
        "clips": composition.clips.iter().map(clip_dto).collect::<Vec<_>>(),
        "updatedAt": composition.updated_at,
    })
}

fn track_dto(track: &Track) -> Value {
    json!({ "id": track.id, "kind": track.kind, "label": track.label, "order": track.sort_order, "isMuted": track.is_muted, "isLocked": track.is_locked })
}

fn clip_dto(clip: &Clip) -> Value {
    json!({ "id": clip.id, "trackId": clip.track_id, "assetId": clip.asset_id, "name": clip.name, "inTicks": clip.in_ticks, "outTicks": clip.out_ticks, "timelineStartTicks": clip.timeline_start_ticks, "timelineDurationTicks": clip.timeline_duration_ticks, "color": clip.color })
}

fn revision_dto(revision: &Revision) -> Value {
    json!({ "id": revision.id, "projectId": revision.project_id, "revisionNumber": revision.revision_number, "commitNote": revision.commit_note, "author": revision.author, "createdAt": revision.created_at, "contentHash": revision.content_hash, "parentRevisionId": revision.parent_revision_id })
}

fn job_dto(job: &JobRecord) -> Value {
    let status = match job.status.as_str() {
        "succeeded" => "completed",
        "canceled" => "cancelled",
        other => other,
    };
    json!({ "id": job.id, "projectId": job.project_id, "title": job.title, "kind": job.kind, "status": status, "step": job.stage, "currentStep": job.progress, "totalSteps": 100, "elapsedSeconds": 0, "error": job.error })
}

fn required_project_id(request: &NativeRequest) -> Result<String, DispatchError> {
    request
        .project_id
        .clone()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| DispatchError::new("PROJECT_NOT_FOUND", "project_id is required"))
}

fn require_operation_id(request: &NativeRequest) -> Result<String, DispatchError> {
    let operation_id = request
        .operation_id
        .clone()
        .or_else(|| {
            optional_string(&request.payload, "operation_id")
                .ok()
                .flatten()
        })
        .ok_or_else(|| DispatchError::new("IDEMPOTENCY_CONFLICT", "operation_id is required"))?;
    let parsed = Uuid::parse_str(&operation_id)
        .map_err(|_| DispatchError::new("IDEMPOTENCY_CONFLICT", "operation_id must be UUIDv4"))?;
    if parsed.get_version_num() != 4 {
        return Err(DispatchError::new(
            "IDEMPOTENCY_CONFLICT",
            "operation_id must be UUIDv4",
        ));
    }
    Ok(operation_id)
}

fn require_expected_version(request: &NativeRequest) -> Result<i64, DispatchError> {
    request
        .expected_version
        .filter(|version| *version >= 1)
        .ok_or_else(|| {
            DispatchError::new(
                "STALE_WRITE_CONFLICT",
                "expected_version is required and must be positive",
            )
        })
}

fn required_string(payload: &Value, field: &str) -> Result<String, DispatchError> {
    optional_string(payload, field)?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            DispatchError::new(
                "INTERNAL_ERROR",
                format!("missing required payload field: {field}"),
            )
        })
}
fn optional_string(payload: &Value, field: &str) -> Result<Option<String>, DispatchError> {
    match payload.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(DispatchError::new(
            "INTERNAL_ERROR",
            format!("payload field {field} must be a string"),
        )),
    }
}
fn required_i64(payload: &Value, field: &str) -> Result<i64, DispatchError> {
    payload.get(field).and_then(Value::as_i64).ok_or_else(|| {
        DispatchError::new(
            "INTERNAL_ERROR",
            format!("payload field {field} must be an integer"),
        )
    })
}
fn required_string_core(payload: &Value, field: &str) -> cutroom_core::Result<String> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| CoreError::InvalidInput(format!("missing required payload field: {field}")))
}
fn optional_string_core(payload: &Value, field: &str) -> cutroom_core::Result<Option<String>> {
    match payload.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(CoreError::InvalidInput(format!(
            "payload field {field} must be a string"
        ))),
    }
}

/// A managed source is named by its accepted native intent, not a fresh random
/// UUID. If the process dies after a successful copy but before the database
/// receipt commits, replay reconciles this exact path rather than adding another
/// owned file. Its hash is still re-probed by the caller before it is accepted.
fn copy_managed_source(
    project_path: &str,
    source: &Path,
    operation_id: &str,
) -> Result<PathBuf, DispatchError> {
    let root = fs::canonicalize(project_path)
        .map_err(|error| DispatchError::new("UNSUPPORTED_MEDIA", error.to_string()))?;
    let root_metadata = fs::symlink_metadata(&root)
        .map_err(|error| DispatchError::new("UNSUPPORTED_MEDIA", error.to_string()))?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err(DispatchError::new(
            "UNSUPPORTED_MEDIA",
            "managed import project root is not a regular directory",
        ));
    }
    let cutroom = root.join(".cutroom");
    ensure_regular_directory(&cutroom)?;
    let managed = cutroom.join("media");
    match fs::symlink_metadata(&managed) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(DispatchError::new(
                "UNSUPPORTED_MEDIA",
                "managed import directory is not a regular directory",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => fs::create_dir(&managed)
            .map_err(|error| DispatchError::new("UNSUPPORTED_MEDIA", error.to_string()))?,
        Err(error) => return Err(DispatchError::new("UNSUPPORTED_MEDIA", error.to_string())),
    }
    let file_name = source.file_name().ok_or_else(|| {
        DispatchError::new("UNSUPPORTED_MEDIA", "selected media path has no file name")
    })?;
    let destination = managed.join(format!("{operation_id}-{}", file_name.to_string_lossy()));
    match fs::symlink_metadata(&destination) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(DispatchError::new(
                "UNSUPPORTED_MEDIA",
                "managed import destination is not a regular file",
            ));
        }
        // An existing file is a crash-recoverable copy for this exact intent.
        // The caller re-probes and compares its source identity before database
        // publication; it is never accepted on name alone.
        Ok(_) => return Ok(destination),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(DispatchError::new("UNSUPPORTED_MEDIA", error.to_string())),
    }
    fs::copy(source, &destination).map_err(|error| {
        let _ = fs::remove_file(&destination);
        DispatchError::new("UNSUPPORTED_MEDIA", error.to_string())
    })?;
    let copied = fs::File::open(&destination)
        .map_err(|error| DispatchError::new("UNSUPPORTED_MEDIA", error.to_string()))?;
    copied
        .sync_all()
        .map_err(|error| DispatchError::new("UNSUPPORTED_MEDIA", error.to_string()))?;
    Ok(destination)
}

fn ensure_regular_directory(path: &Path) -> Result<(), DispatchError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => Err(
            DispatchError::new("UNSUPPORTED_MEDIA", "expected a regular directory"),
        ),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => fs::create_dir(path)
            .map_err(|error| DispatchError::new("UNSUPPORTED_MEDIA", error.to_string())),
        Err(error) => Err(DispatchError::new("UNSUPPORTED_MEDIA", error.to_string())),
    }
}

fn file_format(path: &Path) -> String {
    path.extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("unknown")
        .to_ascii_lowercase()
}

fn map_core_error(error: CoreError) -> DispatchError {
    match error {
        CoreError::ProjectNotFound(message) => DispatchError::new("PROJECT_NOT_FOUND", message),
        CoreError::ProjectLocked(path) => {
            DispatchError::new("PROJECT_LOCKED", path.display().to_string())
        }
        CoreError::StaleWriteConflict { expected, current } => DispatchError::new(
            "STALE_WRITE_CONFLICT",
            format!("expected version {expected}, current version {current}"),
        ),
        CoreError::IdempotencyConflict { operation_id } => {
            DispatchError::new("IDEMPOTENCY_CONFLICT", operation_id)
        }
        CoreError::InvalidSourceRange { asset_id, reason } => {
            DispatchError::new("INVALID_SOURCE_RANGE", format!("{asset_id}: {reason}"))
        }
        CoreError::InvalidInput(message)
            if message == "B0 reorder requires a contiguous rank-ordered track" =>
        {
            DispatchError::new("UNSUPPORTED_TIMELINE_LAYOUT", message)
        }
        CoreError::InvalidInput(message)
            if message == "clip is already at the requested track boundary" =>
        {
            DispatchError::new("INVALID_TIMELINE_OPERATION", message)
        }
        CoreError::InvalidInput(message) => DispatchError::new("INVALID_INPUT", message),
        CoreError::JobNotFound(message) => DispatchError::new("JOB_NOT_FOUND", message),
        other => DispatchError::new("INTERNAL_ERROR", other.to_string()),
    }
}
fn map_media_error(error: cutroom_media::MediaError) -> DispatchError {
    match error {
        cutroom_media::MediaError::InvalidRange { .. } => {
            DispatchError::new("INVALID_SOURCE_RANGE", error.to_string())
        }
        cutroom_media::MediaError::UnsupportedMedia(_)
        | cutroom_media::MediaError::SourceIdentityMismatch { .. }
        | cutroom_media::MediaError::SourceChanged(_) => {
            DispatchError::new("UNSUPPORTED_MEDIA", error.to_string())
        }
        other => DispatchError::new("INTERNAL_ERROR", other.to_string()),
    }
}
fn map_jobs_error(error: cutroom_jobs::JobsError) -> DispatchError {
    match error {
        cutroom_jobs::JobsError::Core(error) => map_core_error(error),
        cutroom_jobs::JobsError::Media(error) => map_media_error(error),
        other => DispatchError::new("INTERNAL_ERROR", other.to_string()),
    }
}
