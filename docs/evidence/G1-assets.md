# G1 asset evidence — Google Cutline Study A

Date: 2026-09-07
Scope: one isolated Google initial image study (Study A) per docs/ASSET_PLAN.md and docs/evidence/T0-design-review.md. No converter invocation was claimed or executed.

## Google Study A

- Requested route/model: Google image tool, Nano Banana2/Pro (requested conditionally if exposed by tool identity/schema).
- Resolved route: Declared built-in `generate_image` tool.
- Backend/model identity: Opaque backend / model-unverified. The declared tool schema exposes `AspectRatio`, `ImageName`, `ImagePaths`, and `Prompt`; it does not expose model or route selection parameters. No provider/backend identity metadata is embedded in image EXIF.
- Invocation: Exactly one generation call; no private input, no refinement, no second generation, no new paid APIs, no config changes, and no approval bypass.
- Source output: `/Users/parthsingh/.gemini/antigravity-cli/brain/06a79476-f1d7-4024-9de6-c32a6ad97dd4/cutline_study_a_1788811026391.jpg`
- Project copy: `assets/generated-references/google/cutline_study_a.jpg`
- Metadata record: `assets/generated-references/google/metadata.json`
- Format: JPEG, RGB (sRGB IEC61966-2.1), 1024 x 1024, 549,103 bytes.
- SHA-256: `d85b0cf5811dd0a36dde9d550f0bdeb3c5d7d7810c7577664ac0b9c11de4bebc`
- Prompt: `Single continuous physically thick editing ribbon, open shallow S-bend with no closed loop, matte clay surface, broad legible front and back edges, fully framed front three-quarter view, filling roughly 70% of the frame, plain light gray background, diffuse light, neutral studio lighting, no text, no UI, no props, no glow, no depth blur, sharp clean edges, geometry-friendly reference object`
- Visual inspection: PASS for bounded study brief. One isolated continuous physically thick editing ribbon; open shallow S-bend with no closed loop; matte terracotta clay surface; broad legible front, inner, and edge faces; fully framed front three-quarter perspective filling approximately 70% of frame; plain light gray background with diffuse neutral light; no UI, text, props, glow, or depth blur.
- Geometry caveat: Reference image only. Does not constitute or claim a 3D mesh, converter execution, topology, rigging, or runtime performance.

## Converter execution

No converter execution was claimed or executed. ComfyUI Hunyuan3D 2.1 conversion remains uninvoked.
