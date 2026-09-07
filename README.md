# Cutroom

Local-first creator production studio under active construction. **This checkout is not yet a working native editor or a release candidate.** The full owner mandate is [references/MASTER.md](references/MASTER.md).

The implemented React frontend uses one shared shell, route manifest and component/token library. Browser preview explicitly lacks the native media engine. Development fixtures illustrate layouts; they do not prove persistence, media editing, approvals or delivery.

## Run the frontend

Prerequisites currently used: Node22, pnpm9.15.9. Dependencies are project-local and lockfile-pinned.

```sh
pnpm install --frozen-lockfile
pnpm --filter @cutroom/desktop dev --host 127.0.0.1
```

The server binds only to this machine.

## Verify

```sh
pnpm typecheck
pnpm test
pnpm build
python3 scripts/media_smoke.py --output tests/fixtures/media-smoke
python3 assets/3d/fallback/validate_cutline_glb.py
python3 assets/3d/fallback/test_validator_corruption.py
```

Frontend tests use renderer/mocked-native boundaries; they are not native persistence or media integration tests. The media script creates and decodes a synthetic fixture with installed FFmpeg. The GLB is an explicitly procedural fallback; the installed image-to-3D converter has not run.

Optional local model smoke: `python3 scripts/evaluate_local_models.py --run`. This uses only the existing idle loopback Ollama service and installed allowlisted Gemma candidates. It does not download models and is not a certification dataset.

## Build records

- [Current state and next task](docs/BUILD_STATE.md)
- [Real worker participation](docs/AGENT_LEDGER.jsonl)
- [Environment and routes](docs/ENVIRONMENT.md)
- [Required feature traceability](docs/FEATURE_TRACEABILITY.json)
- [Design contract](docs/DESIGN_CONTRACT.md)
- [Test evidence](docs/TEST_EVIDENCE.md)

GLM5.2 and GLM5.3 returned provider quota errors. Their required backend/review work is blocked pending the owner's fallback decision or restored capacity. No public deployment, signing, hosting, showcase publication or credential redistribution has occurred.
