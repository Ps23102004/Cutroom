# Task Packet B0-A — SQLite Core & Relational Persistence

**Parent Milestone**: Phase B — Native Vertical Slice  
**Assigned Worker**: Local Qwen 3.8 27B  
**Supervisor**: GLM-5 Turbo (context bounding, cache preservation, deterministic memory guard)  
**Assigned Directory**: `/Users/parthsingh/Developer/Cutroom/crates/cutroom-core`

---

## Scope & Writable Files

### Writable:
- `/Users/parthsingh/Developer/Cutroom/Cargo.toml` (root workspace)
- `/Users/parthsingh/Developer/Cutroom/crates/cutroom-core/Cargo.toml`
- `/Users/parthsingh/Developer/Cutroom/crates/cutroom-core/src/**`
- `/Users/parthsingh/Developer/Cutroom/docs/evidence/B0_A.md`

### Strictly Forbidden:
- Editing frontend `apps/**`, `packages/**`, or global lockfiles
- Modifying `docs/CONTRACTS.md` or `docs/ARCHITECTURE.md`
- Running network downloads or package managers outside cargo local cache

---

## Technical Requirements

1. **Workspace Root**:
   Create `/Users/parthsingh/Developer/Cutroom/Cargo.toml`:
   ```toml
   [workspace]
   members = [
       "crates/cutroom-core",
       "crates/cutroom-media",
       "crates/cutroom-jobs",
       "apps/desktop/src-tauri"
   ]
   resolver = "2"
   ```

2. **Crate `cutroom-core` Dependencies**:
   - `rusqlite` with features `["bundled"]` (or bundled SQLite)
   - `serde`, `serde_json`
   - `uuid` with features `["v4", "serde"]`
   - `sha2` (for content hashing)
   - `chrono` (ISO-8601 timestamps)
   - `thiserror` (error handling)

3. **Schema & Migrations**:
   Implement schema matching `docs/DATA_MODEL.md`:
   - `projects` table
   - `assets` table
   - `compositions` table (with version integer and rational timebase)
   - `tracks` table
   - `clips` table (with string rational ticks for in_ticks, out_ticks, timeline_start_ticks, timeline_duration_ticks)
   - `revisions` table (with SHA-256 content_hash and JSON composition_snapshot)
   - `operation_receipts` table (for idempotency: operation_id, expected_version, payload_hash, response_json)

4. **Domain Repositories & Engine**:
   - `ProjectRepository`: create, get, list, open (enforcing single-writer lock).
   - `AssetRepository`: create, get, list.
   - `CompositionRepository`: get, apply_mutation.
     - Enforces `expected_version` matches current composition version; returns `StaleWriteConflict` if mismatched.
     - Enforces clip source range does not exceed asset duration ticks; returns `InvalidSourceRange` if out of bounds.
     - Stores operation receipt; duplicate `operation_id` with matching payload returns previous result, while mismatched payload returns `IdempotencyConflict`.
   - `RevisionRepository`: create (computes SHA-256 hash of tracks and clips JSON), list, restore.

5. **Unit & Integration Tests**:
   - Test independent reopen: open DB, insert project/assets/clips, close connection, open new connection, verify identical state.
   - Test stale write conflict: attempt mutation with `version = N-1` and assert error returned.
   - Test idempotency digest: attempt repeat of `operation_id` with different payload and assert error returned.
   - Test invalid source range: attempt clip with `out_ticks > asset.duration_ticks` and assert error returned.
   - Test content hash determinism: verify revision content hash is repeatable and changes when clip arrangement changes.
