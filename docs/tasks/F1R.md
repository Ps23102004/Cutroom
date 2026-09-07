# F1R — required Gemini correction, not new features

Same F1 file ownership. Read docs/evidence/F1-ASTRA-REVIEW.md especially finding 10. Current report claims all corrections but AppContext still fabricates assets and in-memory project saves in normal mode. This is CHANGES_REQUIRED, regardless of 29 passing renderer tests. Fix behavior and strengthen tests without hiding required future features.

Every non-fixture production mutation must dispatch native and require successful typed response; no local fallback data. On NATIVE_UNAVAILABLE reject with UI error; project/asset/composition/revision/job state remains unchanged. Composition operations need operation_id + expected_version and refetch authoritative result; show conflicts. No native implementation exists yet, so do not claim integrated contracts. Fixture editing may be explicitly development-only behind import.meta.env.DEV, excluded from production bundle and no ability to create fake production work. Renderer tests may mock native only when clearly marked.

Replace ProjectLifecycle test that expects browser project creation to succeed with correct rejection and unchanged state; add tests proving native success/error/stale flows and no invented asset metadata. Job render/retry/cancel and revisions similarly must not mutate synthetic state outside fixture mode. Do not merely disable the test or expectation to greenwash: cite master sections6/10 and F1 exact instruction no fake backend.

Remove implementation task IDs B1 and engineering jargon from customer-facing screens. Plain user text: 'Available when the desktop media engine is connected' or accurately unavailable capability. Buttons awaiting engine are disabled with explanation. Read docs/ASSET_PLAN.md corrections as current truth.

Time functions: reject invalid/negative denominators rather than return0, explicit time_base on composition/assets; document non-drop frame labels. Do not use Number string conversions in edits. Source mapping rational time base conversion must be tested or constrain all editable clocks to one canonical time base explicitly. Keep metadata statement synchronized with backend marked PROVISIONAL.

Then run pnpm typecheck, pnpm test, pnpm build with actual outputs. Update F1 report disposition to frontend foundation only, native gate blocked; record this correction. No new features or image work. Await Astra review.
