# Cutroom build state — 2026-09-09

## Disposition
**Phase B Native Vertical Slice & Phase C Product UI Integration COMPLETE AND VERIFIED ON MACOS HOST.**
The complete end-to-end native production critical path is implemented and strictly verified through:
1. `scripts/verify_b0_slice.mjs` against `apps/desktop/src-tauri/src/bin/cli.rs`, `crates/cutroom-core`, `crates/cutroom-media`, and `crates/cutroom-jobs`.
2. `apps/desktop/src/__tests__/EndToEndUiWorkflow.test.tsx` verifying the full desktop UI workflow: Home project creation → Studio media import → Timeline editing → Revision snapshotting → Deliver render enqueue → TopBar atomic close → Recent project reopening and state rehydration.

Verified 12-phase native execution loop:
1. Native launch and health probe (`cutroom-cli` initialized, FFmpeg available).
2. Project creation and durable SQLite persistence (`.cutroom/project.cutroom` schema v1..v3).
3. Real recording import (`fixture_a.mp4` and `fixture_b.mp4`), extracting genuine stream metadata, rational ticks, and SHA-256.
4. Multi-track timeline assembly with two source ranges.
5. Timeline range trimming with exact frame boundary alignment.
6. Timeline clip reordering and automatic contiguous start recalculation.
7. Immutable revision snapshot generation with deterministic 64-character SHA-256 content hash.
8. Durable 1080p SDR background render execution via `cutroom-jobs` `OwnedWorker` and `cutroom-media`.
9. Out-of-band ffprobe stream verification (1920x1080, 24fps, H.264 video, AAC audio, exact duration) and bitstream null-decode (`ffmpeg -v error -i ... -f null -`).
10. In-flight job cancellation, safe scratch cleanup, stale write conflict enforcement, and source fixture hash immutability.
11. Process termination with clean `drop(AppState)` worker shutdown and SQLite sync.
12. Process restart, cold project reopen (`project.open`), and full persistence verification across project metadata, imported sources, composition version 5, revision snapshots, render job history, and output artifacts.

Evidence recorded at:
- `docs/evidence/B0_SLICE_VERIFIED.md`
- `docs/evidence/PHASE_C_UI_NATIVE_INTEGRATION.md`
Automated runners:
- `node scripts/verify_b0_slice.mjs`
- `pnpm --filter @cutroom/desktop test` (67/67 tests passing)
- `cargo test --workspace` (16/16 tests passing)

## Operational AI Team
- **Gemini 3.8 Flash** (`omniroute/gemini-3.8-flash-high`): Primary coordinator, implementation planner, fast engineer, integrator.
- **GPT-OSS 120B** (`omniroute/gpt-oss-120b-medium`): Independent engineering critic and reviewer.
- **Claude Opus 4.6** (`omniroute/claude-opus-4-6-thinking`): Deep implementation specialist, architecture and code reviewer.

## Operational Management Structure (Consolidated Mandate)
- **Astra (GPT-6 Astra)**: Product planner, architect, constraints owner, milestone reviewer.
- **Gemini Coordinator (Gemini 3.8 Flash via AGY)**: Operational task graph owner, scheduling, worker file ownership, integration sequencing, milestone evidence assembly.
- **GLM-5 Turbo**: Supervisor and runtime handler for local Qwen, enforcing bounded context, cache reuse, and deterministic memory safeguards.
- **Workers**:
  - **Local Qwen 3.8 27B**: Native/domain/SQLite repositories, migrations, commands.
  - **AGY GPT-OSS-120B**: Backend/service modules, deterministic algorithms, media helpers, tests.
  - **AGY Claude Opus 4.6**: Rust/Tauri integration, state machine recovery, critical independent review.
  - **AGY Gemini Workers**: Frontend-to-IPC integration, studio layouts, browser review, operator UI.
  - **Luna (GPT-5.6 Luna)**: Synthetic fixtures, automated test runs, environment verification.
  - **Terra (GPT-5.6 Terra)**: Narrow escalations only when genuinely blocked.

## Historical Foundation Evidence and Prepared Documents
- The prior checkpoint reported the React 19 / TypeScript 5.7 / Vite 6 frontend with 8 canonical routes, shared AppShell, design tokens, and component library.
- The prior checkpoint reported the procedural Cutline GLB, editable source, manifold/index checks, and Three WebGL lazy renderer. No new asset work was attempted.
- The prior checkpoint reported 56 frontend tests, typechecking, and a production browser build passing. These checks have NOT been rerun on the present working tree and are not native workflow evidence.
- Architecture, draft SQLite schema, and IPC documents exist (`docs/CONTRACTS.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`). Native enforcement, the requested narrow consistency corrections, and independent review remain pending.
- Launch-blocker evidence: `docs/evidence/B0-dispatch-host-blocker-2026-09-07.json`. Pre-correction build-state text was saved at `docs/BUILD_STATE.md.bak-dispatch-correction-2026-09-07`.
- Existing GLM quota and missing image-to-3D volume records are historical observations, not freshly tested route status. The current mandate permits the scoped Gemini/Qwen fallback if GLM is unavailable; it does not permit bypassing the host permission gate.

