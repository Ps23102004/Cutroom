# CUTROOM — DESIGN CONTRACT & FRONTEND SPECIFICATION
**Document:** `docs/DESIGN_CONTRACT.md`  
**Role:** Cutroom Frontend / Design Lead (Gemini 3.8 Flash via AGY)  
**Consumer:** GPT-6 Astra (Orchestrator), GLM 5.3 (Planning/Review), GLM 5.2 (Backend Lead)  
**Status:** Design contract with Astra corrections from T0; runtime verification pending  
**References:** `references/MASTER.md` (Sections 4, 5, 7, 8, 9), `references/build-pack/Cutroom_Build_Pack/DESIGN_CONFLICTS.md`

---

## 1. Canonical Navigation Hierarchy & Shell Architecture

### 1.1 Fixed Primary Sidebar Navigation
The desktop application shell enforces a single immutable eight-item primary navigation order across all desktop screens. No route or component may reorder, add, or omit primary items.

```
[Logo / Brand Mark: Cutroom]
------------------------------------
1. Home          (Workspace overview, resume card, recent projects, attention items)
2. Projects      (Project directory, brief, media assets, asset detail)
3. Studio        (Synchronized editor: preview, timeline, transcript, focused inspectors)
4. AI Briefs     (Intent, bounded plan, source selections, recipe runs)
5. Review        (Package management, client comments, change proposals, approvals)
6. Versions      (Immutable revision history, visual comparison diffs, restore)
7. Deliver       (Output preset setup, preflight checks, render queue, packages)
8. Settings      (App preferences, storage, models, media engine, privacy, diagnostics)
------------------------------------
[Footer Utilities]
• Jobs           (Truthful background task queue & process monitor)
• Help & Support (Searchable documentation, diagnostics, local support assistant)
```

### 1.2 Context & Scope Rules
- **Workspace-Wide Scope (`Home`, `Projects`, `Settings`):** Accessible without an open project.
- **Project-Scoped (`Studio`, `AI Briefs`, `Review`, `Versions`, `Deliver`):** Require an active project context. If navigated to without an active project, the shell renders an actionable project selector and recent list—never an empty or broken editor state.
- **Footer Utilities (`Jobs`, `Help`):** Pinned to the sidebar bottom as persistent utility buttons that open dedicated drawers or dialogs; they are never primary navigation tabs.
- **Client Review & Public Shell:** Standalone web shell (`apps/web`) sharing identical tokens, typography, and button primitives, but completely stripped of editor toolbars, administrative controls, and native IPC hooks.

---

## 2. Focused Subviews & Screen Inventory

Workflows are partitioned into focused subviews rather than congested single-window dashboards.

### 2.1 Home
- **Active Resume Card:** Direct shortcut to the most recent in-progress project and revision.
- **Recent Projects Grid/List:** Displays project title, last modified timestamp, storage location, and truthful status badge (`Draft`, `In Review`, `Approved` — never fabricated completion percentages like "78%").
- **Action Bar:** Primary actions for `New Project`, `Open Project...`, and `Import Recording...`.
- **Attention & Notification Items:** Direct links to unresolved client feedback or failed background tasks.
- **System Health Indicator:** Compact status pill linking directly to `Jobs` or `Settings > Diagnostics`.
- **Edge States:** First-run onboarding prompt, empty workspace state, disconnected external drive warning banner.

### 2.2 Projects
- **Subviews:**
  1. `Project Directory`: Search, sort, filter (Active / Archived), storage root indicator, ownership.
  2. `Project Overview & Brief`: Deliverable targets, latest revision metadata, source media health, brief constraints (target duration, aspect ratios, required/excluded source sections).
  3. `Media Management`: Ingest dropzone (managed copy vs. linked reference), asset bins, tags, technical metadata columns, proxy generation status, duplicate detection.
  4. `Asset Detail`: Dedicated source player, audio waveform, codec/resolution stream info, local transcript inspector with inline correction, source markers, and derivatives list.

