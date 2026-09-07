---
name: Cutroom
description: A focused editing workspace organized around the creator's next task.
colors:
  accent-violet: "#A18AF7"
  ochre: "#D6AE69"
  maroon: "#713D50"
  sky: "#8CC8E8"
  positive: "#A7D7A1"
  destructive: "#E06C75"
  bg-app: "#19161F"
  bg-panel: "#221E29"
  bg-raised: "#2B2533"
  bg-glass: "rgba(34, 30, 41, 0.78)"
  border-default: "#443B4F"
  text-primary: "#F3F0F6"
  text-secondary: "#BAB3C5"
  text-inverse: "#191320"
typography:
  body: {fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', fontSize: "14px", lineHeight: 1.43}
  timecode: {fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace'}
rounded: {sm: "4px", md: "8px", lg: "12px"}
spacing: {tight: "4px", compact: "8px", default: "16px", medium: "24px", large: "32px", xlarge: "48px"}
components:
  button-primary: {backgroundColor: "{colors.accent-violet}", textColor: "{colors.text-inverse}", rounded: "{rounded.md}", height: "38px", padding: "0 16px"}
  input: {backgroundColor: "{colors.bg-panel}", textColor: "{colors.text-primary}", rounded: "{rounded.md}", height: "38px"}
  card: {backgroundColor: "{colors.bg-panel}", rounded: "{rounded.lg}", padding: "16px"}
---

# Design System: Cutroom

## Overview

Snapshot: 2026-09-07. The user's desktop contract is visual authority, reflected in `PRODUCT.md` and the direction comment in `apps/desktop/index.html`; no generated page composition defines this system.

The implemented React shell uses charcoal/plum surfaces, compact system typography and restrained violet actions. Matte content remains readable while translucent navigation supplies depth. This document captures a frontend foundation; native editing, persistence and delivery remain unimplemented. Current validation and pending final verification belong in `docs/TEST_EVIDENCE.md`.

## Colors

Violet identifies actions and active navigation. Ochre marks attention/draft states; sky marks review/information; light green is reserved for backed positive states. Wine surfaces use light foregrounds, never dark wine body text. Destructive actions use the error accent. Neutral surfaces separate application, panel and raised regions.

Source: `packages/design-tokens/src/tokens.css` and `tokens.ts`. Frontmatter is a reusable subset; preserve the source's tertiary-on-panel distinction and subtle accent fills. Token contrast tests cover specific pairs, not every rendered combination.

## Typography

System sans carries interface copy; monospace with tabular numerals carries timecodes. Current route headings vary between 22px and 24px; navigation is 13px. Keep hierarchy compact and task-oriented; no marketing display face is implemented.

## Layout

One shared shell owns a fixed 216px sidebar, 56px top bar and 24px content gutters. The route body scrolls inside the viewport. Primary navigation remains Home, Projects, Studio, AI Briefs, Review, Versions, Deliver, Settings; Jobs and Help & Support are footer drawers.

The code is a desktop layout. No compact sidebar breakpoint is implemented. Standard buttons and inputs are 38px tall, but small buttons are 32px and footer utilities 34px: do not claim a universal 36px minimum or completed responsive/accessibility certification.

## Elevation & Depth

Navigation uses the glass surface and 16px blur; the sidebar additionally saturates it. Cards are opaque, bordered and unshadowed. Modal and drawer shadows establish overlay depth; their exact values are retained in `.impeccable/design.json`.

**The Matte Content Rule.** Preserve opaque reading and editing surfaces; keep glass confined to navigation and controls.

## Shapes

Controls use the medium corner radius, cards the large radius and badges the small radius. Navigation uses 6px corners. Thin borders define boundaries without turning each content fragment into a new elevated container.

## Components

Shared primitives live in `packages/ui/src`: five button variants, labeled fields, badges, cards, tabs, tables, dialogs and drawers. Global keyboard focus is a 2px violet outline with 2px offset. Disabled controls dim and retain explanatory nearby copy; do not invent successful results behind unavailable actions.

Home alone mounts the decorative 72px Cutline. Its lazy Three.js canvas loads the procedural ribbon GLB, renders on pointer demand and settles without an idle loop. OS/browser reduced-motion or reduced-transparency preferences, missing WebGL support, loading and errors select a static rest image. This preference handling is specific to Cutline; it does not establish shell-wide reduced transparency or motion support.

Settings currently presents six informational tabs. The completed F3 source correction replaces editable-looking preferences and native readings with system-preference or unavailable states; it provides no saved appearance override, active model, storage measurement or diagnostics export. Final correction verification remains pending in the evidence document.

## Do's and Don'ts

- Do retain the shared shell and exact navigation order.
- Do keep fixture data explicitly labeled and available only through development opt-in.
- Do distinguish unsupported operations from successful native work.
- Don't promote scaffold labels, placeholder metrics or planned capabilities into product evidence.
- Don't add invented slogans, model identities or activity to empty states.
- Don't treat the optional Cutline as an editor control or expand it across routes.
