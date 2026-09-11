mod support;

use serde_json::{Value, json};
use uuid::Uuid;

use cutroom_tauri::{AppState, NativeRequest, NativeResponse, dispatch};
use support::{TestDirectory, assert_fixture_hashes, fixture_a};

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

fn array_len(response: NativeResponse) -> usize {
    data(response).as_array().unwrap().len()
}

fn error_code(response: NativeResponse) -> String {
    match response {
        NativeResponse::Err { error, .. } => error.code,
        NativeResponse::Ok { .. } => panic!("expected native error"),
    }
}

#[test]
fn native_dispatch_covers_persistent_project_asset_composition_revision_and_job_flow() {
    let directory = TestDirectory::new();
    let project_path = directory.path().join("project");
    let state = AppState::new();

    let health = data(dispatch(
        &state,
        request("health.get", None, None, None, json!({})),
    ));
    // Pure dispatch is a prerequisite only; it must not masquerade as a live Tauri host.
    assert_eq!(health["tauriConnected"], false);
    assert_eq!(health["ffmpegAvailable"], true);

    let project = data(dispatch(
        &state,
        request(
            "project.create",
            Some(operation_id()),
            None,
            None,
            json!({
                "name": "Dispatch integration",
                "path": project_path,
                "aspectRatio": "16:9",
                "fpsNumerator": 24,
                "fpsDenominator": 1
            }),
        ),
    ));
    let project_id = project["id"].as_str().unwrap().to_owned();
    assert!(project_path.join(".cutroom/project.cutroom").is_file());

    let asset = data(dispatch(
        &state,
        request(
            "asset.import",
            Some(operation_id()),
            Some(&project_id),
            None,
            json!({
                "path": fixture_a(),
                "name": "fixture_a.mp4",
                "importType": "linked"
            }),
        ),
    ));
    let asset_id = asset["id"].as_str().unwrap().to_owned();
    assert_eq!(asset["codec"], "h264");
    assert_eq!(asset["width"], 1920);
    assert_eq!(asset["height"], 1080);
    assert_eq!(asset["durationTicks"], "61440");
    assert_eq!(
        asset["sha256"],
        "06e35e744a729825b664fc938485d840307755bcc44a60cd3f47f362555bcccb"
    );
    assert_eq!(
        array_len(dispatch(
            &state,
            request("asset.list", None, Some(&project_id), None, json!({}))
        )),
        1
    );

    let initial = data(dispatch(
        &state,
        request("composition.get", None, Some(&project_id), None, json!({})),
    ));
    assert_eq!(initial["version"], 1);
    let add_first = data(dispatch(
        &state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(&project_id),
            Some(1),
            json!({ "action": "add", "assetId": asset_id, "sourceInTicks": "0", "sourceOutTicks": "24576", "timelineStartTicks": "0" }),
        ),
    ));
    assert_eq!(add_first["version"], 2);
    let track_id = add_first["tracks"][0]["id"].as_str().unwrap().to_owned();
    let first_clip_id = add_first["clips"][0]["id"].as_str().unwrap().to_owned();

    let add_second = data(dispatch(
        &state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(&project_id),
            Some(2),
            json!({ "action": "add", "assetId": asset_id, "trackId": track_id, "sourceInTicks": "24576", "sourceOutTicks": "49152", "timelineStartTicks": "96000" }),
        ),
    ));
    assert_eq!(add_second["version"], 3);
    assert_eq!(add_second["durationTicks"], "192000");
    let second_clip_id = add_second["clips"][1]["id"].as_str().unwrap().to_owned();

    let trimmed = data(dispatch(
        &state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(&project_id),
            Some(3),
            json!({ "action": "trim", "clipId": first_clip_id, "newInTicks": "4096", "newOutTicks": "20480" }),
        ),
    ));
    assert_eq!(trimmed["version"], 4);

    let revision = data(dispatch(
        &state,
        request(
            "revision.create",
            Some(operation_id()),
            Some(&project_id),
            Some(4),
            json!({ "commitNote": "dispatch integration revision" }),
        ),
    ));
    let revision_id = revision["id"].as_str().unwrap().to_owned();
    assert_eq!(revision["contentHash"].as_str().unwrap().len(), 64);

    let reordered = data(dispatch(
        &state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(&project_id),
            Some(4),
            json!({ "action": "reorder", "clipId": second_clip_id, "direction": "left" }),
        ),
    ));
    assert_eq!(reordered["version"], 5);

    let stale = dispatch(
        &state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(&project_id),
            Some(4),
            json!({ "action": "trim", "clipId": second_clip_id, "newInTicks": "0", "newOutTicks": "16384" }),
        ),
    );
    assert_eq!(error_code(stale), "STALE_WRITE_CONFLICT");

    let duplicate_operation = operation_id();
    let applied = data(dispatch(
        &state,
        request(
            "composition.apply",
            Some(duplicate_operation.clone()),
            Some(&project_id),
            Some(5),
            json!({ "action": "trim", "clipId": second_clip_id, "newInTicks": "4096", "newOutTicks": "20480" }),
        ),
    ));
    assert_eq!(applied["version"], 6);
    let conflict = dispatch(
        &state,
        request(
            "composition.apply",
            Some(duplicate_operation),
            Some(&project_id),
            Some(5),
            json!({ "action": "trim", "clipId": second_clip_id, "newInTicks": "8192", "newOutTicks": "16384" }),
        ),
    );
    assert_eq!(error_code(conflict), "IDEMPOTENCY_CONFLICT");

    let listed_revisions = data(dispatch(
        &state,
        request("revision.list", None, Some(&project_id), None, json!({})),
    ));
    assert_eq!(listed_revisions.as_array().unwrap().len(), 1);
    let job = data(dispatch(
        &state,
        request(
            "render.enqueue",
            Some(operation_id()),
            Some(&project_id),
            Some(6),
            json!({ "preset": "1080p_sdr", "revisionId": revision_id }),
        ),
    ));
    let job_id = job["id"].as_str().unwrap().to_owned();
    assert_eq!(job["status"], "queued");
    assert_eq!(
        array_len(dispatch(
            &state,
            request("job.list", None, Some(&project_id), None, json!({}))
        )),
        1
    );

    let canceled = data(dispatch(
        &state,
        request(
            "job.cancel",
            Some(operation_id()),
            Some(&project_id),
            None,
            json!({ "jobId": job_id }),
        ),
    ));
    assert_eq!(canceled["status"], "cancelled");
    assert_fixture_hashes();

    // Reopening the registered project rehydrates its persisted records through dispatch.
    let reopened = data(dispatch(
        &state,
        request("project.open", None, Some(&project_id), None, json!({})),
    ));
    assert_eq!(reopened["id"], project_id);
    assert_eq!(
        array_len(dispatch(
            &state,
            request("asset.list", None, Some(&project_id), None, json!({}))
        )),
        1
    );
    assert_eq!(
        array_len(dispatch(
            &state,
            request("revision.list", None, Some(&project_id), None, json!({}))
        )),
        1
    );
    assert_eq!(
        array_len(dispatch(
            &state,
            request("job.list", None, Some(&project_id), None, json!({}))
        )),
        1
    );
}