### 2.3 Studio
- **Central Layout:**
  - **Program Preview Monitor:** Centered canvas with truthful status tag (`Live Approximation`, `Proxy Preview`, `Rendered Preview`, `Stale`, `Rendering...`).
  - **Synchronized Transcript & Source Selector:** Interactive transcript pane seeking playhead on click; include/exclude selection handles.
  - **Functional Multi-Track Timeline:**
    - Tracks: Overlay/B-roll Video, Primary Video, Dialogue Audio, Music Audio, Captions, Graphics/Logo.
    - Time Representation: Strict integer ticks (`ticks × num / den`) with monospaced timecode display.
    - Tools: Split, Trim, Slip, Ripple Delete, Snap toggle, Zoom slider. Non-drag keyboard equivalents for all essential edits.
- **Focused Inspector Modes (Mutually Exclusive Subviews):**
  - `Caption Inspector`: Subtitle cue styling, line break editor, safe-area preview, SRT/VTT export toggles.
  - `Audio Inspector`: Waveforms, dialogue/music levels, fades, clipping warnings, measured loudness options and optional evaluated conservative cleanup with A/B preview. No unevaluated noise gate control.
  - `Brand Inspector`: User-specified brand logo upload, placement controls, custom brand typography references, color presets. (Displays *user* brand assets, not system palette swatches).
  - `AI Assistant Drawer`: On-demand drawer for natural language edit proposals; closed by default.

### 2.4 AI Briefs
- **Subviews:**
  1. `Brief Editor`: Natural language goal, audience, duration constraints, aspect ratios (16:9, 9:16), required source moments, explicit excluded/confidential segments.
  2. `Execution Plan`: Visible verified steps, local model identifier, processing targets, required permissions, and conflict alerts.
  3. `Source Selections`: Evidence intervals with playable thumbnails, transcripts, and proposed sequencing.
  4. `Runs & Recipes`: Recipe execution dashboard (`Suggest`, `Draft`, `Approved Recipe`), execution receipts, dependency graph, cancel/retry controls.

### 2.5 Review
- **Subviews:**
  1. `Review Packages`: List of published review packages, recipient list, delivery state, unresolved feedback counts, exact revision hash.
  2. `Feedback & Comments`: Timecoded comment thread linked to specific frame/range of an exact rendition, resolution toggles.
  3. `Proposed Changes (Editor)`: Converts client feedback (e.g., "cut intro by 5s") into bounded, previewable edit proposals requiring creator confirmation.
  4. `Share Dialog`: Explicit security sheet enumerating exactly what data/media leaves the local machine.
  5. `Browser Review Portal (Client-Facing)`: Lightweight web viewer with range commenting, version comparison, and authenticated approval sign-off.

### 2.6 Versions
- **Subviews:**
  1. `Revision History`: Immutable list of revisions with timestamp, author, commit note, parent revision ID, and review/delivery links.
  2. `Visual Comparison`: Dual-monitor / split-view comparison between two exact revisions with synchronized scrubbing and structured change diffs (accommodates unequal durations).
  3. `Restore / Fork`: Reversible restoration (creates new head revision from prior state; preserves history).

### 2.7 Deliver
- **Subviews:**
  1. `Output Setup`: Render configuration specifying exact revision, certified output presets (1080p Main SDR, 9:16 Vertical Cut, Review Proxy, Subtitle Package), codec, bitrate, audio normalization, caption embedding.
  2. `Preflight Verification`: Machine-verified preflight checklist (source file integrity, missing media, font availability, disk space, approval verification) distinct from creator editorial sign-offs.
  3. `Render Queue & Progress`: Truthful job queue with measured progress or current stage, elapsed time, cancel/retry. ETA requires a measured estimator; render pause is absent unless safe worker semantics are implemented.
  4. `Delivery Packages`: Delivered artifacts directory, cryptographic SHA-256 digests, manifest viewer, "Reveal in Finder" action.

