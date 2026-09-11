use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use cutroom_core::{
    Database, JobEnqueue, JobRecord, NativeReceipt, NativeReceiptLookup, RenderJobSpec,
};
use cutroom_media::{CancellationToken, MediaEngine, SourceRange, TwoClipRenderRequest};
use serde_json::Value;

use crate::{JobsError, Result};

const LEASE_SECONDS: i64 = 5;
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);

/// Single-process durable render worker. The SQLite handle remains the source of
/// truth; the mutex is held only for short repository transactions, never for media work.
#[derive(Clone)]
pub struct JobEngine {
    database: Arc<Mutex<Database>>,
    media: MediaEngine,
    active: Arc<Mutex<HashMap<String, CancellationToken>>>,
    shutting_down: Arc<AtomicBool>,
}

impl JobEngine {
    pub fn new(database: Arc<Mutex<Database>>, media: MediaEngine) -> Self {
        Self {
            database,
            media,
            active: Arc::new(Mutex::new(HashMap::new())),
            shutting_down: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn enqueue_render(&self, input: JobEnqueue) -> Result<JobRecord> {
        self.with_database(|database| database.jobs().enqueue_render(&input))
    }

    /// The durable queue row and its native reply commit together, so an IPC
    /// timeout can replay an exact job rather than enqueue another render.
    pub fn enqueue_render_with_native_receipt(
        &self,
        input: JobEnqueue,
        expected_version: i64,
        receipt: &NativeReceipt,
        response: impl FnOnce(&JobRecord) -> Value,
    ) -> Result<Value> {
        self.with_database(|database| {
            database.jobs().enqueue_render_with_native_receipt(
                &input,
                expected_version,
                receipt,
                response,
            )
        })
    }

    pub fn get(&self, job_id: &str) -> Result<JobRecord> {
        self.with_database(|database| database.jobs().get(job_id))
    }

    pub fn list(&self, project_id: &str) -> Result<Vec<JobRecord>> {
        self.with_database(|database| database.jobs().list(project_id))
    }

    /// Persists cancellation before signalling the currently owned media child.
    pub fn cancel(&self, job_id: &str) -> Result<JobRecord> {
        let job = self.with_database(|database| database.jobs().request_cancel(job_id))?;
        if let Some(token) = self
            .active
            .lock()
            .map_err(|_| JobsError::MutexPoisoned)?
            .get(job_id)
            .cloned()
        {
            token.cancel();
        }
        Ok(job)
    }

    /// Commit cancellation before signaling an owned child. If signaling is lost
    /// during a process crash, the persisted cancel request is reconciled by the
    /// worker's lease recovery path.
    pub fn cancel_with_native_receipt(
        &self,
        project_id: &str,
        job_id: &str,
        receipt: &NativeReceipt,
        response: impl FnOnce(&JobRecord) -> Value,
    ) -> Result<Value> {
        let value = self.with_database(|database| {
            database
                .jobs()
                .request_cancel_with_native_receipt(project_id, job_id, receipt, response)
        })?;
        if let Some(token) = self
            .active
            .lock()
            .map_err(|_| JobsError::MutexPoisoned)?
            .get(job_id)
            .cloned()
        {
            token.cancel();
        }
        Ok(value)
    }

    pub fn retry(&self, job_id: &str) -> Result<JobRecord> {
        let database_path = self.database_path()?;
        let prior = self.get(job_id)?;
        // Clean only the prior attempt before publishing retrying state. A cleanup
        // refusal leaves the terminal row intact rather than half-publishing retry.
        remove_owned_scratch(&database_path, &prior)?;
        self.with_database(|database| database.jobs().retry(job_id))
    }

    /// Scratch cleanup is deterministic and happens before the atomic database
    /// transition. A crash after cleanup leaves the terminal job safely retryable;
    /// no retry state is published unless its canonical response is committed.
    pub fn retry_with_native_receipt(
        &self,
        project_id: &str,
        job_id: &str,
        receipt: &NativeReceipt,
        response: impl FnOnce(&JobRecord) -> Value,
    ) -> Result<Value> {
        let replay = self.with_database(|database| {
            match database.native_receipts().lookup(
                &receipt.operation_id,
                &receipt.command,
                receipt.project_id.as_deref(),
                &receipt.request_hash,
            )? {
                NativeReceiptLookup::Missing => Ok(None),
                NativeReceiptLookup::Replay(json) => Ok(Some(serde_json::from_str(&json)?)),
            }
        })?;
        if let Some(response) = replay {
            return Ok(response);
        }
        let database_path = self.database_path()?;
        let prior = self.get(job_id)?;
        if prior.project_id != project_id {
            return Err(JobsError::Core(cutroom_core::CoreError::JobNotFound(
                job_id.into(),
            )));
        }
        remove_owned_scratch(&database_path, &prior)?;
        self.with_database(|database| {
            database
                .jobs()
                .retry_with_native_receipt(project_id, job_id, receipt, response)
        })
    }

    /// Recovers expired leases only. It never kills a PID from persisted state:
    /// a process ID can be reused after a crash. Any stale scratch cleanup is
    /// restricted to the deterministic directory for that job ID and attempt.
    pub fn recover_startup(&self) -> Result<Vec<JobRecord>> {
        let database_path = self.database_path()?;
        let recovered = self.with_database(|database| database.jobs().recover_stale())?;
        for job in &recovered {
            remove_owned_scratch(&database_path, job)?;
        }
        Ok(recovered)
    }

    /// Claims and runs at most one job. A successful return contains the durable
    /// terminal record; an empty queue or truthful waiting dependency returns None.
    pub fn run_once(&self) -> Result<Option<JobRecord>> {
        if self.shutting_down.load(Ordering::Acquire) {
            return Err(JobsError::Shutdown);
        }
        let claim = self.with_database(|database| database.jobs().claim_next(LEASE_SECONDS))?;
        let Some(claim) = claim else {
            return Ok(None);
        };
        let database_path = self.database_path()?;
        let scratch_dir = match create_owned_scratch(&database_path, &claim.job) {
            Ok(path) => path,
            Err(error) => {
                return self.abort_claim(&claim.job, &claim.lease_token, &database_path, error);
            }
        };
        let scratch_text = scratch_dir.to_string_lossy().into_owned();
        let mut job = claim.job.clone();
        job.scratch_dir = Some(scratch_text.clone());
        let stored = match self.with_database(|database| {
            database
                .jobs()
                .set_scratch_dir(&job.id, &claim.lease_token, &scratch_text)
        }) {
            Ok(stored) => stored,
            Err(error) => return self.abort_claim(&job, &claim.lease_token, &database_path, error),
        };
        if !stored {
            return self.abort_claim(
                &job,
                &claim.lease_token,
                &database_path,
                JobsError::Core(cutroom_core::CoreError::InvalidInput(
                    "claimed job lost before scratch ownership was persisted".into(),
                )),
            );
        }
        let cancel_requested = match self.with_database(|database| {
            database
                .jobs()
                .is_cancel_requested(&job.id, &claim.lease_token)
        }) {
            Ok(value) => value,
            Err(error) => return self.abort_claim(&job, &claim.lease_token, &database_path, error),
        };
        if cancel_requested {
            let job = self.finish_canceled(
                &job,
                &claim.lease_token,
                &database_path,
                "Cancellation requested before render started",
            )?;
            return Ok(Some(job));
        }

        let cancellation = CancellationToken::new();
        let mut active = match self.active.lock() {
            Ok(active) => active,
            Err(_) => {
                return self.abort_claim(
                    &job,
                    &claim.lease_token,
                    &database_path,
                    JobsError::MutexPoisoned,
                );
            }
        };
        // This check and insertion share the active-map mutex with shutdown:
        // shutdown either observes this token and cancels it, or this worker sees
        // shutdown first and never starts FFmpeg after its claim.
        if self.shutting_down.load(Ordering::Acquire) {
            drop(active);
            let _ = self.with_database(|database| database.jobs().request_cancel(&job.id))?;
            let _ = self.finish_canceled(
                &job,
                &claim.lease_token,
                &database_path,
                "Shutdown requested before render started",
            )?;
            return Err(JobsError::Media(cutroom_media::MediaError::Cancelled));
        }
        active.insert(job.id.clone(), cancellation.clone());
        drop(active);
        let heartbeat_stop = Arc::new(AtomicBool::new(false));
        let heartbeat = self.spawn_heartbeat(
            job.id.clone(),
            claim.lease_token.clone(),
            heartbeat_stop.clone(),
            cancellation.clone(),
        );
        let render = self
            .with_database(|database| database.jobs().render_spec(&job.id))
            .and_then(|spec| render_request(&job, spec, scratch_dir.join("artifact.mp4")));
        let render_result = render.and_then(|request| {
            self.media
                .render_1080p_sdr(&request, &cancellation)
                .map_err(JobsError::from)
        });
        heartbeat_stop.store(true, Ordering::Release);
        heartbeat.join().map_err(|_| JobsError::ThreadFailed)?;
        self.active
            .lock()
            .map_err(|_| JobsError::MutexPoisoned)?
            .remove(&job.id);

        match render_result {
            Ok(artifact) => {
                let finalization = self.with_database(|database| {
                    database.jobs().finish_success(
                        &job.id,
                        &claim.lease_token,
                        &artifact.path.to_string_lossy(),
                        &artifact.sha256,
                        &artifact.config_digest,
                    )
                });
                let finalized = match finalization {
                    Ok(finalized) => finalized,
                    Err(error) => {
                        let cleanup = remove_owned_scratch(&database_path, &job);
                        cleanup?;
                        return Err(error);
                    }
                };
                if finalized {
                    return self.get(&job.id).map(Some);
                }
                let _ = self.finish_canceled(
                    &job,
                    &claim.lease_token,
                    &database_path,
                    "Cancellation won finalization; successful artifact removed",
                )?;
                Err(JobsError::Media(cutroom_media::MediaError::Cancelled))
            }
            Err(error) => {
                let finalization = self.with_database(|database| {
                    database
                        .jobs()
                        .finish_failure(&job.id, &claim.lease_token, &format!("{error}"))
                });
                let cleanup = remove_owned_scratch(&database_path, &job);
                finalization?;
                cleanup?;
                Err(error)
            }
        }
    }

    /// Stops accepting work, persistently requests cancellation for active jobs,
    /// and signals only children owned by this engine invocation.
    pub fn shutdown(&self) -> Result<()> {
        self.shutting_down.store(true, Ordering::Release);
        let active = self
            .active
            .lock()
            .map_err(|_| JobsError::MutexPoisoned)?
            .clone();
        for (job_id, token) in active {
            token.cancel();
            let _ = self.with_database(|database| database.jobs().request_cancel(&job_id))?;
        }
        Ok(())
    }

    fn abort_claim(
        &self,
        job: &JobRecord,
        lease_token: &str,
        database_path: &Path,
        error: JobsError,
    ) -> Result<Option<JobRecord>> {
        let finalization = self.with_database(|database| {
            database
                .jobs()
                .finish_failure(&job.id, lease_token, &format!("{error}"))
        });
        let cleanup = remove_owned_scratch(database_path, job);
        finalization?;
        cleanup?;
        Err(error)
    }

    fn finish_canceled(
        &self,
        job: &JobRecord,
        lease_token: &str,
        database_path: &Path,
        reason: &str,
    ) -> Result<JobRecord> {
        let finished = self.with_database(|database| {
            database
                .jobs()
                .finalize_canceled(&job.id, lease_token, reason)
        });
        let cleanup = remove_owned_scratch(database_path, job);
        let finished = finished?;
        cleanup?;
        Ok(finished)
    }

    fn spawn_heartbeat(
        &self,
        job_id: String,
        lease_token: String,
        stop: Arc<AtomicBool>,
        cancellation: CancellationToken,
    ) -> thread::JoinHandle<()> {
        let database = Arc::clone(&self.database);
        thread::spawn(move || {
            while !stop.load(Ordering::Acquire) {
                thread::sleep(HEARTBEAT_INTERVAL);
                if stop.load(Ordering::Acquire) {
                    break;
                }
                let Ok(mut database) = database.lock() else {
                    cancellation.cancel();
                    break;
                };
                let Ok(alive) = database.jobs().heartbeat_stage(
                    &job_id,
                    &lease_token,
                    LEASE_SECONDS,
                    "rendering",
                ) else {
                    cancellation.cancel();
                    break;
                };
                if !alive {
                    cancellation.cancel();
                    break;
                }
            }
        })
    }

    fn database_path(&self) -> Result<PathBuf> {
        self.with_database(|database| Ok(database.path().to_path_buf()))
    }

    fn with_database<T>(
        &self,
        operation: impl FnOnce(&mut Database) -> cutroom_core::Result<T>,
    ) -> Result<T> {
        let mut database = self.database.lock().map_err(|_| JobsError::MutexPoisoned)?;
        Ok(operation(&mut database)?)
    }
}

fn render_request(
    job: &JobRecord,
    spec: RenderJobSpec,
    destination: PathBuf,
) -> Result<TwoClipRenderRequest> {
    if spec.project_id != job.project_id
        || job.revision_id.as_deref() != Some(spec.revision_id.as_str())
    {
        return Err(JobsError::Core(cutroom_core::CoreError::InvalidInput(
            "job render specification does not match its durable project/revision binding".into(),
        )));
    }
    Ok(TwoClipRenderRequest {
        clips: spec.clips.map(|clip| SourceRange {
            source: PathBuf::from(clip.source),
            expected_sha256: clip.expected_sha256,
            start: clip.start,
            end: clip.end,
        }),
        destination,
    })
}

const OWNERSHIP_MARKER: &str = ".cutroom-owned-attempt";

fn create_owned_scratch(database_path: &Path, job: &JobRecord) -> Result<PathBuf> {
    validate_job_identity(job)?;
    let database_parent = fs::canonicalize(
        database_path
            .parent()
            .ok_or_else(|| JobsError::UnsafeScratchPath("database path has no parent".into()))?,
    )?;
    let root = ensure_directory_child(&database_parent, "jobs", false)?;
    let job_root = ensure_directory_child(&root, &job.id, false)?;
    let attempt_name = format!("attempt-{}", job.attempt);
    // Attempts are exclusive: a collision is never considered ours and is not deleted.
    let attempt = ensure_directory_child(&job_root, &attempt_name, true)?;
    let marker = attempt.join(OWNERSHIP_MARKER);
    let mut marker_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker)?;
    marker_file.write_all(format!("{}:{}", job.id, job.attempt).as_bytes())?;
    marker_file.sync_all()?;
    Ok(attempt)
}

fn remove_owned_scratch(database_path: &Path, job: &JobRecord) -> Result<()> {
    let Some(path) = job.scratch_dir.as_ref() else {
        return Ok(());
    };
    validate_job_identity(job)?;
    let database_parent = fs::canonicalize(
        database_path
            .parent()
            .ok_or_else(|| JobsError::UnsafeScratchPath("database path has no parent".into()))?,
    )?;
    let expected_root = database_parent.join("jobs");
    let expected_job_root = expected_root.join(&job.id);
    let expected_attempt = expected_job_root.join(format!("attempt-{}", job.attempt));
    if Path::new(path) != expected_attempt {
        return Err(JobsError::UnsafeScratchPath(path.clone()));
    }
    let Some(root) = existing_directory_child(&database_parent, "jobs")? else {
        return Ok(());
    };
    let Some(job_root) = existing_directory_child(&root, &job.id)? else {
        return Ok(());
    };
    let Some(attempt) = existing_directory_child(&job_root, &format!("attempt-{}", job.attempt))?
    else {
        return Ok(());
    };
    let marker = attempt.join(OWNERSHIP_MARKER);
    if fs::read_to_string(&marker)? != format!("{}:{}", job.id, job.attempt) {
        return Err(JobsError::UnsafeScratchPath(path.clone()));
    }
    fs::remove_dir_all(&attempt)?;
    if fs::read_dir(&job_root)?.next().is_none() {
        let _ = fs::remove_dir(&job_root);
    }
    Ok(())
}

fn ensure_directory_child(parent: &Path, name: &str, exclusive: bool) -> Result<PathBuf> {
    let path = parent.join(name);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(JobsError::UnsafeScratchPath(path.display().to_string()))
        }
        Ok(_) if exclusive => Err(JobsError::UnsafeScratchPath(format!(
            "refusing pre-existing scratch attempt: {}",
            path.display()
        ))),
        Ok(_) => Ok(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&path)?;
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(JobsError::UnsafeScratchPath(path.display().to_string()));
            }
            Ok(path)
        }
        Err(error) => Err(error.into()),
    }
}

fn existing_directory_child(parent: &Path, name: &str) -> Result<Option<PathBuf>> {
    let path = parent.join(name);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(JobsError::UnsafeScratchPath(path.display().to_string()))
        }
        Ok(_) => Ok(Some(path)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn validate_job_identity(job: &JobRecord) -> Result<()> {
    if uuid::Uuid::parse_str(&job.id).is_err() || job.attempt < 1 {
        return Err(JobsError::UnsafeScratchPath(format!(
            "invalid job identity {} attempt {}",
            job.id, job.attempt
        )));
    }
    Ok(())
}