#[test]
fn durable_registry_cold_opens_only_existing_registered_projects() {
    let directory = TestDirectory::new();
    let registry_path = directory.path().join("native/projects.json");
    let project_path = directory.path().join("project");
    let state = AppState::try_with_registry_path(registry_path.clone()).unwrap();
    let project = data(dispatch(
        &state,
        request(
            "project.create",
            Some(operation_id()),
            None,
            None,
            json!({
                "name": "Durable discovery",
                "path": project_path,
                "aspectRatio": "16:9",
                "fpsNumerator": 24,
                "fpsDenominator": 1
            }),
        ),
    ));
    let project_id = project["id"].as_str().unwrap().to_owned();
    drop(state);

    let reopened_state = AppState::try_with_registry_path(registry_path.clone()).unwrap();
    let listed = data(dispatch(
        &reopened_state,
        request("project.list", None, None, None, json!({})),
    ));
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(
        data(dispatch(
            &reopened_state,
            request("project.open", None, Some(&project_id), None, json!({})),
        ))["id"],
        project_id
    );
    drop(reopened_state);

    std::fs::remove_file(project_path.join(".cutroom/project.cutroom")).unwrap();
    let invalid_state = AppState::try_with_registry_path(registry_path).unwrap();
    assert_eq!(
        error_code(dispatch(
            &invalid_state,
            request("project.open", None, Some(&project_id), None, json!({})),
        )),
        "PROJECT_NOT_FOUND"
    );
    assert_eq!(
        array_len(dispatch(
            &invalid_state,
            request("project.list", None, None, None, json!({})),
        )),
        0
    );
}

