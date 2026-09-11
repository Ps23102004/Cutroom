use std::{
    fs,
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
};

use cutroom_core::*;
use tempfile::TempDir;
use uuid::Uuid;

const LOCK_CHILD_PATH: &str = "CUTROOM_CORE_LOCK_CHILD_PATH";
const LOCK_READY: &str = "CUTROOM_CORE_LOCK_HELD";

fn time(ticks: i128, num: i64, den: i64) -> RationalTime {
    RationalTime::from_ticks(ticks, RationalTimeBase::new(num, den).unwrap()).unwrap()
}

fn database_path(directory: &TempDir) -> std::path::PathBuf {
    directory.path().join(".cutroom").join("project.cutroom")
}

fn open_error(path: impl AsRef<std::path::Path>) -> CoreError {
    match Database::open(path) {
        Ok(_) => panic!("database unexpectedly opened"),
        Err(error) => error,
    }
}

fn project_input(name: &str, path: &str) -> ProjectInput {
    ProjectInput {
        name: name.into(),
        path: path.into(),
        aspect_ratio: "16:9".into(),
        fps: RationalTimeBase::new(24_000, 1_001).unwrap(),
    }
}

fn add_track(id: &str) -> CompositionMutation {
    CompositionMutation {
        operations: vec![TimelineOperation::AddTrack {
            track: TrackInput {
                id: Some(id.into()),
                kind: "primary_video".into(),
                label: "V1".into(),
                sort_order: 0,
                is_muted: false,
                is_locked: false,
            },
        }],
    }
}

fn create_asset(database: &mut Database, project_id: &str) -> Asset {
    database
        .assets()
        .create(AssetInput {
            project_id: project_id.into(),
            name: "source.mov".into(),
            path: "/work/source.mov".into(),
            size_bytes: 1,
            duration: time(3_000, 1, 48_000),
            width: 1,
            height: 1,
            format: "mov".into(),
            codec: "h264".into(),
            audio_channels: 0,
            import_type: "linked".into(),
            sha256: None,
        })
        .unwrap()
}

fn source_clip(track_id: &str, asset_id: &str, timeline_duration: i128) -> ClipInput {
    ClipInput {
        id: Some("clip-1".into()),
        track_id: track_id.into(),
        asset_id: asset_id.into(),
        name: "opening".into(),
        in_time: time(0, 1, 24),
        out_time: time(1, 1, 24),
        timeline_start: time(0, 1, 48_000),
        timeline_duration: time(timeline_duration, 1, 48_000),
        sort_order: 0,
    }
}

#[test]
fn lock_holder_child() {
    let Some(path) = std::env::var_os(LOCK_CHILD_PATH) else {
        return;
    };
    let _database =
        Database::open(std::path::PathBuf::from(path)).expect("child must acquire database lock");
    println!("{LOCK_READY}");
    std::io::stdout().flush().unwrap();
    thread::sleep(Duration::from_secs(30));
}

#[test]
fn child_process_lock_blocks_writer_then_releases_after_crash() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    drop(Database::open(&path).unwrap());

    let mut child = Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("lock_holder_child")
        .arg("--nocapture")
        .env(LOCK_CHILD_PATH, &path)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdout = child.stdout.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        while reader.read_line(&mut line).unwrap_or(0) != 0 {
            if line.contains(LOCK_READY) {
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
    let contender = match Database::open(&path) {
        Err(error) => error,
        Ok(_) => panic!("writer acquired a lock held by another process"),
    };
    child.kill().unwrap();
    child.wait().unwrap();
    reader.join().unwrap();

    assert!(ready, "child did not report an acquired database lock");
    assert!(matches!(contender, CoreError::ProjectLocked(_)));
    Database::open(&path).expect("OS must release the dead child process lock");
}

#[test]
fn refused_writer_does_not_change_database_source_bytes() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let owner = Database::open(&path).unwrap();
    let sentinel = fs::read(&path).unwrap();
    assert!(!sentinel.is_empty());

    let rejected = match Database::open(&path) {
        Err(error) => error,
        Ok(_) => panic!("second writer unexpectedly acquired the database lock"),
    };
    assert!(matches!(rejected, CoreError::ProjectLocked(_)));
    assert_eq!(fs::read(&path).unwrap(), sentinel);
    drop(owner);
}

