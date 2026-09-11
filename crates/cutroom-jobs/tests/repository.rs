mod support;

use std::{
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use cutroom_core::{CoreError, JobEnqueue, JobStatus};
use uuid::Uuid;

use support::setup_fixture;

fn enqueue(
    fixture: &mut support::JobFixture,
    operation_id: &str,
    dependency_job_id: Option<String>,
) -> cutroom_core::JobRecord {
    fixture
        .database
        .jobs()
        .enqueue_render(&JobEnqueue {
            operation_id: operation_id.into(),
            project_id: fixture.project.id.clone(),
            revision_id: fixture.revision.id.clone(),
            dependency_job_id,
        })
        .unwrap()
}

#[test]
fn enqueue_persists_revision_bound_render_spec_and_replays_same_operation() {
    let mut fixture = setup_fixture();
    let operation_id = Uuid::new_v4().to_string();
    let first = enqueue(&mut fixture, &operation_id, None);
    assert_eq!(first.status, JobStatus::Queued);
    assert_eq!(first.project_id, fixture.project.id);
    assert_eq!(
        first.revision_id.as_deref(),
        Some(fixture.revision.id.as_str())
    );
    assert_eq!(first.operation_id.as_deref(), Some(operation_id.as_str()));
    assert_eq!(first.attempt, 0);
    assert!(!first.input_digest.is_empty());
    assert!(first.artifact_path.is_none());

    let spec = fixture.database.jobs().render_spec(&first.id).unwrap();
    assert_eq!(spec.project_id, fixture.project.id);
    assert_eq!(spec.revision_id, fixture.revision.id);
    assert_eq!(spec.clips[0].source, fixture.asset_a.path);
    assert_eq!(spec.clips[1].source, fixture.asset_b.path);
    assert_eq!(
        spec.clips[0].expected_sha256,
        fixture.asset_a.sha256.clone().unwrap()
    );
    assert_eq!(
        spec.clips[1].expected_sha256,
        fixture.asset_b.sha256.clone().unwrap()
    );

    let replay = enqueue(&mut fixture, &operation_id, None);
    assert_eq!(replay.id, first.id);
    assert_eq!(replay.input_digest, first.input_digest);
}

#[test]
fn duplicate_operation_with_different_dependency_is_an_idempotency_conflict() {
    let mut fixture = setup_fixture();
    let upstream = enqueue(&mut fixture, &Uuid::new_v4().to_string(), None);
    let operation_id = Uuid::new_v4().to_string();
    let first = enqueue(&mut fixture, &operation_id, None);
    let error = fixture
        .database
        .jobs()
        .enqueue_render(&JobEnqueue {
            operation_id,
            project_id: fixture.project.id.clone(),
            revision_id: fixture.revision.id.clone(),
            dependency_job_id: Some(upstream.id),
        })
        .unwrap_err();
    assert!(matches!(error, CoreError::IdempotencyConflict { .. }));
    assert_eq!(
        fixture
            .database
            .jobs()
            .get(&first.id)
            .unwrap()
            .dependency_job_id,
        None
    );
}

#[test]
fn claim_heartbeat_and_finish_are_fenced_by_lease_token() {
    let mut fixture = setup_fixture();
    let job = enqueue(&mut fixture, &Uuid::new_v4().to_string(), None);
    let claim = fixture.database.jobs().claim_next(30).unwrap().unwrap();
    assert_eq!(claim.job.id, job.id);
    assert_eq!(claim.job.status, JobStatus::Running);
    assert_eq!(claim.job.attempt, 1);
    assert!(claim.job.lease_expires_at.is_some());
    assert!(
        fixture
            .database
            .jobs()
            .heartbeat(&job.id, &claim.lease_token, 30, "rendering", 42)
            .unwrap()
    );
    assert!(
        !fixture
            .database
            .jobs()
            .heartbeat(&job.id, "wrong-token", 30, "late", 99)
            .unwrap()
    );
    assert!(
        !fixture
            .database
            .jobs()
            .finish_success(&job.id, "wrong-token", "/tmp/wrong.mp4", "bad", "bad")
            .unwrap()
    );
    assert!(
        fixture
            .database
            .jobs()
            .finish_success(
                &job.id,
                &claim.lease_token,
                "/tmp/output.mp4",
                "hash",
                "config"
            )
            .unwrap()
    );
    assert!(
        !fixture
            .database
            .jobs()
            .finish_success(&job.id, &claim.lease_token, "/tmp/late.mp4", "late", "late")
            .unwrap()
    );

    let finished = fixture.database.jobs().get(&job.id).unwrap();
    assert_eq!(finished.status, JobStatus::Succeeded);
    assert_eq!(finished.progress, 100);
    assert_eq!(finished.artifact_sha256.as_deref(), Some("hash"));
    assert_eq!(finished.config_digest.as_deref(), Some("config"));
    assert!(finished.lease_token.is_none());
}

#[test]
fn failed_job_retries_as_a_new_attempt_and_stale_recovery_is_not_false_success() {
    let mut fixture = setup_fixture();
    let job = enqueue(&mut fixture, &Uuid::new_v4().to_string(), None);
    let first_claim = fixture.database.jobs().claim_next(1).unwrap().unwrap();
    let failed = fixture
        .database
        .jobs()
        .finish_failure(&job.id, &first_claim.lease_token, "render failed")
        .unwrap();
    assert_eq!(failed.status, JobStatus::Failed);
    let retried = fixture.database.jobs().retry(&job.id).unwrap();
    assert_eq!(retried.status, JobStatus::Retrying);
    assert_eq!(retried.attempt, 1);
    let second_claim = fixture.database.jobs().claim_next(1).unwrap().unwrap();
    assert_eq!(second_claim.job.attempt, 2);
    thread::sleep(Duration::from_millis(1_200));
    assert!(
        !fixture
            .database
            .jobs()
            .heartbeat(&job.id, &second_claim.lease_token, 30, "late", 99)
            .unwrap()
    );
    assert!(
        !fixture
            .database
            .jobs()
            .finish_success(
                &job.id,
                &second_claim.lease_token,
                "/tmp/late.mp4",
                "late",
                "late"
            )
            .unwrap()
    );
    let recovered = fixture.database.jobs().recover_stale().unwrap();
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].status, JobStatus::Retrying);
    assert!(recovered[0].artifact_path.is_none());
}

