# Cutroom

**Cutroom** is a professional, local-first AI video production studio built for creators and modern post-production teams. 

Unlike conventional cloud-based video generators or sluggish wrapper apps, Cutroom marries a high-performance **Rust-native timeline and media engine** with **strictly local AI models** running directly on device. It features human-in-the-loop structured editing proposals, exact integer timebase conversions, cryptographically verified revision trees, integrated client feedback loops, and immutable source-media guarantees.

---

## Core Product Differentiators

1. **Local-First Privacy Architecture**
   - Inference runs completely on-device using quantized local models (default: `gemma4:e4b-mlx` via local Ollama).
   - Zero telemetry, zero cloud video streaming, and zero network data egress.
   - Strict narrow context construction: AI models never receive filesystem paths, database credentials, or unrelated assets.

2. **Atomic Native Timeline Operations**
   - High-performance native Rust core managing SQLite-backed projects (`cutroom-core`, `cutroom-media`, `cutroom-jobs`, `cutroom-tauri`).
   - Atomic composition mutations with single-step version increments: **Trim**, **Reorder**, **Delete**, **Insert**, and **Replace**.
   - Frame/sample-exact rational timebase conversions (e.g. 1/12288 source to 1/24000 composition ticks).

3. **Human-in-the-Loop AI Assistant**
   - AI generation is strictly non-destructive: model outputs produce previewable, validated proposals.
   - Explicit **Apply** and **Dismiss** actions. Model output never directly mutates the timeline.
   - Version staleness detection guarantees that concurrent timeline edits reject outdated AI proposals immediately.

4. **Multi-Step AI Assembly & EditPlans**
   - Composite editing prompts (e.g. *"Create a 45-second launch teaser. Open with the strongest demo, shorten the interview, and end with the CTA"*).
   - Sequential execution engine with version propagation and partial failure detection (never claims full success on partial failures).

5. **Integrated Media Understanding**
   - Word-level transcript indexing and source-range mapping.
   - Silence and dead-space detection with automated silence-cutting plans.
   - Semantic moment classification: Hooks, Product Demos, Interviews, and Calls to Action (CTAs).

6. **Client Review & Delivery Engine**
   - Timecoded client feedback translated directly into structured AI revision proposals.
   - Signed SHA-256 delivery manifests and rendered artifact validation.
   - Byte-for-byte immutability: original media files are strictly read-only and never modified.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│               Cutroom Desktop UI (React 19 + Vite)           │
│    Studio • Timeline • AI Proposals • Review • Delivery      │
└──────────────────────────────┬───────────────────────────────┘
                               │
               Typed IPC Bridge / AppContext
                               │
┌──────────────────────────────▼───────────────────────────────┐
│                 Local AI & Intelligence Layer                │
│   • Schema & Domain Validators (Trim/Reorder/Delete/Insert)  │
│   • Replace & EditPlan Multi-Step Assembly Engine            │
│   • Media Understanding & Silence Analysis                   │
│   • Local LLM Runtime (gemma4:e4b-mlx via Ollama)           │
└──────────────────────────────┬───────────────────────────────┘
                               │
            Native Command Dispatch (dispatch.rs)
                               │
┌──────────────────────────────▼───────────────────────────────┐
│               Native Rust Post-Production Core               │
│   • cutroom-core: SQLite Single-Writer / Read-Many Engine    │
│   • cutroom-media: FFmpeg/FFprobe Probing & Frame Decode     │
│   • cutroom-jobs: Render Queue & Multi-Step Workers          │
│   • cutroom-tauri: Single-Writer Atomic Locking & IPC        │
└──────────────────────────────────────────────────────────────┘
```

---

## Complete Production Workflow

```
Create Project
   │
Import Media (Probed & Linked)
   │
Project Brief (Goals, Audience, Target Duration, Tone)
   │
Media Understanding (ASR, Silence Gaps, Soundbites)
   │
Smart Assembly / AI EditPlan
   │
Interactive Preview & Human Approval
   │
Atomic Timeline Mutation (Single Version Increment)
   │
Immutable Revision (SHA-256 Content Hash)
   │
Master Render (1080p SDR H.264 / AAC)
   │
Client Review (Timecoded Feedback → AI Revision Plan)
   │
Approved Delivery (Signed Checksum Manifest)
   │
Archive & Persistence (Reopenable SQLite Registry)
```

---

## Quickstart & Verification

### Prerequisites
- Node.js ≥ 22 & pnpm ≥ 9
- Rust stable toolchain & Cargo
- FFmpeg & FFprobe (installed at `/opt/homebrew/bin` or in `PATH`)
- Local Ollama running `gemma4:e4b-mlx` (for live AI smoke tests)
- Linux only: Tauri system libraries (the desktop shell will not compile without them)
  ```bash
  sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  ```

### Build & Test Suite

```bash
# 1. Run full frontend test suite (315 passing tests)
pnpm --filter @cutroom/desktop test

# 2. Verify TypeScript strict check (0 errors)
pnpm --filter @cutroom/desktop typecheck

# 3. Production Vite build
pnpm --filter @cutroom/desktop build

# 4. Cargo workspace tests (all crates)
cargo test --workspace

# 5. Native vertical slice verifier (12 phases)
node scripts/verify_b0_slice.mjs

# 6. Disposable atomic replace & SQLite persistence verifier
node scripts/verify_replace_persistence.mjs

# 7. Complete real-project production E2E verifier
node scripts/verify_full_e2e.mjs
```

### Live Local AI Smoke Tests
Hermetic unit tests mock model outputs by default. Run real on-device model smoke tests with:

```bash
RUN_REAL_LOCAL_AI=1 pnpm --filter @cutroom/desktop test -- aiTrimRealSmoke
RUN_REAL_LOCAL_AI=1 pnpm --filter @cutroom/desktop test -- aiReorderRealSmoke
RUN_REAL_LOCAL_AI=1 pnpm --filter @cutroom/desktop test -- aiDeleteRealSmoke
RUN_REAL_LOCAL_AI=1 pnpm --filter @cutroom/desktop test -- aiInsertRealSmoke
RUN_REAL_LOCAL_AI=1 pnpm --filter @cutroom/desktop test -- aiReplaceRealSmoke
RUN_REAL_LOCAL_AI=1 pnpm --filter @cutroom/desktop test -- aiEditPlanRealSmoke
```

---

## Security Model & Guarantees

- **Strict Model Boundary**: Schema validation rejects unknown keys, JSON injection, and malformed strings.
- **Identity Bounds**: The AI model may reference only real, supplied asset and clip IDs. Invented or hallucinated IDs trigger immediate validation failure.
- **Media Immutability**: All edits are purely non-destructive pointers into source media. Source files are opened read-only and hashes are verified unchanged across workflows.
- **Concurrency & Staleness Protection**: Any proposal generated against composition version $N$ is rejected if the timeline has advanced to $N + 1$.
- **Adversarial Hardening**: `apps/desktop/src/__tests__/AdversarialSecurity.test.ts` continuously verifies resistance against prompt injection, path traversal, and concurrency race exploits.