#[cfg(unix)]
#[test]
fn hard_linked_database_is_rejected_fail_closed() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    drop(Database::open(&path).unwrap());
    let alias = directory.path().join("project-hard-link.cutroom");
    fs::hard_link(&path, &alias).unwrap();

    let error = match Database::open(&alias) {
        Err(error) => error,
        Ok(_) => panic!("hard-linked database unexpectedly opened"),
    };
    assert!(
        matches!(error, CoreError::InvalidInput(message) if message.contains("hard-linked database"))
    );
}

#[cfg(unix)]
#[test]
fn symlinked_database_path_is_rejected_fail_closed() {
    use std::os::unix::fs::symlink;

    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    drop(Database::open(&path).unwrap());
    let alias = directory.path().join("project-symlink.cutroom");
    symlink(&path, &alias).unwrap();

    let error = match Database::open(&alias) {
        Err(error) => error,
        Ok(_) => panic!("symlinked database unexpectedly opened"),
    };
    assert!(
        matches!(error, CoreError::InvalidInput(message) if message.contains("must not be a symlink"))
    );
}

#[test]
fn large_equivalent_rational_times_cancel_before_multiplication() {
    let maximum = time(i128::MAX, 1, 48_000);
    assert_eq!(
        maximum.compare_checked(&maximum).unwrap(),
        std::cmp::Ordering::Equal
    );
    assert_eq!(
        maximum
            .exact_ticks_in(&RationalTimeBase::new(2, 96_000).unwrap())
            .unwrap(),
        i128::MAX.to_string()
    );

    let overflowing = time(i128::MAX, i64::MAX, 1);
    let error = overflowing
        .exact_ticks_in(&RationalTimeBase::new(1, i64::MAX).unwrap())
        .unwrap_err();
    assert!(matches!(error, CoreError::ArithmeticOverflow));
}

#[test]
fn source_range_duration_must_equal_timeline_duration_without_speed() {
    let directory = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&directory)).unwrap();
    let project = database
        .projects()
        .create(project_input("One", "/work/one"))
        .unwrap();
    let asset = create_asset(&mut database, &project.id);
    let composition = database.compositions().get(&project.id).unwrap();
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

    let mismatched = CompositionMutation {
        operations: vec![TimelineOperation::AddClip {
            clip: source_clip("track-1", &asset.id, 1_999),
        }],
    };
    let error = database
        .compositions()
        .apply_mutation(
            &project.id,
            &current.id,
            &Uuid::new_v4().to_string(),
            current.version,
            &mismatched,
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::InvalidSourceRange { .. }));
    assert!(
        database
            .compositions()
            .get(&project.id)
            .unwrap()
            .clips
            .is_empty()
    );

    let valid = CompositionMutation {
        operations: vec![TimelineOperation::AddClip {
            clip: source_clip("track-1", &asset.id, 2_000),
        }],
    };
    database
        .compositions()
        .apply_mutation(
            &project.id,
            &current.id,
            &Uuid::new_v4().to_string(),
            current.version,
            &valid,
        )
        .unwrap();
    assert_eq!(
        database.compositions().get(&project.id).unwrap().clips[0].out_ticks,
        "2000"
    );
}

#[test]
fn receipt_id_cannot_cross_project_or_composition_context() {
    let directory = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&directory)).unwrap();
    let first = database
        .projects()
        .create(project_input("One", "/work/one"))
        .unwrap();
    let second = database
        .projects()
        .create(project_input("Two", "/work/two"))
        .unwrap();
    let first_composition = database.compositions().get(&first.id).unwrap();
    let second_composition = database.compositions().get(&second.id).unwrap();
    let operation_id = Uuid::new_v4().to_string();
    let mutation = add_track("track-shared");

    database
        .compositions()
        .apply_mutation(
            &first.id,
            &first_composition.id,
            &operation_id,
            1,
            &mutation,
        )
        .unwrap();
    let error = database
        .compositions()
        .apply_mutation(
            &second.id,
            &second_composition.id,
            &operation_id,
            1,
            &mutation,
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::IdempotencyConflict { .. }));
}

#[test]
fn non_v4_operation_ids_are_rejected() {
    let directory = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&directory)).unwrap();
    let project = database
        .projects()
        .create(project_input("One", "/work/one"))
        .unwrap();
    let composition = database.compositions().get(&project.id).unwrap();
    let error = database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            "f47ac10b-58cc-11cf-8f0f-08002be10318",
            1,
            &add_track("track-1"),
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::InvalidInput(message) if message.contains("UUIDv4")));
}

