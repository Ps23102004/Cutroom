# Local AI Structured Editing — Vertical Slice Evidence

## Status: VERIFIED (Trim + Reorder)

Date: 2026-09-09

## AI Trim — Fully Verified

### Software Layer
- **trimAssist.ts**: TrimProposal schema, model-boundary validation, domain validation, 
  narrow context builder, structured generation via local AI provider
- **TrimProposalPanel.tsx**: Preview UI with Apply/Dismiss, staleness guard
- **StudioRoute integration**: AI Proposals inspector tab with proposal type selector

### Test Coverage
- TrimAssist.test.ts: 26/26 PASS (domain validation, staleness, context, model output validation, error handling)
- TrimAssistUi.test.tsx: 9/9 PASS (render, apply, dismiss, staleness, errors)

### Real Local Model Inference
- Model: gemma4:e4b-mlx (Ollama, local-only)
- Latency: ~7.1 seconds end-to-end
- Result: Schema-valid, domain-valid trim proposal
- Correct arithmetic: newOutTicks=550000 (600000 - 50000 for 2 seconds at 1/25000 timebase)
- Pipeline: context build → local model → JSON extract → model-boundary validation → domain validation

### Apply Path
- Routes through existing native trimClip() → composition.apply({ action: 'trim' })
- No duplicate mutation logic
- expectedVersion staleness guard prevents stale proposals from reaching native layer

## AI Reorder — Fully Verified

### Software Layer
- **reorderAssist.ts**: ReorderProposal schema, model-boundary validation, domain validation,
  narrow context builder (track clips only), structured generation
- **ReorderProposalPanel.tsx**: Preview UI with current/proposed order visualization,
  Apply/Dismiss, staleness guard
- **StudioRoute integration**: Shared AI Proposals tab with trim/reorder selector

### Test Coverage
- ReorderAssist.test.ts: 25/25 PASS (domain validation incl. boundary checks, staleness,
  context sorting, model output validation, error handling)
- ReorderAssistUi.test.tsx: 9/9 PASS (render, apply, dismiss, staleness, errors)

### Real Local Model Inference
- Model: gemma4:e4b-mlx (Ollama, local-only)
- Latency: ~4.3 seconds end-to-end
- Result: Schema-valid, domain-valid reorder proposal
- Correct direction: "left" (move Interview before Opening)
- Correct version echo: expectedVersion=5
- Reason: "Moving the interview segment to the start creates a stronger, more engaging opening."

### Apply Path
- Routes through existing native reorderClips() → composition.apply({ action: 'reorder' })
- Native reorder performs adjacent swap with timeline start recalculation
- expectedVersion staleness guard prevents stale proposals from reaching native layer

## Architecture Invariants Preserved

1. **Local-only inference**: All AI requests go to 127.0.0.1:11434 (Ollama). Endpoint 
   validation rejects non-loopback addresses. No cloud fallback.
2. **Preview before mutation**: AI output is never auto-applied. User must explicitly 
   click "Apply Edit" after reviewing the proposal.
3. **Staleness guard**: Proposals record composition version at generation time. Apply 
   is rejected if the version has changed. No silent merging.
4. **Dismiss = zero mutation**: Dismiss clears local React state only. No native calls.
5. **Single native path**: Apply routes through the exact existing AppContext mutation 
   (trimClip/reorderClips). No duplicate mutation logic.
6. **Model-boundary validation**: Model output is validated for schema, types, unknown 
   fields, clip identity match, version match, and domain constraints before a proposal 
   is surfaced to the user.
7. **Narrow context**: AI receives only the selected clip, its immediate context 
   (source asset for trim, track siblings for reorder), and composition version. No 
   database dump, no revision history, no unrelated clips.

## Runtime Notes

- Previous sessions referenced qwen3.8:27b-mlx which was not installed
- Current working model: gemma4:e4b-mlx (8.8 GB, Ollama MLX)
- 36 GB system RAM, no memory pressure observed
- Model arithmetic accuracy is imperfect but validation catches errors
- Model produces clean JSON without reasoning contamination when given the 
  REORDER_SYSTEM_PROMPT (trim prompt sometimes gets reasoning in reason field)

## Full Regression

- Desktop frontend: 174/174 PASS (+ 1 real smoke skipped by default)
- TypeScript: PASS
- Production build: PASS
- Cargo workspace: PASS
- B0 native verifier: 12/12 PASS
