# L4 asset evidence — Cutline bounded study and fallback

Date: 2026-09-07
Scope: one OpenAI initial image study (Study B) and a clearly identified procedural fallback. No converter invocation was claimed.

## OpenAI Study B

- Requested route/model: OpenAI image tool, **GPT Image2** (user/brief label).
- Resolved route: built-in `image_gen` tool (the approved local Codex image route).
- Resolved embedded provenance: PNG C2PA metadata contains `claim_generator_info: gpt-image`, version `2.0`, and `OpenAI Media Service API`.
- Invocation: one generation call; no private input, no refinement, no second OpenAI generation, and no new API/key route.
- Source output: `/Users/parthsingh/.codex/generated_images/01a07d6f-65b7-7b02-8f6d-8090f6015325/exec-a88dec34-4e1d-4ff3-bb1b-1bb8f8712f7b.png`
- Project copy: `assets/generated-references/openai/cutline-study-B-openai.png`
- Format: PNG, RGB, 1254 x 1254, 8-bit, non-interlaced.
- SHA-256: `6d950f3819e97accbcb355d80b2651a23510e95786912640bd7b6ae87dcbe2ce`
- Visual inspection: PASS for bounded study brief, but integration review REJECTED the silhouette as the geometry master: it reads as a closed bangle-like loop. Retained as material/color reference only. One isolated object, centered, fully inside frame, approximately 70% fill; broad satin violet face; wine reverse; narrow ochre edge; diffuse neutral studio light. No UI, text, logo, mascot, orb, unrelated props, motion blur, glow, or harsh depth of field observed.
- Geometry caveat: image is a reference only and does not establish a 3D mesh, topology, deformation quality, or runtime performance.

Prompt version: `cutline-study-B-v1` — one continuous thick ribbon, shallow folded strip, front three-quarter, neutral background, satin violet face/wine reverse/narrow ochre edge, isolated geometry-friendly object; avoid UI/text/logo/orb/mascot/props/glow/blur/watermark.

## Converter availability

The documented ComfyUI Hunyuan3D 2.1 route remains **BLOCKED** per `docs/evidence/converter.json`: no local checkpoint weights; ComfyUI server not running; configured external weight store on absent Project Dev volume; existing venv Torch2.13.0 imports; Blender CLI absent. The remote Tencent proxy was not invoked because it requires credentials/authorization and may incur charges. No download, install, server start, model load, or conversion occurred.

## Procedural static fallback

- Artifact: `assets/3d/fallback/cutline-ribbon-fallback.glb`
- Editable generator: `assets/3d/fallback/generate_cutline_fallback.py`
- Design: deterministic closed rectangular ribbon, gently bent once; one merged mesh, one glTF material, per-face `COLOR_0` for violet face/wine reverse/ochre edges; normals computed from each emitted triangle's geometry; `BendToStraight` POSITION morph target with matching vertex order.
- Validation command: `python3 assets/3d/fallback/generate_cutline_fallback.py`
- Independent validator: `python3 assets/3d/fallback/validate_cutline_glb.py`
- Validation result: GLB v2 JSON+BIN chunks valid; 776 vertices / 196 welded vertices; 388 triangles / 582 welded edges; closed manifold; index bounds valid; finite unit normals; morph target present; 1 material; bounds `[-2.4, -0.675, -0.12]` to `[2.4, 1.295, 0.12]`; payload 55,812 bytes; SHA-256 `67bdec38a03ee516ef21b708d7172baa5f0d1051ab100f530b84639622363987`.
- The validator dereferences `primitive.attributes`, `primitive.targets`, and `primitive.indices`; `test_validator_corruption.py` intentionally changes the POSITION accessor to 9 and records rejection. Three.js 0.185.1 `GLTFLoader` from the design-toolkit runtime also parsed the artifact in development (`scene=1`, `vertices=776`, morph dictionary `BendToStraight`, initial weight `0`).
- Actual WebGL evidence: `.runtime/cutline-viewer/index.html` used the installed design-toolkit Three.js 0.185.1 runtime and `GLTFLoader` over a foreground `127.0.0.1` server. Playwright Chrome loaded the GLB with no page error; each state rendered `calls=1`, `triangles=388`, morph dictionary `BendToStraight`, and weights `1` (rest/straightened state) / `0` (bent base state). Captures: `cutline-webgl-rest.png` (SHA-256 `7d53ab4c001716bad10e17f905bb531ebc6faec5b14360f2943b998af20f3370`) and `cutline-webgl-bent.png` (SHA-256 `fc254d6e3f83426a0ad9031e9424eb6cb8e8615918d3a1ab31acfbc3cea1c9f1`). Both were visually inspected as substantive 3/4 renders with visible ochre edge thickness. The temporary server and browser were stopped after capture.
- The Pillow renderer remains available for deterministic local snapshots, but is supplementary; the WebGL captures above are the actual renderer evidence.
- This is clearly procedural from the Cutline brief, not image-converted. It is integrated as a lazy Home-only procedural asset with a static snapshot fallback. See frontend-independent evidence for the separate product checks; full performance/accessibility certification remains open.