#[test]
fn future_user_version_is_refused_before_schema_bootstrap() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let future_version = LATEST_MIGRATION_VERSION + 1;
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(&format!("PRAGMA user_version = {future_version}"))
        .unwrap();
    drop(connection);

    let error = match Database::open(&path) {
        Err(error) => error,
        Ok(_) => panic!("future schema version unexpectedly opened"),
    };
    assert!(matches!(
        error,
        CoreError::UnsupportedSchemaVersion { found, supported }
            if found == future_version && supported == LATEST_MIGRATION_VERSION
    ));
    let connection = rusqlite::Connection::open(&path).unwrap();
    let metadata_exists: i64 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert_eq!(metadata_exists, 0);
}

#[test]
fn fresh_open_sets_supported_schema_metadata_and_reopens() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let database = Database::open(&path).unwrap();
    assert_eq!(
        database.applied_migrations().unwrap(),
        vec![1, 2, LATEST_MIGRATION_VERSION]
    );
    drop(database);

    let connection = rusqlite::Connection::open(&path).unwrap();
    let user_version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(user_version, LATEST_MIGRATION_VERSION);
    let metadata_exists: i64 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations')",
        [],
        |row| row.get(0),
    ).unwrap();
    assert_eq!(metadata_exists, 1);
    drop(connection);

    let reopened = Database::open(&path).unwrap();
    assert_eq!(
        reopened.applied_migrations().unwrap(),
        vec![1, 2, LATEST_MIGRATION_VERSION]
    );
}

#[test]
fn legacy_v1_jobs_upgrade_in_place_and_preserve_existing_project_data() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let project = {
        let mut database = Database::open(&path).unwrap();
        database
            .projects()
            .create(project_input("Legacy project", "/work/legacy"))
            .unwrap()
    };

    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "DELETE FROM schema_migrations WHERE version > 1;
             DROP TABLE native_operation_receipts;
             PRAGMA user_version = 1;
             DROP TABLE jobs;
             CREATE TABLE jobs (
                 id TEXT PRIMARY KEY NOT NULL,
                 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                 title TEXT NOT NULL,
                 kind TEXT NOT NULL CHECK (kind IN ('proxy', 'render', 'asr', 'waveform', 'export')),
                 status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')) DEFAULT 'queued',
                 step TEXT NOT NULL DEFAULT '',
                 current_step INTEGER NOT NULL DEFAULT 0,
                 total_steps INTEGER NOT NULL DEFAULT 1,
                 lease_token TEXT,
                 lease_expires_at TEXT,
                 error TEXT,
                 output_path TEXT,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE INDEX idx_jobs_project_status ON jobs(project_id, status);",
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO jobs (id, project_id, title, kind, status, step, current_step, total_steps, error, output_path, created_at, updated_at) VALUES (?1, ?2, 'Legacy render', 'render', 'completed', 'encode', 4, 4, NULL, '/tmp/legacy.mp4', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z')",
            rusqlite::params!["legacy-job", project.id],
        )
        .unwrap();
    drop(connection);

    let mut reopened = Database::open(&path).unwrap();
    assert_eq!(
        reopened.applied_migrations().unwrap(),
        vec![1, 2, LATEST_MIGRATION_VERSION]
    );
    assert_eq!(
        reopened.projects().get(&project.id).unwrap().name,
        "Legacy project"
    );
    let jobs = reopened.jobs().list(&project.id).unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].id, "legacy-job");
    assert_eq!(jobs[0].status, JobStatus::Succeeded);
    assert_eq!(jobs[0].attempt, 0);
    assert_eq!(jobs[0].input_digest, "legacy:legacy-job");
    assert_eq!(jobs[0].artifact_path.as_deref(), Some("/tmp/legacy.mp4"));
    drop(reopened);

    let mut reopened_again = Database::open(&path).unwrap();
    assert_eq!(
        reopened_again.applied_migrations().unwrap(),
        vec![1, 2, LATEST_MIGRATION_VERSION]
    );
    assert_eq!(
        reopened_again.projects().get(&project.id).unwrap().name,
        "Legacy project"
    );
    assert_eq!(
        reopened_again.jobs().list(&project.id).unwrap()[0].id,
        "legacy-job"
    );
}

