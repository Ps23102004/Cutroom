use std::{
    f32::consts::PI,
    path::{Path, PathBuf},
    process::Command,
};

use cutroom_media::MediaEngine;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const WIDTH: usize = 1920;
pub const HEIGHT: usize = 1080;
pub const SAMPLE_RATE: usize = 48_000;

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

fn test_engine() -> MediaEngine {
    MediaEngine::discover()
        .expect("ffmpeg/ffprobe must resolve for media tests (CUTROOM_FFMPEG / CUTROOM_FFPROBE / PATH)")
}

/// Absolute ffmpeg path, resolved exactly the way the library resolves it.
pub fn ffmpeg() -> PathBuf {
    test_engine().ffmpeg_path().to_path_buf()
}

/// Absolute ffprobe path, resolved exactly the way the library resolves it.
pub fn ffprobe() -> PathBuf {
    test_engine().ffprobe_path().to_path_buf()
}

pub fn sha256(path: &Path) -> String {
    let bytes = std::fs::read(path).unwrap();
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn expected_fixture_hash(path: &Path) -> &'static str {
    match path.file_name().and_then(|name| name.to_str()) {
        Some("fixture_a.mp4") => "06e35e744a729825b664fc938485d840307755bcc44a60cd3f47f362555bcccb",
        Some("fixture_b.mp4") => "5bcb5af63d409cd5f9a46c849867315b83fc9377e5ddab31ac70295ad6654560",
        other => panic!("unknown fixture: {other:?}"),
    }
}

pub fn assert_fixture_unchanged(path: &Path) {
    assert_eq!(
        sha256(path),
        expected_fixture_hash(path),
        "fixture changed: {}",
        path.display()
    );
}

pub fn probe_json(path: &Path) -> Value {
    let output = Command::new(ffprobe())
        .args([
            "-v",
            "error",
            "-count_frames",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "ffprobe failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

pub fn strict_decode(path: &Path) {
    let output = Command::new(ffmpeg())
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-xerror",
            "-err_detect",
            "explode",
            "-threads",
            "2",
            "-filter_threads",
            "2",
            "-filter_complex_threads",
            "2",
            "-i",
        ])
        .arg(path)
        .args(["-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "strict decode failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn audio_samples(path: &Path) -> Vec<f32> {
    let output = Command::new(ffmpeg())
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
        .arg(path)
        .args([
            "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "audio decode failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
        .stdout
        .chunks_exact(4)
        .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
        .collect()
}

pub fn frequency_power(
    path: &Path,
    frequency_hz: f32,
    start_seconds: f32,
    duration_seconds: f32,
) -> f64 {
    let samples = audio_samples(path);
    let start = (start_seconds * SAMPLE_RATE as f32) as usize;
    let end = ((start_seconds + duration_seconds) * SAMPLE_RATE as f32) as usize;
    let window = &samples[start.min(samples.len())..end.min(samples.len())];
    let omega = 2.0 * PI * frequency_hz / SAMPLE_RATE as f32;
    let coefficient = 2.0 * omega.cos();
    let mut q1 = 0.0_f32;
    let mut q2 = 0.0_f32;
    for sample in window {
        let q0 = coefficient * q1 - q2 + sample;
        q2 = q1;
        q1 = q0;
    }
    f64::from(q1 * q1 + q2 * q2 - q1 * q2 * coefficient)
}

pub fn frame_rgb(path: &Path, timestamp_seconds: f32) -> Vec<u8> {
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
    assert_eq!(output.stdout.len(), WIDTH * HEIGHT * 3);
    output.stdout
}

pub fn mean_abs_frame_delta(left: &[u8], right: &[u8]) -> f64 {
    assert_eq!(left.len(), right.len());
    left.iter()
        .zip(right)
        .map(|(left, right)| f64::from(left.abs_diff(*right)))
        .sum::<f64>()
        / left.len() as f64
}
