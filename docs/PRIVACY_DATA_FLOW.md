# Intended privacy boundaries

Required product behavior: local source media, project SQLite, edits, transcription, retrieval, model inference and rendering remain local. Hosted review uploads only selected rendition artifacts and selected metadata after explicit consent. Hosted inference is independently consented. Support tickets and diagnostic attachments have their own preview/consent/acknowledgment boundary. No live project database sync.

Current implementation: frontend preview and local development tests. No hosted review, telemetry, hosted support or product inference integration exists. Development workers use the owner's authorized coding subscriptions; these tools/configurations/credentials are not product dependencies and must never ship.

Testing scope: browser checks will observe the Cutroom frontend request boundary. They cannot certify OS-wide or separately running tools' network behavior. Public privacy/terms text must be drafted from final implemented retention/deletion behavior and reviewed before publication. No E2EE, certification, zero-collection or provider-training promises are asserted.