#[test]
fn project_create_replays_same_operation_after_native_restart() {
    let directory = TestDirectory::new();
    let registry_path = directory.path().join("native/projects.json");
    let project_path = directory.path().join("project");
    let operation_id = operation_id();
    let create = request(
        "project.create",
        Some(operation_id),
        None,
        None,
        json!({
            "name": "Idempotent project",
            "path": project_path,
            "aspectRatio": "16:9",
            "fpsNumerator": 24,
            "fpsDenominator": 1
        }),
    );
    let first_state = AppState::try_with_registry_path(registry_path.clone()).unwrap();
    let first = data(dispatch(&first_state, create.clone()));
    let first_id = first["id"].as_str().unwrap().to_owned();
    drop(first_state);

    let second_state = AppState::try_with_registry_path(registry_path).unwrap();
    let second = data(dispatch(&second_state, create));
    assert_eq!(second["id"], first_id);
    assert_eq!(
        array_len(dispatch(
            &second_state,
            request("project.list", None, None, None, json!({}))
        )),
        1
    );
}

#[test]
fn asset_import_replays_same_operation_after_native_restart() {
    let directory = TestDirectory::new();
    let registry_path = directory.path().join("native/projects.json");
    let project_path = directory.path().join("project");
    let project_operation = operation_id();
    let asset_operation = operation_id();
    let first_state = AppState::try_with_registry_path(registry_path.clone()).unwrap();
    let project = data(dispatch(
        &first_state,
        request(
            "project.create",
            Some(project_operation),
            None,
            None,
            json!({
                "name": "Idempotent import",
                "path": project_path,
                "aspectRatio": "16:9",
                "fpsNumerator": 24,
                "fpsDenominator": 1
            }),
        ),
    ));
    let project_id = project["id"].as_str().unwrap().to_owned();
    let import = request(
        "asset.import",
        Some(asset_operation),
        Some(&project_id),
        None,
        json!({ "path": fixture_a(), "importType": "linked" }),
    );
    let first_asset = data(dispatch(&first_state, import.clone()));
    let first_asset_id = first_asset["id"].as_str().unwrap().to_owned();
    drop(first_state);

    let second_state = AppState::try_with_registry_path(registry_path).unwrap();
    data(dispatch(
        &second_state,
        request("project.open", None, Some(&project_id), None, json!({})),
    ));
    let second_asset = data(dispatch(&second_state, import));
    assert_eq!(second_asset["id"], first_asset_id);
    assert_eq!(
        array_len(dispatch(
            &second_state,
            request("asset.list", None, Some(&project_id), None, json!({}))
        )),
        1
    );
}

