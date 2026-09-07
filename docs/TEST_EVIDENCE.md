# Executed evidence — 2026-09-07

This is foundation evidence, not a release gate pass. There is no native Cutroom core, persistence engine, media job runner, hosted review/support service or installed desktop package.

| Check | Actual result | Scope and evidence |
|---|---|---|
| Full frontend typecheck/test/build | PASS: typecheck exit0, 56 tests, build exit0 | `docs/evidence/frontend-independent/` raw final logs: 7 token + 3 UI + 46 desktop tests. Prior F2 stale fixture/TypeScript failures corrected. Build warns about optional lazy Three chunk (608.34KB, gzip155.80KB) |
| Archive safety tests | PASS, 4 tests, exit 0 | `python3 -m pytest -q tests/archive_inventory_test.py`; bounded inventory, path/symlink/duplicate and corrupt-CRC cases; not a security certification |
| GLB structural validation | PASS, exit 0 | `python3 assets/3d/fallback/validate_cutline_glb.py`; 776 vertices, 388 triangles, closed manifold, finite/unit normals, dereferenced accessors, POSITION/NORMAL morph |
| GLB corruption rejection | PASS, deliberately invalid accessor rejected | `assets/3d/fallback/test_validator_corruption.py`; evidence in L4 |
| Actual Three WebGL rendering | PASS for two endpoint states | `docs/evidence/L4-assets.md`; 1 draw call, 388 triangles each, rest/bent PNGs; no timed animation recording |
| FFmpeg synthetic media smoke | PASS for installed tool | `docs/evidence/media-preflight.json`; synthetic 3-second H.264/AAC generation, probe and decode; not Cutroom export or output certification |
| Dedicated local ASR | PASS WITH CAVEAT | `docs/evidence/asr-preflight.json`; cached Whisper tiny, CPU, exit 0, 3.19s, word timestamps; misrecognized Cutroom; no product integration |
| Gemma E2B/E4B | PARTIAL synthetic smoke, 6/8 valid | `docs/evidence/local-models.json`; 8 sequential actual local calls, no download; schema prompt/validator mismatch prevents quality ranking; held-out certification absent |
| Independent frontend review | PASS for 6 scoped correction findings; no product certification | `docs/evidence/FRONTEND-FINISH-REVIEW.md`; misleading Settings controls/readings, public fixture affordance, fallback framing |
| Native durability, job recovery, media edits, approvals, isolation and support safety | NOT RUN | Required engines and services do not exist yet |

Mock-native tests prove client response/error handling only. Browser screenshots come from one running UI; development fixture screenshots are explicitly marked. No test establishes public deployment, signing, notarization, renderer correctness, AI recipe safety, exact-version approvals or tenant isolation.

Final shared-UI browser batch: 8/8 recorded checks passed, with 17 captures (all8routes at1440x900 and1728x1117 plus explicit DEV Studio fixture). Project submission returned an error, retained the dialog and unchanged zero-project list. Reduced-motion static fallback verified live and after reload. Expanded GPU/production checks, if completed, are separate evidence.

Static artifact integrity audit passed: all 79 requirement entries retained, all referenced evidence paths exist, every asset manifest hash/size matches, and authoritative master SHA is unchanged. Credential-pattern scan returned no matches in authored artifact trees; this is not comprehensive secret/security certification. `git diff --cached --check` returned 2 for trailing whitespace (including preserved Markdown line breaks in owner reference files and generated source comments); no functional error inferred.

Final supplemental browser evidence: rebuilt production preview passed DEV-fixture absence and preserved-direction checks (`frontend-independent/production-gate.json`). Both runtime fallback and GLB HTTP 200 loads were observed (`glb-load.json`); no product renderer performance/GPU or console-error assertion was captured. Tests/typecheck preceded the final Settings copy-only cleanup; the production build was rerun after it. Temporary preview/browser sessions and the root Vite dev server were stopped.