#[test]
fn conflicting_migration_metadata_is_rejected_without_bootstrapping_tables() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);\
         INSERT INTO schema_migrations (version, applied_at) VALUES (0, 'test');\
         PRAGMA user_version = 1;",
    ).unwrap();
    drop(connection);

    let error = open_error(&path);
    assert!(
        matches!(error, CoreError::InvalidInput(message) if message.contains("inconsistent schema migration metadata"))
    );

    let connection = rusqlite::Connection::open(&path).unwrap();
    let projects_exists: i64 = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(projects_exists, 0);
}

#[test]
fn failed_initial_schema_ddl_rolls_back_metadata_and_preserves_unrelated_objects() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE keep_me (value TEXT NOT NULL);\
             INSERT INTO keep_me (value) VALUES ('preserve me');\
             CREATE VIEW assets AS SELECT 1 AS placeholder;",
        )
        .unwrap();
    drop(connection);

    let error = open_error(&path);
    assert!(matches!(error, CoreError::Sqlite(_)));

    let connection = rusqlite::Connection::open(&path).unwrap();
    let schema_migrations_exists: i64 = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(schema_migrations_exists, 0);
    let core_tables: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('projects', 'assets', 'compositions', 'tracks', 'clips', 'revisions', 'operation_receipts', 'jobs')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(core_tables, 0);
    let user_version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(user_version, 0);
    let assets_type: String = connection
        .query_row(
            "SELECT type FROM sqlite_master WHERE name = 'assets'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(assets_type, "view");
    let preserved_value: String = connection
        .query_row("SELECT value FROM keep_me", [], |row| row.get(0))
        .unwrap();
    assert_eq!(preserved_value, "preserve me");
}

#[test]
fn canonical_parent_alias_targets_the_same_locked_database() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let owner = Database::open(&path).unwrap();
    let alias = directory
        .path()
        .join(".cutroom")
        .join("nested")
        .join("..")
        .join("project.cutroom");

    let error = open_error(&alias);
    assert!(matches!(error, CoreError::ProjectLocked(_)));
    drop(owner);
    Database::open(&alias).unwrap();
}

#[cfg(target_os = "macos")]
#[test]
fn macos_private_tmp_alias_is_accepted_and_shares_writer_lock() {
    let directory = TempDir::new_in("/tmp").unwrap();
    let path = database_path(&directory);
    let owner = Database::open(&path).unwrap();
    let relative = path.strip_prefix("/tmp").unwrap();
    let alias = std::path::Path::new("/private/tmp").join(relative);

    let error = open_error(&alias);
    assert!(matches!(error, CoreError::ProjectLocked(_)));
    drop(owner);
    Database::open(&alias).unwrap();
}

#[cfg(unix)]
#[test]
fn symlinked_database_ancestor_is_rejected_fail_closed() {
    use std::os::unix::fs::symlink;

    let directory = TempDir::new().unwrap();
    let real_parent = directory.path().join("real");
    let real_path = real_parent.join("project.cutroom");
    std::fs::create_dir_all(&real_parent).unwrap();
    drop(Database::open(&real_path).unwrap());

    let alias_parent = directory.path().join("alias");
    symlink(&real_parent, &alias_parent).unwrap();
    let error = open_error(alias_parent.join("project.cutroom"));
    assert!(matches!(error, CoreError::InvalidInput(message) if message.contains("symlink")));
}

#[test]
fn rejected_open_preserves_unrelated_project_files() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let unrelated = directory.path().join("notes.txt");
    std::fs::write(&unrelated, b"do not remove").unwrap();
    let owner = Database::open(&path).unwrap();
    let error = open_error(&path);
    assert!(matches!(error, CoreError::ProjectLocked(_)));
    assert_eq!(std::fs::read(&unrelated).unwrap(), b"do not remove");
    drop(owner);
}

#[test]
fn rational_validation_handles_zero_denominator_negative_ticks_and_i64_maxima() {
    assert!(matches!(
        RationalTimeBase::new(1, 0),
        Err(CoreError::InvalidTime(_))
    ));
    assert!(matches!(
        RationalTime::from_ticks(-1, RationalTimeBase::new(1, 48_000).unwrap()),
        Err(CoreError::InvalidTime(_))
    ));

    let maximum_base = RationalTimeBase::new(i64::MAX, i64::MAX).unwrap();
    let maximum = RationalTime::from_ticks(i128::MAX, maximum_base.clone()).unwrap();
    assert_eq!(
        maximum.compare_checked(&maximum).unwrap(),
        std::cmp::Ordering::Equal
    );
    assert_eq!(
        maximum.exact_ticks_in(&maximum_base).unwrap(),
        i128::MAX.to_string()
    );

    let overflowing = time(i128::MAX, i64::MAX, 1);
    let tiny = time(1, 1, i64::MAX);
    assert!(matches!(
        overflowing.compare_checked(&tiny),
        Err(CoreError::ArithmeticOverflow)
    ));
}