### 2.8 Settings
- **Subpages:** `General & Appearance`, `Storage & Workspace Roots`, `Models & AI Runtime` (status of installed local weights, Ollama routes, download manager with progress/hashes), `Media Engine & Codecs` (FFmpeg binary status), `Privacy & Network` (separate explicit permissions for selected hosted review/delivery artifacts and consented support; local inference remains separate; no project database or originals sync), `Diagnostics & Support` (sanitized bundle generator, error logs).

### 2.9 Utilities
- **Jobs Drawer:** Truthful task monitor detailing active workers, step logs, attempt history, and retry buttons.
- **Help & Support:** Searchable offline knowledge base, diagnostics bundle viewer, local support assistant.

---

## 3. Single Shell Geometry & Layout Foundations

All desktop screens share a unified geometric framework implemented via single root layout components (`apps/desktop/src/components/shell/`).

| Dimension / Property | Specification | Rationale & Constraint |
|---|---|---|
| **Sidebar Width** | Fixed `216px` | Range `208px–224px` per Section 7.1; prevents layout shifts. |
| **Top Command Bar Height** | Fixed `56px` | Compact header hosting breadcrumb, project status, and search. |
| **Content Gutters** | `24px` padding | Generous margin preventing content crowding. |
| **Spacing Rhythm** | `8px` Baseline Grid | Increments: `4px` (tight), `8px` (compact), `16px` (default), `24px` (medium), `32px` (large). |
| **Control Hit Targets** | `36px – 40px` | Standard buttons and inputs: `38px` height. Minimum clickable area `36px`. |
| **Body Typography** | `14px` / line-height `20px` (1.4) | Readable off-white text. System font stack (`-apple-system`, `BlinkMacSystemFont`, `Inter`, `sans-serif`). |
| **Dense / Timeline Labels** | `11px – 12px` | Data-dense metadata, track headers, and status badges. |
| **Timecode Display** | `13px` Monospaced | Tabular numbers (`SF Mono`, `JetBrains Mono`, `ui-monospace`). |
| **Liquid Glass Layer** | Nav Sidebar & Floating Bars | `backdrop-filter: blur(16px) saturate(180%)`; background `rgba(34, 30, 41, 0.78)`. |
| **Content Surfaces** | Opaque / Matte | Video canvas, timeline, transcript, and lists use solid opaque backgrounds for maximum contrast and legibility. |

---

## 4. Component & State Inventory

### 4.1 Component Catalog
- **Shell & Navigation:** `AppShell`, `SidebarNav`, `NavItem`, `TopBar`, `Breadcrumb`, `ProjectSelector`, `FooterUtilityBar`, `JobsBadge`, `HealthPill`.
- **Core Primitives:** `Button` (Primary, Secondary, Ghost, Destructive), `IconButton`, `Input`, `Select`, `Checkbox`, `RadioGroup`, `ToggleSwitch`, `Modal`, `Drawer`, `Popover`, `Tooltip`, `Badge`, `Tabs`, `Card`, `Toast`.
- **Media & Editing:** `VideoPlayerMonitor`, `PlaybackControls`, `TimecodeHUD`, `WaveformDisplay`, `FilmstripScrubber`, `TimelineCanvas`, `TrackHeader`, `ClipItem`, `TrimHandle`, `TranscriptList`, `TranscriptSegment`, `CorrectionInput`.
- **Workflow & Review:** `PreflightTable`, `ChecklistRow`, `CommentThread`, `CommentBubble`, `ComparisonViewer`, `DiffList`, `ModelDownloadCard`, `ExecutionReceiptCard`.

### 4.2 Universal Component States
Every interactive and data component must implement concrete visual styling for the following states:

