# T0 Design Contract Review — Narrow Terra Escalation

**Decision:** CHANGES_REQUIRED

**Scope:** Independent prose review of `docs/DESIGN_CONTRACT.md` against `references/MASTER.md` §§7–9 and the owner mandate. This is a temporary, narrow GPT-5.6 Terra escalation because the required GLM 5.3 provider call failed with quota error `429/1310`; GLM did not participate in this review. No source, image, mesh, browser, accessibility, or performance tests were executed.

## What is coherent

The fixed navigation, focused Studio inspectors, matte content/glass control layer, truthful project/review states, and the single Cutline ribbon family align with the mandate. Cutline has a product-grounded purpose: a small timeline/editing metaphor at onboarding, Home, and one verified completion moment. It is correctly excluded from the Studio canvas and must remain decorative, never status-bearing.

The stated 25k-triangle, 1024px-texture, <=2 MB asset, DPR cap, demand rendering, disposal, and no-WebGL fallback are useful **targets**, not achieved performance claims. Bounded image studies may proceed only after the corrections below are incorporated and the required provider/converter availability is independently recorded. The studies must be isolated, geometry-friendly object references followed by an actual mesh, profiling, and fallback validation; images themselves do not satisfy the asset requirement.

## Required corrections before F1 asset studies or implementation

1. **Remove the WCAG certification claim.** `DESIGN_CONTRACT.md:166` says every token combination meets WCAG AA, while `MASTER.md:233` expressly requires rendered measurement and says these starter tokens are not automatically certified. This is also false as written: `#713D50` on `#221E29` is about **1.93:1**, and `#877E94` on `#221E29` about **4.23:1**. Replace the blanket claim and per-token ratio assertions with: named, rendered foreground/background/control pairs will be measured for each supported theme and state; unsupported pairs are prohibited; status additionally uses text and icons. Add the §7.3 interaction requirements: labels, keyboard operation, focus restoration/order, announcements, no hover-only critical action, reduced transparency/high contrast, text scaling/long filename/zoom testing.

2. **Correct privacy wording.** `DESIGN_CONTRACT.md:102` must not offer generic “cloud sync permissions.” The product contract keeps project SQLite, originals, edits, local inference, and render state local; cloud use is limited to explicitly published review/delivery artifacts and consented support tickets. Rename the setting and describe explicit share/publish consent and exactly what leaves the device. It must not imply live-project or media synchronization.

3. **Make render controls capability- and evidence-bound.** `DESIGN_CONTRACT.md:98` promises “time remaining, cancel/pause semantics.” Show an ETA only when a defined estimator provides a confidence-qualified value; otherwise show elapsed time/current stage without a fabricated estimate. Render pause must be absent/disabled with an explanation unless that worker implements safe pause or pause-between-steps, per `MASTER.md:444`. Keep cancel/retry and real progress separate from decorative Cutline motion.

4. **Align audio wording with the specified customer control.** `DESIGN_CONTRACT.md:69` should specify the required waveforms, dialogue/music levels, fades, measured loudness options, clipping warnings, and conservative optional cleanup with A/B preview. A noise gate is only an optional implementation of cleanup after audio evaluation; it cannot be the implied default or substitute for those controls.

5. **Resolve Cutline material/draw-call feasibility.** The three independently specified finishes in `DESIGN_CONTRACT.md:245–247` normally imply at least three material groups/draw calls, contradicting the two-call scene maximum at line 265. Require an implementation choice before modeling: preferably one merged mesh and one material using vertex colors/UV atlas or procedural masks for face/reverse/edge; otherwise record measured draw calls and an ADR that revises the target. The scene budget must include all active Cutline geometry, not just the GLB.

6. **Complete the motion/accessibility contract.** Cutline’s `idle` micro-rotation and `processing` breathing state need the §7.3 pause/disable control for longer ambient animation, immediate reduced-motion/static behavior, no pointer-only essential behavior, and a semantic treatment: decorative canvas/fallback is hidden from assistive technology; any user-facing job state remains a live textual status. Do not write “pause” for rendering here; this is an animation preference only. Also replace “SVG / WebP vector graphic” at line 268: WebP is raster. Define either an SVG fallback or a pre-rendered WebP fallback with appropriate accessible semantics and measured transfer size.