#[test]
fn revision_create_replays_same_operation_after_native_restart() {
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
                "name": "Idempotent revision",
                "path": project_path,
                "aspectRatio": "16:9",
                "fpsNumerator": 24,
                "fpsDenominator": 1
            }),
        ),
    ));
    let project_id = project["id"].as_str().unwrap().to_owned();
    let revision_request = request(
        "revision.create",
        Some(operation_id()),
        Some(&project_id),
        Some(1),
        json!({ "commitNote": "same revision" }),
    );
    let first_revision = data(dispatch(&first_state, revision_request.clone()));
    let first_revision_id = first_revision["id"].as_str().unwrap().to_owned();
    drop(first_state);

    let second_state = AppState::try_with_registry_path(registry_path).unwrap();
    data(dispatch(
        &second_state,
        request("project.open", None, Some(&project_id), None, json!({})),
    ));
    let second_revision = data(dispatch(&second_state, revision_request));
    assert_eq!(second_revision["id"], first_revision_id);
    assert_eq!(
        array_len(dispatch(
            &second_state,
            request("revision.list", None, Some(&project_id), None, json!({}))
        )),
        1
    );
}

#[test]
fn revision_restore_replays_same_operation_after_native_restart() {
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
                "name": "Idempotent restore",
                "path": project_path,
                "aspectRatio": "16:9",
                "fpsNumerator": 24,
                "fpsDenominator": 1
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
    let composition = data(dispatch(
        &first_state,
        request("composition.get", None, Some(&project_id), None, json!({})),
    ));
    let composition = data(dispatch(
        &first_state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(&project_id),
            Some(composition["version"].as_i64().unwrap()),
            json!({
                "action": "add",
                "assetId": asset["id"],
                "sourceInTicks": "0",
                "sourceOutTicks": "24576",
                "timelineStartTicks": "0"
            }),
        ),
    ));
    let revision = data(dispatch(
        &first_state,
        request(
            "revision.create",
            Some(operation_id()),
            Some(&project_id),
            Some(composition["version"].as_i64().unwrap()),
            json!({ "commitNote": "restore source" }),
        ),
    ));
    let current = data(dispatch(
        &first_state,
        request("composition.get", None, Some(&project_id), None, json!({})),
    ));
    data(dispatch(
        &first_state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(&project_id),
            Some(current["version"].as_i64().unwrap()),
            json!({
                "action": "trim",
                "clipId": composition["clips"][0]["id"],
                "newInTicks": "4096",
                "newOutTicks": "20480"
            }),
        ),
    ));
    drop(first_state);

    let second_state = AppState::try_with_registry_path(registry_path).unwrap();
    data(dispatch(
        &second_state,
        request("project.open", None, Some(&project_id), None, json!({})),
    ));
    let restore = request(
        "revision.restore",
        Some(operation_id()),
        Some(&project_id),
        Some(3),
        json!({ "revisionId": revision["id"] }),
    );
    let first_restore = data(dispatch(&second_state, restore.clone()));
    let second_restore = data(dispatch(&second_state, restore));
    assert_eq!(second_restore["id"], first_restore["id"]);
}

#[test]
fn job_cancel_replays_same_operation_after_native_restart() {
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
                "name": "Idempotent cancel",
                "path": project_path,
                "aspectRatio": "16:9",
                "fpsNumerator": 24,
                "fpsDenominator": 1
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
    let composition = data(dispatch(
        &first_state,
        request("composition.get", None, Some(&project_id), None, json!({})),
    ));
    let composition = data(dispatch(
        &first_state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(&project_id),
            Some(composition["version"].as_i64().unwrap()),
            json!({
                "action": "add",
                "assetId": asset["id"],
                "sourceInTicks": "0",
                "sourceOutTicks": "24576",
                "timelineStartTicks": "0"
            }),
        ),
    ));
    let composition = data(dispatch(
        &first_state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(&project_id),
            Some(composition["version"].as_i64().unwrap()),
            json!({
                "action": "add",
                "assetId": asset["id"],
                "trackId": composition["tracks"][0]["id"],
                "sourceInTicks": "24576",
                "sourceOutTicks": "49152"
            }),
        ),
    ));
    let revision = data(dispatch(
        &first_state,
        request(
            "revision.create",
            Some(operation_id()),
            Some(&project_id),
            Some(composition["version"].as_i64().unwrap()),
            json!({ "commitNote": "cancel source" }),
        ),
    ));
    let job = data(dispatch(
        &first_state,
        request(
            "render.enqueue",
            Some(operation_id()),
            Some(&project_id),
            Some(composition["version"].as_i64().unwrap()),
            json!({ "preset": "1080p_sdr", "revisionId": revision["id"] }),
        ),
    ));
    let cancel = request(
        "job.cancel",
        Some(operation_id()),
        Some(&project_id),
        None,
        json!({ "jobId": job["id"] }),
    );
    let first_cancel = data(dispatch(&first_state, cancel.clone()));
    assert_eq!(first_cancel["status"], "cancelled");
    drop(first_state);

    let second_state = AppState::try_with_registry_path(registry_path).unwrap();
    data(dispatch(
        &second_state,
        request("project.open", None, Some(&project_id), None, json!({})),
    ));
    let second_cancel = data(dispatch(&second_state, cancel));
    assert_eq!(second_cancel["status"], "cancelled");
}

