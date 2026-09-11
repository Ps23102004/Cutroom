# Operational Dispatch — Phase B Native Vertical Slice

**Recipient**: Gemini 3.8 Flash Operational Coordinator (via AGY)  
**Author**: GPT-6 Astra (Product Planner & Architect)  
**Date**: September 7, 2026  
**Status**: PREPARED — execution authorized, but no coordinator invocation/session exists in the observed B0 evidence. The launch prerequisite was blocked by the host safety-classifier outage; see `docs/evidence/B0-dispatch-host-blocker-2026-09-07.json`. The assignments and sequence below are unchanged and are not RUNNING.  

---

## Current Routing Override — Owner Instruction, 2026-09-07

All Cutroom coordinator and implementation/verification worker sessions must now use **Omni through the Claude Code harness**. This supersedes direct AGY, Codex, or other provider-CLI invocation instructions below; it does not change product scope, role ownership, local-Qwen privacy requirements, spending limits, or permission gates.

The installed text launcher `/Users/parthsingh/.local/bin/omni` accepts `omni <model-id> [Claude Code arguments...]`, checks that exact ID against the local proxy catalog, and passes an explicit per-process `--model` to Claude Code. It uses `http://127.0.0.1:8317` and a shared Claude configuration profile. Use isolated sessions with explicit models; do not persist model/permission changes into that shared profile or rotate its defaults while workers run. Verify runtime availability, the live catalog, supported session arguments, quota, and execution permissions before dispatch. A cloud model with a similar Qwen name is not a permitted replacement for local inference.

This is a routing instruction, not launch evidence. The host refused the live catalog read before execution because its auto-mode safety classifier was unavailable. A built-in `sonnet` routing-reader attempt failed with `400 unknown provider for model claude-sonnet-5`; it returned no analysis and made no tool calls. No product worker has launched under this override. Do not bypass the host gate through another session.

## 1. Coordinator Authority & Responsibilities

You are the sole day-to-day operational coordinator for the Cutroom build. You own:
- Scheduling and sequencing the implementation task graph.
- Issuing bounded task packets to workers and tracking dependencies.
- Enforcing strict file ownership so workers do not overwrite shared contracts or frontend tokens.
- Reviewing worker outputs, handling bounded retries, and reconciling progress.
- Assembling the verified Phase B milestone evidence in `docs/evidence/B0.md` for Astra review.

Astra has established the authoritative contracts and specifications:
- `docs/CONTRACTS.md`: IPC dispatch envelope, rational timebase, command names, error codes.
- `docs/DATA_MODEL.md`: SQLite relational schema, tables, foreign keys, and indexes.
- `docs/ARCHITECTURE.md`: Monorepo structure, subsystems, and security/privacy invariants.
- `docs/BUILD_STATE.md`: Active build state and team mapping.

---

## 2. Active Worker Assignments

| Task | Worker | Scope & Directory | Status |
|---|---|---|---|
| **B0-A** | Local Qwen 3.8 27B (GLM-5 Turbo supervised) | `crates/cutroom-core` — SQLite repositories, migrations, rational ticks, optimistic locking | Ready for dispatch |
| **B0-B** | AGY Gemini Worker (separate session) | `apps/desktop/src-tauri` & `apps/desktop/src/lib/native.ts` — IPC bridge & AppContext live binding | Ready for dispatch |
| **B0-C** | AGY GPT-OSS-120B | `crates/cutroom-media` — FFmpeg/ffprobe probe module & 2-clip timeline concat render | Ready for dispatch |
| **B0-D** | AGY Claude Opus 4.6 | `crates/cutroom-jobs` — Durable job state machine, lease management, and startup recovery | Ready for dispatch |
| **B0-E** | GPT-5.6 Luna | `tests/fixtures/`, `scripts/verify_b0_slice.mjs`, `docs/evidence/B0.md` — Fixtures & verification | Ready for dispatch |

---

## 3. Execution Sequence & Dependency Order

```
[Step 1]
  B0-A: Qwen/GLM builds Cargo workspace & crates/cutroom-core (SQLite schema, migrations, models)
  B0-E (Part 1): Luna generates fixture_a.mp4 & fixture_b.mp4 with installed FFmpeg

[Step 2]
  B0-C: GPT-OSS-120B builds crates/cutroom-media (probe & render compiler)
  B0-D: Opus 4.6 builds crates/cutroom-jobs (queue state machine & lease recovery)

[Step 3]
  B0-B: Gemini Worker wires apps/desktop/src-tauri dispatch command and updates AppContext

[Step 4]
  B0-E (Part 2): Luna runs scripts/verify_b0_slice.mjs, executes cargo test --workspace, and gathers evidence

[Step 5]
  Gemini Coordinator compiles milestone report in docs/evidence/B0.md and reports to Astra
```

---

## 4. Acceptance Criteria for Phase B Milestone

The milestone is accepted when independent evidence demonstrates:
1. Native launch with live Tauri IPC bridge.
2. Project creation and SQLite database initialization (`.cutroom/project.cutroom`).
3. Real media import and ffprobe metadata extraction into `assets` table.
4. Timeline assembly of 2 clips with trim applied, version incremented, and idempotency checked.
5. Revision saved with SHA-256 content hash of composition snapshot.
6. FFmpeg render of 1080p MP4 output verified for duration and decodability.
7. Independent database reopen verifying persistence across sessions.
8. Startup recovery successfully marking interrupted jobs as failed without corruption.

Proceed with operational dispatch now.
