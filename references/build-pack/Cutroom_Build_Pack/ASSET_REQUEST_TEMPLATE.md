# Cutroom planned asset production

This is an asset-generation brief template, not an instruction to run image tools before the design gate.

## Fill before calling a generator

Asset ID:
Purpose in the product:
Placement and maximum visible area:
Design ZIP source references and hashes:
Chosen geometry/silhouette:
Materials and allowed accents:
Required views and converter input format:
Motion states and deformation needs:
Target mesh/texture/payload budget:
Static/reduced-motion fallback:
Actual image-tool routes and authorization:
Per-provider concept/refinement budget:
Approval by Astra + GLM 5.3:

## Generator instruction draft — adapt to the approved concept

```text
Create an isolated object reference for Cutroom's approved Cutline motif.
Use the attached approved design/shape references, preserving proportions.

The object is a flexible, gently bent strip inspired by a video edit timeline.
It has real thickness, a distinctive but simple silhouette, and no unrelated
props. The intended finish is a restrained violet satin face, wine-colored
reverse, and a narrow warm-ochre edge. Avoid transparent fantasy glass,
bloom, neon lighting, particles, dragons, eyes, or an orb.

This is for reconstructing actual 3D geometry, not a UI poster. Show one
complete object in a plain neutral studio setting with even diffuse lighting,
clear silhouette, and no text, labels, controls, watermark imitation, motion
blur, dramatic reflections, or shallow depth of field. Keep it inside frame.

Produce the specific requested view: [VIEW]. Preserve the master object's
shape; do not invent a different object for each angle. For reconstruction,
also produce a neutral matte/clay version so surface highlights do not hide
geometry. Do not bake colored lighting into the clay reference.
```

Run meaningful work through both available authorized image routes:
AGY → Nano Banana 2 or Nano Banana Pro; Luna → GPT Image 2.
Record the actual image model and output file. Do not call an unavailable
model name or manufacture proof of generation.

## Converter handoff

Actual installed tool/skill path:
Official/documented source:
Local versus hosted behavior:
License/terms:
Supported single/multi-view input:
Approved input files/hashes:
Output destination:
Resource and authorization limits:
Actual invocation and output mesh path:

Inspect the mesh after conversion. Check axes, scale, normals, connectivity,
thickness, self-intersection, topology, UVs, texture dependencies, and deformation.
Repair/retopologize, apply final PBR materials, and create an appropriate rig or
procedural deformation. Export a validated GLB plus editable source/scripts.

Do not assume single-view reconstruction recovers a truthful unseen backside.
Do not feed a contact sheet to a converter expecting one view.

## Integration proof

Actual mesh/texture counts and size:
Target-browser/native runtime loading check:
No hidden external texture requests in local-only mode:
Interaction does not occlude labels/hit targets:
Reduced-motion/static behavior:
Hidden/offscreen/low-resource behavior:
Scene disposal and idle-rendering check:
Performance with video playback/rendering:
Provenance and fallback files:

Any blocked image/converter route stays explicitly recorded. A useful fallback
is allowed, but is not evidence that the preferred conversion pipeline ran.
