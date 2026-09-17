//! True-media tests for the pro render pipeline: 4K/120fps input, H.265
//! 10-bit, HDR (PQ/HLG) tone mapping and HDR10 passthrough, log de-log,
//! custom .cube LUTs, per-clip grades, rotation normalization, and audio
//! normalization.

mod support;

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

use cutroom_media::{
    CancellationToken, InputColorSpace, LutSpec, MediaEngine, MediaError, OutputColor, OutputSpec,
    ProRenderRequest, RationalTime, RationalTimeBase, SourceRange, VideoCodec,
};
use support::{ffmpeg, probe_json, sha256};

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
                "cutroom-pro-test-{}-{sequence}",
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

fn engine() -> MediaEngine {
    MediaEngine::discover().unwrap()
}

fn token() -> CancellationToken {
    CancellationToken::new()
}

fn range(source: &Path, start: RationalTime, end: RationalTime) -> SourceRange {
    SourceRange::new(source.to_path_buf(), sha256(source), start, end)
}

fn neutral_range(source: &Path, start: RationalTime, end: RationalTime) -> SourceRange {
    range(source, start, end)
}

/// Generates a synthetic source clip with ffmpeg. `extra` holds additional
/// output flags (color tags, rotation metadata, audio overrides).
fn make_clip(
    directory: &Path,
    name: &str,
    width: u32,
    height: u32,
    fps: u32,
    seconds: f32,
    codec: &str,
    pix_fmt: &str,
    audio: &str,
    extra: &[&str],
) -> PathBuf {
    let path = directory.join(name);
    let mut command = Command::new(ffmpeg());
    command
        .args(["-hide_banner", "-loglevel", "error", "-nostdin"])
        .args([
            "-f",
            "lavfi",
            "-i",
            &format!("testsrc2=size={width}x{height}:rate={fps}:duration={seconds}"),
        ]);
    match audio {
        "sine48stereo" => {
            command.args([
                "-f",
                "lavfi",
                "-i",
                &format!("sine=frequency=440:duration={seconds}:sample_rate=48000"),
            ]);
        }
        "sine44mono" => {
            command.args([
                "-f",
                "lavfi",
                "-i",
                &format!("sine=frequency=330:duration={seconds}:sample_rate=44100"),
            ]);
        }
        "none" => {}
        other => panic!("unknown audio fixture {other}"),
    }
    command
        .args(["-c:v", codec, "-pix_fmt", pix_fmt, "-preset", "ultrafast"])
        .args(extra);
    match audio {
        "sine48stereo" => {
            command.args(["-c:a", "aac", "-ar", "48000", "-ac", "2"]);
        }
        "sine44mono" => {
            command.args(["-c:a", "aac", "-ar", "44100", "-ac", "1"]);
        }
        "none" => {
            command.arg("-an");
        }
        _ => unreachable!(),
    }
    command.args(["-shortest", "-f", "mp4"]).arg(&path);
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "fixture generation failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    path
}

fn sdr_clip(directory: &Path, name: &str, fps: u32, audio: &str) -> PathBuf {
    make_clip(
        directory,
        name,
        640,
        360,
        fps,
        1.0,
        "libx264",
        "yuv420p",
        audio,
        &[],
    )
}

fn pq_clip(directory: &Path, name: &str) -> PathBuf {
    make_clip(
        directory,
        name,
        640,
        360,
        30,
        1.0,
        "libx265",
        "yuv420p10le",
        "none",
        &[
            "-x265-params",
            "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc",
        ],
    )
}

fn hlg_clip(directory: &Path, name: &str) -> PathBuf {
    make_clip(
        directory,
        name,
        640,
        360,
        30,
        1.0,
        "libx265",
        "yuv420p10le",
        "none",
        &[
            "-x265-params",
            "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
        ],
    )
}