```
[Interactive States]
• idle            -> Standard default presentation.
• hover           -> Subtle brightness increase / tinted background (+6% opacity).
• pressed/active  -> Depressed state / active selection border.
• focus-visible   -> Unambiguous 2px violet focus ring with 2px offset; accessible via keyboard Tab.
• disabled        -> 40% opacity; non-interactive; cursor not-allowed; aria-disabled="true".

[Data & Loading States]
• loading         -> Truthful indeterminate spinner or determinate progress bar (no fabricated percentages).
• empty           -> Dedicated empty-state graphic, descriptive message, and primary CTA.
• error           -> Actionable inline message with specific error details and retry button.
• stale           -> Visual watermark/badge indicating preview is out-of-date relative to current edit.
• offline/missing -> Clear indicator for detached drives or unmounted sources.

[Domain / Review States]
• draft           -> Neutral ochre badge indicating working state.
• in_review       -> Sky-blue badge indicating published review package awaiting feedback.
• approved        -> Verified light-green badge linked to authentic reviewer signature and revision hash.
• changes_req     -> Maroon badge indicating pending revisions requested by client.
```

---

## 5. Semantic Color Tokens & Theme System

The design uses a restrained, near-black "Violet Noir" aesthetic with strictly semantic accents. Named rendered foreground/background/control pairs must be measured (>= 4.5:1 normal text; >= 3:1 large text and required control boundaries). No accessibility certification is claimed. Maroon is never dark-on-dark body text; tertiary text is disabled-only until its intended pair passes. Status uses text and icons as well as color.

```css
:root {
  /* Surface Foundations (Violet Noir: near-black with a violet undertone) */
  --bg-app:                #08080C; /* Deepest near-black application backdrop */
  --bg-panel:              #0F0F16; /* Primary opaque panel background */
  --bg-raised:             #17171F; /* Cards, popovers, elevated modals */
  --bg-glass:              rgba(15, 15, 22, 0.78); /* Navigation / command glass */
  --bg-glass-border:       rgba(255, 255, 255, 0.09);

  /* Borders & Dividers */
  --border-subtle:         #1E1E2A; /* Dividers and nested panel borders */
  --border-default:        #2A2A3A; /* Standard component borders */
  --border-strong:         #3D3D55; /* Emphasized boundaries */
  --border-focus:          #C4B5FD; /* Keyboard focus ring */

  /* Text & Typography */
  --text-primary:          #FAF8FF; /* White body text; measure actual rendered pair */
  --text-secondary:        #C2BCCC; /* Muted labels; measure rendered contrast */
  --text-tertiary:         #8E87A0; /* Disabled text only; use secondary token for readable timecodes */
  --text-inverse:          #0B0A10; /* High-contrast text on solid violet/ochre fills */

  /* Interaction Accent: Light Violet */
  --accent-violet:         #C4B5FD; /* Primary action button, active tab, selected clip */
  --accent-violet-hover:   #D6CBFF; /* Hover state for primary actions */
  --accent-violet-subtle:  rgba(196, 181, 253, 0.14); /* Selection highlights */

  /* Editorial Accent: Warm Ochre */
  --ochre:                 #D6AE69; /* Character accent, warnings, B-roll clips, draft badges */
  --ochre-hover:           #E5C07B;
  --ochre-subtle:          rgba(214, 174, 105, 0.14);

  /* Editorial Accent: Maroon / Wine */
  --maroon:                #713D50; /* Wine character accent, reverse side of Cutline, critical badges */
  --maroon-hover:          #8A4A62;
  --maroon-subtle:         rgba(113, 61, 80, 0.22);
  /* RULE: Maroon is used strictly for surfaces, borders, and badges; NEVER for dark body text on dark backgrounds */

  /* Informational Accent: Sky Blue */
  --sky:                   #8CC8E8; /* Stream metadata, proxy indicators, info callouts, sync state */
  --sky-subtle:            rgba(140, 200, 232, 0.14);

  /* Positive & Verification: Light Green */
  --positive:              #A7D7A1; /* Verified approvals, completed renders, passing preflight */
  --positive-subtle:       rgba(167, 215, 161, 0.14);
  /* RULE: Positive green is displayed ONLY when backed by actual verified state */

  /* Destructive & Error */
  --destructive:           #E06C75; /* Destructive actions, render errors, failed preflight */
  --destructive-subtle:    rgba(224, 108, 117, 0.16);
}
```