7. **Keep asset progression honest.** The “Actual Google Image Tool Inventory” is an environment observation, not proof that a named Nano Banana backend, rights, model identity, or an image call is verified. Preserve it as unverified until a real authorized call produces a saved output and receipt. Before any image generation, verify the design ZIP/current assets and the converter’s documented contract as required by `MASTER.md:285–294,312–334`.

## Gate outcome

Do not treat F0 as approved. After the seven corrections are made, the visual direction is suitable for the mandate’s bounded two-initial-studies-per-available-provider sequence, subject to provider authorization/cost controls and independent pre-integration performance/accessibility checks.

## Verification record

| Check | Result |
|---|---|
| Prose comparison: design contract vs. MASTER §§7–9 | Completed |
| Contrast spot check of declared opaque token pairs | Completed; does not certify rendered UI |
| Source/image/mesh/performance/accessibility tests | Not executed — out of scope for prose review |
| GLM 5.3 provider participation | Not available — actual run failed `429/1310` quota exhausted |

---

## T0 correction verification — follow-up

**Decision:** APPROVED_WITH_CONDITIONS for the narrowly bounded F1 image-study gate only. This does not approve runtime integration, profiling, mesh conversion, or replace the blocked GLM 5.3 review.

### Verified corrections

1. The WCAG blanket certification is removed; the contract now requires named rendered-pair measurement, prohibits unmeasured tertiary usage, and adds the required keyboard, focus, announcement, non-hover, preference, scaling, filename, and zoom expectations.
2. Privacy now permits only explicit hosted review/delivery artifacts and consented support, and explicitly excludes project-database and original-media sync.
3. Render UI now uses measured progress/current stage and elapsed time; ETA requires an estimator, and pause is absent without safe worker semantics.
4. Audio now names the required controls and limits an unevaluated noise gate.
5. The material/draw-call conflict has a feasible one-merged-mesh, one-material, vertex-color plan and requires actual renderer validation later.
6. The contract correctly distinguishes decorative animation controls from render pause, makes the asset decorative/`aria-hidden`, retains textual job state, and correctly identifies SVG as vector and WebP as raster.
7. Provider/tool identity is now characterized as declared or unverified until a real authorized output and receipt exist. `ASSET_PLAN.md` limits F1 to **one initial image per available provider**, with no extra generation before comparison and no private input/new charges.

### Conditions to resolve before generating either image

1. `DESIGN_CONTRACT.md:255–260` still says idle micro-rotation and processing breathing occur while a render job executes. Its later binding correction says Cutline idle is static and there is no continuous decorative activity during rendering. Replace the older motion-state rows or explicitly state that the T0 correction overrides them. The F1 brief already follows the safer static/no-continuous-motion rule.
2. `DESIGN_CONTRACT.md:291` still asserts that `generate_image` “is provided” by the Google route, which conflicts with the immediately preceding “Declared / untested” inventory and the asset plan’s opaque-tool/model-unverified rule. Change it to a conditional route description until a real authorized call yields an output/receipt.

### Gate boundary

Once those two text-only corrections are applied, proceed with exactly one isolated, geometry-friendly Cutline study through each actually available existing provider route. Record the actual provider/model metadata when exposed, output paths/hashes, and comparison result. Do not claim a mesh, accessibility compliance, or performance target has been met; those require the later converter/runtime validation gate.

| Follow-up check | Result |
|---|---|
| Seven original corrective findings | Six verified; one has conflicting legacy motion text |
| F1 study scope | Verified: one initial image per provider, comparison before more generation |
| Runtime, mesh, performance, accessibility testing | Not executed — expressly outside this narrow gate |

### Final recheck

The original motion table now matches the binding correction: idle is static and processing is static through editing, playback, and rendering. The secondary-token ratio claim is also removed. These resolve the first follow-up condition.

**Final verdict: APPROVED_WITH_CONDITIONS** for exactly one initial, isolated Cutline image study through each actually available existing provider route. The sole remaining documentation condition is to change `DESIGN_CONTRACT.md`'s conclusion that the Google `generate_image` route “is provided” to a conditional/declarative statement consistent with its own **Declared / untested** evidence row. Until an authorized call produces an output and receipt, the route and named backend/model remain unverified.

No runtime performance, mesh, converter, browser, or accessibility validation was performed or approved by this verdict.