#[test]
fn managed_import_copies_a_verified_source_into_the_project() {
    let directory = TestDirectory::new();
    let project_path = directory.path().join("project");
    let state = AppState::new();
    let project = data(dispatch(
        &state,
        request(
            "project.create",
            Some(operation_id()),
            None,
            None,
            json!({
                "name": "Managed import",
                "path": project_path,
                "aspectRatio": "16:9",
                "fpsNumerator": 24,
                "fpsDenominator": 1
            }),
        ),
    ));
    let project_id = project["id"].as_str().unwrap().to_owned();
    let asset = data(dispatch(
        &state,
        request(
            "asset.import",
            Some(operation_id()),
            Some(&project_id),
            None,
            json!({ "path": fixture_a(), "importType": "managed" }),
        ),
    ));
    let imported = std::path::PathBuf::from(asset["path"].as_str().unwrap());
    assert!(imported.is_file());
    assert!(
        imported.starts_with(
            std::fs::canonicalize(&project_path)
                .unwrap()
                .join(".cutroom/media")
        )
    );
    assert_ne!(imported, fixture_a());
    assert_eq!(
        asset["sha256"],
        "06e35e744a729825b664fc938485d840307755bcc44a60cd3f47f362555bcccb"
    );
}

#[test]
fn project_brief_persists_and_survives_restart() {
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
                "name": "Brief project",
                "path": project_path,
                "aspectRatio": "16:9",
                "fpsNumerator": 24,
                "fpsDenominator": 1
            }),
        ),
    ));
    let project_id = project["id"].as_str().unwrap().to_owned();

    // Default brief
    let default_brief = data(dispatch(
        &first_state,
        request("brief.get", None, Some(&project_id), None, json!({})),
    ));
    assert_eq!(default_brief["targetDurationSeconds"], 60);
    assert_eq!(default_brief["aspectRatio"], "16:9");

    // Save custom brief
    let saved_brief = data(dispatch(
        &first_state,
        request(
            "brief.set",
            Some(operation_id()),
            Some(&project_id),
            None,
            json!({
                "goal": "Launch announcement",
                "audience": "Enterprise developers",
                "targetDurationSeconds": 45,
                "aspectRatio": "16:9",
                "requiredSegments": "Product demo at 00:30",
                "excludedSegments": "Confidential roadmap",
                "tone": "Confident, focused",
                "style": "Fast-paced",
                "cta": "Sign up today"
            }),
        ),
    ));
    assert_eq!(saved_brief["goal"], "Launch announcement");
    assert_eq!(saved_brief["targetDurationSeconds"], 45);
    drop(first_state);

    // Reopen from new state and verify persistence
    let second_state = AppState::try_with_registry_path(registry_path).unwrap();
    data(dispatch(
        &second_state,
        request("project.open", None, Some(&project_id), None, json!({})),
    ));
    let loaded_brief = data(dispatch(
        &second_state,
        request("brief.get", None, Some(&project_id), None, json!({})),
    ));
    assert_eq!(loaded_brief["goal"], "Launch announcement");
    assert_eq!(loaded_brief["audience"], "Enterprise developers");
    assert_eq!(loaded_brief["targetDurationSeconds"], 45);
    assert_eq!(loaded_brief["requiredSegments"], "Product demo at 00:30");
    assert_eq!(loaded_brief["excludedSegments"], "Confidential roadmap");
}

