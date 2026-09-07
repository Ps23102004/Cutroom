# Cutroom environment preflight

Date: 2026-09-07. This is a read-only inventory; no model, converter, service, or global configuration was changed.

## Workspace

- Repository: `/Users/parthsingh/Developer/Cutroom`, freshly initialized, no base commit at preflight.
- No `AGENTS.md` was found in the bounded Cutroom/Desktop/Developer/.agents search.
- No existing Cutroom repository was found before this workspace was initialized. `Developer/ai-tools/OpenCut` is a separate repository (`main`, HEAD `df6c16413c601d28778b1769e1048399b86c055a`) with a pre-existing untracked `apps/web/bun.lock`.
- `/Volumes/Project Dev` is absent. Macintosh HD is mounted; Data has 124 GiB available.

## Host and build tools

macOS 27.0, arm64, Mac15,7, Apple M3 Pro, 12 cores, 36 GB RAM. Available: Codex, Claude Code 2.1.263, Kimi 0.37.2, AGY 1.1.27, FFmpeg/FFprobe 9.0.1, Bun 1.3.14, Node 22.23.1, npm 10.9.8, pnpm 9.15.9, Cargo/Rust 1.96.1, `hyperframes`, and `designmd`. Prime Agent resolves to prime-agent 0.9.1; Codex CLI is 0.153.4. Tauri CLI and Blender were not found. AGI/Antigravity spoken aliases differ from actual agy. OmniRoute is installed; no new persistent service was authorized. Initial sandbox Ollama probes were denied; elevated checks subsequently found the existing idle server.

GLM existing credential route works outside the sandbox, but both GLM5.3 and GLM5.2 requests were rejected by provider quota 429/1310; provider reset text 2026-09-10 00:34:16 (timezone unspecified). AGY's live catalog later resolved the requested Gemini route to `gemini-3.8-flash-high`.

## Media and 3D

FFmpeg and FFprobe are available for the target architecture. ComfyUI is present at `/Users/parthsingh/Developer/ComfyUI` and contains Hunyuan3D 2.1 and TripoSplat nodes/blueprints. No ComfyUI server was listening on `127.0.0.1:8188`, the configured model pointer resolves to the absent /Volumes/Project Dev/AI/comfyui-models, and Blender was not found. Existing ComfyUI .venv imports Torch2.13.0 on Python3.14.7; host-Python import failure did not mean the installation was broken. Status: converter capability present/untested; conversion blocked until an authorized, running and provisioned route is identified.

Installed design references include `design-materials`, `hyperframes-animation`, and isolated React Three Fiber/Three dependencies in `Developer/agent-design-kit`. The extracted design kit contains documentation and skills but no image or mesh assets.

## Local model manifests

The existing Ollama fallback store is `/Users/parthsingh/Library/Application Support/LocalModels/ollama-fallback`. Read-only manifest inspection found:

- `gemma4/e2b-mlx`: 2,073 artifact layers referencing 6,504,184,877 bytes; these are not neural layer counts.
- `gemma4/e4b-mlx`: 2,192 artifact layers referencing 8,797,551,778 bytes; these are not neural layer counts.

Exact manifest/config digests and actual inference results are in docs/evidence/local-models.json. Models were tested sequentially through the existing idle loopback service; no download, alias, model-store or routing changes. This is smoke evaluation, not task certification.
