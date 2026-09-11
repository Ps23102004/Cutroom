# AI Replace, Assembly, Media Understanding, Client Review & Delivery Verification

**Date**: 2026-09-09  
**Status**: VERIFIED  

---

## 1. Native Replace Primitive
- **Primitive**: `TimelineOperation::UpdateClip` dispatched atomically via `action: "replace"`.
- **Invariants**: Clip ID preserved, track ID preserved, sort order preserved, timeline start preserved. Asset ID swapped, source in/out ticks updated, duration updated, and later clips rippled by duration delta.
- **Native tests**: `timeline_regressions.rs::replace_swaps_asset_and_range_in_place_with_delta_ripple` PASS.
- **Full workspace**: `cargo test --workspace` PASS (all packages).
- **Persistence proof**: `scripts/verify_replace_persistence.mjs` PASS.
  - Project created -> assets imported -> clip added -> atomic replace applied -> version bumped -> revision created -> app closed (state dropped) -> app reopened from SQLite -> replacement persisted -> source asset hashes identical.

---

## 2. Frontend AI Replace Vertical Slice
- **Module**: `apps/desktop/src/lib/replaceAssist.ts`
- **Component**: `apps/desktop/src/components/ReplaceProposalPanel.tsx`
- **UI Route**: Integrated in Studio AI Assistant tabs (`StudioRoute.tsx`).
- **Tests**:
  - Unit: `apps/desktop/src/__tests__/ReplaceAssist.test.ts` (27 tests PASS).
  - UI: `apps/desktop/src/__tests__/ReplaceAssistUi.test.tsx` (5 tests PASS).
  - Real local model smoke: `apps/desktop/src/__tests__/aiReplaceRealSmoke.test.ts` PASS (~5.4s on Gemma 4 E4B).

---

## 3. EditPlan & AI Assembly
- **Module**: `apps/desktop/src/lib/editPlanAssist.ts`
- **Component**: `apps/desktop/src/components/EditPlanProposalPanel.tsx`
- **Capabilities**: Supports composite user instructions (e.g. "Create a 45-second product demo. Start with the strongest demo, shorten the interview, remove repetition, and end with CTA.")
- **Allowed Operations**: `trim`, `reorder`, `delete`, `insert`, `replace`.
- **Safety Invariants**:
  - Each operation reuses its specific domain validator.
  - Unknown operations rejected at the model boundary.
  - Sequential deterministic execution with version propagation.
  - Partial failure detection: halts immediately, records partial state, never reports full success or creates revision on partial execution.
  - Revision created ONLY after complete 100% success.
- **Tests**:
  - Unit: `apps/desktop/src/__tests__/EditPlanAssist.test.ts` (10 tests PASS).
  - UI: `apps/desktop/src/__tests__/EditPlanAssistUi.test.tsx` (4 tests PASS).
  - Real local model smoke: `apps/desktop/src/__tests__/aiEditPlanRealSmoke.test.ts` PASS (~8.9s on Gemma 4 E4B).

---

## 4. Media Understanding & Smart Assembly
- **Modules**:
  - `apps/desktop/src/lib/mediaUnderstanding.ts` (ASR segments, source range mapping, silence detection, moment classification, searchable media index).
  - `apps/desktop/src/lib/smartAssembly.ts` (synthesizes brief, moments, and timeline into validated EditPlans).
- **Tests**:
  - `apps/desktop/src/__tests__/MediaUnderstanding.test.ts` (4 tests PASS).
  - `apps/desktop/src/__tests__/SmartAssembly.test.ts` (3 tests PASS).

---

## 5. Client Review & Delivery/Archive
- **Modules**:
  - `apps/desktop/src/lib/clientReview.ts` (translates timecoded comments into structured EditPlans for creator preview/approval; comments never directly mutate timeline).
  - `apps/desktop/src/lib/deliveryArchive.ts` (validates artifact existence, SHA-256 checksums, brief conformance, and produces delivery manifest).
- **Tests**:
  - `apps/desktop/src/__tests__/ClientReview.test.ts` (2 tests PASS).
  - `apps/desktop/src/__tests__/DeliveryArchive.test.ts` (2 tests PASS).

---

## 6. Security Preflight & Regression Summary
- **Security suite**: `apps/desktop/src/__tests__/SecurityPreflight.test.ts` (6 tests PASS).
- **Frontend suite**: 309 tests passing (6 real smokes skipped by default).
- **TypeScript**: `pnpm --filter @cutroom/desktop typecheck` PASS.
- **Production build**: `pnpm --filter @cutroom/desktop build` PASS.
- **Native suite**: `cargo test --workspace` PASS.
- **Native slice verifier**: `node scripts/verify_b0_slice.mjs` PASS (12/12 phases).