#[test]
fn absurd_lease_duration_is_rejected_without_panicking() {
    let mut fixture = setup_fixture();
    let _job = enqueue(&mut fixture, &Uuid::new_v4().to_string(), None);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        fixture.database.jobs().claim_next(i64::MAX)
    }));
    assert!(
        result.is_ok(),
        "claim_next panicked on an absurd lease duration"
    );
    assert!(matches!(result.unwrap(), Err(CoreError::InvalidInput(_))));
}

#[test]
fn queued_cancel_and_running_cancel_fence_success() {
    let mut fixture = setup_fixture();
    let queued = enqueue(&mut fixture, &Uuid::new_v4().to_string(), None);
    let canceled = fixture.database.jobs().request_cancel(&queued.id).unwrap();
    assert_eq!(canceled.status, JobStatus::Canceled);
    assert!(canceled.cancel_requested);
    assert!(fixture.database.jobs().claim_next(30).unwrap().is_none());

    let running = enqueue(&mut fixture, &Uuid::new_v4().to_string(), None);
    let claim = fixture.database.jobs().claim_next(30).unwrap().unwrap();
    let requested = fixture.database.jobs().request_cancel(&running.id).unwrap();
    assert_eq!(requested.status, JobStatus::Running);
    assert!(requested.cancel_requested);
    assert!(
        !fixture
            .database
            .jobs()
            .finish_success(
                &running.id,
                &claim.lease_token,
                "/tmp/false-success.mp4",
                "hash",
                "config"
            )
            .unwrap()
    );
    let final_record = fixture
        .database
        .jobs()
        .finalize_canceled(&running.id, &claim.lease_token, "canceled by test")
        .unwrap();
    assert_eq!(final_record.status, JobStatus::Canceled);
}

