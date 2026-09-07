# Frontend finish review — 2026-09-07

## Disposition

**CHANGES_REQUIRED for the bounded browser frontend slice.** The shell has a coherent visual direction, but Settings presents disconnected controls and invented machine state as operational. This is an incomplete frontend review, not approval of a finished native creator studio. Native backend work remains quota-blocked and unverified.

## Contract assessment

Authority: `PRODUCT.md`, `docs/DESIGN_CONTRACT.md`, the direction comment in `apps/desktop/index.html`, and Impeccable's `reference/craft-floor.md`. The explicit user contract wins over generic aesthetic defaults; no generated page comps or missing reference images are assumed.

The supplied eight captures (Home, Settings, Projects, Studio at 1440×900 and 1728×1117) retain the charcoal/plum world, violet actions, restrained ochre runtime warning, matte content, 216px sidebar, 56px command bar, and exact eight-route order with Jobs/Help below. Empty workspace and project-context gating are clear. These captures do not establish the complete Studio workflow or all semantic status colors. Current source takes precedence over older screenshot copy; Home's introductory copy is already corrected.

## Material findings

1. **P1 — Settings reports unmeasured machine capabilities.** `apps/desktop/src/routes/SettingsRoute.tsx:87` hardcodes “124 GiB Free” and SSD/APFS; `:110` asserts Neural Engine acceleration; `:140–148` asserts a hardware encoder, detected FFmpeg 9.0.1, and an audio pipeline without any status query in this component. These contradict the visible unavailable-native state. **Bounded fix:** show unavailable/not checked values until measured backend responses exist; label any intended support explicitly as a target. Do not invent a detection result.

2. **P1 — Accessibility and configuration controls claim effects they cannot provide.** `SettingsRoute.tsx:8–12,43–54` keeps reduced motion and contrast only in route-local state. Neither value reaches CSS or Cutline; `components/cutline/Cutline.tsx:34–47` observes operating-system media queries only. Settings changes disappear on route unmount. Editable storage paths (`:74–84`) and telemetry (`:164–169`) are likewise disconnected; the diagnostics button (`:183–185`) has no handler. **Bounded fix:** connect the browser-capable appearance preferences to shared state and actual styles/fallback behavior, or disable them with an accurate unavailable explanation. Disable native settings and diagnostics until supported; do not let a cosmetic switch appear to save consent. Preserve the operating-system fallback handling.

3. **P2 — A development-only operation has a production affordance.** `components/shell/TopBar.tsx:136–145` always offers fixture loading, but `context/AppContext.tsx:114–120` rejects it outside DEV, producing a dead public control. **Bounded fix:** gate the complete fixture control on `import.meta.env.DEV`. Home's corresponding affordance is already DEV-gated at `routes/HomeRoute.tsx:202`; retain that correction and explicit fixture labels.

4. **P2 — Cutline fallback does not read as the intended ribbon.** Both Home captures show a tiny violet sliver against a conspicuous pale rectangle inside the dark tile. `components/cutline/Cutline.tsx:3,49–76` fits the full wide capture into a 72px square (`HomeRoute.tsx:61`). **Bounded fix:** recapture the existing authorized mesh with tight framing and a transparent or matching plum background, at the final display size; keep the asset decorative and static under preferences. Check the replacement at both supplied desktop sizes. No new concept or image generation is needed.

5. **P1 — Deliver fabricates machine verification and delivered output.** Targeted follow-up inspection confirms `routes/DeliverRoute.tsx:33–38` defines four unconditional passed checks, including matching source hashes, available disk space/estimated output, and embedded fonts. The renderer at `:171` always displays green “Passed,” even independently of `chk.status`. `:122` displays green “Static Profile Ready”; `:70,155` calls these machine-verified. The same route's packages view (`:233–254`) presents a fixed master artifact, truncated invented digest, and a no-handler Finder button. None is fixture-gated or backed by a result query. **Smallest correction acceptance:** retain checklist labels with neutral “Not checked”/unavailable state and no invented details, remove current verification/readiness claims, and render an honest empty packages state without an active Finder action. Preserve existing render dispatch and availability guards. A mocked active project with either native-connected or browser state must not produce passes or output artifacts without actual result data; do not treat presence of native transport alone as verification.

