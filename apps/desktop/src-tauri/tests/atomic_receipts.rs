mod support;

use std::{sync::Arc, thread};

use cutroom_tauri::{AppState, NativeRequest, NativeResponse, dispatch};
use serde_json::json;
use support::{TestDirectory, assert_fixture_hashes, fixture_a};
use uuid::Uuid;

fn operation_id() -> String {
    Uuid::new_v4().to_string()
}

fn request(
    command: &str,
    operation_id: Option<String>,
    project_id: Option<&str>,
    payload: serde_json::Value,
) -> NativeRequest {
    NativeRequest {
        command: command.into(),
        operation_id,
        project_id: project_id.map(str::to_owned),
        expected_version: None,
        payload,
    }
}

fn data(response: NativeResponse) -> serde_json::Value {
    match response {
        NativeResponse::Ok { data, .. } => data,
        NativeResponse::Err { error, .. } => {
            panic!("unexpected native error {}: {}", error.code, error.message)
        }
    }
}

#[test]
fn concurrent_duplicate_asset_import_returns_one_canonical_receipt() {
    assert_fixture_hashes();
    let directory = TestDirectory::new();
    let project_path = directory.path().join("project");
    let state = Arc::new(AppState::new());
    let project = data(dispatch(
        &state,
        request(
            "project.create",
            Some(operation_id()),
            None,
            json!({
                "name": "Concurrent import",
                "path": project_path,
                "aspectRatio": "16:9",
                "fpsNumerator": 24,
                "fpsDenominator": 1,
            }),
        ),
    ));
    let project_id = project["id"].as_str().unwrap().to_owned();
    let import = request(
        "asset.import",
        Some(operation_id()),
        Some(&project_id),
        json!({ "path": fixture_a(), "importType": "linked" }),
    );

    let left_state = Arc::clone(&state);
    let left_request = import.clone();
    let left = thread::spawn(move || data(dispatch(&left_state, left_request)));
    let right_state = Arc::clone(&state);
    let right = thread::spawn(move || data(dispatch(&right_state, import)));
    let left = left.join().unwrap();
    let right = right.join().unwrap();

    assert_eq!(left["id"], right["id"]);
    assert_eq!(
        data(dispatch(
            &state,
            request("asset.list", None, Some(&project_id), json!({})),
        ))
        .as_array()
        .unwrap()
        .len(),
        1
    );
}

#[test]
fn project_create_reconciles_registry_reservation_without_sidecar_receipt() {
    let directory = TestDirectory::new();
    let registry_path = directory.path().join("native/projects.json");
    let project_path = directory.path().join("project");
    let create = request(
        "project.create",
        Some(operation_id()),
        None,
        json!({
            "name": "Registry recovery",
            "path": project_path,
            "aspectRatio": "16:9",
            "fpsNumerator": 24,
            "fpsDenominator": 1,
        }),
    );
    let state = AppState::try_with_registry_path(registry_path.clone()).unwrap();
    let first = data(dispatch(&state, create.clone()));
    drop(state);
    std::fs::remove_file(registry_path.with_extension("receipts.json")).unwrap();

    let restarted = AppState::try_with_registry_path(registry_path).unwrap();
    let replay = data(dispatch(&restarted, create));
    assert_eq!(replay["id"], first["id"]);
}
