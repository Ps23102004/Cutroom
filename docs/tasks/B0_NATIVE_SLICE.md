# Task Packet B0 — Native Core & First Vertical Slice

**Parent Milestone**: Phase B — First Native Vertical Slice  
**Assigned Coordinator**: Gemini 3.8 Flash (via AGY)  
**Assigned Workers**:
- Local Qwen 3.8 27B (supervised by GLM-5 Turbo): `crates/cutroom-core` SQLite repositories, migrations, domain models
- AGY GPT-OSS-120B: `crates/cutroom-media` FFmpeg/ffprobe wrappers, filtergraph compiler, probe tests
- AGY Claude Opus 4.6: `crates/cutroom-jobs` durable queue, lease recovery, and Tauri IPC integration review
- AGY Gemini Worker: `apps/desktop/src/lib/native.ts` and `apps/desktop/src/context/AppContext.tsx` live IPC binding
- Luna: Synthetic test fixtures and independent cargo test verification

---

## Objectives

1. **Cargo Workspace & Rust Core**:
   - Initialize `/Users/parthsingh/Developer/Cutroom/Cargo.toml` and `crates/cutroom-core`.
   - Implement SQLite migrations and database connection pooling using `rusqlite` (bundled).
   - Implement domain entities matching `docs/DATA_MODEL.md`.
   - Implement optimistic locking (`expected_version`) and idempotency digest (`operation_receipts`).
   - Implement content-hashed immutable revisions (`revisions`).

2. **Media Probe & Timeline Render**:
   - Create `crates/cutroom-media`.
   - Implement media probing via `/opt/homebrew/bin/ffprobe` extracting streams, codec, resolution, audio channels, and rational duration ticks.
   - Implement 2-clip timeline compilation into an FFmpeg export command creating a 1080p H.264/AAC MP4.

3. **Durable Job Engine**:
   - Create `crates/cutroom-jobs`.
   - Implement job queue state machine (`queued` → `running` → `completed` / `failed` / `cancelled`).
   - Implement startup lease recovery: stale jobs marked failed gracefully.

4. **Tauri IPC Bridge**:
   - Set up `apps/desktop/src-tauri` with command `dispatch` taking `NativeRequest` and returning `NativeResponse`.
   - Wire commands: `health.get`, `project.create`, `project.open`, `project.list`, `asset.import`, `asset.list`, `composition.get`, `composition.apply`, `revision.create`, `render.enqueue`, `job.list`.

5. **Independent Verification Suite**:
   - Test independent database reopen (persistence across sessions).
   - Test stale write conflict rejection.
   - Test operation ID reuse (idempotency vs conflict).
   - Test invalid source range rejection.
   - Test immutable revision content hash calculation.
   - Test real FFmpeg probe and render on a sample video fixture.

---

## File Ownership & Boundaries

### Writable by Workers:
- `/Users/parthsingh/Developer/Cutroom/Cargo.toml`
- `/Users/parthsingh/Developer/Cutroom/Cargo.lock`
- `/Users/parthsingh/Developer/Cutroom/crates/**`
- `/Users/parthsingh/Developer/Cutroom/apps/desktop/src-tauri/**`
- `/Users/parthsingh/Developer/Cutroom/apps/desktop/src/lib/native.ts`
- `/Users/parthsingh/Developer/Cutroom/apps/desktop/src/context/AppContext.tsx`
- `/Users/parthsingh/Developer/Cutroom/docs/evidence/B0.md`

### Forbidden to Workers:
- Modifying frontend tokens or UI packages (`packages/**`)
- Editing core contracts (`docs/CONTRACTS.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`) without Astra approval
- Arbitrary network calls, public deployments, or deleting source media

---

## Acceptance Criteria

1. `cargo test --workspace` passes all unit and integration tests.
2. An end-to-end run demonstrates:
   - Create project in SQLite database.
   - Import video asset and probe stream metadata.
   - Assemble two clips on the timeline and apply trim.
   - Save immutable revision with valid SHA-256 hash.
   - Render 1080p MP4 output via FFmpeg.
   - Close database, reopen, and confirm all project entities reload accurately.
   - Simulate interrupted job and verify startup lease recovery.
3. Luna and Gemini coordinator submit verified test evidence in `docs/evidence/B0.md` to Astra for milestone review.
