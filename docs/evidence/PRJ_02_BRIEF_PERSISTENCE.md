# PRJ-02: Structured Brief Persistence

Status: TESTED

## Native (Rust)

Commands: `brief.get`, `brief.set`

Storage: `<project>/.cutroom/brief.json`

Verified behaviors:
- Valid project/session required
- Missing brief returns defaults
- Temporary file write → atomic rename
- Malformed JSON returns INVALID_DATA
- Overwrite works
- Valid write recovers from prior malformed state
- Process restart/reopen persistence works

Native tests (all passing):
- `project_brief_persists_and_survives_restart`
- `project_brief_is_overwritten_and_stored_durable`
- `project_brief_surfaces_malformed_json_and_recovers`

## Frontend (TypeScript/React)

Verified behaviors:
- Brief hydration on project open
- `saveBrief` writes through native bridge
- Clear on project close
- Restore on project reopen
- Project-switch isolation (brief belongs to correct project)
- Native failure does not mutate local brief state
- Native failure surfaces error to UI

Frontend suite: 73 tests passing

## Build

- Cargo workspace: all tests passing
- Desktop production build: PASS
