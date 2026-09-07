# L7 runtime fallback evidence

Date: 2026-09-07

The runtime fallback was rendered from the existing procedural `cutline-ribbon-fallback.glb` through the installed design-toolkit Three.js 0.185.1 `GLTFLoader` and WebGL renderer. No image generation or reference-image editing was used.

- Editable renderer: `assets/3d/fallback/render_runtime_fallback.html`
- GLB input: `assets/3d/fallback/cutline-ribbon-fallback.glb`
- WebGL setup: transparent alpha canvas, 256 x 256, DPR 1, perspective 3/4 camera, ambient plus directional light, one merged mesh.
- Playwright result: `loaded=true`, `error=null`, `calls=1`, `triangles=388`, canvas `256 x 256`.
- Visual inspection: the complete bent ribbon is inside frame at approximately 70% width, with the ochre thickness edge visible.
- Alpha cleanup: screenshot canvas was converted from the browser's white compositing to RGBA by removing only near-white background pixels; the mesh pixels remain unchanged. This keeps the runtime fallback transparent for placement over Home surfaces.
- Artifact: `assets/3d/fallback/cutline-runtime-fallback.png`; 256 x 256 RGBA PNG, 2,341 bytes, SHA-256 `77abc261b8c132d9fcaf25ff2f7261699228d606971631720fcc61ab4dbbf6ad`.
- Public copy: `apps/desktop/public/assets/3d/fallback/cutline-runtime-fallback.png`; same dimensions, bytes, and hash.

The temporary localhost server and Playwright browser were stopped after capture. The fallback is an actual runtime mesh render and remains decorative/static; no production component or test was changed.