---

## 6. Resolution of Historical Source Conflicts

Older concept mockups and drafts contain major contradictions resolved by this contract:

| Historical Mockup Pattern | Mandated Resolution & Correction | Source Reference |
|---|---|---|
| **Marketing Landing Page as Home** | Home is an operational desktop workspace: active resume card, recent projects, real attention items. No giant marketing slogans. | `DESIGN_CONFLICTS.md` L15; `MASTER.md` Sec 7.2 |
| **Fabricated Metrics & Percentages** | Remove all invented percentages (e.g. "78% complete", "94% viral score"). Only display truthful discrete states (`Draft`, `In Review`, `Approved`). | `DESIGN_CONFLICTS.md` L15, L28; `MASTER.md` Sec 9.2 |
| **In-App Palette & Swatch Posters** | Palette presentation posters removed from app UI. Custom colors belong exclusively inside user-editable Brand presets. | `DESIGN_CONFLICTS.md` L16; `MASTER.md` Sec 7.1 |
| **Fantasy Mascots & Glowing Blobs** | Eliminate random dragons, floating orbs, neon halos, and luminous borders. Adopt the single refined Cutline ribbon motif. | `DESIGN_CONFLICTS.md` L17, L30; `MASTER.md` Sec 8.1 |
| **All-Panel Glass / Bloom** | Liquid Glass restricted to navigation bars and floating popovers. Video monitors, timelines, and content panels remain opaque/matte. | `MASTER.md` Sec 7.1 |
| **Unimplemented Feature Creep** | Exclude 3D asset marketplace, generative video/B-roll, voice cloning, synthetic speakers, and direct social auto-publishing. | `DESIGN_CONFLICTS.md` L20, L22; `MASTER.md` Sec 5.3 |
| **Superficial "Label Approved"** | Prohibit manual "Label as approved" badges. Approvals require authenticated reviewer identity and cryptographic revision hashes. | `DESIGN_CONFLICTS.md` L26; `MASTER.md` Sec 9.9 |
| **Vague Cloud vs. Local Privacy** | Strict separation: local desktop owns project SQLite, media originals, and local inference; cloud hosts only explicitly shared review packages. | `DESIGN_CONFLICTS.md` L24, L25; `MASTER.md` Sec 6 |

---

## 7. Cutline 3D Asset Plan & Performance Budget

### 7.1 Asset Specification
- **Identifier:** `asset-3d-cutline-ribbon`
- **Concept & Form:** A continuous tactile strip inspired by a physical video edit timeline segment. A simple, elegant ribbon with subtle physical thickness, a gentle spatial bend, and clean silhouette.
- **Surface & Finishes:**
  - Front Face: Restrained violet satin (`#A18AF7`) with soft specular roughness (~0.35).
  - Reverse Face: Wine/maroon matte finish (`#713D50`).
  - Beveled Edge: Warm ochre accent line (`#D6AE69`).
  - No fantasy glowing edges, transparency, or particle trails.
- **Placements (Strictly Bounded):**
  1. *Onboarding Welcome:* Small intro accent during initial workspace configuration.
  2. *Home Workspace Header:* Subtle stationary or low-interaction hero accent.
  3. *Render Settle Moment:* Brief micro-animation upon successful render completion.
  *Forbidden Placements:* Never on the active Studio editing canvas, never obscuring video preview, timeline tracks, or interactive hit targets.