#[test]
fn exact_source_boundary_is_accepted_and_one_tick_over_is_rejected() {
    let directory = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&directory)).unwrap();
    let project = database
        .projects()
        .create(project_input("Boundary", "/work/boundary"))
        .unwrap();
    let asset = create_asset(&mut database, &project.id);
    let composition = database.compositions().get(&project.id).unwrap();
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

    let make_clip = |id: &str, out: i128| ClipInput {
        id: Some(id.into()),
        track_id: "track-1".into(),
        asset_id: asset.id.clone(),
        name: id.into(),
        in_time: time(0, 1, 48_000),
        out_time: time(out, 1, 48_000),
        timeline_start: time(0, 1, 48_000),
        timeline_duration: time(out, 1, 48_000),
        sort_order: 0,
    };

    database
        .compositions()
        .apply_mutation(
            &project.id,
            &current.id,
            &Uuid::new_v4().to_string(),
            current.version,
            &CompositionMutation {
                operations: vec![TimelineOperation::AddClip {
                    clip: make_clip("exact", 3_000),
                }],
            },
        )
        .unwrap();
    let after_exact = database.compositions().get(&project.id).unwrap();
    assert_eq!(after_exact.duration_ticks, "3000");

    let error = database
        .compositions()
        .apply_mutation(
            &project.id,
            &after_exact.id,
            &Uuid::new_v4().to_string(),
            after_exact.version,
            &CompositionMutation {
                operations: vec![TimelineOperation::AddClip {
                    clip: make_clip("over", 3_001),
                }],
            },
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::InvalidSourceRange { .. }));
    let unchanged = database.compositions().get(&project.id).unwrap();
    assert_eq!(unchanged.version, after_exact.version);
    assert_eq!(unchanged.clips.len(), 1);
}

#[test]
fn derived_duration_and_reorder_preserve_each_clip_source_identity() {
    let directory = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&directory)).unwrap();
    let project = database
        .projects()
        .create(project_input("Derived", "/work/derived"))
        .unwrap();
    let first_asset = create_asset(&mut database, &project.id);
    let second_asset = create_asset(&mut database, &project.id);
    let composition = database.compositions().get(&project.id).unwrap();
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

    let make_clip =
        |id: &str, asset_id: &str, input: i128, output: i128, start: i128, sort_order: i64| {
            ClipInput {
                id: Some(id.into()),
                track_id: "track-1".into(),
                asset_id: asset_id.into(),
                name: id.into(),
                in_time: time(input, 1, 48_000),
                out_time: time(output, 1, 48_000),
                timeline_start: time(start, 1, 48_000),
                timeline_duration: time(output - input, 1, 48_000),
                sort_order,
            }
        };
    database
        .compositions()
        .apply_mutation(
            &project.id,
            &current.id,
            &Uuid::new_v4().to_string(),
            current.version,
            &CompositionMutation {
                operations: vec![
                    TimelineOperation::AddClip {
                        clip: make_clip("clip-a", &first_asset.id, 0, 1_000, 0, 0),
                    },
                    TimelineOperation::AddClip {
                        clip: make_clip("clip-b", &second_asset.id, 500, 2_500, 1_000, 1),
                    },
                ],
            },
        )
        .unwrap();
    let after_add = database.compositions().get(&project.id).unwrap();
    assert_eq!(after_add.duration_ticks, "3000");
    assert_eq!(
        after_add
            .clips
            .iter()
            .map(|clip| clip.asset_id.as_str())
            .collect::<Vec<_>>(),
        vec![first_asset.id.as_str(), second_asset.id.as_str()]
    );

    let reordered = database
        .compositions()
        .apply_mutation(
            &project.id,
            &after_add.id,
            &Uuid::new_v4().to_string(),
            after_add.version,
            &CompositionMutation {
                operations: vec![
                    TimelineOperation::UpdateClip {
                        clip: make_clip("clip-a", &first_asset.id, 0, 1_000, 0, 1),
                    },
                    TimelineOperation::UpdateClip {
                        clip: make_clip("clip-b", &second_asset.id, 500, 2_500, 1_000, 0),
                    },
                ],
            },
        )
        .unwrap();
    assert_eq!(reordered.composition.duration_ticks, "3000");
    assert_eq!(
        reordered
            .composition
            .clips
            .iter()
            .map(|clip| clip.id.as_str())
            .collect::<Vec<_>>(),
        vec!["clip-b", "clip-a"]
    );
    assert_eq!(
        reordered
            .composition
            .clips
            .iter()
            .map(|clip| clip.asset_id.as_str())
            .collect::<Vec<_>>(),
        vec![second_asset.id.as_str(), first_asset.id.as_str()]
    );
}

