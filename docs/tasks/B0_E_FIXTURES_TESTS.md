# Task Packet B0-E — Synthetic Fixtures & Independent Verification

**Parent Milestone**: Phase B — Native Vertical Slice  
**Assigned Worker**: GPT-5.6 Luna  
**Coordinator**: Gemini 3.8 Flash Coordinator  
**Assigned Directory**:
- `/Users/parthsingh/Developer/Cutroom/tests/fixtures/**`
- `/Users/parthsingh/Developer/Cutroom/scripts/verify_b0_slice.mjs`
- `/Users/parthsingh/Developer/Cutroom/docs/evidence/B0.md`

---

## Scope & Writable Files

### Writable:
- `/Users/parthsingh/Developer/Cutroom/tests/fixtures/**`
- `/Users/parthsingh/Developer/Cutroom/scripts/verify_b0_slice.mjs`
- `/Users/parthsingh/Developer/Cutroom/docs/evidence/B0.md`
- `/Users/parthsingh/Developer/Cutroom/docs/evidence/B0_E.md`

### Strictly Forbidden:
- Modifying application source code in `crates/**` or `apps/**`
- Modifying requirements or status in `docs/FEATURE_TRACEABILITY.json` without Astra review
- Using personal or copyrighted test media

---

## Technical Requirements

1. **Synthetic Video Fixture Generation**:
   - Generate two deterministic, short synthetic video fixtures using installed FFmpeg:
     - `fixture_a.mp4`: 5 seconds, 1920x1080, 24fps, H.264 / AAC 48kHz, displaying timecode overlay and audio tone (440Hz).
     - `fixture_b.mp4`: 5 seconds, 1920x1080, 24fps, H.264 / AAC 48kHz, displaying timecode overlay and audio tone (880Hz).
   - Compute and record SHA-256 digests and stream metadata.

2. **Automated End-to-End Verification Script (`scripts/verify_b0_slice.mjs`)**:
   Implement a standalone verification runner that executes and validates the full vertical slice:
   1. Initialize a test project directory at `/tmp/cutroom_test_project`.
   2. Execute `project.create` and assert `.cutroom/project.cutroom` exists and schema is populated.
   3. Execute `asset.import` on `fixture_a.mp4` and `fixture_b.mp4`; verify metadata and duration ticks.
   4. Execute `composition.apply` inserting a 3-second slice of `fixture_a` followed by a 2-second slice of `fixture_b`.
   5. Execute `revision.create` and assert immutable revision SHA-256 hash is generated.
   6. Execute `render.enqueue` and await completion; probe output MP4 with ffprobe to assert duration is exactly 5.0 seconds and has valid video/audio streams.
   7. Reopen the database from a new process and verify that project, assets, composition, and revision match.
   8. Simulate an interrupted job and verify startup lease recovery.

3. **Evidence Assembly (`docs/evidence/B0.md`)**:
   - Record exact commands, outputs, exit codes, and durations.
   - Document any observed limitations or deviations.
   - Submit assembled evidence to Gemini Coordinator and Astra for milestone acceptance.
