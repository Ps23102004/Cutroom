# B0-E Native Vertical Slice — verified 2026-09-09

Status: **Native Vertical Slice fully verified and accepted on macOS host.**

## Capability
The complete end-to-end native production critical path is verified via `scripts/verify_b0_slice.mjs` against `apps/desktop/src-tauri/src/bin/cli.rs` and the real SQLite and Media engines:
1. **Native Launch & Health**: Verified `cutroom-cli` health check (`ffmpegAvailable: true`).
2. **Project Creation & Persistence**: Created project in SQLite (`.cutroom/project.cutroom`), verified schema migrations v1..v3.
3. **Real Media Import**: Imported `tests/fixtures/fixture_a.mp4` and `fixture_b.mp4` (linked). Verified metadata extraction (H.264, 1920x1080, 24fps, 61440 ticks, SHA-256).
4. **Timeline Source Ranges**: Inserted two clips on track 1 (`0..24576` ticks).
5. **Trimming**: Trimmed clip 1 to `4096..20480` ticks; version incremented.
6. **Reordering**: Moved clip 2 before clip 1; start offsets recalculated cleanly.
7. **Immutable Revision**: Created revision snapshot with deterministic SHA-256 content hash.
8. **Durable Media Render**: Enqueued 1080p SDR render; background `OwnedWorker` claimed job, heartbeated lease, executed FFmpeg, and marked job `completed`.
9. **Probe & Decode Output**: Verified output artifact at `.cutroom/jobs/<jobId>/attempt-1/artifact.mp4`:
   - Exact resolution 1920x1080, 3.333s duration, 2 streams (video H.264, audio AAC).
   - FFmpeg null-decode (`ffmpeg -v error -i ... -f null -`) passed with 0 bitstream errors.
10. **Cancellation & Recovery**: Enqueued second render, cancelled immediately, confirmed cancelled status and safe cleanup. Confirmed stale write conflict rejection.
11. **Application Close & Reopen**: Terminated Process 1, spawned Process 2, reopened project ID.
12. **Persistence Verification**: Verified project, 2 assets, composition version 5, immutable revision, 2 jobs, and render artifact all persist across process restarts.
13. **Original Media Immutability**: Verified `fixture_a.mp4` and `fixture_b.mp4` SHA-256 digests remained identical before and after.

## Verification Command
```bash
node scripts/verify_b0_slice.mjs
```
Exit code: 0. All 12 phases passed.