/// A flat mid-gray clip: ideal for measuring LUT/grade changes.
fn gray_clip(directory: &Path, name: &str, audio: &str) -> PathBuf {
    let path = directory.join(name);
    let mut command = Command::new(ffmpeg());
    command
        .args(["-hide_banner", "-loglevel", "error", "-nostdin"])
        .args([
            "-f",
            "lavfi",
            "-i",
            "color=size=640x360:rate=30:duration=1.0:color=0x808080",
        ]);
    if audio != "none" {
        command.args([
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1.0:sample_rate=48000",
        ]);
    }
    command.args([
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "ultrafast",
    ]);
    if audio == "none" {
        command.arg("-an");
    } else {
        command.args(["-c:a", "aac", "-ar", "48000", "-ac", "2"]);
    }
    command.args(["-shortest", "-f", "mp4"]).arg(&path);
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "gray fixture generation failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    path
}

fn request(
    first: SourceRange,
    second: SourceRange,
    destination: PathBuf,
    output: OutputSpec,
) -> ProRenderRequest {
    ProRenderRequest {
        clips: [first, second],
        output,
        destination,
    }
}

fn output_720p30_h264() -> OutputSpec {
    OutputSpec {
        width: 1280,
        height: 720,
        frame_rate: RationalTimeBase::new(30, 1).unwrap(),
        codec: VideoCodec::H264,
        color: OutputColor::SdrRec709,
    }
}

fn video_stream(path: &Path) -> serde_json::Value {
    let json = probe_json(path);
    json["streams"]
        .as_array()
        .unwrap()
        .iter()
        .find(|stream| stream["codec_type"] == "video")
        .unwrap()
        .clone()
}

fn audio_stream(path: &Path) -> Option<serde_json::Value> {
    probe_json(path)["streams"]
        .as_array()
        .unwrap()
        .iter()
        .find(|stream| stream["codec_type"] == "audio")
        .cloned()
}

