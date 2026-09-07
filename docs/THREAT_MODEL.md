# Threat model — required controls, not certified implementation

Native core is not implemented. Every native item below remains a release gate.

| Boundary | Threat | Required enforcement/evidence |
|---|---|---|
| Webview → native IPC | forged paths, arbitrary operations, stale writes | narrow capability + strict domain schemas, selected file handles, expected version, operation digest/idempotency tests |
| Media → worker | malicious playlist/protocol, malformed file, resource exhaustion | local protocol restrictions, fixed argument compiler without shell, size/runtime limits, disposable fault fixtures |
| Model → operation engine | invented sources, injected instructions, uploads/deletions | validate IDs/ranges/policies; model cannot grant scope; exact proposal approval binding; hostile-source tests |
| Database ↔ artifacts | interrupted writes, stale job leases, missing output, duplicate work | pending artifact records, hash/validate/promote, transactional references, lease recovery and restart drills |
| Hosted review | cross-tenant access, forged reviewer, stale approval | private artifacts, resource-scoped authorization, authenticated invited reviewer, exact rendition/revision digest, tenant/revocation tests |
| Support assistant → actions/tickets | unsafe repair, sensitive diagnostics, fake acknowledgment | restricted registry, payload preview, consent, server receipt, finite retries, tenant-safe retrieval |
| Archive → filesystem | traversal/symlink overwrite or model/secret leakage | bounded manifest validation, immutable hashes, independent restore, no credentials/model stores |

Frontend browser mode must reject native mutations; development fixtures are explicitly scoped examples. This is only a UI boundary and does not prove native protection. No remote page will receive native capabilities. No signing, hosted deployment, account system or secure-release claim has been made.
