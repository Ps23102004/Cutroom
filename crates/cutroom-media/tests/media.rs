mod support;

use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

use cutroom_media::{
    CancellationToken, MediaEngine, MediaError, RationalTime, RationalTimeBase, SourceRange,
    TwoClipRenderRequest,
};
use support::{
    assert_fixture_unchanged, fixture_a, fixture_b, frame_rgb, frequency_power,
    mean_abs_frame_delta, probe_json, sha256, strict_decode,
};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

struct TestDirectory {
    path: PathBuf,
}

impl TestDirectory {
    fn new() -> Self {
        let root = std::env::temp_dir();
        for _ in 0..128 {
            let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = root.join(format!(
                "cutroom-media-test-{}-{sequence}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Self { path },
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create test directory: {error}"),
            }
        }
        panic!("could not allocate test directory");
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn time(ticks: i128, numerator: i64, denominator: i64) -> RationalTime {
    RationalTime::from_ticks(
        ticks,
        RationalTimeBase::new(numerator, denominator).unwrap(),
    )
    .unwrap()
}

fn seconds(value: i128) -> RationalTime {
    time(value, 1, 1)
}

fn range(source: &Path, start: RationalTime, end: RationalTime) -> SourceRange {
    SourceRange {
        source: source.to_path_buf(),
        expected_sha256: sha256(source),
        start,
        end,
    }
}

fn request(first: SourceRange, second: SourceRange, destination: PathBuf) -> TwoClipRenderRequest {
    TwoClipRenderRequest {
        clips: [first, second],
        destination,
    }
}

fn engine() -> MediaEngine {
    MediaEngine::discover().unwrap()
}

fn token() -> CancellationToken {
    CancellationToken::new()
}

#[test]
fn probe_reports_full_fixture_metadata_and_strict_decode() {
    let engine = engine();
    for source in [fixture_a(), fixture_b()] {
        let cancellation = token();
        let probe = engine.probe(&source, &cancellation).unwrap();
        assert_eq!(probe.source, fs::canonicalize(&source).unwrap());
        assert_eq!(probe.sha256, sha256(&source));
        assert_eq!(probe.video.codec, "h264");
        assert_eq!((probe.video.width, probe.video.height), (1920, 1080));
        assert_eq!(probe.video.pixel_format, "yuv420p");
        assert_eq!(probe.video.rotation_degrees, 0);
        assert_eq!(probe.video.duration.ticks_i128().unwrap(), 61_440);
        assert_eq!(
            probe.video.duration.time_base,
            RationalTimeBase::new(1, 12_288).unwrap()
        );
        assert_eq!(
            probe.video.time_base,
            RationalTimeBase::new(1, 12_288).unwrap()
        );
        assert_eq!(
            probe.video.frame_rate,
            RationalTimeBase::new(24, 1).unwrap()
        );
        assert!(probe.video.color.color_space.is_none());
        assert!(probe.video.color.color_transfer.is_none());
        assert!(probe.video.color.color_primaries.is_none());

        let audio = probe.audio.expect("fixture must contain audio");
        assert_eq!(audio.codec, "aac");
        assert_eq!(audio.channels, 1);
        assert_eq!(audio.sample_rate, 48_000);
        assert_eq!(audio.duration.ticks_i128().unwrap(), 240_000);
        assert_eq!(audio.time_base, RationalTimeBase::new(1, 48_000).unwrap());
        strict_decode(&source);

        let raw = probe_json(&source);
        assert_eq!(raw["format"]["nb_streams"], 2);
        assert_eq!(raw["streams"][0]["codec_name"], "h264");
        assert_eq!(raw["streams"][1]["codec_name"], "aac");
    }
}

#[test]
fn render_preserves_exact_order_trim_audio_and_visible_timecode() {
    let directory = TestDirectory::new();
    let destination = directory.path().join("ordered.mp4");
    let source_a = fixture_a();
    let source_b = fixture_b();
    let artifact = engine()
        .render_1080p_sdr(
            &request(
                range(&source_b, seconds(1), seconds(3)),
                range(&source_a, seconds(2), seconds(4)),
                destination.clone(),
            ),
            &token(),
        )
        .unwrap();

    assert_eq!(artifact.path, destination);
    assert_eq!(
        artifact.probe.source,
        fs::canonicalize(&destination).unwrap()
    );
    assert!(artifact.probe.source.is_file());
    assert_eq!(artifact.sha256, sha256(&destination));
    assert_eq!(artifact.probe.video.duration.ticks_i128().unwrap(), 49_152);
    assert_eq!(
        artifact.probe.video.duration.time_base,
        RationalTimeBase::new(1, 12_288).unwrap()
    );
    assert_eq!(
        artifact
            .probe
            .audio
            .as_ref()
            .unwrap()
            .duration
            .ticks_i128()
            .unwrap(),
        192_000
    );
    assert_eq!(
        artifact.probe.audio.as_ref().unwrap().time_base,
        RationalTimeBase::new(1, 48_000).unwrap()
    );
    assert_eq!(
        (artifact.probe.video.width, artifact.probe.video.height),
        (1920, 1080)
    );
    assert_eq!(artifact.probe.video.codec, "h264");
    assert_eq!(artifact.probe.video.pixel_format, "yuv420p");
    assert_eq!(artifact.probe.audio.as_ref().unwrap().codec, "aac");
    strict_decode(&destination);

    let first_segment_880 = frequency_power(&destination, 880.0, 0.5, 0.75);
    let first_segment_440 = frequency_power(&destination, 440.0, 0.5, 0.75);
    let second_segment_440 = frequency_power(&destination, 440.0, 2.5, 0.75);
    let second_segment_880 = frequency_power(&destination, 880.0, 2.5, 0.75);
    assert!(first_segment_880 > first_segment_440 * 4.0);
    assert!(second_segment_440 > second_segment_880 * 4.0);

    let first_frame = frame_rgb(&destination, 0.5);
    let second_frame = frame_rgb(&destination, 2.5);
    let expected_first_frame = frame_rgb(&source_b, 1.5);
    let expected_second_frame = frame_rgb(&source_a, 2.5);
    assert!(mean_abs_frame_delta(&first_frame, &expected_first_frame) < 12.0);
    assert!(mean_abs_frame_delta(&second_frame, &expected_second_frame) < 12.0);
    assert_fixture_unchanged(&source_a);
    assert_fixture_unchanged(&source_b);
}

#[test]
fn exact_full_source_boundaries_render_without_rounding() {
    let directory = TestDirectory::new();
    let destination = directory.path().join("full-boundaries.mp4");
    let source_a = fixture_a();
    let source_b = fixture_b();
    let artifact = engine()
        .render_1080p_sdr(
            &request(
                range(&source_a, seconds(0), seconds(5)),
                range(&source_b, seconds(0), seconds(5)),
                destination,
            ),
            &token(),
        )
        .unwrap();
    assert_eq!(artifact.probe.video.duration.ticks_i128().unwrap(), 122_880);
    assert_eq!(
        artifact
            .probe
            .audio
            .as_ref()
            .unwrap()
            .duration
            .ticks_i128()
            .unwrap(),
        480_000
    );
}

#[test]
fn invalid_ranges_are_typed_and_leave_no_output() {
    let source_a = fixture_a();
    let source_b = fixture_b();
    let cases = [
        ("zero", seconds(2), seconds(2)),
        ("reversed", seconds(3), seconds(2)),
        ("out-of-bounds", seconds(4), seconds(6)),
        ("unrepresentable", time(1, 1, 25), time(2, 1, 25)),
    ];
    for (name, start, end) in cases {
        let directory = TestDirectory::new();
        let destination = directory.path().join(format!("{name}.mp4"));
        let error = engine()
            .render_1080p_sdr(
                &request(
                    range(&source_a, start, end),
                    range(&source_b, seconds(0), seconds(1)),
                    destination.clone(),
                ),
                &token(),
            )
            .unwrap_err();
        assert!(
            matches!(
                error,
                MediaError::InvalidRange { .. } | MediaError::UnsupportedMedia(_)
            ),
            "{name}: {error:?}"
        );
        assert!(
            !destination.exists(),
            "failed render left output for {name}"
        );
    }
}

#[test]
fn destination_no_clobber_and_source_aliases_are_rejected() {
    let source_a = fixture_a();
    let source_b = fixture_b();
    let directory = TestDirectory::new();
    let destination = directory.path().join("existing.mp4");
    fs::write(&destination, b"do not replace").unwrap();
    let error = engine()
        .render_1080p_sdr(
            &request(
                range(&source_a, seconds(0), seconds(1)),
                range(&source_b, seconds(0), seconds(1)),
                destination.clone(),
            ),
            &token(),
        )
        .unwrap_err();
    assert!(matches!(error, MediaError::DestinationExists(_)));
    assert_eq!(fs::read(&destination).unwrap(), b"do not replace");

    let error = engine()
        .render_1080p_sdr(
            &request(
                range(&source_a, seconds(0), seconds(1)),
                range(&source_b, seconds(0), seconds(1)),
                source_a.clone(),
            ),
            &token(),
        )
        .unwrap_err();
    assert!(matches!(error, MediaError::DestinationAliasesSource(_)));
    assert_fixture_unchanged(&source_a);
}

#[test]
fn shell_like_source_filename_is_file_data_not_a_command() {
    let directory = TestDirectory::new();
    let marker = directory.path().join("shell-pwned");
    let shell_named = directory.path().join("$(touch shell-pwned); source.mp4");
    fs::copy(fixture_a(), &shell_named).unwrap();
    let destination = directory.path().join("shell-name-output.mp4");
    let artifact = engine()
        .render_1080p_sdr(
            &request(
                range(&shell_named, seconds(0), seconds(1)),
                range(&fixture_b(), seconds(0), seconds(1)),
                destination,
            ),
            &token(),
        )
        .unwrap();
    assert!(artifact.path.exists());
    assert!(!marker.exists());
}

#[test]
fn playlist_content_disguised_as_mp4_is_rejected_without_nested_reads() {
    let directory = TestDirectory::new();
    let playlist = directory.path().join("disguised.mp4");
    let nested = fixture_a();
    fs::write(&playlist, format!("#EXTM3U\nfile://{}\n", nested.display())).unwrap();
    let destination = directory.path().join("playlist-output.mp4");
    let error = engine()
        .render_1080p_sdr(
            &request(
                range(&playlist, seconds(0), seconds(1)),
                range(&fixture_b(), seconds(0), seconds(1)),
                destination.clone(),
            ),
            &token(),
        )
        .unwrap_err();
    assert!(
        matches!(
            error,
            MediaError::UnsupportedMedia(_) | MediaError::ProcessFailed { .. }
        ),
        "unexpected playlist error: {error:?}"
    );
    assert!(!destination.exists());
    assert_fixture_unchanged(&nested);
}

#[test]
fn disposable_source_integrity_mismatch_is_typed_and_preserves_fixtures() {
    let source_a = fixture_a();
    let source_b = fixture_b();
    let directory = TestDirectory::new();
    let disposable = directory.path().join("mutated.mp4");
    fs::copy(&source_a, &disposable).unwrap();
    let mut bytes = fs::read(&disposable).unwrap();
    let midpoint = bytes.len() / 2;
    bytes[midpoint] ^= 0x01;
    fs::write(&disposable, bytes).unwrap();
    let destination = directory.path().join("mismatch.mp4");
    let error = engine()
        .render_1080p_sdr(
            &request(
                SourceRange {
                    source: disposable.clone(),
                    expected_sha256: sha256(&source_a),
                    start: seconds(0),
                    end: seconds(1),
                },
                range(&source_b, seconds(0), seconds(1)),
                destination.clone(),
            ),
            &token(),
        )
        .unwrap_err();
    assert!(matches!(error, MediaError::SourceIdentityMismatch { .. }));
    assert!(!destination.exists());
    assert_fixture_unchanged(&source_a);
    assert_fixture_unchanged(&source_b);
}

#[test]
fn corrupt_input_and_pre_cancelled_render_clean_up_without_promotion() {
    let source_a = fixture_a();
    let source_b = fixture_b();
    let directory = TestDirectory::new();
    let corrupt = directory.path().join("corrupt.mp4");
    fs::copy(&source_a, &corrupt).unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&corrupt)
        .unwrap()
        .set_len(1_024)
        .unwrap();
    let corrupt_destination = directory.path().join("corrupt-output.mp4");
    let corrupt_error = engine()
        .render_1080p_sdr(
            &request(
                SourceRange {
                    source: corrupt.clone(),
                    expected_sha256: sha256(&corrupt),
                    start: seconds(0),
                    end: seconds(1),
                },
                range(&source_b, seconds(0), seconds(1)),
                corrupt_destination.clone(),
            ),
            &token(),
        )
        .unwrap_err();
    assert!(matches!(
        corrupt_error,
        MediaError::ProcessFailed { .. } | MediaError::UnsupportedMedia(_)
    ));
    assert!(!corrupt_destination.exists());

    let cancelled_destination = directory.path().join("cancelled.mp4");
    let cancellation = token();
    cancellation.cancel();
    let cancelled = engine()
        .render_1080p_sdr(
            &request(
                range(&source_a, seconds(0), seconds(1)),
                range(&source_b, seconds(0), seconds(1)),
                cancelled_destination.clone(),
            ),
            &cancellation,
        )
        .unwrap_err();
    assert!(matches!(cancelled, MediaError::Cancelled));
    assert!(!cancelled_destination.exists());
    let entries = fs::read_dir(directory.path()).unwrap().count();
    assert_eq!(entries, 1, "failed renders left temporary artifacts behind");
}

#[test]
fn in_flight_cancellation_after_owned_temp_creation_removes_partial_render() {
    let source_a = fixture_a();
    let source_b = fixture_b();
    let directory = TestDirectory::new();
    let parent = directory.path().to_path_buf();
    let destination = parent.join("cancelled-in-flight.mp4");
    let cancellation = CancellationToken::new();
    let worker_token = cancellation.clone();
    let worker_destination = destination.clone();
    let worker_source_a = source_a.clone();
    let worker_source_b = source_b.clone();
    let worker = thread::spawn(move || {
        engine().render_1080p_sdr(
            &request(
                range(&worker_source_a, seconds(0), seconds(5)),
                range(&worker_source_b, seconds(0), seconds(5)),
                worker_destination,
            ),
            &worker_token,
        )
    });

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut observed_owned_temp = false;
    while Instant::now() < deadline {
        observed_owned_temp = fs::read_dir(&parent).unwrap().flatten().any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".cutroom-media-render-")
                && entry.path().join("artifact.mp4").is_file()
        });
        if observed_owned_temp {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    if !observed_owned_temp {
        cancellation.cancel();
        let _ = worker.join();
        panic!("render did not create its owned temporary artifact within 5 seconds");
    }

    cancellation.cancel();
    let result = worker.join().unwrap();
    assert!(
        matches!(result, Err(MediaError::Cancelled)),
        "unexpected cancellation result: {result:?}"
    );
    assert!(!destination.exists());
    let leftovers: Vec<_> = fs::read_dir(&parent)
        .unwrap()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".cutroom-media-render-")
        })
        .collect();
    assert!(
        leftovers.is_empty(),
        "owned temporary render directory leaked"
    );
    assert_fixture_unchanged(&source_a);
    assert_fixture_unchanged(&source_b);
}