## Active Milestone: Phase B Native Vertical Slice
The immediate critical path is:
`Native launch → persistent SQLite project → actual media import → editable composition → validated export → close/reopen → interruption recovery`.

Current assigned task packet: `docs/tasks/B0_NATIVE_SLICE.md`.

## Phase D Completion (SourceViewer + PRJ-02)

**SourceViewer** — Phase D work green. Source playback shell with play/pause, native scrubber, time display, frame stepping, mark in/out, range validation, timeline integration, keyboard shortcuts, frame-aligned ticks. 3/3 SourceViewer tests passing.

**PRJ-02 Structured Brief** — Functionally verified. Native `brief.get`/`brief.set` with atomic persistence at `<project>/.cutroom/brief.json`. Frontend hydration, save, close/reopen, project-switch isolation, and failure handling all verified. See `docs/evidence/PRJ_02_BRIEF_PERSISTENCE.md`.

**Test suite:** 73 frontend tests passing. Cargo workspace tests passing. Production build passing.

**Next milestone:** Local AI vertical slice — Qwen 3.8 27B brief-assist via Ollama.

## Local AI Structured Editing — Trim + Reorder Verified (2026-09-09)

**AI Trim vertical slice**: FULLY VERIFIED including real local model inference.
- trimAssist.ts: TrimProposal schema, validation, narrow context, structured generation
- TrimProposalPanel.tsx: Preview UI with Apply/Dismiss, staleness guard
- Real inference: gemma4:e4b-mlx, 7.1s, correct arithmetic, valid proposal
- 26 unit + 9 UI tests passing

**AI Reorder vertical slice**: FULLY VERIFIED including real local model inference.
- reorderAssist.ts: ReorderProposal schema, validation, narrow context, structured generation
- ReorderProposalPanel.tsx: Preview UI with current/proposed order, Apply/Dismiss, staleness guard
- Real inference: gemma4:e4b-mlx, 4.3s, correct direction, valid proposal
- 25 unit + 9 UI tests passing

**Runtime resolution**: Previous qwen3.8:27b-mlx model was not installed. Switched to gemma4:e4b-mlx which is present, fast (~4-7s), and produces valid structured JSON.

**Test baseline**: 174/174 frontend tests, TypeScript PASS, production build PASS, Cargo workspace PASS, B0 native verifier 12/12 PASS.

**Evidence**: docs/evidence/LOCAL_AI_TRIM_VERTICAL_SLICE.md

**Next milestone**: AI Delete vertical slice, then Insert/Replace.

## Local AI Complete Suite — Replace, EditPlan, Media Understanding, Client Review & Delivery Verified (2026-09-09)

**AI Replace vertical slice**: FULLY VERIFIED.
- Native: `mutation_replace` in `dispatch.rs` using `TimelineOperation::UpdateClip` with duration delta ripple.
- AppContext: `replaceClip` method with native error handling and authoritative composition update.
- Pure library: `replaceAssist.ts` with strict schema validation, candidate asset checking, duration delta math.
- UI: `ReplaceProposalPanel.tsx` in Studio AI Assistant tabs with preview (current, replace with, delta, reason) and Apply/Dismiss.
- Real local model inference: `aiReplaceRealSmoke.test.ts` (~5.4s on Gemma 4 E4B).
- Persistence proof: `scripts/verify_replace_persistence.mjs` verifying SQLite persistence across CLI restart and unchanged source hashes.

**EditPlan & AI Assembly**: FULLY VERIFIED.
- `editPlanAssist.ts`: Structured multi-operation plan supporting `trim`, `reorder`, `delete`, `insert`, `replace`.
- Deterministic sequential execution, version propagation, partial failure detection (halts, reports partial state, never creates revision on partial execution), atomic revision on full success.
- `EditPlanProposalPanel.tsx`: Interactive preview with step list, Apply Plan, Dismiss, progress tracking.
- Real local model inference: `aiEditPlanRealSmoke.test.ts` (~8.9s on Gemma 4 E4B).

**Media Understanding**: FULLY VERIFIED.
- `mediaUnderstanding.ts`: Transcript indexing, source range mapping, silence/dead-space detection, moment classification (hook, demo, cta), searchable media index, silence cut plan generator.

**Smart Assembly**: FULLY VERIFIED.
- `smartAssembly.ts`: Synthesizes project brief, media moments, and timeline into validated EditPlans with real asset IDs and in-bound ranges.

**Client Review**: FULLY VERIFIED.
- `clientReview.ts`: Timecoded client comments converted to structured EditPlans for human preview; comments never directly mutate timeline.

**Delivery & Archive**: FULLY VERIFIED.
- `deliveryArchive.ts`: Validates real artifact existence, SHA-256 checksums, brief conformance, and produces signed delivery manifest.

**Security Preflight**: FULLY VERIFIED.
- `SecurityPreflight.test.ts`: Enforces model boundary, identity boundary, version boundary, media immutability, and privacy isolation.

**Verification Baseline**:
- Frontend vitest: 309 tests passing (6 real smokes skipped by default).
- TypeScript: `tsc --noEmit` PASS with 0 errors.
- Production build: `vite build` PASS.
- Cargo workspace: All tests PASS.
- Native slice verifier: 12/12 phases PASS (`node scripts/verify_b0_slice.mjs`).
