mod support;

use std::{
    fs,
    path::PathBuf,
    thread,
    time::{Duration, Instant},
};

use cutroom_core::{Database, JobStatus};
use cutroom_tauri::{AppState, NativeRequest, NativeResponse, dispatch};
use serde_json::{Value, json};
use uuid::Uuid;

use support::{TestDirectory, fixture_a, fixture_b, sha256};

fn operation_id() -> String {
    Uuid::new_v4().to_string()
}

fn request(
    command: &str,
    operation_id: Option<String>,
    project_id: Option<&str>,
    expected_version: Option<i64>,
    payload: Value,
) -> NativeRequest {
    NativeRequest {
        command: command.into(),
        operation_id,
        project_id: project_id.map(str::to_owned),
        expected_version,
        payload,
    }
}

fn data(response: NativeResponse) -> Value {
    match response {
        NativeResponse::Ok { ok, data } => {
            assert!(ok);
            data
        }
        NativeResponse::Err { error, .. } => {
            panic!("unexpected native error {}: {}", error.code, error.message)
        }
    }
}

fn error_code(response: NativeResponse) -> String {
    match response {
        NativeResponse::Err { error, .. } => error.code,
        NativeResponse::Ok { .. } => panic!("expected native error"),
    }
}

fn create_project(state: &AppState, path: PathBuf, name: &str) -> Value {
    data(dispatch(
        state,
        request(
            "project.create",
            Some(operation_id()),
            None,
            None,
            json!({
                "name": name,
                "path": path,
                "aspectRatio": "16:9",
                "fpsNumerator": 24,
                "fpsDenominator": 1,
            }),
        ),
    ))
}

fn wait_for_job_status(state: &AppState, project_id: &str, job_id: &str, expected: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let jobs = data(dispatch(
            state,
            request("job.list", None, Some(project_id), None, json!({})),
        ));
        let job = jobs
            .as_array()
            .unwrap()
            .iter()
            .find(|job| job["id"] == job_id)
            .unwrap_or_else(|| panic!("job {job_id} was not persisted"));
        if job["status"] == expected {
            return job.clone();
        }
        assert!(
            ["queued", "running", "retrying"].contains(&job["status"].as_str().unwrap()),
            "job {job_id} reached unexpected status {}: {job}",
            job["status"]
        );
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {expected}: {job}"
        );
        thread::sleep(Duration::from_millis(50));
    }
}

fn add_two_ranges_and_revision(state: &AppState, project_id: &str, asset_id: &str) -> Value {
    let initial = data(dispatch(
        state,
        request("composition.get", None, Some(project_id), None, json!({})),
    ));
    let first = data(dispatch(
        state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(project_id),
            Some(initial["version"].as_i64().unwrap()),
            json!({
                "action": "add",
                "assetId": asset_id,
                "sourceInTicks": "0",
                "sourceOutTicks": "24576",
                "timelineStartTicks": "0",
            }),
        ),
    ));
    let second = data(dispatch(
        state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(project_id),
            Some(first["version"].as_i64().unwrap()),
            json!({
                "action": "add",
                "assetId": asset_id,
                "trackId": first["tracks"][0]["id"],
                "sourceInTicks": "24576",
                "sourceOutTicks": "49152",
            }),
        ),
    ));
    assert_eq!(second["clips"].as_array().unwrap().len(), 2);
    data(dispatch(
        state,
        request(
            "revision.create",
            Some(operation_id()),
            Some(project_id),
            Some(second["version"].as_i64().unwrap()),
            json!({ "commitNote": "retry coverage" }),
        ),
    ))
}

