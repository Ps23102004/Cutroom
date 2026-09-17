mod support;

use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc, Mutex, mpsc},
    thread,
    time::{Duration, Instant},
};

use cutroom_core::{Database, JobEnqueue, JobStatus};
use cutroom_jobs::{JobEngine, JobsError};
use cutroom_media::{MediaEngine, MediaError};
use uuid::Uuid;

use support::{assert_artifact, fixture_a, fixture_b, setup_fixture, sha256};

const CRASH_CHILD_PATH: &str = "CUTROOM_JOBS_CRASH_CHILD_PATH";
const CRASH_READY: &str = "CUTROOM_JOBS_CRASH_READY";

fn make_engine(
    fixture: support::JobFixture,
) -> (
    JobEngine,
    Arc<Mutex<Database>>,
    String,
    String,
    support::TestDirectory,
) {
    let project_id = fixture.project.id.clone();
    let revision_id = fixture.revision.id.clone();
    let support::JobFixture {
        _directory: directory,
        database: raw_database,
        ..
    } = fixture;
    let database = Arc::new(Mutex::new(raw_database));
    let engine = JobEngine::new(Arc::clone(&database), MediaEngine::discover().unwrap());
    (engine, database, project_id, revision_id, directory)
}

fn enqueue(engine: &JobEngine, project_id: &str, revision_id: &str) -> cutroom_core::JobRecord {
    engine
        .enqueue_render(JobEnqueue {
            operation_id: Uuid::new_v4().to_string(),
            project_id: project_id.into(),
            revision_id: revision_id.into(),
            dependency_job_id: None,
            output: None,
        })
        .unwrap()
}

#[test]
fn crash_child_claims_job_at_safe_scratch_checkpoint() {
    let Some(path) = std::env::var_os(CRASH_CHILD_PATH) else {
        return;
    };
    let path = PathBuf::from(path);
    let mut database = Database::open(&path).unwrap();
    let claim = database.jobs().claim_next(1).unwrap().unwrap();
    let database_path = database.path().to_path_buf();
    let scratch = database_path
        .parent()
        .unwrap()
        .join("jobs")
        .join(&claim.job.id)
        .join(format!("attempt-{}", claim.job.attempt));
    fs::create_dir_all(&scratch).unwrap();
    fs::write(
        scratch.join(".cutroom-owned-attempt"),
        format!("{}:{}", claim.job.id, claim.job.attempt),
    )
    .unwrap();
    fs::write(scratch.join("artifact.mp4"), b"partial").unwrap();
    database
        .jobs()
        .set_scratch_dir(
            &claim.job.id,
            &claim.lease_token,
            &scratch.display().to_string(),
        )
        .unwrap();
    println!("{CRASH_READY}");
    std::io::stdout().flush().unwrap();
    thread::sleep(Duration::from_secs(30));
}

#[test]
fn process_termination_recovery_retries_once_without_duplicate_or_false_success() {
    let mut fixture = setup_fixture();
    let project_id = fixture.project.id.clone();
    let revision_id = fixture.revision.id.clone();
    let database_path = fixture._directory.path().join("project.cutroom");
    let unrelated = fixture._directory.path().join("unrelated.txt");
    fs::write(&unrelated, b"preserve").unwrap();
    let job = fixture
        .database
        .jobs()
        .enqueue_render(&JobEnqueue {
            operation_id: Uuid::new_v4().to_string(),
            project_id: project_id.clone(),
            revision_id: revision_id.clone(),
            dependency_job_id: None,
            output: None,
        })
        .unwrap();
    let directory = fixture._directory;
    drop(fixture.database);

    let mut child = Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("crash_child_claims_job_at_safe_scratch_checkpoint")
        .arg("--nocapture")
        .env(CRASH_CHILD_PATH, &database_path)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdout = child.stdout.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        while reader.read_line(&mut line).unwrap_or(0) != 0 {
            if line.contains(CRASH_READY) {
                let _ = sender.send(true);
                return;
            }
            line.clear();
        }
        let _ = sender.send(false);
    });
    let ready = receiver
        .recv_timeout(Duration::from_secs(5))
        .unwrap_or(false);
    child.kill().unwrap();
    child.wait().unwrap();
    reader.join().unwrap();
    assert!(ready, "crash child did not reach scratch checkpoint");

    thread::sleep(Duration::from_millis(1_200));
    let database = Arc::new(Mutex::new(Database::open(&database_path).unwrap()));
    let engine = JobEngine::new(Arc::clone(&database), MediaEngine::discover().unwrap());
    let recovered = engine.recover_startup().unwrap();
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].id, job.id);
    assert_eq!(recovered[0].status, JobStatus::Retrying);
    assert!(recovered[0].artifact_path.is_none());
    assert_eq!(fs::read(&unrelated).unwrap(), b"preserve");

    let succeeded = engine.run_once().unwrap().unwrap();
    assert_eq!(succeeded.id, job.id);
    assert_eq!(succeeded.status, JobStatus::Succeeded);
    assert_eq!(engine.list(&project_id).unwrap().len(), 1);
    drop(directory);
}

