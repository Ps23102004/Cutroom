from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path

from generate_b0 import (
    HEIGHT,
    WIDTH,
    _run_owned_process,
    draw_timecode,
    ensure_no_existing_targets,
    make_frame,
    timecode,
)


class _FakeStdin:
    def write(self, data: bytes) -> int:
        return len(data)

    def close(self) -> None:
        pass


class _FakeProcess:
    def __init__(self, natural_delay: float | None) -> None:
        self.stdin = _FakeStdin()
        self.natural_delay = natural_delay
        self.returncode: int | None = None
        self.killed = False
        self.waited = False

    def poll(self) -> int | None:
        return self.returncode

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9

    def wait(self) -> int:
        self.waited = True
        if self.returncode is None:
            if self.natural_delay is None:
                while self.returncode is None:
                    time.sleep(0.001)
            else:
                time.sleep(self.natural_delay)
                self.returncode = 0
        return self.returncode


class B0FixtureHelperTests(unittest.TestCase):
    def test_timecode_uses_frame_numbers(self) -> None:
        self.assertEqual(timecode(0), "00:00:00:00")
        self.assertEqual(timecode(119), "00:00:04:23")
        self.assertEqual(timecode(24 * 60 * 60), "01:00:00:00")

    def test_valid_frame_dimensions_and_glyphs(self) -> None:
        frame = make_frame(0, width=640, height=200)
        self.assertEqual(len(frame), 640 * 200 * 3)
        self.assertIn(bytes((255, 255, 255)), bytes(frame))
        self.assertIn(bytes((0, 0, 0)), bytes(frame))

    def test_small_frame_rejects_overlay(self) -> None:
        with self.assertRaisesRegex(ValueError, "overlay does not fit"):
            make_frame(0, width=32, height=32)

    def test_default_dimensions_match_packet(self) -> None:
        self.assertEqual((WIDTH, HEIGHT), (1920, 1080))

    def test_encoder_waits_for_natural_completion(self) -> None:
        process = _FakeProcess(natural_delay=0.03)
        _run_owned_process(["fake-ffmpeg"], lambda stream: stream.write(b"frame"), timeout=0.2,
                           popen=lambda *args, **kwargs: process)
        self.assertFalse(process.killed)
        self.assertTrue(process.waited)

    def test_encoder_timeout_kills_and_reaps_owned_process(self) -> None:
        process = _FakeProcess(natural_delay=None)
        with self.assertRaisesRegex(RuntimeError, "encoder exceeded"):
            _run_owned_process(["fake-ffmpeg"], lambda stream: stream.write(b"frame"), timeout=0.03,
                               popen=lambda *args, **kwargs: process)
        self.assertTrue(process.killed)
        self.assertTrue(process.waited)

    def test_no_clobber_rejects_existing_and_dangling_targets(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "fixture_a.mp4").write_bytes(b"existing")
            with self.assertRaisesRegex(RuntimeError, "fixture_a.mp4"):
                ensure_no_existing_targets(directory)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            os.symlink("missing.mp4", directory / "fixture_b.mp4")
            with self.assertRaisesRegex(RuntimeError, "fixture_b.mp4"):
                ensure_no_existing_targets(directory)

    def test_no_clobber_allows_empty_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            ensure_no_existing_targets(Path(temporary))


if __name__ == "__main__":
    unittest.main()