fn frame_rgb_sized(path: &Path, timestamp_seconds: f32, width: usize, height: usize) -> Vec<u8> {
    let output = Command::new(ffmpeg())
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
        .arg(path)
        .args([
            "-ss",
            &format!("{timestamp_seconds:.6}"),
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "frame decode failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(output.stdout.len(), width * height * 3);
    output.stdout
}

fn mean_pixel(frame: &[u8]) -> f64 {
    frame.iter().map(|byte| f64::from(*byte)).sum::<f64>() / frame.len() as f64
}

fn mean_abs_delta(left: &[u8], right: &[u8]) -> f64 {
    assert_eq!(left.len(), right.len());
    left.iter()
        .zip(right)
        .map(|(a, b)| f64::from(a.abs_diff(*b)))
        .sum::<f64>()
        / left.len() as f64
}

fn write_cube(directory: &Path, name: &str, contents: &str) -> PathBuf {
    let path = directory.join(name);
    fs::write(&path, contents).unwrap();
    path
}

fn lut_spec(path: &Path) -> LutSpec {
    LutSpec {
        path: path.to_path_buf(),
        expected_sha256: sha256(path),
    }
}

const IDENTITY_CUBE: &str = r#"TITLE "identity 2^3"
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
"#;

/// Generates a 3D LUT applying a gamma lift (gamma < 1 brightens mid-tones).
fn gamma_cube(size: u32, gamma: f64) -> String {
    let mut text = format!(
        "TITLE \"gamma {gamma} lift\"\nLUT_3D_SIZE {size}\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n"
    );
    for b in 0..size {
        for g in 0..size {
            for r in 0..size {
                let lifted = [r, g, b]
                    .iter()
                    .map(|channel| {
                        let input = f64::from(*channel) / f64::from(size - 1);
                        input.powf(gamma).min(1.0)
                    })
                    .collect::<Vec<_>>();
                text.push_str(&format!(
                    "{:.6} {:.6} {:.6}\n",
                    lifted[0], lifted[1], lifted[2]
                ));
            }
        }
    }
    text
}

#[test]
fn pro_accepts_4k120_hevc10_input() {
    let directory = TestDirectory::new();
    // 60 frames of 4K HEVC 10-bit at 120 fps, no audio.
    let clip_a = make_clip(
        directory.path(),
        "a.mp4",
        3840,
        2160,
        120,
        0.5,
        "libx265",
        "yuv420p10le",
        "none",
        &[],
    );
    let clip_b = make_clip(
        directory.path(),
        "b.mp4",
        3840,
        2160,
        120,
        0.5,
        "libx265",
        "yuv420p10le",
        "none",
        &[],
    );
    let destination = directory.path().join("out.mp4");
    let artifact = engine()
        .render_pro(
            &request(
                range(&clip_a, seconds(0), time(2, 1, 5)),
                range(&clip_b, seconds(0), time(2, 1, 5)),
                destination.clone(),
                OutputSpec {
                    width: 1920,
                    height: 1080,
                    frame_rate: RationalTimeBase::new(24, 1).unwrap(),
                    codec: VideoCodec::H264,
                    color: OutputColor::SdrRec709,
                },
            ),
            &token(),
        )
        .unwrap();
    assert!(destination.exists());
    let video = video_stream(&destination);
    assert_eq!(video["width"], 1920);
    assert_eq!(video["height"], 1080);
    assert_eq!(video["avg_frame_rate"], "24/1");
    assert_eq!(video["codec_name"], "h264");
    assert_eq!(video["pix_fmt"], "yuv420p");
    assert_eq!(video["color_transfer"], "bt709");
    assert!(audio_stream(&destination).is_none());
    assert!(!artifact.config_digest.is_empty());
}

#[test]
fn pro_normalizes_mismatched_fps_and_audio() {
    let directory = TestDirectory::new();
    let clip_a = sdr_clip(directory.path(), "a.mp4", 30, "sine44mono");
    let clip_b = sdr_clip(directory.path(), "b.mp4", 24, "sine48stereo");
    let destination = directory.path().join("out.mp4");
    engine()
        .render_pro(
            &request(
                range(&clip_a, seconds(0), seconds(1)),
                range(&clip_b, seconds(0), seconds(1)),
                destination.clone(),
                output_720p30_h264(),
            ),
            &token(),
        )
        .unwrap();
    let video = video_stream(&destination);
    assert_eq!(video["width"], 1280);
    assert_eq!(video["height"], 720);
    assert_eq!(video["avg_frame_rate"], "30/1");
    let audio = audio_stream(&destination).expect("audio must be present");
    assert_eq!(audio["codec_name"], "aac");
    assert_eq!(audio["sample_rate"], "48000");
    assert_eq!(audio["channels"], 2);
}

#[test]
fn pro_rejects_audio_in_only_one_clip() {
    let directory = TestDirectory::new();
    let clip_a = sdr_clip(directory.path(), "a.mp4", 30, "sine48stereo");
    let clip_b = sdr_clip(directory.path(), "b.mp4", 30, "none");
    let destination = directory.path().join("out.mp4");
    let error = engine()
        .render_pro(
            &request(
                range(&clip_a, seconds(0), seconds(1)),
                range(&clip_b, seconds(0), seconds(1)),
                destination.clone(),
                output_720p30_h264(),
            ),
            &token(),
        )
        .unwrap_err();
    assert!(
        matches!(error, MediaError::UnsupportedMedia(_)),
        "unexpected error: {error:?}"
    );
    assert!(!destination.exists());
}

#[test]
fn pro_tonemaps_pq_and_hlg_to_sdr() {
    let directory = TestDirectory::new();
    for (label, first, second) in [
        (
            "pq",
            pq_clip(directory.path(), "pq_a.mp4"),
            pq_clip(directory.path(), "pq_b.mp4"),
        ),
        (
            "hlg",
            hlg_clip(directory.path(), "hlg_a.mp4"),
            hlg_clip(directory.path(), "hlg_b.mp4"),
        ),
    ] {
        let destination = directory.path().join(format!("{label}.mp4"));
        engine()
            .render_pro(
                &request(
                    range(&first, seconds(0), seconds(1)),
                    range(&second, seconds(0), seconds(1)),
                    destination.clone(),
                    output_720p30_h264(),
                ),
                &token(),
            )
            .unwrap();
        let video = video_stream(&destination);
        assert_eq!(
            video["color_transfer"], "bt709",
            "{label} was not tone-mapped to SDR"
        );
        assert_eq!(video["pix_fmt"], "yuv420p");
    }
}

#[test]
fn pro_hdr10_passthrough_preserves_pq_metadata() {
    let directory = TestDirectory::new();
    let clip_a = pq_clip(directory.path(), "a.mp4");
    let clip_b = pq_clip(directory.path(), "b.mp4");
    let destination = directory.path().join("hdr10.mp4");
    engine()
        .render_pro(
            &request(
                range(&clip_a, seconds(0), seconds(1)),
                range(&clip_b, seconds(0), seconds(1)),
                destination.clone(),
                OutputSpec {
                    width: 1280,
                    height: 720,
                    frame_rate: RationalTimeBase::new(30, 1).unwrap(),
                    codec: VideoCodec::H265,
                    color: OutputColor::Hdr10,
                },
            ),
            &token(),
        )
        .unwrap();
    let video = video_stream(&destination);
    assert_eq!(video["codec_name"], "hevc");
    assert_eq!(video["pix_fmt"], "yuv420p10le");
    assert_eq!(video["color_transfer"], "smpte2084");
    assert_eq!(video["color_primaries"], "bt2020");
}

#[test]
fn pro_hdr10_rejects_sdr_sources() {
    let directory = TestDirectory::new();
    let clip_a = sdr_clip(directory.path(), "a.mp4", 30, "none");
    let clip_b = sdr_clip(directory.path(), "b.mp4", 30, "none");
    let destination = directory.path().join("out.mp4");
    let error = engine()
        .render_pro(
            &request(
                range(&clip_a, seconds(0), seconds(1)),
                range(&clip_b, seconds(0), seconds(1)),
                destination.clone(),
                OutputSpec {
                    width: 1280,
                    height: 720,
                    frame_rate: RationalTimeBase::new(30, 1).unwrap(),
                    codec: VideoCodec::H265,
                    color: OutputColor::Hdr10,
                },
            ),
            &token(),
        )
        .unwrap_err();
    assert!(
        matches!(error, MediaError::UnsupportedMedia(_)),
        "unexpected error: {error:?}"
    );
    assert!(!destination.exists());
}

#[test]
fn pro_delogs_slog3_with_builtin_lut() {
    let directory = TestDirectory::new();
    let clip_a = sdr_clip(directory.path(), "a.mp4", 30, "none");
    let clip_b = sdr_clip(directory.path(), "b.mp4", 30, "none");
    let neutral_dest = directory.path().join("neutral.mp4");
    engine()
        .render_pro(
            &request(
                range(&clip_a, seconds(0), seconds(1)),
                range(&clip_b, seconds(0), seconds(1)),
                neutral_dest.clone(),
                output_720p30_h264(),
            ),
            &token(),
        )
        .unwrap();
    let mut slog3_a = range(&clip_a, seconds(0), seconds(1));
    slog3_a.input_color_space = InputColorSpace::SLog3;
    let mut slog3_b = range(&clip_b, seconds(0), seconds(1));
    slog3_b.input_color_space = InputColorSpace::SLog3;
    let slog3_dest = directory.path().join("slog3.mp4");
    engine()
        .render_pro(
            &request(slog3_a, slog3_b, slog3_dest.clone(), output_720p30_h264()),
            &token(),
        )
        .unwrap();
    let neutral = frame_rgb_sized(&neutral_dest, 0.25, 1280, 720);
    let delogged = frame_rgb_sized(&slog3_dest, 0.25, 1280, 720);
    let delta = mean_abs_delta(&neutral, &delogged);
    assert!(
        delta > 2.0,
        "built-in S-Log3 LUT did not visibly change the image (delta {delta})"
    );
}

#[test]
fn pro_vlog_requires_manufacturer_lut() {
    let directory = TestDirectory::new();
    let clip_a = sdr_clip(directory.path(), "a.mp4", 30, "none");
    let clip_b = sdr_clip(directory.path(), "b.mp4", 30, "none");
    let mut vlog_a = range(&clip_a, seconds(0), seconds(1));
    vlog_a.input_color_space = InputColorSpace::VLog;
    let mut vlog_b = range(&clip_b, seconds(0), seconds(1));
    vlog_b.input_color_space = InputColorSpace::VLog;
    let destination = directory.path().join("out.mp4");
    let error = engine()
        .render_pro(
            &request(vlog_a, vlog_b, destination.clone(), output_720p30_h264()),
            &token(),
        )
        .unwrap_err();
    assert!(
        matches!(error, MediaError::UnsupportedMedia(ref message) if message.contains("V-Log")),
        "unexpected error: {error:?}"
    );
    assert!(!destination.exists());

    // With the manufacturer's official .cube supplied, the render proceeds.
    let lut_path = write_cube(directory.path(), "vlog.cube", IDENTITY_CUBE);
    let mut vlog_a = range(&clip_a, seconds(0), seconds(1));
    vlog_a.input_color_space = InputColorSpace::VLog;
    vlog_a.color.lut = Some(lut_spec(&lut_path));
    let mut vlog_b = range(&clip_b, seconds(0), seconds(1));
    vlog_b.input_color_space = InputColorSpace::VLog;
    vlog_b.color.lut = Some(lut_spec(&lut_path));
    engine()
        .render_pro(
            &request(vlog_a, vlog_b, destination.clone(), output_720p30_h264()),
            &token(),
        )
        .unwrap();
    assert!(destination.exists());
}

#[test]
fn pro_custom_lut_visibly_changes_image() {
    let directory = TestDirectory::new();
    let clip_a = gray_clip(directory.path(), "a.mp4", "none");
    let clip_b = gray_clip(directory.path(), "b.mp4", "none");
    let neutral_dest = directory.path().join("neutral.mp4");
    engine()
        .render_pro(
            &request(
                range(&clip_a, seconds(0), seconds(1)),
                range(&clip_b, seconds(0), seconds(1)),
                neutral_dest.clone(),
                output_720p30_h264(),
            ),
            &token(),
        )
        .unwrap();
    let lut_path = write_cube(directory.path(), "lift.cube", &gamma_cube(4, 0.45));
    let mut graded_a = range(&clip_a, seconds(0), seconds(1));
    graded_a.color.lut = Some(lut_spec(&lut_path));
    let mut graded_b = range(&clip_b, seconds(0), seconds(1));
    graded_b.color.lut = Some(lut_spec(&lut_path));
    let graded_dest = directory.path().join("graded.mp4");
    engine()
        .render_pro(
            &request(
                graded_a,
                graded_b,
                graded_dest.clone(),
                output_720p30_h264(),
            ),
            &token(),
        )
        .unwrap();
    let neutral = frame_rgb_sized(&neutral_dest, 0.25, 1280, 720);
    let graded = frame_rgb_sized(&graded_dest, 0.25, 1280, 720);
    let delta = mean_abs_delta(&neutral, &graded);
    assert!(
        delta > 20.0,
        "custom LUT did not visibly change the image (delta {delta})"
    );
    assert!(
        mean_pixel(&graded) > mean_pixel(&neutral),
        "gamma lift LUT should brighten the image"
    );
}

#[test]
fn pro_rejects_malformed_luts() {
    let directory = TestDirectory::new();
    let cases = [
        ("missing_size", "TITLE \"no size\"\n0.0 0.0 0.0\n"),
        (
            "wrong_count",
            "TITLE \"short\"\nLUT_3D_SIZE 2\n0.0 0.0 0.0\n1.0 0.0 0.0\n",
        ),
        (
            "nan_value",
            "TITLE \"nan\"\nLUT_3D_SIZE 2\nNaN 0.0 0.0\n1.0 0.0 0.0\n0.0 1.0 0.0\n1.0 1.0 0.0\n0.0 0.0 1.0\n1.0 0.0 1.0\n0.0 1.0 1.0\n1.0 1.0 1.0\n",
        ),
        (
            "one_d",
            "TITLE \"1d\"\nLUT_1D_SIZE 4\n0.0\n0.33\n0.66\n1.0\n",
        ),
        ("oversize", "TITLE \"big\"\nLUT_3D_SIZE 65\n"),
    ];
    for (name, contents) in cases {
        let path = write_cube(directory.path(), &format!("{name}.cube"), contents);
        let error = MediaEngine::validate_lut(&path).unwrap_err();
        assert!(
            matches!(error, MediaError::InvalidInput(_)),
            "{name}: unexpected error {error:?}"
        );
    }
    let binary = directory.path().join("binary.cube");
    fs::write(&binary, [0xff, 0xfe, 0x00, 0x01]).unwrap();
    let error = MediaEngine::validate_lut(&binary).unwrap_err();
    assert!(matches!(error, MediaError::InvalidInput(_)));
}

#[test]
fn pro_rejects_lut_hash_mismatch() {
    let directory = TestDirectory::new();
    let clip_a = sdr_clip(directory.path(), "a.mp4", 30, "none");
    let clip_b = sdr_clip(directory.path(), "b.mp4", 30, "none");
    let lut_path = write_cube(directory.path(), "lut.cube", IDENTITY_CUBE);
    let mut graded_a = range(&clip_a, seconds(0), seconds(1));
    graded_a.color.lut = Some(LutSpec {
        path: lut_path.clone(),
        expected_sha256: "00".repeat(32),
    });
    let graded_b = range(&clip_b, seconds(0), seconds(1));
    let destination = directory.path().join("out.mp4");
    let error = engine()
        .render_pro(
            &request(
                graded_a,
                graded_b,
                destination.clone(),
                output_720p30_h264(),
            ),
            &token(),
        )
        .unwrap_err();
    assert!(
        matches!(error, MediaError::SourceIdentityMismatch { .. }),
        "unexpected error: {error:?}"
    );
    assert!(!destination.exists());
}

#[test]
fn pro_rejects_grade_out_of_bounds() {
    let directory = TestDirectory::new();
    let clip_a = sdr_clip(directory.path(), "a.mp4", 30, "none");
    let clip_b = sdr_clip(directory.path(), "b.mp4", 30, "none");
    let mut graded_a = range(&clip_a, seconds(0), seconds(1));
    graded_a.color.exposure_ev = 5.0;
    let graded_b = range(&clip_b, seconds(0), seconds(1));
    let destination = directory.path().join("out.mp4");
    let error = engine()
        .render_pro(
            &request(
                graded_a,
                graded_b,
                destination.clone(),
                output_720p30_h264(),
            ),
            &token(),
        )
        .unwrap_err();
    assert!(
        matches!(error, MediaError::InvalidInput(_)),
        "unexpected error: {error:?}"
    );
    assert!(!destination.exists());
}

#[test]
fn pro_applies_per_clip_grade() {
    let directory = TestDirectory::new();
    let clip_a = sdr_clip(directory.path(), "a.mp4", 30, "none");
    let clip_b = sdr_clip(directory.path(), "b.mp4", 30, "none");
    let neutral_dest = directory.path().join("neutral.mp4");
    engine()
        .render_pro(
            &request(
                range(&clip_a, seconds(0), seconds(1)),
                range(&clip_b, seconds(0), seconds(1)),
                neutral_dest.clone(),
                output_720p30_h264(),
            ),
            &token(),
        )
        .unwrap();
    let mut graded_a = range(&clip_a, seconds(0), seconds(1));
    graded_a.color.exposure_ev = 2.0;
    graded_a.color.saturation = 0.0;
    let graded_b = range(&clip_b, seconds(0), seconds(1));
    let graded_dest = directory.path().join("graded.mp4");
    engine()
        .render_pro(
            &request(
                graded_a,
                graded_b,
                graded_dest.clone(),
                output_720p30_h264(),
            ),
            &token(),
        )
        .unwrap();
    // First half carries the grade; the second half must be untouched.
    let neutral = frame_rgb_sized(&neutral_dest, 0.25, 1280, 720);
    let graded = frame_rgb_sized(&graded_dest, 0.25, 1280, 720);
    assert!(mean_abs_delta(&neutral, &graded) > 8.0);
    let neutral_tail = frame_rgb_sized(&neutral_dest, 1.5, 1280, 720);
    let graded_tail = frame_rgb_sized(&graded_dest, 1.5, 1280, 720);
    assert!(mean_abs_delta(&neutral_tail, &graded_tail) < 4.0);
}

#[test]
fn pro_normalizes_rotation() {
    let directory = TestDirectory::new();
    let clip_a = make_clip(
        directory.path(),
        "a.mp4",
        640,
        360,
        30,
        1.0,
        "libx264",
        "yuv420p",
        "none",
        &["-metadata:s:v:0", "rotate=90"],
    );
    let clip_b = sdr_clip(directory.path(), "b.mp4", 30, "none");
    let destination = directory.path().join("out.mp4");
    engine()
        .render_pro(
            &request(
                range(&clip_a, seconds(0), seconds(1)),
                range(&clip_b, seconds(0), seconds(1)),
                destination.clone(),
                output_720p30_h264(),
            ),
            &token(),
        )
        .unwrap();
    let video = video_stream(&destination);
    assert_eq!(video["width"], 1280);
    assert_eq!(video["height"], 720);
}

#[test]
fn pro_rejects_240fps_and_8k() {
    let directory = TestDirectory::new();
    let fast = make_clip(
        directory.path(),
        "fast.mp4",
        320,
        180,
        240,
        0.5,
        "libx264",
        "yuv420p",
        "none",
        &[],
    );
    let normal = sdr_clip(directory.path(), "normal.mp4", 30, "none");
    let destination = directory.path().join("out.mp4");
    let error = engine()
        .render_pro(
            &request(
                range(&fast, seconds(0), time(1, 1, 2)),
                range(&normal, seconds(0), seconds(1)),
                destination.clone(),
                output_720p30_h264(),
            ),
            &token(),
        )
        .unwrap_err();
    assert!(
        matches!(error, MediaError::UnsupportedMedia(_)),
        "unexpected error: {error:?}"
    );

    let huge = make_clip(
        directory.path(),
        "huge.mp4",
        7680,
        4320,
        5,
        0.4,
        "libx264",
        "yuv420p",
        "none",
        &[],
    );
    let error = engine()
        .render_pro(
            &request(
                range(&huge, seconds(0), time(2, 1, 5)),
                range(&normal, seconds(0), seconds(1)),
                destination.clone(),
                output_720p30_h264(),
            ),
            &token(),
        )
        .unwrap_err();
    assert!(
        matches!(error, MediaError::UnsupportedMedia(_)),
        "unexpected error: {error:?}"
    );
    assert!(!destination.exists());
}

#[test]
fn pro_validate_lut_reports_info() {
    let directory = TestDirectory::new();
    let path = write_cube(directory.path(), "identity.cube", IDENTITY_CUBE);
    let info = MediaEngine::validate_lut(&path).unwrap();
    assert_eq!(info.size, 2);
    assert_eq!(info.title.as_deref(), Some("identity 2^3"));
    assert_eq!(info.sha256, sha256(&path));
}

#[test]
fn pro_rejects_bad_output_presets() {
    let directory = TestDirectory::new();
    let clip_a = sdr_clip(directory.path(), "a.mp4", 30, "none");
    let clip_b = sdr_clip(directory.path(), "b.mp4", 30, "none");
    for output in [
        OutputSpec {
            width: 800,
            height: 600,
            frame_rate: RationalTimeBase::new(30, 1).unwrap(),
            codec: VideoCodec::H264,
            color: OutputColor::SdrRec709,
        },
        OutputSpec {
            width: 1280,
            height: 720,
            frame_rate: RationalTimeBase::new(30, 1).unwrap(),
            codec: VideoCodec::H264,
            color: OutputColor::Hdr10,
        },
        OutputSpec {
            width: 1280,
            height: 720,
            frame_rate: RationalTimeBase::new(120, 1).unwrap(),
            codec: VideoCodec::H264,
            color: OutputColor::SdrRec709,
        },
    ] {
        let destination = directory.path().join("out.mp4");
        let error = engine()
            .render_pro(
                &request(
                    range(&clip_a, seconds(0), seconds(1)),
                    range(&clip_b, seconds(0), seconds(1)),
                    destination.clone(),
                    output,
                ),
                &token(),
            )
            .unwrap_err();
        assert!(
            matches!(error, MediaError::InvalidInput(_)),
            "unexpected error: {error:?}"
        );
        assert!(!destination.exists());
    }
}

#[test]
fn pro_config_digest_is_stable_across_runs() {
    let directory = TestDirectory::new();
    let clip_a = sdr_clip(directory.path(), "a.mp4", 30, "none");
    let clip_b = sdr_clip(directory.path(), "b.mp4", 30, "none");
    let mut digests = Vec::new();
    for index in 0..2 {
        let destination = directory.path().join(format!("out{index}.mp4"));
        let artifact = engine()
            .render_pro(
                &request(
                    range(&clip_a, seconds(0), seconds(1)),
                    range(&clip_b, seconds(0), seconds(1)),
                    destination,
                    output_720p30_h264(),
                ),
                &token(),
            )
            .unwrap();
        digests.push(artifact.config_digest);
    }
    assert_eq!(digests[0], digests[1]);
}
