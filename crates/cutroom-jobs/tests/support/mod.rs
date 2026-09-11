use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

use cutroom_core::{
    Asset, AssetInput, ClipInput, CompositionMutation, Database, Project, ProjectInput,
    RationalTime, RationalTimeBase, Revision, TimelineOperation, TrackInput,
};
use cutroom_media::{CancellationToken, MediaEngine};
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct TestDirectory {
    path: PathBuf,
}

impl TestDirectory {
    pub fn new() -> Self {
        let root = std::env::temp_dir();
        for _ in 0..128 {
            let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = root.join(format!(
                "cutroom-jobs-test-{}-{sequence}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Self { path },
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create test directory: {error}"),
            }
        }
        panic!("could not allocate jobs test directory");
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures")
        .join(name)
}

pub fn fixture_a() -> PathBuf {
    fixture("fixture_a.mp4")
}

pub fn fixture_b() -> PathBuf {
    fixture("fixture_b.mp4")
}

pub fn sha256(path: &Path) -> String {
    let output = Command::new("shasum")
        .args(["-a", "256"])
        .arg(path)
        .output()
        .unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .to_owned()
}

#[allow(dead_code)]
pub fn assert_artifact(path: &Path) {
    assert!(path.is_file(), "missing artifact: {}", path.display());
    let probe = MediaEngine::homebrew()
        .unwrap()
        .probe(path, &CancellationToken::new())
        .unwrap();
    assert_eq!((probe.video.width, probe.video.height), (1920, 1080));
    assert_eq!(probe.video.codec, "h264");
    assert_eq!(
        probe.audio.as_ref().map(|audio| audio.codec.as_str()),
        Some("aac")
    );
}

pub fn time(ticks: i128, numerator: i64, denominator: i64) -> RationalTime {
    RationalTime::from_ticks(
        ticks,
        RationalTimeBase::new(numerator, denominator).unwrap(),
    )
    .unwrap()
}

pub struct JobFixture {
    pub _directory: TestDirectory,
    pub database: Database,
    pub project: Project,
    #[allow(dead_code)]
    pub asset_a: Asset,
    #[allow(dead_code)]
    pub asset_b: Asset,
    pub revision: Revision,
}

pub fn setup_fixture() -> JobFixture {
    let directory = TestDirectory::new();
    let database_path = directory.path().join("project.cutroom");
    let mut database = Database::open(database_path).unwrap();
    let project = database
        .projects()
        .create(ProjectInput {
            name: "Jobs test project".into(),
            path: directory.path().display().to_string(),
            aspect_ratio: "16:9".into(),
            fps: RationalTimeBase::new(24, 1).unwrap(),
        })
        .unwrap();

    let make_asset = |database: &mut Database, name: &str, path: PathBuf| {
        let size_bytes = fs::metadata(&path).unwrap().len() as i64;
        database
            .assets()
            .create(AssetInput {
                project_id: project.id.clone(),
                name: name.into(),
                path: path.display().to_string(),
                size_bytes,
                duration: time(61_440, 1, 12_288),
                width: 1920,
                height: 1080,
                format: "mp4".into(),
                codec: "h264".into(),
                audio_channels: 1,
                import_type: "linked".into(),
                sha256: Some(sha256(&path)),
            })
            .unwrap()
    };
    let asset_a = make_asset(&mut database, "fixture_a.mp4", fixture_a());
    let asset_b = make_asset(&mut database, "fixture_b.mp4", fixture_b());
    let composition = database.compositions().get(&project.id).unwrap();
    database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &uuid::Uuid::new_v4().to_string(),
            composition.version,
            &CompositionMutation {
                operations: vec![TimelineOperation::AddTrack {
                    track: TrackInput {
                        id: Some("primary".into()),
                        kind: "primary_video".into(),
                        label: "V1".into(),
                        sort_order: 0,
                        is_muted: false,
                        is_locked: false,
                    },
                }],
            },
        )
        .unwrap();
    let composition = database.compositions().get(&project.id).unwrap();
    let clip = |id: &str, asset_id: &str, start: i128| ClipInput {
        id: Some(id.into()),
        track_id: "primary".into(),
        asset_id: asset_id.into(),
        name: id.into(),
        in_time: time(0, 1, 12_288),
        out_time: time(24_576, 1, 12_288),
        timeline_start: time(start, 1, 48_000),
        timeline_duration: time(96_000, 1, 48_000),
        sort_order: if start == 0 { 0 } else { 1 },
    };
    database
        .compositions()
        .apply_mutation(
            &project.id,
            &composition.id,
            &uuid::Uuid::new_v4().to_string(),
            composition.version,
            &CompositionMutation {
                operations: vec![
                    TimelineOperation::AddClip {
                        clip: clip("clip-a", &asset_a.id, 0),
                    },
                    TimelineOperation::AddClip {
                        clip: clip("clip-b", &asset_b.id, 96_000),
                    },
                ],
            },
        )
        .unwrap();
    let composition = database.compositions().get(&project.id).unwrap();
    let revision = database
        .revisions()
        .create(
            &project.id,
            &composition.id,
            "jobs test revision",
            "jobs-tests",
        )
        .unwrap();

    JobFixture {
        _directory: directory,
        database,
        project,
        asset_a,
        asset_b,
        revision,
    }
}
