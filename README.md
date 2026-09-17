# Cutroom

**Cutroom** is a professional, local-first AI video production studio for creators and modern post-production teams. A high-performance **Rust-native timeline and media engine** paired with **strictly local AI models** running on your own machine — no cloud rendering, no uploads, no telemetry.

![Cutroom demo — color grading and 4K/HDR delivery](assets/demo.gif)
*Demo recorded from the fixture UI preview — the same interface as the desktop app.*

---

## Download

Prebuilt installers are not published yet. The supported way to run Cutroom today is a one-time build from source — it takes about 10 minutes on a modern machine.

### Prerequisites

| | macOS | Windows | Linux |
|---|---|---|---|
| Rust | [rustup.rs](https://rustup.rs) | [rustup.rs](https://rustup.rs) | [rustup.rs](https://rustup.rs) |
| Node.js ≥ 22 + pnpm ≥ 9 | `brew install node pnpm` | [nodejs.org](https://nodejs.org), then `npm i -g pnpm` | [nodejs.org](https://nodejs.org), then `npm i -g pnpm` |
| FFmpeg + FFprobe | `brew install ffmpeg` | `winget install Gyan.FFmpeg` | `sudo apt install ffmpeg` |
| System libs | Xcode CLT (`xcode-select --install`) | WebView2 (preinstalled on Win 10/11) | see below |

Linux also needs the Tauri system libraries:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

### Build & run

```bash
git clone https://github.com/Ps23102004/Cutroom.git
cd Cutroom
cargo install tauri-cli          # one-time
pnpm --filter @cutroom/desktop install
cargo tauri dev                  # launches the Cutroom desktop app
```

To produce a release installer instead:

```bash
cargo tauri build
# → apps/desktop/src-tauri/target/release/bundle/
```

---

## Features

### Professional color pipeline
- **Input up to 4K 120fps** — H.264/H.265, 8-bit and 10-bit, with strict validation
- **HDR & camera log** — PQ/HLG tone mapping to SDR, HDR10 output, S-Log3 built-in de-log (V-Log/C-Log3 via manufacturer LUTs)
- **Per-clip grading** — exposure, contrast, saturation, white balance, tint
- **Custom `.cube` LUTs** — SHA-256 pinned, canonical-path verified before render and re-verified before the artifact is promoted
- **Color-space conversion** — e.g. BT.2020 SDR → Rec.709

### Render presets
| Preset | Resolution / fps | Codec | Color |
|---|---|---|---|
| `1080p_sdr` | 1080p24 | H.264 | Rec.709 SDR |
| `720p_h264` | 720p30 | H.264 | Rec.709 SDR |
| `1080p_h264` | 1080p30 | H.264 | Rec.709 SDR |
| `2160p_h265` | 2160p30 | H.265 | Rec.709 SDR |
| `2160p60_h265` | 2160p60 | H.265 | Rec.709 SDR |
| `2160p_hdr10` | 2160p30 | H.265 | BT.2020 PQ HDR10 |

### Local-first AI editing
- On-device inference via local Ollama models — your footage never leaves the machine
- Human-in-the-loop structured proposals: **Apply** / **Dismiss**, never silent mutation
- AI EditPlans for multi-step assembly ("build a 45-second teaser from the interview")
- Word-level transcripts, silence detection, semantic moment classification (hooks, demos, CTAs)

### Trust & integrity
- Frame/sample-exact rational timebase conversions
- SHA-256 content-hashed immutable revisions
- Source media is strictly read-only — originals are never modified
- Signed delivery manifests; rendered artifacts are verified before delivery

---

## Current limitations (honest)

- **No prebuilt downloads yet** — build from source (see above).
- HDR10 output supports **PQ only**; HLG sources are tone-mapped to SDR.
- Only **S-Log3** has a built-in de-log LUT; V-Log/C-Log3 need the manufacturer's `.cube`.
- Mixed audio/no-audio timelines are rejected rather than silence-filled (for now).
- AI features need a local Ollama runtime; without it the app degrades to honest "unavailable" states — nothing is faked.

---

## Developing

```bash
# Frontend tests + typecheck
pnpm --filter @cutroom/desktop test
pnpm --filter @cutroom/desktop typecheck

# Rust workspace tests (core, media, jobs, Tauri)
cargo test --workspace

# Production web build
pnpm --filter @cutroom/desktop build
```

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│            Cutroom Desktop UI (React 19 + Vite)               │
│   Studio • Timeline • Color • AI Proposals • Review • Deliver │
└──────────────────────────────┬───────────────────────────────┘
                               │ Typed IPC Bridge
┌──────────────────────────────▼───────────────────────────────┐
│                 Native Rust Post-Production Core             │
│   • cutroom-core:  SQLite project engine, timeline ops       │
│   • cutroom-media: FFmpeg/FFprobe probing, pro color render  │
│   • cutroom-jobs:  Render queue & background workers        │
│   • cutroom-tauri: Native dispatch, dialogs, single-writer   │
└──────────────────────────────────────────────────────────────┘
```

### Security model

- The AI model only ever sees narrow, validated context — never filesystem paths or credentials.
- Production IPC never accepts caller-supplied file paths; media and LUTs are chosen through native file dialogs.
- Adversarial test suites continuously verify resistance to prompt injection, path traversal, and concurrency races.

---

## License

MIT — see [LICENSE](LICENSE).
