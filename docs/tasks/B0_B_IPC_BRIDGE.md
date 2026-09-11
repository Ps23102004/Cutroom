# Task Packet B0-B — Tauri Native IPC Bridge & Desktop Integration

**Parent Milestone**: Phase B — Native Vertical Slice  
**Assigned Worker**: AGY Gemini Worker (separate session)  
**Coordinator**: Gemini 3.8 Flash Coordinator  
**Assigned Directories**:
- `/Users/parthsingh/Developer/Cutroom/apps/desktop/src-tauri`
- `/Users/parthsingh/Developer/Cutroom/apps/desktop/src/lib/native.ts`
- `/Users/parthsingh/Developer/Cutroom/apps/desktop/src/context/AppContext.tsx`

---

## Scope & Writable Files

### Writable:
- `/Users/parthsingh/Developer/Cutroom/apps/desktop/src-tauri/Cargo.toml`
- `/Users/parthsingh/Developer/Cutroom/apps/desktop/src-tauri/tauri.conf.json`
- `/Users/parthsingh/Developer/Cutroom/apps/desktop/src-tauri/src/**`
- `/Users/parthsingh/Developer/Cutroom/apps/desktop/src/lib/native.ts`
- `/Users/parthsingh/Developer/Cutroom/apps/desktop/src/context/AppContext.tsx`
- `/Users/parthsingh/Developer/Cutroom/docs/evidence/B0_B.md`

### Strictly Forbidden:
- Editing core SQLite persistence models in `crates/cutroom-core`
- Modifying design tokens or UI package
- Fabricating mock responses in production code

---

## Technical Requirements

1. **Tauri v2 Application Scaffolding**:
   - Create `apps/desktop/src-tauri/tauri.conf.json` with production identifiers, window settings (1440x900 min, dark background `#19161F`), and capability permissions.
   - Implement `apps/desktop/src-tauri/src/main.rs` initializing Tauri with the core plugin and registering the `dispatch` command.

2. **IPC Dispatch Command (`dispatch`)**:
   Implement a single unified dispatch command in Rust matching `docs/CONTRACTS.md`:
   ```rust
   #[tauri::command]
   pub async fn dispatch(
       state: tauri::State<'_, AppState>,
       request: NativeRequest,
   ) -> Result<NativeResponse, String>
   ```
   Routes incoming commands (`project.create`, `project.open`, `project.list`, `asset.import`, `asset.list`, `composition.get`, `composition.apply`, `revision.create`, `render.enqueue`, `job.list`, `health.get`) to `cutroom-core`, `cutroom-media`, and `cutroom-jobs`.

3. **Frontend Connection (`AppContext.tsx`)**:
   - Ensure `isNativeAvailable()` detects the live Tauri bridge.
   - When native is available, query `health.get` on mount.
   - Replace fixture fallbacks in production handlers (`createProject`, `openProject`, `importAsset`, `splitClip`, `trimClip`, `createRevision`, `enqueueRender`) with live `dispatchNativeCommand` calls.
   - Ensure development sample fixtures remain gated under `import.meta.env.DEV`.

4. **Verification**:
   - Build desktop frontend (`pnpm --filter @cutroom/desktop build`).
   - Run unit tests (`pnpm --filter @cutroom/desktop test`).
   - Verify that all 46 existing tests pass without regressions.