#[test]
fn dependency_success_unblocks_without_replacing_upstream_artifact() {
    let mut fixture = setup_fixture();
    let upstream = enqueue(&mut fixture, &Uuid::new_v4().to_string(), None);
    let dependent = enqueue(
        &mut fixture,
        &Uuid::new_v4().to_string(),
        Some(upstream.id.clone()),
    );
    assert_eq!(dependent.status, JobStatus::Waiting);
    let claim = fixture.database.jobs().claim_next(30).unwrap().unwrap();
    assert_eq!(claim.job.id, upstream.id);
    assert!(
        fixture
            .database
            .jobs()
            .finish_success(
                &upstream.id,
                &claim.lease_token,
                "/tmp/upstream.mp4",
                "upstream-hash",
                "upstream-config"
            )
            .unwrap()
    );
    let next = fixture.database.jobs().claim_next(30).unwrap().unwrap();
    assert_eq!(next.job.id, dependent.id);
    let upstream_after = fixture.database.jobs().get(&upstream.id).unwrap();
    assert_eq!(upstream_after.status, JobStatus::Succeeded);
    assert_eq!(
        upstream_after.artifact_sha256.as_deref(),
        Some("upstream-hash")
    );
}

#[test]
fn failed_dependency_blocks_dependent_without_claiming_it() {
    let mut fixture = setup_fixture();
    let upstream = enqueue(&mut fixture, &Uuid::new_v4().to_string(), None);
    let dependent = enqueue(
        &mut fixture,
        &Uuid::new_v4().to_string(),
        Some(upstream.id.clone()),
    );
    let claim = fixture.database.jobs().claim_next(30).unwrap().unwrap();
    fixture
        .database
        .jobs()
        .finish_failure(&upstream.id, &claim.lease_token, "upstream failed")
        .unwrap();
    assert!(fixture.database.jobs().claim_next(30).unwrap().is_none());
    let dependent_after = fixture.database.jobs().get(&dependent.id).unwrap();
    assert_eq!(dependent_after.status, JobStatus::Failed);
    assert!(dependent_after.artifact_path.is_none());
}

#[test]
fn render_enqueue_rejects_non_primary_or_muted_revision_tracks() {
    for (kind, muted) in [("overlay_video", 0_i64), ("primary_video", 1_i64)] {
        let mut fixture = setup_fixture();
        let database_path = fixture._directory.path().join("project.cutroom");
        let project_id = fixture.project.id.clone();
        drop(fixture.database);
        let sql = format!("UPDATE tracks SET kind = '{kind}', is_muted = {muted}");
        assert!(
            Command::new("sqlite3")
                .arg(&database_path)
                .arg(sql)
                .status()
                .unwrap()
                .success()
        );
        fixture.database = cutroom_core::Database::open(&database_path).unwrap();
        let composition = fixture.database.compositions().get(&project_id).unwrap();
        fixture.revision = fixture
            .database
            .revisions()
            .create(
                &project_id,
                &composition.id,
                "unsupported track",
                "jobs-tests",
            )
            .unwrap();
        let error = fixture
            .database
            .jobs()
            .enqueue_render(&JobEnqueue {
                operation_id: Uuid::new_v4().to_string(),
                project_id,
                revision_id: fixture.revision.id.clone(),
                dependency_job_id: None,
            })
            .unwrap_err();
        assert!(
            matches!(error, CoreError::InvalidInput(_)),
            "{kind} muted={muted}: {error:?}"
        );
    }
}

#[test]
fn concurrent_duplicate_enqueues_return_one_durable_job() {
    let fixture = setup_fixture();
    let operation_id = Uuid::new_v4().to_string();
    let project_id = fixture.project.id.clone();
    let revision_id = fixture.revision.id.clone();
    let database = Arc::new(Mutex::new(fixture.database));
    let mut handles = Vec::new();
    for _ in 0..2 {
        let database = Arc::clone(&database);
        let operation_id = operation_id.clone();
        let project_id = project_id.clone();
        let revision_id = revision_id.clone();
        handles.push(thread::spawn(move || {
            let mut database = database.lock().unwrap();
            database
                .jobs()
                .enqueue_render(&JobEnqueue {
                    operation_id,
                    project_id,
                    revision_id,
                    dependency_job_id: None,
                })
                .map(|job| job.id)
                .map_err(|error| error.to_string())
        }));
    }
    let first = handles.remove(0).join().unwrap().unwrap();
    let second = handles.remove(0).join().unwrap().unwrap();
    assert_eq!(first, second);
    let mut database = database.lock().unwrap();
    assert_eq!(database.jobs().list(&project_id).unwrap().len(), 1);
}