#[test]
fn job_retry_replays_after_worker_completion_and_native_restart() {
    let directory = TestDirectory::new();
    let registry_path = directory.path().join("native/projects.json");
    let project_path = directory.path().join("project");
    let source_path = directory.path().join("disposable-source.mp4");
    fs::copy(fixture_a(), &source_path).unwrap();

    let retry_operation = operation_id();
    let first_state = AppState::try_with_registry_path(registry_path.clone()).unwrap();
    let project = create_project(&first_state, project_path.clone(), "Retry replay");
    let project_id = project["id"].as_str().unwrap().to_owned();
    let asset = data(dispatch(
        &first_state,
        request(
            "asset.import",
            Some(operation_id()),
            Some(&project_id),
            None,
            json!({ "path": source_path, "importType": "linked" }),
        ),
    ));
    let revision =
        add_two_ranges_and_revision(&first_state, &project_id, asset["id"].as_str().unwrap());

    // Only the disposable linked source is changed. The real worker must fail
    // its persisted identity check, rather than a test-only status transition.
    fs::write(&source_path, b"changed disposable source").unwrap();
    let job = data(dispatch(
        &first_state,
        request(
            "render.enqueue",
            Some(operation_id()),
            Some(&project_id),
            Some(3),
            json!({ "preset": "1080p_sdr", "revisionId": revision["id"] }),
        ),
    ));
    let job_id = job["id"].as_str().unwrap().to_owned();
    let failed = wait_for_job_status(&first_state, &project_id, &job_id, "failed");
    assert!(
        failed["error"]
            .as_str()
            .is_some_and(|error| !error.is_empty())
    );

    fs::copy(fixture_a(), &source_path).unwrap();
    let retry_request = request(
        "job.retry",
        Some(retry_operation),
        Some(&project_id),
        None,
        json!({ "jobId": job_id }),
    );
    let retry_response = data(dispatch(&first_state, retry_request.clone()));
    assert_eq!(retry_response["id"], job["id"]);
    assert_eq!(retry_response["status"], "retrying");
    let _completed = wait_for_job_status(&first_state, &project_id, &job_id, "completed");
    drop(first_state);

    // Core is the supported durable read for fields intentionally omitted by
    // the public job DTO, especially the attempt counter and artifact path.
    let database_path = project_path.join(".cutroom/project.cutroom");
    let mut database = Database::open(database_path.clone()).unwrap();
    let durable_before_restart = database.jobs().get(&job_id).unwrap();
    assert_eq!(durable_before_restart.status, JobStatus::Succeeded);
    assert_eq!(durable_before_restart.attempt, 2);
    let artifact_path = durable_before_restart.artifact_path.clone();
    assert!(
        artifact_path
            .as_ref()
            .is_some_and(|path| PathBuf::from(path).is_file()),
        "successful retry should persist an artifact path"
    );
    let artifact_file_path = PathBuf::from(
        artifact_path
            .as_ref()
            .expect("successful retry should persist an artifact path"),
    );
    let artifact_sha256_before_restart = durable_before_restart
        .artifact_sha256
        .clone()
        .expect("successful retry should persist an artifact SHA256");
    let artifact_file_sha256_before_restart = sha256(&artifact_file_path);
    assert_eq!(
        artifact_file_sha256_before_restart, artifact_sha256_before_restart,
        "stored artifact SHA256 must match the artifact bytes before restart"
    );
    drop(database);

    let second_state = AppState::try_with_registry_path(registry_path.clone()).unwrap();
    data(dispatch(
        &second_state,
        request("project.open", None, Some(&project_id), None, json!({})),
    ));
    let replay = data(dispatch(&second_state, retry_request));
    assert_eq!(replay, retry_response);
    let listed = data(dispatch(
        &second_state,
        request("job.list", None, Some(&project_id), None, json!({})),
    ));
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["status"], "completed");
    drop(second_state);

    // Core is the supported durable read for fields intentionally omitted by
    // the public job DTO, especially the attempt counter and artifact path.
    let database_path = project_path.join(".cutroom/project.cutroom");
    let mut database = Database::open(database_path).unwrap();
    let durable = database.jobs().get(&job_id).unwrap();
    assert_eq!(durable.status, JobStatus::Succeeded);
    assert_eq!(durable.attempt, 2);
    assert_eq!(durable.artifact_path, artifact_path);
    assert!(
        durable
            .artifact_path
            .as_ref()
            .is_some_and(|path| PathBuf::from(path).is_file()),
        "replayed retry should retain an artifact path"
    );
    assert_eq!(
        durable.artifact_sha256.as_deref(),
        Some(artifact_sha256_before_restart.as_str()),
        "replayed retry should retain the stored artifact SHA256"
    );
    let artifact_file_sha256_after_restart = sha256(&PathBuf::from(
        durable
            .artifact_path
            .as_ref()
            .expect("replayed retry should retain an artifact path"),
    ));
    assert_eq!(
        artifact_file_sha256_after_restart, artifact_file_sha256_before_restart,
        "replayed retry should preserve the artifact bytes across restart"
    );
    assert_eq!(
        artifact_file_sha256_after_restart,
        durable
            .artifact_sha256
            .as_deref()
            .expect("replayed retry should retain an artifact SHA256"),
        "stored artifact SHA256 must match the replayed artifact bytes"
    );
}