#[test]
fn revisions_keep_old_snapshots_and_define_duplicate_save_parentage() {
    let directory = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&directory)).unwrap();
    let project = database
        .projects()
        .create(project_input("History", "/work/history"))
        .unwrap();
    let composition = database.compositions().get(&project.id).unwrap();
    let first = database
        .revisions()
        .create(&project.id, &composition.id, "empty", "tester")
        .unwrap();

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
    let second = database
        .revisions()
        .create(&project.id, &composition.id, "track", "tester")
        .unwrap();
    let duplicate = database
        .revisions()
        .create(&project.id, &composition.id, "same state", "tester")
        .unwrap();
    assert_eq!(first.revision_number, 1);
    assert_eq!(second.revision_number, 2);
    assert_eq!(duplicate.revision_number, 3);
    assert_eq!(
        second.parent_revision_id.as_deref(),
        Some(first.id.as_str())
    );
    assert_eq!(
        duplicate.parent_revision_id.as_deref(),
        Some(second.id.as_str())
    );
    assert_eq!(duplicate.content_hash, second.content_hash);

    let first_before_edit = database.revisions().get(&project.id, &first.id).unwrap();
    database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &Uuid::new_v4().to_string(),
            2,
            &add_track("track-2"),
        )
        .unwrap();
    let first_after_edit = database.revisions().get(&project.id, &first.id).unwrap();
    assert_eq!(first_after_edit, first_before_edit);
    assert!(first_after_edit.composition_snapshot.tracks.is_empty());
}

#[test]
fn failed_mutation_rolls_back_and_allows_same_operation_id_retry() {
    let directory = TempDir::new().unwrap();
    let mut database = Database::open(database_path(&directory)).unwrap();
    let project = database
        .projects()
        .create(project_input("Retry", "/work/retry"))
        .unwrap();
    let asset = create_asset(&mut database, &project.id);
    let composition = database.compositions().get(&project.id).unwrap();
    let operation_id = Uuid::new_v4().to_string();
    let invalid = CompositionMutation {
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
                clip: source_clip("track-1", &asset.id, 3_001),
            },
        ],
    };
    assert!(matches!(
        database.compositions().apply_mutation(
            &project.id,
            &composition.id,
            &operation_id,
            1,
            &invalid
        ),
        Err(CoreError::InvalidSourceRange { .. })
    ));

    let retry = database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &operation_id,
            1,
            &add_track("track-1"),
        )
        .unwrap();
    assert!(!retry.replayed);
    assert_eq!(retry.composition.version, 2);
    let replay = database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &operation_id,
            1,
            &add_track("track-1"),
        )
        .unwrap();
    assert!(replay.replayed);
}

#[test]
fn concurrent_duplicate_operations_serialize_to_one_commit_and_one_replay() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let mut database = Database::open(&path).unwrap();
    let project = database
        .projects()
        .create(project_input("Concurrent", "/work/concurrent"))
        .unwrap();
    let composition = database.compositions().get(&project.id).unwrap();
    let shared = std::sync::Arc::new(std::sync::Mutex::new(database));
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let operation_id = Uuid::new_v4().to_string();
    let mutation = add_track("track-concurrent");

    let mut handles = Vec::new();
    for _ in 0..2 {
        let shared = std::sync::Arc::clone(&shared);
        let barrier = std::sync::Arc::clone(&barrier);
        let project_id = project.id.clone();
        let composition_id = composition.id.clone();
        let operation_id = operation_id.clone();
        let mutation = mutation.clone();
        handles.push(std::thread::spawn(move || {
            barrier.wait();
            let mut database = shared.lock().unwrap();
            database
                .compositions()
                .apply_mutation(&project_id, &composition_id, &operation_id, 1, &mutation)
                .map(|result| result.replayed)
                .map_err(|error| error.to_string())
        }));
    }
    barrier.wait();

    let first = handles.remove(0).join().unwrap().unwrap();
    let second = handles.remove(0).join().unwrap().unwrap();
    assert_ne!(first, second);
    assert_eq!(
        [first, second]
            .into_iter()
            .filter(|replayed| *replayed)
            .count(),
        1
    );
    let mut database = shared.lock().unwrap();
    assert_eq!(database.compositions().get(&project.id).unwrap().version, 2);
}

