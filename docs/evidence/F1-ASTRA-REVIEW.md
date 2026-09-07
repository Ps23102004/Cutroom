# F1 integration review — CHANGES_REQUIRED

Source inspection during implementation, not final test results. Frontend cannot pass design/product honesty gate yet.

1. Remove development image-tool identities from product runtime UI. `generate_image` is currently shown as a local planner in Studio, Settings and AI Briefs. This confuses the two AI systems and violates the explicit mandate. Show unavailable/not evaluated until backend runtime registry exists.
2. Remove fixed peak/clipping claims (`-2.1 dBFS`, `-2.4 dBFS`, no clipping) and unconditional waveform cache/readiness. Only actual analysis results may display these.
3. Program preview is a div with play/pause labels; no media plays. It must say preview unavailable and disable playback until actual media source is bound. Do not label this Live Approximation or Playing.
4. Captions/audio/branding local controls do not persist or execute. Bind backend operations or explicitly disable them with a pending integration explanation; no claim subtitle bundles export or certification of presets.
5. Production fixtures must never use owner-specific invented Movies paths. Use clearly synthetic portable paths. Fixture mode should be development-only and visibly labeled throughout.
6. Time is not rational just because tick fields are strings. Each asset/composition needs an explicit time_base and rational frame rate. Current formatTimecode formula hardcodes inconsistent 24000/fps and Number conversion can lose precision. Isolate a correct integer/rational formatter; test 24/30/30000:1001 and large tick strings. Clip source trim mapping must account for timelineStart and source in offset.
7. Implement keyboard clip selection and project selection (buttons, not click-only divs), input labels and dialog focus trap/restoration. Preserve unrelated route state.
8. No generic catch that returns as success: failed save/import/apply must keep dialog and show actionable typed error. Refetch version after mutation; stale writes must remain conflicts.
9. Package version specifications should be pinned and lockfile authoritative. Tests must test behavioral failures, no mock IPC claims as native verification. Root test script must run meaningful suites.

Backend implementation remains blocked by GLM quota and required fallback decision. This does not permit inventing backend data or source contracts that are described as synchronized.

10. BLOCKER: AppContext.tsx creates projects/assets in memory in ordinary browser mode, invents codec/duration/dimensions and performs local composition edits; this is a fake backend even without localStorage. Remove all production fallbacks. Native operations must dispatch or reject NATIVE_UNAVAILABLE. Fixture-only branches may remain strictly development-only, visibly synthetic, and must never satisfy production tests.
