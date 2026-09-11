# Cutroom System Architecture

**Owner**: GPT-6 Astra (Product Planner & Architect)  
**Coordinator**: Gemini 3.8 Flash (via AGY)  
**Version**: 1.0.0-draft  

---

## 1. System Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Cutroom Desktop App                             │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │                      React 19 Frontend                       │     │
│   │  (Vite 6, TypeScript 5.7, @cutroom/ui, @cutroom/tokens)      │     │
│   │  8 Routes: Home · Projects · Studio · AI Briefs · Review ·   │     │
│   │            Versions · Deliver · Settings                     │     │
│   └──────────────────────────────┬───────────────────────────────┘     │
│                                  │ IPC dispatch invoke                 │
│                                  ▼                                     │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │                     Tauri v2 Native Host                     │     │
│   │  (Rust core, window lifecycle, native dialogs, FS sandbox)   │     │
│   └──────────────────────────────┬───────────────────────────────┘     │
│                                  │                                     │
│         ┌────────────────────────┼────────────────────────┐            │
│         ▼                        ▼                        ▼            │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐    │
│  │ cutroom-core │         │cutroom-media │         │ cutroom-jobs │    │
│  │ SQLite (WAL) │         │FFmpeg/ffprobe│         │Durable Engine│    │
│  │ Relational DB│         │Probe, Proxy, │         │Leases, Queue,│    │
│  │ Revisions,   │         │Timeline Cut, │         │Cancellation, │    │
│  │ Idempotency  │         │Export Rend.  │         │Recovery      │    │
│  └──────────────┘         └──────────────┘         └──────────────┘    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Monorepo Crate & Package Structure

```
/Users/parthsingh/Developer/Cutroom/
├── Cargo.toml                     # Root Cargo workspace configuration
├── apps/
│   ├── desktop/                   # React 19 / Vite 6 Desktop Frontend
│   │   ├── src/                   # Route implementations, shell, AppContext
│   │   └── src-tauri/             # Tauri application wrapper & commands
│   └── web-review/                # Next.js Reviewer & Public Portal (Phase E)
├── crates/
│   ├── cutroom-core/              # Relational models, SQLite migrations, domain ops
│   ├── cutroom-media/             # FFmpeg/ffprobe wrappers, filtergraph compiler
│   └── cutroom-jobs/              # Durable background scheduler & lease recovery
├── packages/
│   ├── design-tokens/             # Color tokens, spacing, typography
│   └── ui/                        # Button, Dialog, Drawer, Card, Input components
└── docs/                          # Architecture, contracts, tasks, and test evidence
```

---

## 3. Core Subsystems

### A. SQLite Storage & Concurrency
- Storage is local-first: `<project_path>/.cutroom/project.cutroom`.
- Concurrency control: Optimistic locking on `compositions.version`. Stale writes are rejected with conflict details.
- Idempotency: `operation_receipts` table hashes incoming request payloads against `operation_id` to guarantee replay safety.
- Revisions: Created atomically with full composition JSON snapshots and SHA-256 verification.

### B. Media Engine & Processing Pipeline
- Uses installed system FFmpeg and ffprobe (`/opt/homebrew/bin/ffmpeg`, `/opt/homebrew/bin/ffprobe`).
- Strict probe extraction: video streams, audio streams, pixel formats, sample rates, duration in rational ticks.
- Proxies generated as 720p H.264 MP4 with synchronized timecode.
- Timeline rendering compiles clips into complex filtergraphs with exact rational tick boundaries.
- No model-generated arbitrary FFmpeg CLI strings; only parameter-validated domain operations compiled in Rust.

### C. Durable Job Scheduler
- In-memory runner backed by persistent SQLite `jobs` table.
- Tasks obtain timed leases (`lease_token` and `lease_expires_at`).
- Automatic recovery on startup: any job left in `running` state with an expired lease is gracefully marked failed without crashing the application.
- Cancelable processes: tracks child PID handles to ensure cancellation terminates active FFmpeg processes immediately and purges partial outputs.

---

## 4. Privacy & Security Invariants
- **Local-First Isolation**: No media, project database, or transcript is uploaded to cloud services unless explicitly published by the user for web review.
- **Path Confinement**: All file accesses outside project boundaries are mediated by explicit user selection dialogs. Symlink traversal is rejected.
- **Model Output Sandboxing**: Local AI models propose structured JSON actions only. Arbitrary code, shell commands, or SQL statements from model outputs are rejected by design.
