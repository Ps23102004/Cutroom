# Cutroom Relational Data Model (SQLite)

**Version**: 1.0.0-draft  
**Database**: SQLite with WAL (Write-Ahead Logging) Mode  
**Storage Location**: `<project_path>/.cutroom/project.cutroom`

---

## 1. Relational Schema Definition

```sql
-- Projects Table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL CHECK (aspect_ratio IN ('16:9', '9:16', '1:1')),
    fps_numerator INTEGER NOT NULL DEFAULT 24000,
    fps_denominator INTEGER NOT NULL DEFAULT 1001,
    status TEXT NOT NULL CHECK (status IN ('draft', 'in_review', 'approved')) DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Assets Table
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    duration_ticks TEXT NOT NULL,
    timebase_numerator INTEGER NOT NULL,
    timebase_denominator INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    format TEXT NOT NULL,
    codec TEXT NOT NULL,
    audio_channels INTEGER NOT NULL DEFAULT 2,
    import_type TEXT NOT NULL CHECK (import_type IN ('managed', 'linked')),
    proxy_status TEXT NOT NULL CHECK (proxy_status IN ('none', 'generating', 'ready', 'failed')) DEFAULT 'none',
    sha256 TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);

-- Compositions Table
CREATE TABLE IF NOT EXISTS compositions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    duration_ticks TEXT NOT NULL DEFAULT '0',
    timebase_numerator INTEGER NOT NULL DEFAULT 1,
    timebase_denominator INTEGER NOT NULL DEFAULT 48000,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_compositions_project ON compositions(project_id);

-- Tracks Table
CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY NOT NULL,
    composition_id TEXT NOT NULL REFERENCES compositions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('primary_video', 'overlay_video', 'dialogue_audio', 'music_audio', 'captions', 'graphics')),
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_muted BOOLEAN NOT NULL DEFAULT 0,
    is_locked BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tracks_composition ON tracks(composition_id, sort_order);

-- Clips Table
CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY NOT NULL,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    in_ticks TEXT NOT NULL,
    out_ticks TEXT NOT NULL,
    timeline_start_ticks TEXT NOT NULL,
    timeline_duration_ticks TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_clips_track ON clips(track_id, sort_order);

-- Revisions Table
CREATE TABLE IF NOT EXISTS revisions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    commit_note TEXT NOT NULL,
    author TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    parent_revision_id TEXT REFERENCES revisions(id) ON DELETE SET NULL,
    composition_snapshot TEXT NOT NULL, -- Full JSON snapshot of tracks and clips
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_revisions_project ON revisions(project_id, revision_number);

-- Operation Receipts Table (Idempotency and Concurrency)
CREATE TABLE IF NOT EXISTS operation_receipts (
    operation_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    expected_version INTEGER NOT NULL,
    payload_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_receipts_project ON operation_receipts(project_id);

-- Background Jobs Table
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('proxy', 'render', 'asr', 'waveform', 'export')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')) DEFAULT 'queued',
    step TEXT NOT NULL DEFAULT '',
    current_step INTEGER NOT NULL DEFAULT 0,
    total_steps INTEGER NOT NULL DEFAULT 1,
    lease_token TEXT,
    lease_expires_at TEXT,
    error TEXT,
    output_path TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_project_status ON jobs(project_id, status);
```

---

## 2. Invariants & Guarantees

1. **Foreign Key Integrity**: `PRAGMA foreign_keys = ON;` is strictly executed upon establishing any database connection.
2. **Atomic Commits**: Mutations spanning composition updates, clip insertions, and operation receipt storage run within single SQLite transactions.
3. **Lease Recovery**: On process startup, any job with status `'running'` whose `lease_expires_at` is in the past is transitioned to `'failed'` with error `'Process interrupted / lease expired'`.