#[test]
fn project_brief_is_overwritten_and_stored_durable() {
    let directory = TestDirectory::new();
    let registry_path = directory.path().join("native/projects.json");
    let project_path = directory.path().join("project");
    let state = AppState::try_with_registry_path(registry_path).unwrap();
    let project = data(dispatch(
         &state,
        request(
             "project.create",
            Some(operation_id()),
            None,
            None,
            json!({
                 "name": "Overwrite project",
                 "path": project_path,
                 "aspectRatio": "16:9",
                 "fpsNumerator": 24,
                 "fpsDenominator": 1
             }),
         ),
     ));
    let project_id = project["id"].as_str().unwrap().to_owned();

     // First write.
    dispatch(
         &state,
        request(
             "brief.set",
            Some(operation_id()),
            Some(&project_id),
            None,
            json!({ "goal": "First draft", "targetDurationSeconds": 30 }),
         ),
     );

     // Second write must replace the file's structured values, not append.
    let second = data(dispatch(
         &state,
        request(
             "brief.set",
            Some(operation_id()),
            Some(&project_id),
            None,
            json!({ "goal": "Final cut", "targetDurationSeconds": 60 }),
         ),
     ));
    assert_eq!(second["goal"], "Final cut");
    assert_eq!(second["targetDurationSeconds"], 60);

     // Durable read-back reflects the last (overwriting) write.
    let reloaded = data(dispatch(
         &state,
        request("brief.get", None, Some(&project_id), None, json!({})),
     ));
    assert_eq!(reloaded["goal"], "Final cut");
    assert_eq!(reloaded["targetDurationSeconds"], 60);
}

#[test]
fn project_brief_surfaces_malformed_json_and_recovers() {
    let directory = TestDirectory::new();
    let registry_path = directory.path().join("native/projects.json");
    let project_path = directory.path().join("project");
    let state = AppState::try_with_registry_path(registry_path).unwrap();
    let project = data(dispatch(
         &state,
        request(
             "project.create",
            Some(operation_id()),
            None,
            None,
            json!({
                 "name": "Malformed brief project",
                 "path": project_path,
                 "aspectRatio": "16:9",
                 "fpsNumerator": 24,
                 "fpsDenominator": 1
             }),
         ),
     ));
    let project_id = project["id"].as_str().unwrap().to_owned();

     // Corrupt the brief file on disk; the SQLite project must stay untouched.
    let brief_path = project_path.join(".cutroom").join("brief.json");
    std::fs::create_dir_all(brief_path.parent().unwrap()).unwrap();
    std::fs::write(&brief_path, b"{ this is not valid json ]").unwrap();

     // Malformed JSON is surfaced as an error, never silently used.
    assert_eq!(
        error_code(dispatch(&state, request("brief.get", None, Some(&project_id), None, json!({})))),
         "INVALID_DATA"
     );

     // A valid write recovers and atomically overwrites the corrupt file.
    let saved = data(dispatch(
         &state,
        request(
             "brief.set",
            Some(operation_id()),
            Some(&project_id),
            None,
            json!({ "goal": "Recovered", "targetDurationSeconds": 42 }),
         ),
     ));
    assert_eq!(saved["goal"], "Recovered");

    let reloaded = data(dispatch(
         &state,
        request("brief.get", None, Some(&project_id), None, json!({})),
     ));
    assert_eq!(reloaded["goal"], "Recovered");
    assert_eq!(reloaded["targetDurationSeconds"], 42);
}
