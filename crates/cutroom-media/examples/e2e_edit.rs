//! Manual end-to-end verification: probe two real clips and render a trimmed
//! two-clip edit (clip A 1s..4s + clip B 2s..5s) to a 1080p H.264 artifact.
//! Run: cargo run -p cutroom-media --example e2e_edit
//! Env: CUTROOM_E2E_DIR (defaults to ~/workspace/cutroom-e2e)

use std::path::PathBuf;

use cutroom_media::{
    CancellationToken, MediaEngine, RationalTime, RationalTimeBase, SourceRange,
    TwoClipRenderRequest,
};

fn secs(s: i64) -> RationalTime {
    RationalTime {
        ticks: s.to_string(),
        time_base: RationalTimeBase { num: 1, den: 1 },
    }
}

fn rational_seconds(t: &RationalTime) -> f64 {
    let ticks: f64 = t.ticks.parse().expect("ticks parse");
    ticks * (t.time_base.num as f64) / (t.time_base.den as f64)
}

fn main() {
    let dir = std::env::var("CUTROOM_E2E_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = std::env::var("HOME").expect("HOME");
            PathBuf::from(home).join("workspace/cutroom-e2e")
        });
    let clip_a = dir.join("clipA.mp4");
    let clip_b = dir.join("clipB.mp4");
    let dest = dir.join("edit-output.mp4");
    assert!(clip_a.exists(), "missing {}", clip_a.display());
    assert!(clip_b.exists(), "missing {}", clip_b.display());
    if dest.exists() {
        std::fs::remove_file(&dest).expect("remove stale output");
    }

    let engine = MediaEngine::discover().expect("ffmpeg/ffprobe discovery");
    println!("ffmpeg: {}", engine.ffmpeg_path().display());
    let cancel = CancellationToken::new();

    // 1. Probe both sources like the import flow does.
    let probe_a = engine.probe(&clip_a, &cancel).expect("probe clip A");
    let probe_b = engine.probe(&clip_b, &cancel).expect("probe clip B");
    for (name, p) in [("A", &probe_a), ("B", &probe_b)] {
        let v = &p.video;
        println!(
            "clip {}: {}x{} {} {} {}s audio={}",
            name,
            v.width,
            v.height,
            v.codec,
            v.pixel_format,
            rational_seconds(&v.duration),
            p.audio
                .as_ref()
                .map(|a| format!("{}/{}Hz/{}ch", a.codec, a.sample_rate, a.channels))
                .unwrap_or_else(|| "none".into())
        );
    }

    // 2. Build the edit: trim A to 1s..4s, trim B to 2s..5s (6s total).
    let request = TwoClipRenderRequest {
        clips: [
            SourceRange::new(clip_a.clone(), probe_a.sha256.clone(), secs(1), secs(4)),
            SourceRange::new(clip_b.clone(), probe_b.sha256.clone(), secs(2), secs(5)),
        ],
        destination: dest.clone(),
    };

    // 3. Render through the same engine the Tauri backend uses.
    let artifact = engine
        .render_1080p_sdr(&request, &cancel)
        .expect("render edit");
    let out = &artifact.probe;
    println!("rendered: {}", artifact.path.display());
    println!("  sha256: {}", &artifact.sha256[..16]);
    println!(
        "  output: {}x{} {} {}s",
        out.video.width,
        out.video.height,
        out.video.codec,
        rational_seconds(&out.video.duration)
    );

    // 4. Assertions: the edit actually did what we asked.
    assert!(dest.exists(), "output file missing");
    assert_eq!(out.video.width, 1920, "output width");
    assert_eq!(out.video.height, 1080, "output height");
    assert_eq!(out.video.codec, "h264", "output codec");
    let dur = rational_seconds(&out.video.duration);
    assert!(
        (dur - 6.0).abs() < 0.15,
        "output duration {dur}s, expected ~6s"
    );
    println!("E2E EDIT OK: 3s of A + 3s of B -> {dur:.2}s 1080p H.264");
}
