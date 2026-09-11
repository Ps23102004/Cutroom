use cutroom_core::*;
use rusqlite::{Connection, params};
use tempfile::TempDir;

fn database_path(dir: &TempDir) -> std::path::PathBuf {
    dir.path().join(".cutroom").join("project.cutroom")
}

fn project_input() -> ProjectInput {
    ProjectInput {
        name: "Genuine v1".into(),
        path: "/work/genuine-v1".into(),
        aspect_ratio: "16:9".into(),
        fps: RationalTimeBase::new(24, 1).unwrap(),
    }
}

fn install_true_v1_jobs(connection: &Connection) {
    connection
        .execute_batch(
            "DROP TABLE jobs;
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
}

#[test]
fn genuine_v1_jobs_and_only_marker_one_upgrade_all_stages_to_latest() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let project = {
        let mut database = Database::open(&path).unwrap();
        database.projects().create(project_input()).unwrap()
    };

    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "DELETE FROM schema_migrations WHERE version > 1;
             DROP TABLE native_operation_receipts;
             PRAGMA user_version = 1;",
        )
        .unwrap();
    install_true_v1_jobs(&connection);
    connection
        .execute(
            "INSERT INTO jobs (id, project_id, title, kind, status, step, current_step, total_steps, error, output_path, created_at, updated_at) VALUES (?1, ?2, 'Legacy render', 'render', 'completed', 'encode', 4, 4, NULL, '/tmp/legacy.mp4', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z')",
            params!["legacy-job", project.id],
        )
        .unwrap();
    drop(connection);

    let mut reopened = Database::open(&path).unwrap();
    assert_eq!(reopened.applied_migrations().unwrap(), vec![1, 2, 3]);
    assert_eq!(
        reopened.projects().get(&project.id).unwrap().name,
        "Genuine v1"
    );
    let jobs = reopened.jobs().list(&project.id).unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].status, JobStatus::Succeeded);
    assert_eq!(jobs[0].input_digest, "legacy:legacy-job");
    drop(reopened);

    let mut reopened_again = Database::open(&path).unwrap();
    assert_eq!(reopened_again.applied_migrations().unwrap(), vec![1, 2, 3]);
    assert_eq!(
        reopened_again.projects().get(&project.id).unwrap().name,
        "Genuine v1"
    );
    let jobs_again = reopened_again.jobs().list(&project.id).unwrap();
    assert_eq!(jobs_again.len(), 1);
    assert_eq!(jobs_again[0].id, "legacy-job");
    assert_eq!(jobs_again[0].status, JobStatus::Succeeded);
    assert_eq!(jobs_again[0].input_digest, "legacy:legacy-job");
    assert_eq!(
        jobs_again[0].artifact_path.as_deref(),
        Some("/tmp/legacy.mp4")
    );
}

#[test]
fn unproven_v1_marker_with_v3_schema_is_rejected_without_mutation() {
    let directory = TempDir::new().unwrap();
    let path = database_path(&directory);
    let project = {
        let mut database = Database::open(&path).unwrap();
        database.projects().create(project_input()).unwrap()
    };

    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "DELETE FROM schema_migrations WHERE version = 2;
             PRAGMA user_version = 1;",
        )
        .unwrap();
    drop(connection);

    let error = match Database::open(&path) {
        Ok(_) => panic!("unproven [1,3]/user_version=1 metadata unexpectedly opened"),
        Err(error) => error,
    };
    assert!(matches!(
        error,
        CoreError::InvalidInput(message) if message.contains("conflicts with migration metadata")
    ));

    let connection = Connection::open(&path).unwrap();
    let migrations: Vec<i64> = {
        let mut statement = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .unwrap();
        statement
            .query_map([], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap()
    };
    assert_eq!(migrations, vec![1, 3]);
    let user_version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(user_version, 1);
    let native_receipts_exists: i64 = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'native_operation_receipts')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(native_receipts_exists, 1);
    let job_columns: Vec<String> = {
        let mut statement = connection.prepare("PRAGMA table_info(jobs)").unwrap();
        statement
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap()
    };
    assert!(job_columns.iter().any(|column| column == "input_json"));
    assert_eq!(
        connection
            .query_row(
                "SELECT name FROM projects WHERE id = ?1",
                params![project.id],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "Genuine v1"
    );
}
