# B0-D Durable job engine — verified 2026-09-08

Status: **Durable SQLite-backed job engine accepted on the current macOS host.**

## Capability
`crates/cutroom-jobs` provides transactional job state management, cooperative cancellation, heartbeat lease fencing, retry, startup recovery, and execution of real two-range renders via `cutroom-media`.
- States: `queued`, `running`, `waiting`, `retrying`, `succeeded`, `failed`, `canceled`.
- Persistence: Shared project SQLite via typed `cutroom-core` `JobRepository` (migration v2).
- Derives render specifications strictly from immutable revision snapshots and assets; no caller-invented timeline ranges.
- Safe scratch ownership: unique attempt directory with ownership marker, validating every parent directory against symlinks; safe cleanup of owned artifacts without deleting unrelated files.
- Process crash recovery: detects expired leases on startup, recovers state without false-success, cleans owned scratch, and allows single clean retry.

## Verification
- Core tests: 9 core + 27 regressions = 36 tests (includes v1→v2 migration and rollback tests).
- Jobs tests: 10 repository tests + 9 engine integration tests = 19 tests.
- Media tests: 5 unit + 10 integration = 15 tests.
- Total: **70 Rust integration/unit tests pass** in parallel across workspace.
- `cargo fmt --check` passes.
- `cargo clippy --workspace --all-targets --offline -- -D warnings` passes.
- Baseline fixture SHA-256 hashes remain unchanged.