#[test]
fn native_receipts_and_resource_mutations_are_project_scoped() {
    let directory = TestDirectory::new();
    let state = AppState::new();
    let project_a = create_project(&state, directory.path().join("project-a"), "Scope A");
    let project_b = create_project(&state, directory.path().join("project-b"), "Scope B");
    let project_a_id = project_a["id"].as_str().unwrap();
    let project_b_id = project_b["id"].as_str().unwrap();
    let shared_operation = operation_id();

    let import_a = request(
        "asset.import",
        Some(shared_operation.clone()),
        Some(project_a_id),
        None,
        json!({ "path": fixture_a(), "importType": "linked" }),
    );
    let asset_a = data(dispatch(&state, import_a.clone()));
    let asset_a_replay = data(dispatch(&state, import_a));
    assert_eq!(asset_a_replay, asset_a);
    assert_eq!(asset_a["projectId"], project_a_id);

    // The same UUID is valid in the independent project database and must not
    // replay project A's response or create a resource in project A.
    let asset_b = data(dispatch(
        &state,
        request(
            "asset.import",
            Some(shared_operation.clone()),
            Some(project_b_id),
            None,
            json!({ "path": fixture_b(), "importType": "linked" }),
        ),
    ));
    assert_eq!(asset_b["projectId"], project_b_id);
    assert_ne!(asset_b["id"], asset_a["id"]);
    assert_eq!(
        data(dispatch(
            &state,
            request("asset.list", None, Some(project_a_id), None, json!({})),
        ))
        .as_array()
        .unwrap()
        .len(),
        1
    );
    assert_eq!(
        data(dispatch(
            &state,
            request("asset.list", None, Some(project_b_id), None, json!({})),
        ))
        .as_array()
        .unwrap()
        .len(),
        1
    );

    // Same-scope reuse with a changed payload remains a conflict.
    assert_eq!(
        error_code(dispatch(
            &state,
            request(
                "asset.import",
                Some(shared_operation),
                Some(project_a_id),
                None,
                json!({ "path": fixture_b(), "importType": "linked" }),
            ),
        )),
        "IDEMPOTENCY_CONFLICT"
    );

    // A resource ID from A cannot mutate B's composition. The failed request
    // leaves B's durable composition untouched.
    let before = data(dispatch(
        &state,
        request("composition.get", None, Some(project_b_id), None, json!({})),
    ));
    assert_eq!(
        error_code(dispatch(
            &state,
            request(
                "composition.apply",
                Some(operation_id()),
                Some(project_b_id),
                Some(before["version"].as_i64().unwrap()),
                json!({
                    "action": "add",
                    "assetId": asset_a["id"],
                    "sourceInTicks": "0",
                    "sourceOutTicks": "24576",
                }),
            ),
        )),
        "INTERNAL_ERROR"
    );
    let after = data(dispatch(
        &state,
        request("composition.get", None, Some(project_b_id), None, json!({})),
    ));
    assert_eq!(after["version"], before["version"]);
    assert!(after["clips"].as_array().unwrap().is_empty());
}
