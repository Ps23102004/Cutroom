#!/usr/bin/env python3
"""Generate and verify deterministic synthetic B0 media fixtures."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import traceback
from decimal import Decimal
from fractions import Fraction
from pathlib import Path
from typing import Any

WIDTH, HEIGHT, FPS, DURATION = 1920, 1080, 24, 5
SAMPLE_RATE, THREADS, TIMEOUT = 48000, 2, 90
FRAME_COUNT = FPS * DURATION
MANIFEST = "b0-fixtures.json"
DIAGNOSTICS = "b0-fixtures.error.json"
FIXTURES = ("fixture_a.mp4", "fixture_b.mp4")
TARGETS = (*FIXTURES, MANIFEST, DIAGNOSTICS)
GLYPHS = {
    "0": ("11111", "10001", "10001", "10001", "10001", "10001", "11111"),
    "1": ("00100", "01100", "00100", "00100", "00100", "00100", "01110"),
    "2": ("11111", "00001", "00001", "11111", "10000", "10000", "11111"),
    "3": ("11111", "00001", "00001", "01111", "00001", "00001", "11111"),
    "4": ("10001", "10001", "10001", "11111", "00001", "00001", "00001"),
    "5": ("11111", "10000", "10000", "11111", "00001", "00001", "11111"),
    "6": ("11111", "10000", "10000", "11111", "10001", "10001", "11111"),
    "7": ("11111", "00001", "00010", "00100", "01000", "01000", "01000"),
    "8": ("11111", "10001", "10001", "11111", "10001", "10001", "11111"),
    "9": ("11111", "10001", "10001", "11111", "00001", "00001", "11111"),
    ":": ("00000", "00100", "00100", "00000", "00100", "00100", "00000"),
}


class FixtureError(RuntimeError):
    pass


class PreflightError(FixtureError):
    pass


def timecode(frame_number: int, fps: int = FPS) -> str:
    if frame_number < 0 or fps <= 0:
        raise ValueError("frame_number must be non-negative and fps must be positive")
    h, rem = divmod(frame_number, fps * 3600)
    m, rem = divmod(rem, fps * 60)
    s, f = divmod(rem, fps)
    return f"{h:02d}:{m:02d}:{s:02d}:{f:02d}"


def draw_timecode(frame: bytearray, frame_number: int, *, width: int = WIDTH,
                  height: int = HEIGHT, scale: int = 8, x: int = 64, y: int = 64) -> None:
    if width <= 0 or height <= 0 or scale <= 0:
        raise ValueError("width, height, and scale must be positive")
    if len(frame) != width * height * 3:
        raise ValueError("frame length does not match RGB dimensions")
    text, cell = timecode(frame_number), 6 * scale
    text_width, padding = len(text) * cell - scale, scale
    box_width, box_height = text_width + 2 * padding, 7 * scale + 2 * padding
    if x < padding or y < padding or x + box_width > width or y + box_height > height:
        raise ValueError("timecode overlay does not fit within frame bounds")
    black = bytes(box_width * 3)
    for row in range(y - padding, y - padding + box_height):
        start = (row * width + x - padding) * 3
        frame[start : start + box_width * 3] = black
    white = bytes((255, 255, 255)) * scale
    blank = bytes(3 * scale)
    for index, char in enumerate(text):
        for glyph_row, bits in enumerate(GLYPHS[char]):
            line = b"".join(white if bit == "1" else blank for bit in bits)
            start_x = x + index * cell
            for dy in range(scale):
                start = ((y + glyph_row * scale + dy) * width + start_x) * 3
                frame[start : start + len(line)] = line


def _paint_background(frame: bytearray, width: int, height: int) -> None:
    row = bytes((24, 48, 80)) * width
    row_size = width * 3
    for index in range(height):
        start = index * row_size
        frame[start : start + row_size] = row


def make_frame(frame_number: int, *, width: int = WIDTH, height: int = HEIGHT) -> bytearray:
    frame = bytearray(width * height * 3)
    _paint_background(frame, width, height)
    draw_timecode(frame, frame_number, width=width, height=height)
    return frame


def ensure_no_existing_targets(directory: Path) -> None:
    existing = [name for name in TARGETS if os.path.lexists(str(directory / name))]
    if existing:
        raise PreflightError("refusing to overwrite existing targets: " + ", ".join(existing))


def run_checked(args: list[str], timeout: int = TIMEOUT) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise FixtureError(f"command timed out after {timeout}s: {' '.join(args)}") from exc
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip() or "no diagnostics"
        raise FixtureError(f"command failed ({result.returncode}): {' '.join(args)}\n{detail}")
    return result


def _run_owned_process(args: list[str], write_input: Any, *, timeout: float = TIMEOUT,
                       popen: Any = None) -> None:
    stderr_file = tempfile.TemporaryFile()
    factory = subprocess.Popen if popen is None else popen
    process = factory(args, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=stderr_file)
    stdin = process.stdin
    expired = threading.Event()

    def kill_owned_process() -> None:
        if process.poll() is None:
            expired.set()
            try:
                process.kill()
            except OSError:
                pass

    watchdog = threading.Timer(timeout, kill_owned_process)
    watchdog.daemon = True
    watchdog.start()
    failure: Exception | None = None
    cleanup_error: Exception | None = None
    waited = False
    try:
        if stdin is None:
            raise FixtureError("encoder did not provide stdin")
        write_input(stdin)
        stdin.close()
        stdin = None
        process.wait()
        waited = True
    except Exception as exc:
        failure = exc
    finally:
        if failure is not None and process.poll() is None:
            try:
                process.kill()
            except OSError:
                pass
        if stdin is not None:
            try:
                stdin.close()
            except OSError:
                pass
        if not waited:
            try:
                process.wait()
                waited = True
            except Exception as exc:
                cleanup_error = exc
        watchdog.cancel()
        watchdog.join()
        stderr_file.seek(0)
        diagnostics = stderr_file.read().decode("utf-8", "replace").strip()
        stderr_file.close()
    if expired.is_set():
        raise FixtureError(f"FFmpeg encoder exceeded {timeout}s: {diagnostics}")
    if failure is not None:
        raise FixtureError(f"FFmpeg pipe failed: {diagnostics or failure}") from failure
    if cleanup_error is not None:
        raise FixtureError(f"FFmpeg process could not be reaped: {diagnostics or cleanup_error}") from cleanup_error
    if process.returncode:
        raise FixtureError(f"FFmpeg failed ({process.returncode}): {diagnostics or 'no diagnostics'}")


def encode_fixture(ffmpeg: str, output: Path, frequency: int) -> None:
    args = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s:v", f"{WIDTH}x{HEIGHT}",
            "-r", str(FPS), "-i", "pipe:0", "-f", "lavfi", "-i",
            f"sine=frequency={frequency}:sample_rate={SAMPLE_RATE}:duration={DURATION}",
            "-map", "0:v:0", "-map", "1:a:0", "-t", str(DURATION), "-c:v", "libx264",
            "-preset", "ultrafast", "-threads", str(THREADS), "-filter_threads", str(THREADS),
            "-filter_complex_threads", str(THREADS), "-pix_fmt", "yuv420p", "-c:a", "aac",
            "-ar", str(SAMPLE_RATE), "-b:a", "128k", "-shortest", "-movflags", "+faststart",
            str(output)]

    def write_frames(stream: Any) -> None:
        frame = bytearray(WIDTH * HEIGHT * 3)
        for frame_number in range(FRAME_COUNT):
            _paint_background(frame, WIDTH, HEIGHT)
            draw_timecode(frame, frame_number)
            stream.write(frame)

    _run_owned_process(args, write_frames)


def _stream_duration(stream: dict[str, Any], label: str) -> None:
    ts, base = stream.get("duration_ts"), stream.get("time_base")
    if ts not in (None, "N/A") and base not in (None, "N/A"):
        actual: Fraction | Decimal = Fraction(str(ts)) * Fraction(str(base))
        expected: Fraction | Decimal = Fraction(DURATION, 1)
    else:
        if stream.get("duration") in (None, "N/A"):
            raise FixtureError(f"{label} has no exact duration fields")
        actual, expected = Decimal(str(stream["duration"])), Decimal(DURATION)
    if actual != expected:
        raise FixtureError(f"{label} duration is {actual}, expected exactly {DURATION}")


def probe_and_decode(ffmpeg: str, ffprobe: str, fixture: Path) -> dict[str, Any]:
    result = run_checked([ffprobe, "-v", "error", "-threads", str(THREADS), "-count_frames",
                          "-show_format", "-show_streams", "-of", "json", str(fixture)])
    try:
        metadata = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise FixtureError(f"invalid ffprobe JSON for {fixture}") from exc
    streams = metadata.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video is None or audio is None:
        raise FixtureError(f"{fixture} must contain video and audio streams")
    if (video.get("codec_name"), video.get("width"), video.get("height"), video.get("avg_frame_rate")) != ("h264", WIDTH, HEIGHT, f"{FPS}/1"):
        raise FixtureError(f"unexpected video metadata for {fixture}")
    if audio.get("codec_name") != "aac" or int(audio.get("sample_rate", 0)) != SAMPLE_RATE:
        raise FixtureError(f"unexpected audio metadata for {fixture}")
    if int(video.get("nb_read_frames", -1)) != FRAME_COUNT:
        raise FixtureError(f"{fixture} has {video.get('nb_read_frames')} decoded frames, expected {FRAME_COUNT}")
    _stream_duration(video, f"{fixture} video")
    _stream_duration(audio, f"{fixture} audio")
    try:
        container_duration = Decimal(str(metadata["format"]["duration"]))
    except (KeyError, ValueError, TypeError) as exc:
        raise FixtureError(f"{fixture} has no exact container duration") from exc
    if container_duration != Decimal(DURATION):
        raise FixtureError(f"{fixture} container duration is {container_duration}, expected exactly {DURATION}")
    run_checked([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-xerror",
                 "-err_detect", "explode", "-threads", str(THREADS), "-filter_threads", str(THREADS),
                 "-filter_complex_threads", str(THREADS), "-i", str(fixture), "-map", "0:v:0",
                 "-map", "0:a:0", "-f", "null", "-"])
    return metadata


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def generate(output: Path) -> dict[str, Any]:
    ensure_no_existing_targets(output)
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise FixtureError("ffmpeg and ffprobe are required")
    output.mkdir(parents=True, exist_ok=True)
    records = []
    for name, frequency in (("fixture_a.mp4", 440), ("fixture_b.mp4", 880)):
        fixture = output / name
        encode_fixture(ffmpeg, fixture, frequency)
        records.append({"file": name, "frequency_hz": frequency, "sha256": sha256_file(fixture),
                        "probe": probe_and_decode(ffmpeg, ffprobe, fixture), "decode": "passed"})
    manifest = {"format": "b0-fixtures-v1",
                "parameters": {"duration_seconds": DURATION, "width": WIDTH, "height": HEIGHT,
                               "fps": FPS, "audio_sample_rate": SAMPLE_RATE, "threads": THREADS},
                "ffmpeg": {"path": ffmpeg, "version_lines": run_checked([ffmpeg, "-version"]).stdout.splitlines()[:2]},
                "fixtures": records}
    with (output / MANIFEST).open("x", encoding="utf-8") as target:
        json.dump(manifest, target, indent=2, sort_keys=True)
        target.write("\n")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args(argv)
    try:
        manifest = generate(args.output)
    except PreflightError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:
        try:
            args.output.mkdir(parents=True, exist_ok=True)
            with (args.output / DIAGNOSTICS).open("x", encoding="utf-8") as target:
                json.dump({"error": str(exc), "traceback": traceback.format_exc()}, target, indent=2)
                target.write("\n")
        except OSError:
            pass
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps({"manifest": str(args.output / MANIFEST), "fixtures": len(manifest["fixtures"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
