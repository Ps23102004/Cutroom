use cutroom_core::*;
use tempfile::TempDir;
use uuid::Uuid;

fn time(ticks: i128, num: i64, den: i64) -> RationalTime {
    RationalTime::from_ticks(ticks, RationalTimeBase::new(num, den).unwrap()).unwrap()
}

fn database_path(dir: &TempDir) -> std::path::PathBuf {
    dir.path().join(".cutroom").join("project.cutroom")
}

fn project_input() -> ProjectInput {
    ProjectInput {
        name: "Campaign".into(),
        path: "/work/campaign".into(),
        aspect_ratio: "16:9".into(),
        fps: RationalTimeBase::new(24000, 1001).unwrap(),
    }
}

fn asset_input(project_id: String, duration: RationalTime) -> AssetInput {
    AssetInput {
        project_id,
        name: "source.mov".into(),
        path: "/work/campaign/source.mov".into(),
        size_bytes: 42,
        duration,
        width: 1920,
        height: 1080,
        format: "mov".into(),
        codec: "h264".into(),
        audio_channels: 2,
        import_type: "linked".into(),
        sha256: None,
    }
}

fn add_track(track_id: &str) -> CompositionMutation {
    CompositionMutation {
        operations: vec![TimelineOperation::AddTrack {
            track: TrackInput {
                id: Some(track_id.into()),
                kind: "primary_video".into(),
                label: "V1".into(),
                sort_order: 0,
                is_muted: false,
                is_locked: false,
            },
        }],
    }
}

fn clip(track_id: &str, asset_id: &str, out: RationalTime) -> ClipInput {
    ClipInput {
        id: Some("clip-1".into()),
        track_id: track_id.into(),
        asset_id: asset_id.into(),
        name: "Opening".into(),
        in_time: time(0, 1, 24),
        out_time: out,
        timeline_start: time(0, 1, 48_000),
        timeline_duration: time(2_000, 1, 48_000),
        sort_order: 0,
    }
}

fn add_clip(track_id: &str, asset_id: &str, out: RationalTime) -> CompositionMutation {
    CompositionMutation {
        operations: vec![TimelineOperation::AddClip {
            clip: clip(track_id, asset_id, out),
        }],
    }
}

fn create_project_asset_composition(
    database: &mut Database,
    duration: RationalTime,
) -> (Project, Asset, Composition) {
    let project = database.projects().create(project_input()).unwrap();
    let asset = database
        .assets()
        .create(asset_input(project.id.clone(), duration))
        .unwrap();
    let composition = database.compositions().get(&project.id).unwrap();
    (project, asset, composition)
}

#[test]
fn migrations_are_ordered_and_include_jobs_baseline() {
    let dir = TempDir::new().unwrap();
    let database = Database::open(database_path(&dir)).unwrap();
    assert_eq!(
        database.applied_migrations().unwrap(),
        vec![1, 2, LATEST_MIGRATION_VERSION]
    );
}

#[test]
fn reopen_preserves_project_asset_and_clip_state() {
    let dir = TempDir::new().unwrap();
    let path = database_path(&dir);
    let (project, asset) = {
        let mut database = Database::open(&path).unwrap();
        let (project, asset, composition) =
            create_project_asset_composition(&mut database, time(96_000, 1, 48_000));
        let track_id = "track-1";
        database
            .compositions()
            .apply_mutation(
                &project.id,
                &composition.id,
                &Uuid::new_v4().to_string(),
                1,
                &add_track(track_id),
            )
            .unwrap();
        let after_track = database.compositions().get(&project.id).unwrap();
        database
            .compositions()
            .apply_mutation(
                &project.id,
                &after_track.id,
                &Uuid::new_v4().to_string(),
                after_track.version,
                &add_clip(track_id, &asset.id, time(1, 1, 24)),
            )
            .unwrap();
        (project, asset)
    };
    let mut reopened = Database::open(&path).unwrap();
    assert_eq!(
        reopened.projects().get(&project.id).unwrap().name,
        "Campaign"
    );
    assert_eq!(
        reopened.assets().get(&asset.id).unwrap().duration.ticks,
        "96000"
    );
    let composition = reopened.compositions().get(&project.id).unwrap();
    assert_eq!(composition.clips.len(), 1);
    assert_eq!(composition.clips[0].out_ticks, "2000");
}

#[test]
fn stale_write_is_rejected() {
    let dir = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&dir)).unwrap();
    let (project, _, composition) =
        create_project_asset_composition(&mut database, time(48_000, 1, 48_000));
    database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &Uuid::new_v4().to_string(),
            1,
            &add_track("track-1"),
        )
        .unwrap();
    let error = database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &Uuid::new_v4().to_string(),
            1,
            &add_track("track-2"),
        )
        .unwrap_err();
    assert!(matches!(
        error,
        CoreError::StaleWriteConflict {
            expected: 1,
            current: 2
        }
    ));
}

#[test]
fn identical_operation_replays_even_with_its_old_expected_version() {
    let dir = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&dir)).unwrap();
    let (project, _, composition) =
        create_project_asset_composition(&mut database, time(48_000, 1, 48_000));
    let operation_id = Uuid::new_v4().to_string();
    let mutation = add_track("track-1");
    let first = database
        .compositions()
        .apply_mutation(&project.id, &composition.id, &operation_id, 1, &mutation)
        .unwrap();
    let replay = database
        .compositions()
        .apply_mutation(&project.id, &composition.id, &operation_id, 1, &mutation)
        .unwrap();
    assert!(!first.replayed);
    assert!(replay.replayed);
    assert_eq!(replay.composition.version, 2);
    let conflict = database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &operation_id,
            1,
            &add_track("track-2"),
        )
        .unwrap_err();
    assert!(matches!(conflict, CoreError::IdempotencyConflict { .. }));
}