#[test]
fn run_once_performs_real_render_and_persists_verified_artifact() {
    let fixture = setup_fixture();
    let source_a = fixture_a();
    let source_b = fixture_b();
    let (engine, _, project_id, revision_id, _directory) = make_engine(fixture);
    let queued = enqueue(&engine, &project_id, &revision_id);
    let succeeded = engine.run_once().unwrap().unwrap();

    assert_eq!(succeeded.id, queued.id);
    assert_eq!(succeeded.status, JobStatus::Succeeded);
    assert_eq!(succeeded.progress, 100);
    let artifact = PathBuf::from(succeeded.artifact_path.clone().unwrap());
    assert_artifact(&artifact);
    let artifact_hash = sha256(&artifact);
    assert_eq!(
        succeeded.artifact_sha256.as_deref(),
        Some(artifact_hash.as_str())
    );
    assert!(
        succeeded
            .config_digest
            .as_ref()
            .is_some_and(|digest| digest.len() == 64)
    );
    assert!(
        succeeded
            .scratch_dir
            .as_ref()
            .is_some_and(|path| PathBuf::from(path).join("artifact.mp4") == artifact)
    );
    assert_eq!(
        sha256(&source_a),
        "06e35e744a729825b664fc938485d840307755bcc44a60cd3f47f362555bcccb"
    );
    assert_eq!(
        sha256(&source_b),
        "5bcb5af63d409cd5f9a46c849867315b83fc9377e5ddab31ac70295ad6654560"
    );
}

#[test]
fn in_flight_cancel_kills_render_and_removes_owned_artifact() {
    let fixture = setup_fixture();
    let (engine, _, project_id, revision_id, _directory) = make_engine(fixture);
    let queued = enqueue(&engine, &project_id, &revision_id);
    let worker_engine = engine.clone();
    let worker = thread::spawn(move || worker_engine.run_once());

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut scratch = None;
    while Instant::now() < deadline {
        if let Ok(job) = engine.get(&queued.id)
            && let Some(path) = job.scratch_dir
        {
            let artifact = PathBuf::from(&path).join("artifact.mp4");
            if artifact.is_file() {
                scratch = Some(path);
                break;
            }
        }
        thread::sleep(Duration::from_millis(10));
    }
    let scratch = scratch.unwrap_or_else(|| panic!("render did not create an owned artifact"));
    assert_eq!(engine.get(&queued.id).unwrap().progress, 0);
    let requested = engine.cancel(&queued.id).unwrap();
    assert!(requested.cancel_requested);
    let result = worker.join().unwrap();
    assert!(
        matches!(result, Err(JobsError::Media(MediaError::Cancelled))),
        "unexpected worker result: {result:?}"
    );
    let final_job = engine.get(&queued.id).unwrap();
    assert_eq!(final_job.status, JobStatus::Canceled);
    assert!(!PathBuf::from(scratch).exists());
    assert!(final_job.artifact_path.is_none());
    let retried = engine.retry(&queued.id).unwrap();
    assert_eq!(retried.status, JobStatus::Retrying);
    let succeeded = engine.run_once().unwrap().unwrap();
    assert_eq!(succeeded.id, queued.id);
    assert_eq!(succeeded.status, JobStatus::Succeeded);
    assert_eq!(succeeded.attempt, 2);
    assert_eq!(engine.list(&project_id).unwrap().len(), 1);
}

#[test]
fn startup_recovery_removes_only_owned_scratch_and_preserves_unrelated_files() {
    let fixture = setup_fixture();
    let unrelated = fixture._directory.path().join("keep.txt");
    fs::write(&unrelated, b"keep me").unwrap();
    let (engine, database, project_id, revision_id, _directory) = make_engine(fixture);
    let queued = enqueue(&engine, &project_id, &revision_id);
    let claim = database
        .lock()
        .unwrap()
        .jobs()
        .claim_next(1)
        .unwrap()
        .unwrap();
    let database_path = database.lock().unwrap().path().to_path_buf();
    let scratch = database_path
        .parent()
        .unwrap()
        .join("jobs")
        .join(&queued.id)
        .join(format!("attempt-{}", claim.job.attempt));
    fs::create_dir_all(&scratch).unwrap();
    fs::write(
        scratch.join(".cutroom-owned-attempt"),
        format!("{}:{}", queued.id, claim.job.attempt),
    )
    .unwrap();
    fs::write(scratch.join("artifact.mp4"), b"partial").unwrap();
    database
        .lock()
        .unwrap()
        .jobs()
        .set_scratch_dir(
            &queued.id,
            &claim.lease_token,
            &scratch.display().to_string(),
        )
        .unwrap();
    thread::sleep(Duration::from_millis(1_200));

    let recovered = engine.recover_startup().unwrap();
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].status, JobStatus::Retrying);
    assert!(!scratch.exists());
    assert_eq!(fs::read(&unrelated).unwrap(), b"keep me");
}

