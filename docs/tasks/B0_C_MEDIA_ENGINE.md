# Task Packet B0-C — Media Engine & Timeline Render Pipeline

**Parent Milestone**: Phase B — Native Vertical Slice  
**Assigned Worker**: AGY GPT-OSS-120B  
**Coordinator**: Gemini 3.8 Flash Coordinator  
**Assigned Directory**: `/Users/parthsingh/Developer/Cutroom/crates/cutroom-media`

---

## Scope & Writable Files

### Writable:
- `/Users/parthsingh/Developer/Cutroom/crates/cutroom-media/Cargo.toml`
- `/Users/parthsingh/Developer/Cutroom/crates/cutroom-media/src/**`
- `/Users/parthsingh/Developer/Cutroom/crates/cutroom-media/tests/**`
- `/Users/parthsingh/Developer/Cutroom/docs/evidence/B0_C.md`

### Strictly Forbidden:
- Hardcoding user-specific paths or external network URLs
- Using model-generated arbitrary FFmpeg CLI strings without strict code-level argument validation
- Mutating or deleting original source media files

---

## Technical Requirements

1. **Crate `cutroom-media` Dependencies**:
   - `serde`, `serde_json`
   - `thiserror`
   - `tokio` (for async child process management)
   - `sha2` (checksum calculation)

2. **Probe Module (`probe.rs`)**:
   - Execute `/opt/homebrew/bin/ffprobe` with JSON output format (`-show_format -show_streams -print_format json`).
   - Parse video streams: codec name, width, height, frame rate numerator and denominator, pixel format, duration ticks, and timebase.
   - Parse audio streams: codec name, sample rate, channels, bit rate.
   - Detect unsupported formats, variable frame rate (VFR), and HDR signaling.

3. **Proxy & Waveform Generation (`proxy.rs`, `waveform.rs`)**:
   - Proxy generation: 720p H.264 MP4 with AAC audio (`-vf scale=-2:720 -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k`).
   - Waveform generation: extract peak and RMS audio samples as compact JSON arrays for UI display.

4. **Timeline Export Compiler (`render.rs`)**:
   - Takes a `Composition` (tracks, clips with rational in/out ticks) and `OutputPreset` (e.g. `1080p_sdr`).
   - Compiles clips into an explicit FFmpeg filtergraph:
     - `trim` and `atrim` for clip source boundaries.
     - `setpts=PTS-STARTPTS` and `asetpts=PTS-STARTPTS`.
     - `concat` filter combining clips into continuous video and audio streams.
     - Color formatting and audio normalization.
   - Executes FFmpeg writing to a temporary file (`.cutroom/exports/tmp_*.mp4`).
   - Verifies exported MP4 via ffprobe before promoting to final deliverable path.

5. **Tests**:
   - Probe test: probe a generated synthetic MP4 fixture and assert all extracted metadata fields match expectations.
   - Concat render test: assemble two synthetic clips into an export MP4 and verify output duration, audio stream, and frame decodability.
