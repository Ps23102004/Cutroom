# B0-A verified checkpoint — 2026-09-08

Status: **SQLite core accepted on the current macOS host**. This is not Phase B native UI acceptance.

## Capability
Project, asset, composition and immutable revision data persist across SQLite reopen. Composition mutations enforce rational source bounds, expected versions, transactional rollback and scoped idempotent replay. Cooperating Cutroom writers are mutually excluded.

## Workers
- Omni `gpt-5.6-terra`, implementation session `bc1d6a2b-3414-489d-9a5a-b4e4dd7cab8a`.
- Omni `gpt-5.6-luna`, independent tests/review session `df7e594d-f948-437b-8043-1bf1c6b71c9e`.
- Parent integration reviewer: GPT-6 Astra, independently executed final gates.

## Reproduced defect and correction
Initial `cargo test --workspace --offline` compiled, but all nine `tests/core.rs` cases failed on database open with SQLite `DatabaseBusy (database is locked)`. The exclusive filesystem lock on the database inode conflicted with SQLite byte-range locks on Darwin.

The bounded correction uses an OS advisory lock held on a persistent canonical companion inode. It validates symlink/hardlink aliases and the acquired companion identity; never deletes lock state; and verifies the known macOS root aliases separately from user-created symlinks. Migration version/metadata checks were tightened and baseline DDL, metadata, and `user_version` share one transaction. No core rewrite was performed.

## Changed files
- `crates/cutroom-core/src/storage.rs`: locking, migration validation, Clippy tuple aliases.
- `crates/cutroom-core/Cargo.toml`, generated `Cargo.lock`: direct cached libc dependency for Unix `O_NOFOLLOW`.
- Other `crates/cutroom-core/src/*.rs`: formatting only relative to preserved initial tree.
- `crates/cutroom-core/tests/core.rs`: formatting.
- `crates/cutroom-core/tests/regressions.rs`: independent adversarial coverage.

Initial uncommitted core and Cargo files were copied to `/tmp/cutroom-b0-baseline-0pWcGn` before worker edits. No Git reset, clean, commit or discard. Existing architecture/task packets and fixture generation work were retained. No harness or profile configuration changed.

## Final parent-run gate
All commands exited 0 after the final Luna migration rollback regression was added:

```
cargo fmt --check
cargo test --workspace --offline
cargo clippy --workspace --all-targets --offline -- -D warnings
```

Tests: **9 core + 26 regression tests pass**, no ignored tests. One regression is the subprocess lock-holder entry point exercised by the crash-release parent test. Library/doc-test targets currently contain zero tests.

Coverage includes reopen, second writer/canonical aliases, macOS root aliases, symlink ancestors/files, DB and companion hardlinks, process termination lock release, unrelated-file preservation, supported/future/conflicting migration metadata, actual initial-DDL rollback, maximum rational values and checked multiplication overflow, exact and one-tick-excess ranges, consistent composition duration/reorder source identity, revision immutability/duplicate-save parentage, stale writes, cross-project idempotency conflicts, and serialized concurrent duplicate mutations.

## Source preservation
Parent SHA-256 checks before and after core verification matched:
- `fixture_a.mp4`: `06e35e744a729825b664fc938485d840307755bcc44a60cd3f47f362555bcccb`
- `fixture_b.mp4`: `5bcb5af63d409cd5f9a46c849867315b83fc9377e5ddab31ac70295ad6654560`
- `generate_b0.py`: `622aab14f663ee89649b49eb9e36bb11dbec1db61def26486bda0eac90be3ceb`
- `test_b0_fixtures.py`: `89afc80888e25ed776e6004779747e5dd482b5db232bbe97066916505177efbe`

## Actual limitations
- Advisory locking is not a defense against hostile processes that directly replace/unlink project files. It protects cooperating Cutroom writers.
- Runtime verification is macOS only; Windows/Linux acceptance has not been performed. Unix hardlink checks are platform-gated.
- Negative ticks are explicitly rejected. Inexact conversions and arithmetic overflow are errors, not rounding/saturation.
- Revision content hashes identify deterministic composition snapshots; revision IDs and parent links separately identify historical saves. Equal content may have equal hashes across distinct saves.
- The current jobs table is only a baseline, not an implemented durable job engine.
- Real media rendering, durable jobs, IPC and native UI vertical-slice acceptance remain subsequent gates.

Next active work: Terra media adapters and Luna independent fixture-render regression tests through the same separate Omni sessions.
