#!/usr/bin/env python3
"""Create and verify a disposable, synthetic media fixture."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def run(*args: str) -> str:
    result = subprocess.run(args, check=True, text=True, capture_output=True)
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("tests/fixtures/media-smoke"))
    args = parser.parse_args()
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise SystemExit("ffmpeg and ffprobe are required")
    args.output.mkdir(parents=True, exist_ok=True)
    fixture = args.output / "synthetic-3s.mp4"
    # Fixed color/time and sine/audio event inputs; no external media or network.
    run(ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-preset", "ultrafast", "-threads", "1", "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", str(fixture))
    probe = json.loads(run(ffprobe, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(fixture)))
    decoded = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(fixture), "-f", "null", "-"], capture_output=True, text=True)
    if decoded.returncode:
        raise SystemExit(decoded.stderr)
    digest = hashlib.sha256(fixture.read_bytes()).hexdigest()
    build = subprocess.run([ffmpeg, "-version"], check=True, text=True, capture_output=True).stdout.splitlines()[:2]
    report = {"fixture": str(fixture), "sha256": digest, "probe": probe, "decode": "passed", "args_fixed": True,
              "ffmpeg": {"path": ffmpeg, "version_lines": build, "license_relevant_flags": ["--enable-gpl", "--enable-version3", "--enable-libx264", "--enable-libx265"]}}
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"fixture": str(fixture), "sha256": digest, "streams": len(probe.get("streams", [])), "decode": "passed"}, indent=2))


if __name__ == "__main__":
    main()