6. **P2 — Help advertises nonexistent shortcuts and completed revision guarantees.** `components/drawers/HelpDrawer.tsx:10–18` advertises Space, Cmd+Z, Cmd+S and 1–8. Targeted handler search and `routes/StudioRoute.tsx:48–83` confirm only S, [, ], Backspace/Delete handlers; no handlers substantiate the other advertised shortcuts. The immutable-revisions article at `HelpDrawer.tsx:27–28` asserts present cryptographic persistence without the native implementation evidence. **Smallest correction acceptance:** remove the unsupported shortcut rows; scope retained editing shortcuts to Studio, selected clips, and the same capability constraints as their actions. Describe revision immutability as an intended requirement pending native verification, or omit the claim. Keep searchable help and the existing backend-unavailable explanation. Do not implement new shortcut or revision systems in this correction batch.

## Preserved strengths

- Consistent shared navigation, legible hierarchy, focused route bodies and persistent footer utilities.
- Calm content surfaces and restrained emphasis; no fabricated activity metrics in these empty-state captures.
- Clear project-context guard and explicit browser/native limitation banner.
- Current Home copy is direct; fixtures are explicitly tagged, and the loader itself is development-restricted.
- Cutline remains bounded to Home, decorative, lazy-loaded, with media-query listeners and a static error fallback.

## Verification limitations

Read-only source inspection and visual inspection of all eight supplied PNGs; no browser execution or new tests. File line references record the inspected state and may shift during root edits. The detector artifact records an old width-transition warning; current `JobsDrawer.tsx` no longer contains that transition, so it is not repeated as an open finding. Contrast ratios, keyboard behavior, text scaling, populated editing views, native persistence, FFmpeg/ASR, permissions, approval authenticity, and delivery correctness are **not verified** by this review. Native backend functionality is not passed.

## Final correction verdict — F3 / F4 / L7

**PASS for resolution of the six scoped frontend defects below: 6 resolved, 0 partial, 0 unresolved.** This supersedes the initial correction disposition for these findings only. It does not approve product completeness or native functionality.

| Finding | Final status | Verified correction |
|---|---|---|
| 1. Settings machine claims | Resolved | Current `SettingsRoute.tsx` removes invented disk capacity, filesystem, encoder, FFmpeg detection, acceleration and pipeline results. It shows unavailable runtime readings and labels the ASR choice as a target. |
| 2. Disconnected Settings controls | Resolved | Cosmetic switches and editable fake paths are gone. Appearance uses read-only system/unavailable explanations; telemetry is unavailable and diagnostics generation is disabled. The existing Cutline media-query subscription remains. This resolves misleading controls, not the still-unimplemented manual preferences. |
| 3. Public fixture affordance | Resolved | `TopBar.tsx` now gates its entire fixture control with `import.meta.env.DEV`, matching Home and the loader. Development screenshots correctly retain the fixture controls; production runtime verification is still pending. |
| 4. Cutline fallback framing | Resolved | Current `Cutline.tsx` references `cutline-runtime-fallback.png`. Both refreshed Home captures show a clearly framed violet ribbon with ochre edge over the plum tile, without the pale rectangle. `L7-fallback.md` records the existing-mesh render and matching public artifact. |
| 5. Deliver fabricated verification/output | Resolved | Current `DeliverRoute.tsx` uses pending checklist data with neutral unchecked/unavailable badges, neutral readiness, planned-target copy, and an empty delivered-packages state. Invented master/digest and the dead Finder action are removed; disconnected render submission is guarded. |
| 6. Help unsupported shortcuts/guarantees | Resolved | Current `HelpDrawer.tsx` removes Space, Cmd+Z, Cmd+S and 1–8. Retained edit shortcuts name Studio and selected clips; native availability is explained in the help articles. Revision immutability is explicitly planned and unavailable in browser preview. |

Final review evidence: personally inspected the refreshed 20:40 UTC Home, Settings, Projects and Studio captures at both desktop sizes, plus `studio-fixture-1440x900.png`, and the corrected source files named above. The fixture capture is clearly labeled and shows unavailable media preview; it is not evidence of a working native editor. Read `frontend-independent/test.log` (7 token + 3 UI + 46 desktop = **56 passed tests**), `typecheck.log` and `build.log` (all three workspace packages done), and `frontend-independent/report.json` (eight browser checks passed, run started `2026-09-07T20:40:27.192Z`). These are other agents' executed evidence, not tests rerun by this reviewer.

Remaining verification limits: expanded production-build fixture checks and live GLB checks are pending at this verdict; source gating and fallback captures do not substitute for them. No native persistence, media processing, security/approval guarantees, end-to-end delivery, complete accessibility certification, or full product-contract coverage is certified. No broader defect hunt or design expansion was performed in this verdict pass.
