mod support;

use std::{
    path::Path,
    thread,
    time::{Duration, Instant},
};

use cutroom_core::{
    ClipInput, CompositionMutation, Database, RationalTime, TimelineOperation, TrackInput,
};
use cutroom_tauri::{AppState, NativeRequest, NativeResponse, dispatch};
use serde_json::{Value, json};
use support::{TestDirectory, fixture_a, fixture_b};
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

fn create_project_with_asset(state: &AppState, project_path: &Path) -> (String, String) {
    let project = data(dispatch(
        state,
        request(
            "project.create",
            Some(operation_id()),
            None,
            None,
            json!({
                "name": "Native timeline regressions",
                "path": project_path,
                "aspectRatio": "16:9",
                "fpsNumerator": 24,
                "fpsDenominator": 1,
            }),
        ),
    ));
    let project_id = project["id"].as_str().unwrap().to_owned();
    let asset = data(dispatch(
        state,
        request(
            "asset.import",
            Some(operation_id()),
            Some(&project_id),
            None,
            json!({ "path": fixture_a(), "importType": "linked" }),
        ),
    ));
    (project_id, asset["id"].as_str().unwrap().to_owned())
}

fn composition(state: &AppState, project_id: &str) -> Value {
    data(dispatch(
        state,
        request("composition.get", None, Some(project_id), None, json!({})),
    ))
}

fn apply(state: &AppState, project_id: &str, expected_version: i64, payload: Value) -> Value {
    data(dispatch(
        state,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(project_id),
            Some(expected_version),
            payload,
        ),
    ))
}

fn clip<'a>(composition: &'a Value, clip_id: &str) -> &'a Value {
    composition["clips"]
        .as_array()
        .unwrap()
        .iter()
        .find(|clip| clip["id"] == clip_id)
        .unwrap_or_else(|| panic!("missing clip {clip_id}"))
}

fn wait_for_completed_render(state: &AppState, project_id: &str, job_id: &str) {
    let deadline = Instant::now() + Duration::from_secs(45);
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
            .unwrap_or_else(|| panic!("missing render job {job_id}"));
        if job["status"] == "completed" {
            return;
        }
        assert!(
            ["queued", "running", "retrying"].contains(&job["status"].as_str().unwrap()),
            "render reached unexpected state: {job}"
        );
        assert!(
            Instant::now() < deadline,
            "timed out waiting for render: {job}"
        );
        thread::sleep(Duration::from_millis(50));
    }
}

fn add_secondary_track_clip(database_path: &Path, project_id: &str, asset_id: &str) {
    let mut database = Database::open(database_path).unwrap();
    let composition = database.compositions().get(project_id).unwrap();
    let asset = database.assets().get(asset_id).unwrap();
    let track_id = Uuid::new_v4().to_string();
    let in_time = RationalTime::from_ticks(3_072, asset.duration.time_base.clone()).unwrap();
    let out_time = RationalTime::from_ticks(3_584, asset.duration.time_base.clone()).unwrap();
    let duration = RationalTime::from_ticks(512, asset.duration.time_base.clone())
        .unwrap()
        .exact_ticks_in(&composition.time_base)
        .unwrap();
    let mutation = CompositionMutation {
        operations: vec![
            TimelineOperation::AddTrack {
                track: TrackInput {
                    id: Some(track_id.clone()),
                    kind: "overlay_video".into(),
                    label: "V2".into(),
                    sort_order: 1,
                    is_muted: false,
                    is_locked: false,
                },
            },
            TimelineOperation::AddClip {
                clip: ClipInput {
                    id: Some(Uuid::new_v4().to_string()),
                    track_id,
                    asset_id: asset_id.into(),
                    name: asset.name,
                    in_time,
                    out_time,
                    timeline_start: RationalTime::from_ticks(
                        400_000,
                        composition.time_base.clone(),
                    )
                    .unwrap(),
                    timeline_duration: RationalTime::new(duration, composition.time_base.clone())
                        .unwrap(),
                    sort_order: 0,
                },
            },
        ],
    };
    database
        .compositions()
        .apply_mutation(
            project_id,
            &composition.id,
            &operation_id(),
            composition.version,
            &mutation,
        )
        .unwrap();
}