#[test]
fn cross_timebase_clip_is_normalized_without_float_math() {
    let dir = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&dir)).unwrap();
    let (project, asset, composition) =
        create_project_asset_composition(&mut database, time(3_000, 1, 48_000));
    database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &Uuid::new_v4().to_string(),
            1,
            &add_track("track-1"),
        )
        .unwrap();
    let current = database.compositions().get(&project.id).unwrap();
    database
        .compositions()
        .apply_mutation(
            &project.id,
            &current.id,
            &Uuid::new_v4().to_string(),
            current.version,
            &add_clip("track-1", &asset.id, time(1, 1, 24)),
        )
        .unwrap();
    assert_eq!(
        database.compositions().get(&project.id).unwrap().clips[0].out_ticks,
        "2000"
    );
    assert_eq!(
        time(1, 1, 24)
            .compare_checked(&time(2000, 1, 48_000))
            .unwrap(),
        std::cmp::Ordering::Equal
    );
    assert!(RationalTime::new("001", RationalTimeBase::new(1, 48_000).unwrap()).is_err());
}

#[test]
fn invalid_source_range_rolls_back_all_prior_operations_in_the_mutation() {
    let dir = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&dir)).unwrap();
    let (project, asset, composition) =
        create_project_asset_composition(&mut database, time(1_000, 1, 48_000));
    let mutation = CompositionMutation {
        operations: vec![
            TimelineOperation::AddTrack {
                track: TrackInput {
                    id: Some("track-1".into()),
                    kind: "primary_video".into(),
                    label: "V1".into(),
                    sort_order: 0,
                    is_muted: false,
                    is_locked: false,
                },
            },
            TimelineOperation::AddClip {
                clip: clip("track-1", &asset.id, time(1_001, 1, 48_000)),
            },
        ],
    };
    let error = database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &Uuid::new_v4().to_string(),
            1,
            &mutation,
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::InvalidSourceRange { .. }));
    let after = database.compositions().get(&project.id).unwrap();
    assert_eq!(after.version, 1);
    assert!(after.tracks.is_empty());
    assert!(after.clips.is_empty());
}

#[test]
fn revision_hash_is_deterministic_and_changes_with_arrangement() {
    let dir = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&dir)).unwrap();
    let (project, asset, composition) =
        create_project_asset_composition(&mut database, time(96_000, 1, 48_000));
    database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &Uuid::new_v4().to_string(),
            1,
            &add_track("track-1"),
        )
        .unwrap();
    let current = database.compositions().get(&project.id).unwrap();
    database
        .compositions()
        .apply_mutation(
            &project.id,
            &current.id,
            &Uuid::new_v4().to_string(),
            current.version,
            &add_clip("track-1", &asset.id, time(1, 1, 24)),
        )
        .unwrap();
    let current = database.compositions().get(&project.id).unwrap();
    let first = database
        .revisions()
        .create(&project.id, &current.id, "first", "tester")
        .unwrap();
    let second = database
        .revisions()
        .create(&project.id, &current.id, "same state", "tester")
        .unwrap();
    assert_eq!(first.content_hash, second.content_hash);
    let mut moved = clip("track-1", &asset.id, time(1, 1, 24));
    moved.timeline_start = time(2_000, 1, 48_000);
    let changed = database
        .compositions()
        .apply_mutation(
            &project.id,
            &current.id,
            &Uuid::new_v4().to_string(),
            current.version,
            &CompositionMutation {
                operations: vec![TimelineOperation::UpdateClip { clip: moved }],
            },
        )
        .unwrap();
    let third = database
        .revisions()
        .create(&project.id, &changed.composition.id, "moved", "tester")
        .unwrap();
    assert_ne!(first.content_hash, third.content_hash);
    assert_eq!(first.content_hash.len(), 64);
}

#[test]
fn restore_retains_history_and_advances_version_without_aba() {
    let dir = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&dir)).unwrap();
    let (project, _, composition) =
        create_project_asset_composition(&mut database, time(48_000, 1, 48_000));
    let first_change = database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &Uuid::new_v4().to_string(),
            1,
            &add_track("track-1"),
        )
        .unwrap();
    let first_revision = database
        .revisions()
        .create(&project.id, &composition.id, "one track", "tester")
        .unwrap();
    let second_change = database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &Uuid::new_v4().to_string(),
            first_change.composition.version,
            &add_track("track-2"),
        )
        .unwrap();
    database
        .revisions()
        .create(&project.id, &composition.id, "two tracks", "tester")
        .unwrap();
    let restored = database
        .revisions()
        .restore(
            &project.id,
            &composition.id,
            &first_revision.id,
            second_change.composition.version,
        )
        .unwrap();
    assert_eq!(restored.version, 4);
    assert_eq!(restored.tracks.len(), 1);
    assert_eq!(database.revisions().list(&project.id).unwrap().len(), 2);
}

#[test]
fn second_writer_is_denied_until_the_first_handle_drops() {
    let dir = TempDir::new().unwrap();
    let path = database_path(&dir);
    let first = Database::open(&path).unwrap();
    let locked = match Database::open(&path) {
        Err(error) => error,
        Ok(_) => panic!("second writer unexpectedly acquired the database lock"),
    };
    assert!(matches!(locked, CoreError::ProjectLocked(_)));
    drop(first);
    Database::open(&path).unwrap();
}