#[test]
fn companion_writer_lock_inode_persists_after_close() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let database = Database::open(&path).unwrap();
    let lock_path = database.lock_path();
    assert!(lock_path.exists());
    drop(database);
    assert!(lock_path.is_file());
    Database::open(&path).unwrap();
}

#[cfg(unix)]
#[test]
fn companion_writer_lock_symlink_is_rejected_fail_closed() {
    use std::os::unix::fs::symlink;

    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let database = Database::open(&path).unwrap();
    let lock_path = database.lock_path();
    drop(database);
    fs::remove_file(&lock_path).unwrap();
    let target = directory.path().join("unrelated-lock-target");
    fs::write(&target, b"not a lock").unwrap();
    symlink(&target, &lock_path).unwrap();

    let error = open_error(&path);
    assert!(
        matches!(error, CoreError::InvalidInput(message) if message.contains("writer lock") && message.contains("symlink"))
    );
}

#[cfg(unix)]
#[test]
fn companion_writer_lock_hardlink_is_rejected_fail_closed() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let database = Database::open(&path).unwrap();
    let lock_path = database.lock_path();
    drop(database);
    let alias = directory.path().join("project.writer.lock.alias");
    fs::hard_link(&lock_path, &alias).unwrap();

    let error = open_error(&path);
    assert!(
        matches!(error, CoreError::InvalidInput(message) if message.contains("hard-linked") && message.contains("writer lock"))
    );
}

#[test]
fn native_receipt_write_failure_rolls_back_project_creation() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    drop(Database::open(&path).unwrap());
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER reject_native_project_receipt
             BEFORE INSERT ON native_operation_receipts
             BEGIN
                 SELECT RAISE(ABORT, 'test receipt write rejection');
             END;",
        )
        .unwrap();
    drop(connection);

    let mut database = Database::open(&path).unwrap();
    let receipt = NativeReceipt::new(
        Uuid::new_v4().to_string(),
        "project.create".into(),
        None,
        "receipt-write-failure".into(),
    );
    let error = database
        .projects()
        .create_with_native_receipt(
            project_input("Atomic failure", "/work/atomic"),
            &receipt,
            |_| serde_json::json!({ "id": "must-not-commit" }),
        )
        .unwrap_err();
    assert!(error.to_string().contains("test receipt write rejection"));
    assert!(database.projects().list().unwrap().is_empty());
}

#[test]
fn native_receipt_write_failure_rolls_back_asset_publication() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let mut database = Database::open(&path).unwrap();
    let project = database
        .projects()
        .create(project_input("Atomic asset", "/work/atomic-asset"))
        .unwrap();
    drop(database);

    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER reject_native_asset_receipt
             BEFORE INSERT ON native_operation_receipts
             BEGIN
                 SELECT RAISE(ABORT, 'test asset receipt write rejection');
             END;",
        )
        .unwrap();
    drop(connection);

    let mut database = Database::open(&path).unwrap();
    let receipt = NativeReceipt::new(
        Uuid::new_v4().to_string(),
        "asset.import".into(),
        Some(project.id.clone()),
        "asset-receipt-write-failure".into(),
    );
    let error = database
        .assets()
        .create_with_native_receipt(
            AssetInput {
                project_id: project.id.clone(),
                name: "source.mov".into(),
                path: "/work/source.mov".into(),
                size_bytes: 1,
                duration: time(3_000, 1, 48_000),
                width: 1,
                height: 1,
                format: "mov".into(),
                codec: "h264".into(),
                audio_channels: 0,
                import_type: "linked".into(),
                sha256: Some("source-hash".into()),
            },
            &receipt,
            |_| serde_json::json!({ "id": "must-not-commit" }),
        )
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("test asset receipt write rejection")
    );
    assert!(database.assets().list(&project.id).unwrap().is_empty());
}
