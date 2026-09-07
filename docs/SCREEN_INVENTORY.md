# Cutroom screen inventory

Code snapshot: 2026-09-07. This replaces the earlier inventory that described planned capabilities as implemented. Scope is the current browser frontend foundation. The user's desktop contract in `PRODUCT.md`, `docs/DESIGN_CONTRACT.md` and the `apps/desktop/index.html` direction comment remains the intended product; `DESIGN.md` records its current visual implementation.

The native Cutroom core, persistence, media workers, review service and installed desktop package are absent. `src/lib/native.ts` is a provisional Tauri transport adapter. Non-fixture native mutation paths reject unavailable browser transport with `NATIVE_UNAVAILABLE`; they do not create a browser database. Development fixtures require explicit opt-in and `import.meta.env.DEV`, remain labeled and cannot establish native behavior.

## Shared shell

`apps/desktop/src/components/shell/` provides one 216px sidebar, one 56px top bar, a browser-mode banner and a scrolling route body with 24px gutters. `src/routes/manifest.ts` defines the eight primary destinations below and two footer drawers. Paths are manifest values; this inventory does not certify URL routing or browser history.

Glass navigation surrounds matte content. Standard controls are 38px; small buttons and footer utilities are shorter, so minimum target compliance is not universal. Global visible focus exists. Responsive behavior, text scaling and comprehensive accessibility still require executed checks.

## Current screens and outstanding contract

| Screen | Present in source | Required work still outstanding |
|---|---|---|
| Home (`/home`) | Empty workspace, create form, browse/import affordances, conditional resume/recent-project regions, runtime status; one lazy decorative Cutline. | Real project creation, storage and activity from a native backend. |
| Projects (`/projects`) | Directory/search UI, overview, media and asset-detail tabs; create/import forms dispatch client commands. | Durable project store, file picking/ingest, actual stream metadata, proxies and transcripts. |
| Studio (`/studio`) | Project selection gate; preview/timeline/transcript/inspector scaffold; selected timeline operations can be exercised on development fixtures. | Real playback, synchronized media editing, evaluated audio/caption output and native revision persistence. This is not a complete editor. |
| AI Briefs (`/ai-briefs`) | Project gate, brief inputs and plan/source/recipe tabs with unavailable execution. | Source-grounded inference, evaluated model routing, safe proposals, receipts and real recipe runs. |
| Review (`/review`) | Project gate, package/comment/proposal views and disclosure/recipient form scaffold. | Hosted review, upload/publication, exact-rendition feedback and approvals. UI disclosure is not enforcement evidence. |
| Versions (`/versions`) | Project gate, revision list, comparison and restore/fork UI; fixture revisions and provisional native commands. | Durable immutable revisions, cryptographic integrity and actual synchronized visual comparison. |
| Deliver (`/deliver`) | Project gate, preset/preflight/queue/package tabs; neutral Not Checked/Unavailable preflight, disabled render without native connection and empty delivered packages. | Real preflight, rendering, disk measurement, artifact manifests and certified outputs remain unavailable. |
| Settings (`/settings`) | Six tabs: appearance, storage, models, media engine, privacy, diagnostics. Observed F3 source is informational: system preferences, unavailable native readings and disabled bundle generation. | Saved appearance/contrast overrides, detected paths/disk/FFmpeg/hardware/model status, privacy controls and diagnostics generation. F3 source correction is complete; final frontend verification remains pending. |

Project-scoped routes remain reachable without a selected project and present a project gate. Default browser state is empty; populated development screens are fixtures, not customer activity.

## Footer utilities and Cutline

Jobs opens a queue drawer over current context state with cancel/retry client affordances. Real worker progress, recovery and process monitoring are absent. Help & Support searches a small static article set and shows the retained shortcut list. Unsupported shortcuts were removed; immutable revision and hash guarantees are explicitly planned pending native integration. No support assistant is implemented.

The Home-only Cutline loads a procedural ribbon GLB through a lazy Three.js canvas. Pointer motion schedules bounded orientation updates; the source halts rendering when settled, hidden or offscreen and disposes resources on unmount. A static rest PNG covers OS/browser reduced-motion or reduced-transparency preferences, unsupported WebGL, loading and errors. Settings does not save a manual override, and this fallback does not establish global accessibility compliance.

## Evidence boundary

Source inspection supports this inventory; this documentation task did not execute UI or native tests. Read `docs/TEST_EVIDENCE.md` for actual commands/results, pending final frontend verification and independent review findings. Mock-native client tests, standalone media/model smokes and fixture screenshots do not establish production editing, AI, approvals, delivery, security certification or release readiness. Scaffold copy remains subordinate to code and executed evidence.