#[test]
fn split_first_of_two_dense_renumbers_without_rendering_three_clips() {
    let directory = TestDirectory::new();
    let project_path = directory.path().join("project");
    let state = AppState::new();
    let (project_id, asset_id) = create_project_with_asset(&state, &project_path);

    let first = apply(
        &state,
        &project_id,
        1,
        json!({
            "action": "add",
            "assetId": asset_id,
            "sourceInTicks": "0",
            "sourceOutTicks": "24576",
            "timelineStartTicks": "0",
        }),
    );
    let track_id = first["tracks"][0]["id"].as_str().unwrap().to_owned();
    let first_id = first["clips"][0]["id"].as_str().unwrap().to_owned();
    let second = apply(
        &state,
        &project_id,
        2,
        json!({
            "action": "add",
            "assetId": asset_id,
            "trackId": track_id,
            "sourceInTicks": "24576",
            "sourceOutTicks": "49152",
            "timelineStartTicks": "96000",
        }),
    );
    let second_id = second["clips"][1]["id"].as_str().unwrap().to_owned();
    let split_request = request(
        "composition.apply",
        Some(operation_id()),
        Some(&project_id),
        Some(3),
        json!({ "action": "split", "clipId": first_id, "splitPointTicks": "48000" }),
    );
    let split = data(dispatch(&state, split_request.clone()));
    let replay = data(dispatch(&state, split_request));
    assert_eq!(replay, split, "same split operation must replay exactly");
    assert_eq!(split["clips"].as_array().unwrap().len(), 3);

    let new_half = split["clips"]
        .as_array()
        .unwrap()
        .iter()
        .find(|clip| clip["id"] != first_id && clip["id"] != second_id)
        .unwrap();
    let new_half_id = new_half["id"].as_str().unwrap().to_owned();
    assert_eq!(clip(&split, &first_id)["inTicks"], "0");
    assert_eq!(clip(&split, &first_id)["outTicks"], "12288");
    assert_eq!(clip(&split, &first_id)["timelineStartTicks"], "0");
    assert_eq!(clip(&split, &new_half_id)["inTicks"], "12288");
    assert_eq!(clip(&split, &new_half_id)["outTicks"], "24576");
    assert_eq!(clip(&split, &new_half_id)["timelineStartTicks"], "48000");
    assert_eq!(clip(&split, &second_id)["inTicks"], "24576");
    assert_eq!(clip(&split, &second_id)["outTicks"], "49152");
    assert_eq!(clip(&split, &second_id)["timelineStartTicks"], "96000");

    drop(state);
    let mut database = Database::open(project_path.join(".cutroom/project.cutroom")).unwrap();
    let persisted = database.compositions().get(&project_id).unwrap();
    assert_eq!(
        persisted
            .clips
            .iter()
            .map(|clip| clip.id.as_str())
            .collect::<Vec<_>>(),
        vec![first_id.as_str(), new_half_id.as_str(), second_id.as_str()]
    );
    assert_eq!(
        persisted
            .clips
            .iter()
            .map(|clip| clip.sort_order)
            .collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
}

#[test]
fn reorder_unequal_ranges_recalculates_starts_and_real_revision_render_succeeds() {
    let directory = TestDirectory::new();
    let project_path = directory.path().join("project");
    let state = AppState::new();
    let (project_id, asset_id) = create_project_with_asset(&state, &project_path);

    let first = apply(
        &state,
        &project_id,
        1,
        json!({
            "action": "add",
            "assetId": asset_id,
            "sourceInTicks": "0",
            "sourceOutTicks": "15360",
            "timelineStartTicks": "0",
        }),
    );
    let track_id = first["tracks"][0]["id"].as_str().unwrap().to_owned();
    let first_id = first["clips"][0]["id"].as_str().unwrap().to_owned();
    let second = apply(
        &state,
        &project_id,
        2,
        json!({
            "action": "add",
            "assetId": asset_id,
            "trackId": track_id,
            "sourceInTicks": "15360",
            "sourceOutTicks": "46080",
        }),
    );
    let second_id = second["clips"][1]["id"].as_str().unwrap().to_owned();
    assert_eq!(clip(&second, &second_id)["timelineStartTicks"], "60000");

    let reordered = apply(
        &state,
        &project_id,
        3,
        json!({ "action": "reorder", "clipId": second_id, "direction": "left" }),
    );
    assert_eq!(reordered["durationTicks"], second["durationTicks"]);
    assert_eq!(clip(&reordered, &second_id)["timelineStartTicks"], "0");
    assert_eq!(
        clip(&reordered, &second_id)["timelineDurationTicks"],
        "120000"
    );
    assert_eq!(clip(&reordered, &first_id)["timelineStartTicks"], "120000");
    assert_eq!(
        clip(&reordered, &first_id)["timelineDurationTicks"],
        "60000"
    );
    assert_eq!(clip(&reordered, &second_id)["inTicks"], "15360");
    assert_eq!(clip(&reordered, &second_id)["outTicks"], "46080");
    assert_eq!(clip(&reordered, &first_id)["inTicks"], "0");
    assert_eq!(clip(&reordered, &first_id)["outTicks"], "15360");
    assert_eq!(
        error_code(dispatch(
            &state,
            request(
                "composition.apply",
                Some(operation_id()),
                Some(&project_id),
                Some(4),
                json!({ "action": "reorder", "clipId": second_id, "direction": "left" }),
            ),
        )),
        "INVALID_TIMELINE_OPERATION"
    );
    assert_eq!(composition(&state, &project_id)["version"], 4);

    let revision = data(dispatch(
        &state,
        request(
            "revision.create",
            Some(operation_id()),
            Some(&project_id),
            Some(4),
            json!({ "commitNote": "reordered unequal ranges" }),
        ),
    ));
    let job = data(dispatch(
        &state,
        request(
            "render.enqueue",
            Some(operation_id()),
            Some(&project_id),
            Some(4),
            json!({ "preset": "1080p_sdr", "revisionId": revision["id"] }),
        ),
    ));
    wait_for_completed_render(&state, &project_id, job["id"].as_str().unwrap());

    drop(state);
    let mut database = Database::open(project_path.join(".cutroom/project.cutroom")).unwrap();
    let revision = database
        .revisions()
        .get(&project_id, revision["id"].as_str().unwrap())
        .unwrap();
    assert_eq!(
        revision
            .composition_snapshot
            .clips
            .iter()
            .map(|clip| clip.id.as_str())
            .collect::<Vec<_>>(),
        vec![second_id.as_str(), first_id.as_str()]
    );
    assert_eq!(revision.composition_snapshot.clips[0].in_ticks, "15360");
    assert_eq!(revision.composition_snapshot.clips[0].out_ticks, "46080");
}

#[test]
fn trim_uses_numeric_cross_digit_starts_preserves_gaps_and_other_tracks() {
    let directory = TestDirectory::new();
    let registry_path = directory.path().join("native/projects.json");
    let project_path = directory.path().join("project");
    let state = AppState::try_with_registry_path(registry_path.clone()).unwrap();
    let (project_id, asset_id) = create_project_with_asset(&state, &project_path);
    let first = apply(
        &state,
        &project_id,
        1,
        json!({
            "action": "add",
            "assetId": asset_id,
            "sourceInTicks": "0",
            "sourceOutTicks": "1536",
            "timelineStartTicks": "90000",
        }),
    );
    let track_id = first["tracks"][0]["id"].as_str().unwrap().to_owned();
    let first_id = first["clips"][0]["id"].as_str().unwrap().to_owned();
    let second = apply(
        &state,
        &project_id,
        2,
        json!({
            "action": "add",
            "assetId": asset_id,
            "trackId": track_id,
            "sourceInTicks": "1536",
            "sourceOutTicks": "3072",
            "timelineStartTicks": "100000",
        }),
    );
    let second_id = second["clips"][1]["id"].as_str().unwrap().to_owned();

    // A gapped primary track is unsupported for reorder; rejection must leave the
    // native composition unchanged rather than silently closing the gap.
    assert_eq!(
        error_code(dispatch(
            &state,
            request(
                "composition.apply",
                Some(operation_id()),
                Some(&project_id),
                Some(3),
                json!({ "action": "reorder", "clipId": second_id, "direction": "left" }),
            ),
        )),
        "UNSUPPORTED_TIMELINE_LAYOUT"
    );
    assert_eq!(composition(&state, &project_id)["version"], 3);

    drop(state);
    add_secondary_track_clip(
        &project_path.join(".cutroom/project.cutroom"),
        &project_id,
        &asset_id,
    );
    let restarted = AppState::try_with_registry_path(registry_path).unwrap();
    data(dispatch(
        &restarted,
        request("project.open", None, Some(&project_id), None, json!({})),
    ));
    let before = composition(&restarted, &project_id);
    let other_track_id = before["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|track| track["id"] != track_id)
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let other_before = before["clips"]
        .as_array()
        .unwrap()
        .iter()
        .find(|clip| clip["trackId"] == other_track_id)
        .unwrap()
        .clone();

    let trim_request = request(
        "composition.apply",
        Some(operation_id()),
        Some(&project_id),
        Some(4),
        json!({ "action": "trim", "clipId": first_id, "newInTicks": "0", "newOutTicks": "512" }),
    );
    let trimmed = data(dispatch(&restarted, trim_request.clone()));
    assert_eq!(data(dispatch(&restarted, trim_request)), trimmed);
    assert_eq!(clip(&trimmed, &first_id)["timelineStartTicks"], "90000");
    assert_eq!(clip(&trimmed, &first_id)["timelineDurationTicks"], "2000");
    // The original 4,000-tick gap remains: 90,000 + 2,000 -> 96,000.
    assert_eq!(clip(&trimmed, &second_id)["timelineStartTicks"], "96000");
    assert_eq!(
        trimmed["clips"]
            .as_array()
            .unwrap()
            .iter()
            .find(|clip| clip["trackId"] == other_track_id)
            .unwrap(),
        &other_before
    );

    let overflow = dispatch(
        &restarted,
        request(
            "composition.apply",
            Some(operation_id()),
            Some(&project_id),
            Some(5),
            json!({
                "action": "add",
                "assetId": asset_id,
                "trackId": track_id,
                "sourceInTicks": "0",
                "sourceOutTicks": "512",
                "timelineStartTicks": "170141183460469231731687303715884105727",
            }),
        ),
    );
    assert_eq!(error_code(overflow), "INTERNAL_ERROR");
    assert_eq!(composition(&restarted, &project_id)["version"], 5);
}

#[test]
fn remove_uses_numeric_cross_digit_starts_and_dense_ranks_after_add() {
    let directory = TestDirectory::new();
    let project_path = directory.path().join("project");
    let state = AppState::new();
    let (project_id, asset_id) = create_project_with_asset(&state, &project_path);
    let first = apply(
        &state,
        &project_id,
        1,
        json!({
            "action": "add",
            "assetId": asset_id,
            "sourceInTicks": "0",
            "sourceOutTicks": "1536",
            "timelineStartTicks": "90000",
        }),
    );
    let track_id = first["tracks"][0]["id"].as_str().unwrap().to_owned();
    let first_id = first["clips"][0]["id"].as_str().unwrap().to_owned();
    let second = apply(
        &state,
        &project_id,
        2,
        json!({
            "action": "add",
            "assetId": asset_id,
            "trackId": track_id,
            "sourceInTicks": "1536",
            "sourceOutTicks": "3072",
            "timelineStartTicks": "100000",
        }),
    );
    let second_id = second["clips"][1]["id"].as_str().unwrap().to_owned();
    let removed = apply(
        &state,
        &project_id,
        3,
        json!({ "action": "remove", "clipId": first_id }),
    );
    assert_eq!(removed["clips"].as_array().unwrap().len(), 1);
    assert_eq!(clip(&removed, &second_id)["timelineStartTicks"], "94000");
    assert_eq!(clip(&removed, &second_id)["inTicks"], "1536");
    assert_eq!(clip(&removed, &second_id)["outTicks"], "3072");

    let added = apply(
        &state,
        &project_id,
        4,
        json!({
            "action": "add",
            "assetId": asset_id,
            "trackId": track_id,
            "sourceInTicks": "3072",
            "sourceOutTicks": "4608",
            "timelineStartTicks": "100000",
        }),
    );
    assert_eq!(added["clips"].as_array().unwrap().len(), 2);

    drop(state);
    let mut database = Database::open(project_path.join(".cutroom/project.cutroom")).unwrap();
    let persisted = database.compositions().get(&project_id).unwrap();
    assert_eq!(
        persisted
            .clips
            .iter()
            .map(|clip| clip.sort_order)
            .collect::<Vec<_>>(),
        vec![0, 1]
    );
}

#[test]
fn replace_swaps_asset_and_range_in_place_with_delta_ripple() {
    let directory = TestDirectory::new();
    let project_path = directory.path().join("project");
    let state = AppState::new();
    let (project_id, asset_a) = create_project_with_asset(&state, &project_path);
    let asset_b = data(dispatch(
        &state,
        request(
            "asset.import",
            Some(operation_id()),
            Some(&project_id),
            None,
            json!({ "path": fixture_b(), "importType": "linked" }),
        ),
    ))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    // fixture_b probes at 1/12288 (5s = 61440 ticks); the composition runs
    // 1/24000, so source boundaries must stay multiples of 64 to convert exactly.
    let half_b = "19200".to_string();
    let beyond_b = "61504".to_string();

    let first = apply(
        &state,
        &project_id,
        1,
        json!({
            "action": "add",
            "assetId": asset_a,
            "sourceInTicks": "0",
            "sourceOutTicks": "1536",
            "timelineStartTicks": "90000",
        }),
    );
    let track_id = first["tracks"][0]["id"].as_str().unwrap().to_owned();
    let first_id = first["clips"][0]["id"].as_str().unwrap().to_owned();
    let second = apply(
        &state,
        &project_id,
        2,
        json!({
            "action": "add",
            "assetId": asset_a,
            "trackId": track_id,
            "sourceInTicks": "1536",
            "sourceOutTicks": "3072",
            "timelineStartTicks": "100000",
        }),
    );
    let second_id = second["clips"][1]["id"].as_str().unwrap().to_owned();
    let second_start_before = clip(&second, &second_id)["timelineStartTicks"]
        .as_str()
        .unwrap()
        .to_owned();
    let first_duration_before = clip(&second, &first_id)["timelineDurationTicks"]
        .as_str()
        .unwrap()
        .to_owned();

    let replaced = apply(
        &state,
        &project_id,
        3,
        json!({
            "action": "replace",
            "clipId": first_id,
            "assetId": asset_b,
            "sourceInTicks": "0",
            "sourceOutTicks": half_b,
        }),
    );
    // Same clip identity, same timeline start, new asset and source range.
    assert_eq!(clip(&replaced, &first_id)["id"], first_id.as_str());
    assert_eq!(clip(&replaced, &first_id)["assetId"], asset_b.as_str());
    assert_eq!(clip(&replaced, &first_id)["timelineStartTicks"], "90000");
    assert_eq!(clip(&replaced, &first_id)["inTicks"], "0");
    assert_eq!(clip(&replaced, &first_id)["outTicks"], half_b.as_str());
    // The following sibling rippled by the exact duration delta.
    let first_duration_after = clip(&replaced, &first_id)["timelineDurationTicks"]
        .as_str()
        .unwrap()
        .to_owned();
    let delta = first_duration_after.parse::<i64>().unwrap()
        - first_duration_before.parse::<i64>().unwrap();
    assert_eq!(
        clip(&replaced, &second_id)["timelineStartTicks"].as_str().unwrap(),
        &(second_start_before.parse::<i64>().unwrap() + delta).to_string()
    );
    // No clips were added or removed: replace is an in-place swap.
    assert_eq!(replaced["clips"].as_array().unwrap().len(), 2);
    assert_eq!(replaced["version"], 4);

    // A source range beyond the replacement asset duration is rejected and
    // leaves the composition unchanged.
    let before_failed = composition(&state, &project_id);
    assert_eq!(
        error_code(dispatch(
            &state,
            request(
                "composition.apply",
                Some(operation_id()),
                Some(&project_id),
                Some(4),
                json!({
                    "action": "replace",
                    "clipId": first_id,
                    "assetId": asset_b,
                    "sourceInTicks": "0",
                    "sourceOutTicks": beyond_b,
                }),
            ),
        )),
        "INVALID_INPUT"
    );
    assert_eq!(composition(&state, &project_id), before_failed);

    // An inverted range is rejected without mutation.
    assert_eq!(
        error_code(dispatch(
            &state,
            request(
                "composition.apply",
                Some(operation_id()),
                Some(&project_id),
                Some(4),
                json!({
                    "action": "replace",
                    "clipId": first_id,
                    "assetId": asset_b,
                    "sourceInTicks": "3072",
                    "sourceOutTicks": "1024",
                }),
            ),
        )),
        "INVALID_INPUT"
    );
    assert_eq!(composition(&state, &project_id), before_failed);

    // Persisted authoritative composition matches the dispatched snapshot.
    drop(state);
    let mut database = Database::open(project_path.join(".cutroom/project.cutroom")).unwrap();
    let persisted = database.compositions().get(&project_id).unwrap();
    let persisted_first = persisted
        .clips
        .iter()
        .find(|clip| clip.id == first_id)
        .unwrap();
    assert_eq!(persisted_first.asset_id, asset_b);
    assert_eq!(persisted_first.out_ticks, half_b);
}
