mod support;

use cutroom_tauri::{AppState, NativeRequest, NativeResponse, dispatch};
use serde_json::{Value, json};
use support::{TestDirectory, fixture_a};
use uuid::Uuid;

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
        NativeResponse::Ok { data, .. } => data,
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

#[test]
fn native_replay_rejects_different_payload_and_command_reuse() {
    let directory = TestDirectory::new();
    let registry_path = directory.path().join("native/projects.json");
    let project_path = directory.path().join("project");
    let project_operation = operation_id();
    let state = AppState::try_with_registry_path(registry_path).unwrap();
    let create = request(
        "project.create",
        Some(project_operation.clone()),
        None,
        None,
        json!({
            "name": "Replay conflict",
            "path": project_path,
            "aspectRatio": "16:9",
            "fpsNumerator": 24,
            "fpsDenominator": 1,
        }),
    );
    let project = data(dispatch(&state, create.clone()));
    let different_payload = request(
        "project.create",
        Some(project_operation.clone()),
        None,
        None,
        json!({
            "name": "Different payload",
            "path": create.payload["path"],
            "aspectRatio": "16:9",
            "fpsNumerator": 24,
            "fpsDenominator": 1,
        }),
    );
    assert_eq!(
        error_code(dispatch(&state, different_payload)),
        "IDEMPOTENCY_CONFLICT"
    );

    // The project.create receipt has a different command and project binding.
    // The import preflight must reject before probing this nonexistent path.
    let command_reuse = request(
        "asset.import",
        Some(project_operation),
        project["id"].as_str(),
        None,
        json!({
            "path": "/definitely/not/a/media/file.mp4",
            "importType": "linked",
        }),
    );
    assert_eq!(
        error_code(dispatch(&state, command_reuse)),
        "IDEMPOTENCY_CONFLICT"
    );
}

#[test]
fn revision_replay_survives_subsequent_edit_and_native_restart() {
    let directory = TestDirectory::new();
    let registry_path = directory.path().join("native/projects.json");
    let project_path = directory.path().join("project");
    let first_state = AppState::try_with_registry_path(registry_path.clone()).unwrap();
    let project = data(dispatch(
        &first_state,
        request(
            "project.create",
            Some(operation_id()),
            None,
            None,
            json!({
                "name": "Revision replay",
                "path": project_path,
                "aspectRatio": "16:9",
                "fpsNumerator": 24,
                "fpsDenominator": 1,
            }),
        ),
    ));
    let project_id = project["id"].as_str().unwrap().to_owned();
    let asset = data(dispatch(
        &first_state,
        request(
            "asset.import",
            Some(operation_id()),
            Some(&project_id),
            None,
            json!({ "path": fixture_a(), "importType": "linked" }),
        ),
    ));
    let initial = data(dispatch(
        &first_state,
        request("composition.get", None, Some(&project_id), None, json!({})),
    ));
    let first_edit = data(dispatch(
        &first_state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(&project_id),
            Some(initial["version"].as_i64().unwrap()),
            json!({
                "action": "add",
                "assetId": asset["id"],
                "sourceInTicks": "0",
                "sourceOutTicks": "24576",
                "timelineStartTicks": "0",
            }),
        ),
    ));
    let revision_request = request(
        "revision.create",
        Some(operation_id()),
        Some(&project_id),
        Some(first_edit["version"].as_i64().unwrap()),
        json!({ "commitNote": "replay after edit" }),
    );
    let revision = data(dispatch(&first_state, revision_request.clone()));
    drop(first_state);

    let second_state = AppState::try_with_registry_path(registry_path).unwrap();
    data(dispatch(
        &second_state,
        request("project.open", None, Some(&project_id), None, json!({})),
    ));
    let current = data(dispatch(
        &second_state,
        request("composition.get", None, Some(&project_id), None, json!({})),
    ));
    assert_eq!(current["version"], 2);
    data(dispatch(
        &second_state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(&project_id),
            Some(current["version"].as_i64().unwrap()),
            json!({
                "action": "add",
                "assetId": asset["id"],
                "trackId": first_edit["tracks"][0]["id"],
                "sourceInTicks": "24576",
                "sourceOutTicks": "49152",
            }),
        ),
    ));

    // expected_version=2 is stale now, but the exact receipt must win before
    // mutable composition state is read.
    let replay = data(dispatch(&second_state, revision_request));
    assert_eq!(replay["id"], revision["id"]);
    assert_eq!(
        data(dispatch(
            &second_state,
            request("revision.list", None, Some(&project_id), None, json!({})),
        ))
        .as_array()
        .unwrap()
        .len(),
        1
    );
}
