# Cutroom IPC & Domain Contracts

**Version**: 1.0.0-draft  
**Status**: Authoritative Architecture Contract  
**Owner**: GPT-6 Astra (Product Architecture) | Gemini 3.8 Flash (Execution Implementation)

---

## 1. Native Transport & IPC Protocol

The desktop frontend communicates with the Tauri native core through a single typed dispatch interface:

### Request Envelope
```typescript
interface NativeRequest<P = Record<string, unknown>> {
  command: string;             // Namespaced command identifier, e.g. "project.create"
  operation_id?: string;       // Unique UUIDv4 for mutation idempotency tracking
  project_id?: string;         // Active project context ID
  expected_version?: number;   // Expected composition version for optimistic concurrency
  payload: P;                  // Typed command payload
}
```

### Response Envelope
```typescript
type NativeResponse<T> = 
  | { ok: true; data: T }
  | { ok: false; error: NativeErrorPayload };

interface NativeErrorPayload {
  code: string;                // Canonical error code (e.g. "STALE_WRITE_CONFLICT")
  message: string;             // Human-readable error description
  details?: Record<string, unknown>; // Structured contextual error details
}
```

### Standard Error Codes
| Code | Meaning |
|---|---|
| `NATIVE_UNAVAILABLE` | Browser preview environment without Tauri IPC bridge |
| `PROJECT_NOT_FOUND` | Specified project ID does not exist or cannot be accessed |
| `PROJECT_LOCKED` | Single-writer lock held by another process |
| `STALE_WRITE_CONFLICT` | Current composition version does not match `expected_version` |
| `IDEMPOTENCY_CONFLICT` | `operation_id` reused with a different payload digest |
| `INVALID_SOURCE_RANGE` | Clip in/out ticks fall outside asset source bounds |
| `UNSUPPORTED_MEDIA` | Source codec, container, or format unsupported or corrupt |
| `JOB_NOT_FOUND` | Specified job ID not found in queue or history |
| `INTERNAL_ERROR` | Unhandled backend failure |

---

## 2. Canonical Rational Timing Specification

Floating-point seconds must **never** be accumulated across edits, compositions, or media renders.

### Representation
```typescript
interface RationalTimeBase {
  num: number; // e.g. 1
  den: number; // e.g. 24000 (for 24fps) or 48000 (for audio/standard timeline ticks)
}

interface RationalTime {
  ticks: string;            // Large integer ticks represented as string to prevent JS safe-int overflow
  time_base: RationalTimeBase;
}
```

### Invariants:
1. Every asset probe extracts exact duration ticks and stream time base.
2. Compositions use a canonical default timebase (e.g. `{ num: 1, den: 48000 }` allowing exact integer representation of 24, 25, 30, 50, and 60 fps).
3. Clip `in_ticks` and `out_ticks` are validated against source asset duration before application.
4. Calculations (ripple, trim, split) operate strictly on integer arithmetic in backend code.

---

## 3. Coordinated Command Catalog

### Health & System
- `health.get`: Returns native system status, tool readiness (FFmpeg, local models), and storage paths.

### Project Operations
- `project.list`: Returns metadata for all registered projects.
- `project.create`: Initializes project directory, SQLite database (`project.cutroom`), and `.cutroom/` structure.
- `project.open`: Acquires single-writer lock, runs pending SQLite migrations, and loads active project state.

### Asset Operations
- `asset.import`: Probes media via ffprobe, optionally copies file (managed) or references existing path (linked), creates asset record, and spawns thumbnail/waveform generation jobs.
- `asset.list`: Returns all assets associated with the active project.

### Composition & Timeline Operations
- `composition.get`: Fetches current working composition (tracks, clips, version).
- `composition.apply`: Atomic mutation applying domain operations (split, trim, reorder, add clip). Validates `expected_version` and records `operation_id`.

### Revisions & Versions
- `revision.create`: Creates an immutable revision snapshot with computed SHA-256 content hash of the composition.
- `revision.list`: Returns revision history tree for the active project.
- `revision.restore`: Restores timeline state to a historical revision without deleting newer history.

### Rendering & Jobs
- `render.enqueue`: Enqueues timeline render job for a designated revision and preset (`1080p_sdr`, `vertical_9_16`, etc.).
- `job.list`: Returns status, progress, and errors of active and historical background jobs.
- `job.cancel`: Cancels an in-progress job and cleans up partial output files.
- `job.retry`: Reschedules a failed job from the last valid checkpoint.