### 7.2 Motion States
1. `idle`: Static resting graceful curve; no idle animation.
2. `pointer-proximity`: Gentle orientation response towards cursor when hovering header area.
3. `route-transition`: 220ms subtle unfold/settle transition when entering Home.
4. `processing`: Static while editing, playback or rendering; a real textual status conveys job activity.
5. `completion`: Single celebratory settle loop returning to idle rest.
6. `reduced-motion`: 100% static mesh or SVG fallback with all animation disabled.

### 7.3 Performance Budget & Technical Boundaries
- **Triangle Count:** Max 25,000 triangles (target: 8,000–12,000 for ribbon geometry).
- **Draw Calls:** Target maximum 2 draw calls for the whole active scene. Use one merged mesh, one material and vertex colors for violet face/wine reverse/ochre edge; avoid three material groups. Validate actual renderer calls.
- **Textures:** Max 1024x1024 diffuse, roughness, and normal maps; procedural shader preferred.
- **Compressed Payload:** <= 2.0 MB compressed `.glb` asset size.
- **Static Fallback Payload:** <= 40 KB (pre-rendered SVG vector or pre-rendered WebP raster).
- **Execution & Disposal:**
  - Demand-driven rendering (`frameloop="demand"` in Three.js / React Three Fiber).
  - Immediate pause when tab is hidden, offscreen, during active video playback in Studio, or on battery-saver mode.
  - Hard cap on device pixel ratio at `1.5x`.
  - Immediate GPU buffer/texture disposal on component unmount.
  - Zero critical-path dependency: desktop app and browser review portal must remain fully functional if WebGL is unavailable or disabled.

---

## 8. Actual Google Image Tool Inventory

A live system and toolchain inventory was conducted in the environment to establish actual image generation capabilities:

| Inspection Target | Command / Path Evaluated | Observed Inventory Result | Toolchain Status |
|---|---|---|---|
| **AGY Agent Native Tool** | Built-in tool declarations | `generate_image` tool declared (accepts `Prompt`, `ImageName`, `AspectRatio`, `ImagePaths`). | **Declared / untested**; named backend and successful output not yet verified |
| **AGY Models Catalog** | `agy models` | Lists `gemini-3.8-flash-high`, `gemini-3.7-flash`, `gemini-3.1-pro`, `claude-*`. | Text/multimodal reasoning models verified. |
| **CLI / PATH Executables** | `which nano-banana`, `which nanobanana` | No standalone binary named `nano-banana` or `nanobanana` in PATH. | Not an external CLI command. |
| **Environment Variables** | `env \| grep -i banana` | No Nano Banana specific environment variables configured. | Default AGY environment. |
| **MCP Tool Servers** | `agy mcp list` | `claude-mem` (stdio), `context7` (http), `prompts-chat` (http). | No image generation MCP server attached. |

### Conclusion for Asset Pipeline (F1 Integration)
- AGY declares a native `generate_image` tool. It is untested; backend product/model identity and successful availability remain unverified until an authorized call returns an artifact and receipt.
- **Policy Compliance:** In strict adherence to Task F0 instructions ("No code or image generation yet"), `generate_image` has **not** been invoked during this gate. When Task F1 begins, `generate_image` will be called with the geometry-friendly prompt specified in Section 7 and `references/build-pack/Cutroom_Build_Pack/ASSET_REQUEST_TEMPLATE.md`.

## T0 integration corrections (Astra)
Keyboard labels, visible focus, predictable focus restoration/order, screen-reader announcements and non-hover critical actions are required. Test reduced transparency, high contrast, text scaling, long filenames and zoom. Cutline idle is static. Any optional long decorative motion outside editing/playback/rendering is disabled by default and independently pausable; reduced-motion takes effect immediately. Canvas/static fallback are decorative and aria-hidden. Actual job state remains textual. No continuous decorative activity during editing/rendering. All performance values are targets pending mesh/browser measurements.
