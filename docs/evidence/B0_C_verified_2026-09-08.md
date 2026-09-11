# B0-C initial media operation — verified 2026-09-08

Status: **Initial two-range media operation accepted on the current macOS host.** Not native application acceptance; proxy/waveform work remains later.

## Capability
`crates/cutroom-media` executes real FFprobe/FFmpeg using fixed executable paths and structured Rust arguments. It probes source metadata and SHA-256, validates exact rational ranges and alignment, renders two ranges in specified order, checks output streams/duration, strictly decodes, hashes, and promotes without clobbering existing files. Original fixtures remain unchanged.

## Workers
- Omni `gpt-5.6-terra`, session `bc1d6a2b-3414-489d-9a5a-b4e4dd7cab8a`: implementation and private process regression helpers.
- Omni `gpt-5.6-luna`, session `df7e594d-f948-437b-8043-1bf1c6b71c9e`: independent real-media tests and final source review.
- GPT-6 Astra parent: integration findings, final judgment, independent final gate execution.

Both worker sessions were interrupted by a shared upstream DNS/503 failure and resumed in place after DNS resolved. No harness configuration changes. Worker exit status alone was not treated as product acceptance.

## Files
- `crates/cutroom-media/Cargo.toml`
- `crates/cutroom-media/src/{lib,model,error,engine}.rs`
- `crates/cutroom-media/tests/media.rs`, `tests/support/mod.rs`
- Root `Cargo.toml` workspace member and generated `Cargo.lock`.

## Parent-run final checks
All exit 0:

```
cargo fmt --check
cargo test --workspace --offline
cargo clippy --workspace --all-targets --offline -- -D warnings
```

**50 tests pass:** 9 original core + 26 core regressions + 5 media process unit tests + 10 media integration tests. No ignored tests. Existing fixture generation tests were not regenerated or unnecessarily rerun.

Real ordered output test: fixture B `[1s, 3s)` followed by fixture A `[2s, 4s)`; 1920×1080, 24fps, H.264 video and AAC audio. Exact four-second duration (49152 video ticks at 1/12288; 192000 audio ticks at 1/48000). Independent audio-frequency order and decoded image/timecode comparisons at exact 0.5s and 2.5s samples verify order and trim. Full boundaries `[0s, 5s)` also render successfully. Test outputs are disposable, not published deliverables.

Error/safety coverage: empty/reversed/out-of-bounds/inexact ranges; source/output alias and existing destination; shell-like filename; disguised playlist; changed disposable source hash; valid-container truncation causing process failure; precancel and real cancellation after temporary artifact creation, with no promotion and owned scratch cleanup.

Private process tests cover output larger than pipe capacity, bounded capture overflow, UTF-8-safe stderr capture, nonzero child exit, and cancellation kill/wait/reap.

## Review corrections
Parent review found and Terra fixed:
- Waiting for process exit before draining both pipes could deadlock.
- Byte-index String truncation could panic on UTF-8 error text.
- Returned artifact probe referenced a deleted temporary path rather than final output.
- Cancellation required another check immediately before promotion.
- Import probing needed a second source hash check.
- Extension-only playlist rejection was insufficient; fixed demuxer selection and container signature checks now precede probing.

Luna independently rechecked the final implementation and reported no remaining concrete defects in this initial operation.

## Limits, not promises
- Homebrew tool paths are fixed for this macOS stage; packaging and cross-platform tool discovery remain unimplemented.
- Exactly two ranges, 1080p/24fps SDR H.264 output. Source/container/audio compatibility is intentionally narrow and unsupported cases fail closed; no generic multi-track render claim.
- MP4/MOV/M4V and MKV demuxers are selected explicitly with `file,pipe` protocol restriction. No caller-supplied executable, URL or filtergraph API.
- No HDR conversion, mixed-audio-presence rendering, proxy/thumbnails/waveforms or arbitrary-rate editing is accepted here.
- Media-level cancellation is verified; durable job/app-crash recovery is the next gate, not established by these tests.
- Output success is returned by the adapter; durable success recording belongs to the upcoming job engine.

## Preserved source hashes
- A: `06e35e744a729825b664fc938485d840307755bcc44a60cd3f47f362555bcccb`
- B: `5bcb5af63d409cd5f9a46c849867315b83fc9377e5ddab31ac70295ad6654560`
- Generator: `622aab14f663ee89649b49eb9e36bb11dbec1db61def26486bda0eac90be3ceb`
- Fixture tests: `89afc80888e25ed776e6004779747e5dd482b5db232bbe97066916505177efbe`

Accepted source/Cargo snapshot before jobs: `/tmp/cutroom-pre-jobs-EaUkVq`. Next active work: durable jobs and independent recovery tests; frontend native-slice integration proceeds separately using existing design guidance.