#[test]
fn setup_failure_does_not_leave_claimed_job_running_or_fake_progress() {
    let fixture = setup_fixture();
    let (engine, database, project_id, revision_id, _directory) = make_engine(fixture);
    let queued = enqueue(&engine, &project_id, &revision_id);
    let database_path = database.lock().unwrap().path().to_path_buf();
    let scratch = database_path
        .parent()
        .unwrap()
        .join("jobs")
        .join(&queued.id)
        .join("attempt-1");
    fs::create_dir_all(&scratch).unwrap();
    fs::write(scratch.join("unrelated.txt"), b"preserve").unwrap();

    let error = engine.run_once().unwrap_err();
    assert!(matches!(error, JobsError::UnsafeScratchPath(_)));
    let failed = engine.get(&queued.id).unwrap();
    assert_eq!(failed.status, JobStatus::Failed);
    assert_eq!(failed.progress, 0);
    assert!(failed.error.is_some());
    assert_eq!(
        fs::read(scratch.join("unrelated.txt")).unwrap(),
        b"preserve"
    );
}

#[cfg(unix)]
#[test]
fn symlinked_scratch_root_and_job_directory_are_rejected_without_touching_sentinel() {
    use std::os::unix::fs::symlink;

    for job_directory_symlink in [false, true] {
        let fixture = setup_fixture();
        let (engine, database, project_id, revision_id, _directory) = make_engine(fixture);
        let queued = enqueue(&engine, &project_id, &revision_id);
        let database_parent = database
            .lock()
            .unwrap()
            .path()
            .parent()
            .unwrap()
            .to_path_buf();
        let jobs_root = database_parent.join("jobs");
        let sentinel = database_parent.join("outside-scratch");
        fs::create_dir_all(&sentinel).unwrap();
        fs::write(sentinel.join("keep.txt"), b"keep").unwrap();
        if job_directory_symlink {
            fs::create_dir_all(&jobs_root).unwrap();
            symlink(&sentinel, jobs_root.join(&queued.id)).unwrap();
        } else {
            symlink(&sentinel, &jobs_root).unwrap();
        }

        let error = engine.run_once().unwrap_err();
        assert!(matches!(error, JobsError::UnsafeScratchPath(_)));
        assert_eq!(engine.get(&queued.id).unwrap().status, JobStatus::Failed);
        assert_eq!(fs::read(sentinel.join("keep.txt")).unwrap(), b"keep");
    }
}

#[test]
fn persisted_cancel_is_recovered_as_canceled_not_retrying() {
    let fixture = setup_fixture();
    let (engine, database, project_id, revision_id, _directory) = make_engine(fixture);
    let queued = enqueue(&engine, &project_id, &revision_id);
    let claim = database
        .lock()
        .unwrap()
        .jobs()
        .claim_next(1)
        .unwrap()
        .unwrap();
    database
        .lock()
        .unwrap()
        .jobs()
        .request_cancel(&queued.id)
        .unwrap();
    thread::sleep(Duration::from_millis(1_200));
    let recovered = engine.recover_startup().unwrap();
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].status, JobStatus::Canceled);
    assert!(recovered[0].cancel_requested);
    assert!(
        !database
            .lock()
            .unwrap()
            .jobs()
            .heartbeat(&queued.id, &claim.lease_token, 30, "late", 50)
            .unwrap()
    );
}

#[test]
fn shutdown_rejects_new_work_after_requesting_active_cancellation() {
    let fixture = setup_fixture();
    let (engine, _, project_id, revision_id, _directory) = make_engine(fixture);
    let queued = enqueue(&engine, &project_id, &revision_id);
    let worker_engine = engine.clone();
    let worker = thread::spawn(move || worker_engine.run_once());
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if engine.get(&queued.id).unwrap().scratch_dir.is_some() {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    engine.shutdown().unwrap();
    let result = worker.join().unwrap();
    assert!(
        matches!(result, Err(JobsError::Media(MediaError::Cancelled))),
        "unexpected shutdown result: {result:?}"
    );
    assert!(matches!(engine.run_once(), Err(JobsError::Shutdown)));
}
