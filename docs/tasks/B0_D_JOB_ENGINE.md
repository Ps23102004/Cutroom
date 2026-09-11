# Task Packet B0-D — Durable Job Engine & Startup Recovery

**Parent Milestone**: Phase B — Native Vertical Slice  
**Assigned Worker**: AGY Claude Opus 4.6  
**Coordinator**: Gemini 3.8 Flash Coordinator  
**Assigned Directory**: `/Users/parthsingh/Developer/Cutroom/crates/cutroom-jobs`

---

## Scope & Writable Files

### Writable:
- `/Users/parthsingh/Developer/Cutroom/crates/cutroom-jobs/Cargo.toml`
- `/Users/parthsingh/Developer/Cutroom/crates/cutroom-jobs/src/**`
- `/Users/parthsingh/Developer/Cutroom/crates/cutroom-jobs/tests/**`
- `/Users/parthsingh/Developer/Cutroom/docs/evidence/B0_D.md`

### Strictly Forbidden:
- Editing frontend components or UI packages
- Bypassing SQLite transactions
- Permitting unmanaged child processes to leak on cancel/crash

---

## Technical Requirements

1. **Crate `cutroom-jobs` Dependencies**:
   - `cutroom-core` (for database access and job records)
   - `tokio` (runtime, tasks, channels)
   - `serde`, `serde_json`
   - `thiserror`
   - `uuid`

2. **Job State Machine (`queue.rs`)**:
   - States: `Queued` → `Running` → `Completed` / `Failed` / `Cancelled`.
   - Transitions are atomic SQLite updates recording `step`, `current_step`, `total_steps`, and `updated_at`.
   - Running jobs maintain a `lease_token` with an expiration timestamp (`lease_expires_at`).

3. **Interruption & Startup Recovery (`recovery.rs`)**:
   - On scheduler initialization (application startup):
     - Scan `jobs` table for any jobs in `Running` status with expired leases.
     - Gracefully transition orphaned jobs to `Failed` with error: `"Process terminated unexpectedly / lease expired"`.
     - Inspect associated partial artifacts on disk and purge orphan temporary files.
     - Never report false success for incomplete jobs.

4. **Child Process Cancellation**:
   - Track OS process IDs for active child tasks (e.g. FFmpeg renders).
   - On `job.cancel`:
     - Send SIGTERM to the process group, wait briefly, and escalate to SIGKILL if unresponsive.
     - Remove partial output files.
     - Transition job to `Cancelled`.

5. **Tests**:
   - Test job enqueue and state progression to completed.
   - Test cancellation: verify child process is terminated and job marked `Cancelled`.
   - Test startup recovery: simulate a crashed job with active lease, run recovery handler, and assert job transitions to `Failed` and partial files are cleaned up.
