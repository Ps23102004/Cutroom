# Cutroom — Product and Engineering Blueprint

**Version:** 0.1 — proposed specification  
**Prepared:** September 7, 2026  
**Owner:** Parth  
**Working description:** Local-first creator production studio for independent creators and small video teams.

## Status and provenance

Parth selected Cutroom for a substantial Handshake AI Showcase portfolio project. The carried-forward requirements are a complete product, not an isolated AI feature; real frontend and backend; media processing; AI workflow execution; versioning; client collaboration; and useful small local models, including Gemma 4 E2B/E4B, with optional hosted inference.

The complete earlier Cutroom recommendation was not recovered. The detailed choices in this document are new proposals, not a claim that they were all previously agreed. This is a specification, not a report of implemented functionality. Performance numbers and acceptance thresholds below are proposed engineering gates, not measured results. Public technical references were checked on September 7, 2026. Source identifiers resolve in the final section.

---

# 1. Product thesis

**Cutroom helps a creator turn existing recordings into organized, editable, reviewable, approved deliverables while retaining control of original media and AI processing.**

The central workflow is:

`Brief → Import → Understand → Assemble → Refine → Review → Revise → Approve → Deliver → Archive`

The product should own this complete workflow for a deliberately bounded class of videos. It should not try to own every kind of professional post-production.

The north-star user outcome is not “generated a clip.” It is “delivered the right version, with feedback addressed, and can explain or undo every consequential change.”

The portfolio outcome is demonstrable engineering: desktop product development, multimedia correctness, structured model integration, durable jobs, data modeling, secure collaboration, meaningful evaluation, and deployment. No product idea can guarantee employer preference. The submission should make Parth's actual contribution and measured outcomes inspectable. Handshake asks for the problem, operation, beneficiaries, AI tools, and personal contribution. [S01]

## 1.1 Product promise

“Your footage stays under your control. Cutroom handles the production workflow, shows its work, and keeps you in charge of the final cut.”

“Shows its work” means source references, proposed edits, executed operations, validation results, and concise decision summaries. It does not require exposing a model's private reasoning trace.

## 1.2 What the product is not

It is not a chat interface around an upload form, an automatic shorts generator with no project lifecycle, an autonomous publishing bot, a universal replacement for Premiere/Resolve/Final Cut, a text-to-video generator, a full project-management suite, or a promise that a small language model can reliably make every creative decision.

---

# 2. Positioning and differentiation

Prompt-driven editing is already offered by Descript's Underlord; OpusClip offers clipping and a raw-footage editing agent; Frame.io offers review and approval; DaVinci Resolve offers AI-assisted editorial features. These are overlapping products, not evidence that Cutroom has an untouched market. [S02–S05]

The proposed distinction is the combination of:

1. Local media processing and local inference as the normal path.
2. A source-grounded editing plan instead of an opaque generated answer.
3. Immutable, inspectable versions of a composition.
4. Feedback converted into proposed, reviewable changes against the correct version.
5. Resumable production jobs and portable project data.
6. Selective sharing that does not require uploading the entire original library.

This combination is a positioning hypothesis, not a proven competitive moat or a verified claim that no competitor implements it.

## 2.1 Initial customer

Start with solo creators, freelance editors, and teams of roughly one to five people producing speech-led videos: interviews, tutorials, product explanations, podcasts, course segments, and screen-recorded demonstrations.

This customer has existing recordings, repeats a similar production process, needs several formats, and often receives feedback from someone who does not use an editor.

Parth can use the product for his own technology/AI creator workflow. Gaming is a later expansion: selecting dialogue-led gaming commentary and user-marked moments can work initially, but dependable gameplay-event detection should not be claimed without game-specific evaluation.

## 2.2 Customer assumptions to validate

The following are hypotheses: creators value not uploading raw footage; they lose time coordinating feedback; they will install a desktop app and models; they will accept a focused editor for straightforward productions; and they will pay for collaboration or reliability rather than merely more AI buttons.

Interview five to eight suitable creators. Observe a complete project from recording through delivery. Record current tools, time spent, revision mistakes, hardware, privacy concerns, storage sizes, and willingness to switch. Run a pilot with three to five creators and their own permitted media. Do not invent user testimonials, market statistics, or time savings.

---

# 3. Definitions

| Term | Meaning inside Cutroom |
|---|---|
| Workspace | Local owner context containing project references, defaults, and reusable assets. Cloud membership is separate and optional. |
| Project | A bounded production with a brief, assets, compositions, jobs, revisions, and deliverables. |
| Brief | Structured goals and constraints: audience, message, duration, deliverables, required material, prohibited material, and style. |
| Source asset | An imported original media item identified by content and metadata. |
| Managed asset | Media copied into a project-controlled location and verified after copying. |
| Linked asset | Media referenced at a user-selected location without copying; it may later become unavailable or change externally. |
| Proxy | A lower-cost derivative used for preview; it does not replace the original. |
| Transcript | Recognized speech linked to source media and timing, retaining model output and user corrections separately. |
| Segment | A stable, identifiable source interval: sentence, speech section, shot, or user selection. |
| Composition | The editable representation of a deliverable: ordered media intervals, tracks, captions, layout, and processing. |
| Edit plan | A proposed set of typed operations with references, constraints, and checks. |
| Workflow recipe | A reusable, versioned sequence of supported operations. |
| Job | A durable unit of processing such as probing, transcription, proxy generation, or rendering. |
| Revision | An immutable saved composition state with its parent, author, and change description. |
| Rendition | A rendered artifact produced from one revision and one export specification. |
| Review package | Explicitly shared renditions, selected metadata, and review permissions. |
| Approval | A recorded review decision attached to a specific revision/rendition, not to an indefinitely changing project. |
| Delivery manifest | A list of delivered artifacts, hashes, export settings, versions, and approval references. |
| Local-first | Core production works without remote services once required software/models are installed. Optional sharing is identified separately. |
| AI execution receipt | A trace of model identity, relevant inputs/references, prompt/schema version, proposed operations, validations, and outcome. |

---

# 4. Non-negotiable product rules

Originals are not overwritten. AI cannot silently upload content, publish work, delete originals, install arbitrary software, or purchase services. Every consequential edit is reversible through revision history. An unsupported task returns a useful limitation rather than fake completion. Offline production must not require a cloud account. Raw footage and credentials must not enter analytics logs. Every preview and export must identify its revision. Jobs must distinguish queued, running, waiting, failed, canceled, and completed states truthfully.

Model support is an engineering claim: a provider-listed model is not “Cutroom supported” until the exact adapter/model configuration passes the relevant tests.

## 4.1 First-release boundaries

Proposed launch target: macOS on Apple Silicon. Use Parth's M3 Pro machine as the first benchmark device, recording its actual available memory and operating-system version during testing. Do not treat a recalled memory specification as a measured hardware fact.

The initial content scope is English speech-led material. Other languages may be tested and labeled experimental; multilingual model advertising is not sufficient to claim production caption quality.

The proposed acceptance envelope is projects containing up to 50 assets and 90 minutes of total source material, with 1080p SDR final deliverables. These are initial testing targets to validate or revise, not known system limits. Larger media can be allowed experimentally with an explicit warning.

Supported input combinations should be enumerated by actual tested codec/container/bit-depth/frame-rate combinations. Start with a tested MP4/MOV subset containing H.264/AAC, plus WAV, MP3, PNG, and JPEG. Add HEVC, ProRes, MKV, WebM, and other inputs only as certified combinations. FFprobe supplies actual stream metadata rather than guessing from the extension. [S14]

4K source ingestion should use proxies and require test coverage before being advertised. Full HDR/Dolby Vision finishing, RAW camera workflows, 8K, advanced compositing, and unrestricted multicam are outside the first release. HDR inputs must be detected and either explicitly converted through a tested SDR workflow or rejected with an explanation; never silently render wrong colors.

The first editor supports one main video track, one B-roll/overlay video track, dialogue and music audio tracks, and captions/title overlays. Start with hard cuts and simple fades, not a general effects system. Manual framing is mandatory; advanced tracking is not.

A single desktop writer owns a project at a time. Remote reviewers collaborate on review packages, not simultaneous timeline editing. A controlled project handoff is different from live co-editing.

---

# 5. End-to-end user journeys

## 5.1 Solo creator: one recording, several deliverables

A creator creates a project, selects its folder, imports a 45-minute tutorial and a logo, and specifies one eight-minute main video and three short vertical excerpts. They identify a required disclosure and mark a sensitive section as excluded.

Cutroom probes the files, verifies source identities, builds proxies, transcribes speech, and indexes source segments. The creator can start searching as analysis completes rather than waiting for the entire project.

The creator asks for an opening that starts with the practical result rather than the introduction. Cutroom proposes existing source segments, explains the choices, and highlights any incomplete context. The creator previews candidates, accepts a selection, and edits the composition through text and timeline controls.

The creator applies a brand preset and captions, checks framing, and renders a review draft. They compare it with an alternative opening, choose a revision, pass the delivery checklist, and export the main video, three shorts, captions, and a manifest. The original recording remains unchanged.

## 5.2 Freelancer and client: feedback to an approved revision

The editor explicitly publishes a compressed review rendition. The client opens a browser link, comments on specific moments, requests a logo adjustment, and marks one section too long.

Cutroom retrieves the feedback when online. The AI groups comments and proposes actions, distinguishing exact instructions from ambiguous judgments. The editor accepts the logo adjustment, chooses among shortening options, and asks for clarification on a contradictory request.

Accepted changes create a new revision. The client sees a comparison and approves the new rendition. The old approval is retained on the old version; it is never silently transferred. The editor exports the approved deliverables.

## 5.3 Offline and failure recovery

The creator works offline after installation. Import, search, local AI, editing, versioning, and export continue. Review uploads remain queued.

An application crash interrupts a render. On restart, Cutroom checks the persisted job lease and output state, discards incomplete output, and retries only the necessary step. Completed transcription and proxy artifacts are reused when their inputs and configuration still match.

An external SSD is disconnected. The application stops relevant writes, marks missing media, and explains the recovery action. It does not mark jobs successful or forget the revision. After reconnecting, source identity is verified before processing continues.

## 5.4 No suitable source material

The creator requests a quote or shot that is not present. Cutroom states that it could not locate supporting material and shows the search scope. It does not fabricate footage, quotations, or timestamps. It may propose an explicitly labeled placeholder or ask the creator to record additional material.

## 5.5 Repeatable production

The creator saves a successful recipe for weekly interviews: ingest, transcribe, identify three excerpt candidates, draft a main composition, apply branding, render review, and create delivery artifacts. The recipe is versioned. On a new project, the AI fills supported parameters; policy and validation remain enforced by code.

---

# 6. Functional specification

## 6.1 Onboarding and setup

The first launch offers a sample project and an empty project. It explains local processing, optional sharing, expected model downloads, and storage choices without a wall of technical vocabulary.

The setup inspector checks platform, available memory, disk space, required worker binaries, encoder availability, and installed local models. It distinguishes missing, installed, compatible, tested, and enabled components.

Users choose model and project locations, including an external SSD. Model downloads require approval and show source, artifact size, license, and checksum. Setup runs an actual inference smoke test, a tiny transcription test, and a tiny render test. A failure disables only the affected feature and exposes an actionable message.

The application must not download models silently, run model-generated shell scripts, or assume an external inference server is reachable. Updates and model installation are separate user-approved operations.

**Acceptance:** A new user completes the bundled sample without a paid API key. After setup, the offline test completes without network access.

## 6.2 Brief and project management

Project creation captures title, owner, storage location, source folder, output intentions, default language, and privacy mode. A brief captures audience, purpose, desired tone, must-include segments/assets, must-exclude segments, duration constraints, deliverable formats, brand preset, and reviewer.

Hard constraints and preferences are distinct. “Do not use segment X” is enforceable. “Make this feel energetic” is a subjective objective. Required disclosure handling uses explicit source markers or exact asset references; the product does not claim legal compliance analysis.

The AI can turn a paragraph into draft brief fields, identify conflicting requirements, and suggest missing production inputs. The creator confirms the resulting brief. Each deliverable has its own specification and status.

Include duplicate-project templates, archive/unarchive, recent projects, a production status board, and storage summaries. Do not build invoicing, customer relationship management, or a general task-management product.

## 6.3 Asset ingestion and library

Support drag-and-drop files and folders, recursive discovery with explicit limits, import progress, cancellation, duplicate detection, and managed versus linked import. Source discovery is immediate; expensive hashing happens as a visible background operation.

Read actual duration, streams, codec, time base, dimensions, rotation, audio channels, sample rate, frame-rate behavior, color metadata, and size. Detect unsupported combinations early.

Generate thumbnails, filmstrip samples, waveforms, and preview proxies. Preserve source-to-proxy timing maps. Normalize variable-frame-rate material only through a documented workflow that maintains correspondence to original media.

Provide tags, favorites, bins, source notes, relinking, missing-source warnings, and provenance. File hashes establish identity; filenames alone do not. A changed linked file becomes a new asset version or requires explicit re-import rather than silently altering old edits.

**Acceptance:** Importing the same bytes twice does not double-copy managed media. Removing a source produces an explicit missing-media state. A proxy can be deleted and rebuilt without losing edits.

## 6.4 Media analysis and transcript

Use dedicated local speech recognition with speech-activity detection. Store raw recognition output, source language, approximate token/segment timings, recognition metadata, and human corrections separately.

Provide click-to-seek transcripts, sentence/segment selection, search, markers, uncertain-text indicators, and a user glossary. Do not display a calibrated percentage unless it is genuinely calibrated. An ASR score is not the probability that a sentence is correct.

Transcript correction changes the text representation, not the spoken audio. Caption correction and editorial cutting are separate operations. Original word identities and timings remain available after corrections so references do not become ambiguous.

Speaker labeling starts manually. Any automatic speaker segmentation is optional and evaluated separately; anonymous labels do not imply reliable identity recognition.

Whisper.cpp is a suitable implementation candidate, with Apple Silicon support and local inference. Its documentation labels word-level timestamps and some diarization features experimental; those features require validation rather than a promise of perfect timing. [S10]

## 6.5 Search and source understanding

Provide exact keyword search first, with filters for asset, speaker label, tag, and duration. Add semantic retrieval over transcript chunks and optional sampled-frame descriptions. Always return playable source intervals.

Use hybrid lexical and embedding retrieval, then a small model for bounded reranking when it improves tested performance. Chunk with sentence boundaries and modest overlap, retaining stable IDs and source spans. Never send a full 90-minute project blindly into one model context.

Search examples: “the part where I explain the trade-off,” “all mentions of the product name,” or “a clean demonstration of the dashboard.” A visual result must identify sampled evidence, not imply the entire video was continuously understood.

EmbeddingGemma is an available local text-embedding option; its context length means inputs must be chunked independently of the larger language model context. [S08–S09]

**Acceptance:** Every displayed search hit resolves to an existing source interval. Retrieval performance is measured on annotated queries; no-match queries are included.

## 6.6 Storyboard, selections, and draft assembly

The user asks for a deliverable or uses a template. Cutroom proposes an ordered list of source intervals with concise reasons, intended role, duration, and concerns such as missing context or repeated information.

Candidates should distinguish a hook, explanation, demonstration, supporting evidence, and ending where appropriate. The AI may draft overlay text or descriptions, but it must not pass rewritten prose off as an exact spoken quotation.

A draft must respect exclusions, required intervals, source bounds, aspect-ratio intent, and available media. When duration and required content conflict, the system returns an unsatisfied-constraint report rather than quietly dropping material.

Avoid a fabricated “virality score.” Use interpretable editorial criteria such as self-contained meaning, topic relevance, repetition, and source quality, with visible uncertainty and human choice.

**Acceptance:** Every inserted source interval is valid, the requested source references are visible, and rejected suggestions leave the current composition untouched.

## 6.7 Editing workspace

Provide synchronized transcript, preview, and timeline. Support segment insertion/removal, split/trim/reorder, ripple behavior, B-roll overlay, crop/scale/position, source gain, music gain, fades, title/logo placement, caption selection, and undo/redo.

All controls dispatch the same typed editing operations used by AI. There must not be a hidden AI-only editing path that bypasses validation.

Store time as rational ticks/frames with explicit time bases, not accumulated floating-point seconds. Display timecodes in the chosen composition rate. Preserve a mapping between source media intervals and composition intervals.

Preview initially uses proxies and a debounced rendered draft of the supported composition. Basic interactive adjustments can use lightweight preview rendering, but an explicit render state must identify stale or draft output. Do not promise an unrestricted real-time NLE from concatenated HTML video elements.

Final export renders from verified originals when required. A proxy-only render is explicitly labeled and cannot masquerade as a full-quality delivery.

**Acceptance:** A tested edit produces the same intended ordering and boundaries in preview and final output. Export artifacts are tied to the exact revision previewed; pending preview renders cannot be mislabeled.

## 6.8 Captions and branding

Offer editable sentence-level captions, configurable line breaking, safe-area preview, a small set of readable styles, optional word highlighting when alignment passes checks, and SRT/VTT export. Burned-in captions and sidecar captions are separate deliverable choices.

Brand presets store user-provided logo, selected installed or properly licensed fonts, color choices, text hierarchy, framing preferences, and caption styles. They do not infer ownership of imported material.

Track caption overflow, overlapping cues, invalid durations, missing glyphs, and off-screen positioning. Caption reflow is deterministic. Correction suggestions preserve the original text and require acceptance when meaning could change.

Translation is an expansion feature and must be labeled as translated text, not an exact original quote. Voice cloning, lip-sync replacement, and fabricated speaker speech are outside the initial product.

## 6.9 Audio processing

Provide waveform display, gain, basic fades, measured loudness normalization, clipping warnings, and optional conservative noise reduction with A/B preview. Music ducking may be a later improvement after basic mixing is reliable.

Use configured signal-processing operations rather than asking an LLM to manufacture audio. FFmpeg provides relevant filtering primitives, including loudness, fades, trimming, concatenation, and subtitle-related processing in suitable builds. [S13]

The user selects a delivery loudness target. Any default is a Cutroom preset, not a universal platform requirement. Severe distortion cannot be promised recoverable. Noise reduction that damages speech must be easy to bypass.

## 6.10 AI workflow execution

Provide a command panel plus visible recipe actions. Core recipes include “prepare an interview,” “draft a main video,” “find excerpt candidates,” “apply review changes,” and “prepare delivery.”

Before execution, show intended steps, selected model, local/remote processing, affected assets, expected outputs, approximate resource demand, and approval requirements. Estimated times are based on measured jobs when available; otherwise label them unknown.

Offer three permission modes: Suggest, Draft, and Approved Recipe. Suggest changes nothing. Draft can create reversible alternatives within the requested project. Approved Recipe can run previously allowed local processing steps. Uploads, deletion, publishing, purchases, and privilege expansion remain separately gated.

Every operation declares its schema, permissions, preconditions, output artifacts, invalidation rules, retry behavior, and timeout. The scheduler, not the language model, determines job execution and resource concurrency.

## 6.11 Versions and comparisons

Each revision is immutable and records composition state, parent revision, author, timestamp, source references, change summary, and relevant AI receipt IDs. A mutable working copy can be saved into a revision, but a reviewed revision never changes underneath its reviewer.

Support named versions, duplicate-as-alternative, restore, and comparison. Restoring creates a new current state derived from an older revision; it does not erase later history.

Store edit metadata, not a full copy of each original for every revision. Render caches are reusable only when source hashes, composition digest, worker versions, and export settings match.

The product promises replayable edit decisions with recorded dependencies, not identical encoded bytes across all machines and encoders. Preserve delivered renditions separately for exact historical review.

## 6.12 Client review and collaboration

A creator can explicitly upload selected review renditions and selected metadata to a private hosted review service. The pre-upload screen enumerates what leaves the computer. Original footage remains local by default.

The browser portal provides video playback, comments on moments or ranges, version selection, comparison, requested-change status, and approval. Reviewing does not require installing the desktop application or downloading local AI models.

Roles are owner/editor, reviewer, and viewer. Reviewers may comment and record review decisions but cannot edit local media. Guest-link comments may be allowed for convenience, but guest display names are unverified; formal approval should require an authenticated invited reviewer.

Use expiring, revocable share tokens and authorized delivery of private objects. Password protection can supplement but does not replace authorization. Revoking a share link stops new authorization; already issued signed object URLs can remain usable until their short expiry unless a stricter authenticated delivery gateway is implemented. The UI and tests must reflect that window. A link cannot prevent screen recording or revoke a copy already downloaded.

Every comment anchors to the original revision/rendition and a timeline range. Where possible it also records source interval and clip-instance references. Remapping comments to a newer version is derived information. Deleted or ambiguous intervals remain visibly unresolved rather than being attached to the wrong moment.

The AI may group feedback and propose edits, but client text is untrusted input and cannot expand application privileges. Conflicting comments are surfaced for the editor.

The desktop queues outgoing review changes and retrieves new feedback when connected. Cloud failure must not block local work. The service remains available to clients when the editor's laptop is asleep because the shared rendition is hosted.

## 6.13 Delivery

Deliverables specify composition revision, aspect ratio, dimensions, frame rate, encoder preset, audio settings, caption mode, filename template, output folder, and approval reference.

The delivery checklist verifies source availability, required content markers, excluded segments, cue validity, render success, stream properties, expected duration, revision identity, and user acknowledgement of creative/rights checks. Automated checks cannot certify legal compliance, guaranteed factual correctness, or flawless editorial quality.

Output can include main video, alternate aspect ratios, short excerpts, SRT/VTT, a transcript, chapters, draft title/description text, a review summary, and a machine-readable manifest. Only selected items are generated.

Titles and descriptions must not invent product specifications, claims, or results absent from project-provided material. Publishing to external platforms is not part of the first release. Copy/export remains available.

## 6.14 Archive, recovery, and maintenance

Provide a portable project export with a consistent database snapshot, revision manifests, receipts, and optionally managed sources. Include checksums and a readable manifest. Exclude secrets, unnecessary temp files, and account tokens.

Provide missing-media relinking, cache cleanup preview, storage reporting, safe-close/eject guidance, backup and restore, and a sanitized support bundle. Deleting derived caches must not delete originals or the only retained approved rendition without explicit confirmation.

Project deletion, cloud-share deletion, and cache deletion are separate operations. Explain retention and backup behavior. Do not label deletion immediate or permanent when a hosted backup retention period still applies.

---

# 7. Information architecture and visual design

## 7.1 Main areas

**Home:** recent projects, create/open, sample project, actual background activity.

**Project:** brief, deliverables, status, assets, and project settings.

**Studio:** preview, transcript/storyboard, limited timeline, inspector, and AI command drawer.

**Review:** shared versions, comments, change proposals, and approvals.

**Deliver:** output presets, preflight report, render queue, finished artifacts, and manifests.

**Activity:** processing jobs, AI receipts, warnings, retries, and recovery.

**Settings:** storage, models, privacy, sharing account, accessibility, and diagnostics.

Subfeatures live inside these areas rather than becoming dozens of empty navigation pages.

## 7.2 Studio layout

Use a resizable asset/transcript region on the left, central video canvas, a context-sensitive inspector on the right, and a bottom timeline. The AI drawer should not permanently displace editing space. A compact job indicator expands into real logs.

Use an Apple-inspired glass treatment sparingly in navigation and floating controls. Keep the video well neutral and avoid translucent backgrounds behind dense transcript text. Prioritize legible type, restrained motion, clear selected states, and strong contrast. Use system fonts or appropriately licensed alternatives, without redistributing proprietary font files.

Keyboard support includes play/pause, seek, select range, split, delete selection, undo/redo, save version, and command search. Provide tooltips with shortcuts, visible focus, screen-reader labels, scalable text, reduced motion, and reduced transparency.

Every screen needs useful empty, loading, partial-success, error, offline, missing-media, and permission-denied states. No fake counters, artificial success toasts, decorative agent swarms, or unsupported model names.

---

# 8. AI implementation

## 8.1 Division of responsibilities

The language model interprets intent, extracts brief fields, searches/reranks source candidates, proposes editorial selections, classifies feedback, drafts metadata, and summarizes changes.

Dedicated models recognize speech and optionally embed text or analyze sampled images.

Application code validates permissions, source bounds, timestamps, exact requirements, schema correctness, revision preconditions, resource budgets, and file paths.

Media workers decode, normalize, cut, composite, caption, and encode. The operating system and application permissions control access. No prompt is relied on as the sole safety boundary.

## 8.2 Model choices

| Role | Proposed initial implementation | Constraint |
|---|---|---|
| Default local editing planner | Gemma 4 E4B through a certified local adapter | Must pass Cutroom plan/selection tests; not assumed editorially reliable from public benchmarks. |
| Lighter local route | Gemma 4 E2B | Narrow extraction/classification and tested recipes; do not promise the same quality as E4B. |
| Optional larger local route | A tested installed model, initially evaluate Gemma 4 12B | User enables it after memory/performance testing; not required for the product. |
| Speech recognition | Whisper.cpp with a benchmarked multilingual or English checkpoint | Word alignment and speaker handling need their own tests. |
| Semantic retrieval | EmbeddingGemma plus lexical search | Respect the embedding model's shorter context; index versions track model identity. |
| Visual interpretation | E4B over selected, timestamped frames when adapter tests pass | Sampled evidence is not continuous video coverage. |
| Optional hosted reasoning | Provider adapter implementing the same tested contract | Explicit consent, payload preview, budget, no automatic fallback from local-only. |
| Rendering and QA | FFmpeg/ffprobe plus application validators | Not language-model work. |

Official Gemma documentation lists E2B/E4B as effective-parameter models with larger total parameter counts and multimodal capabilities. The model card currently describes bounded direct audio/video inputs, including 30-second audio and a 60-second video example at one frame per second. That is another reason to use a segmented media pipeline. [S06]

Ollama publishes E2B/E4B artifacts, currently listing approximately 7.2 GB and 9.6 GB respectively. Artifact size is not peak runtime memory. Quantization, encoders, context/KV cache, backend, and concurrent workers all matter. Its model capability presentation also does not replace adapter tests for native audio or structured tool use. [S07]

Do not default to the provider's mutable `latest` alias for certified runs. Save the resolved model digest, runtime version, options, prompt version, schema version, and task result. A user can select an untested model in experimental mode, but the UI must say so.

## 8.3 Runtime capability detection

Inspect the installed local model registry rather than showing invented names. Probe text generation, schema-constrained output, tool-call behavior, image input, audio input where relevant, context behavior, timeout/cancellation, and model unload behavior independently.

The model registry tracks: provider, endpoint class, exact model identifier, artifact digest, modalities, context tested, schema/tool test results, memory observations, latency observations, license record, and certification status.

Ollama documents JSON-schema-constrained structured outputs, but schema compliance still does not prove correct source selection or permission safety. [S11]

## 8.4 Inference pipeline

1. Convert the user request into a draft task specification.
2. Apply project policy and identify missing requirements.
3. Retrieve relevant source segments and approved project facts.
4. Send only the required context to the selected model.
5. Receive a typed proposal referencing existing IDs.
6. Validate the schema and all deterministic constraints.
7. Return a readable diff/preview and request approval when required.
8. Execute approved operations using the durable scheduler.
9. Check output artifacts and record the receipt.
10. Update the UI based on actual results, not the model's completion statement.

A failed proposal receives at most a bounded number of repair attempts. A reasonable initial limit is one schema repair and one task revision, with configurable task limits. On exhaustion, surface the issue and preserve the current composition.

## 8.5 Example proposal contract

This is a schema illustration, not a complete runnable implementation:

```json
{
  "schema_version": "1",
  "project_id": "project_demo",
  "base_revision_id": "rev_12",
  "intent": "create_short_draft",
  "operations": [
    {
      "type": "select_source_range",
      "asset_id": "asset_interview",
      "from_word_id": "word_210",
      "through_word_id": "word_286",
      "purpose": "opening"
    },
    {
      "type": "apply_brand_preset",
      "preset_id": "brand_primary"
    }
  ],
  "evidence_segment_ids": ["segment_18"],
  "unresolved_requirements": [],
  "decision_summary": "This existing passage states the main result before the explanation."
}
```

The runtime derives exact intervals and whether approval is required. The model cannot decide its own permission level. The runtime checks that both word IDs exist in the referenced asset, have valid ordering, belong to permitted source content, and resolve to usable media.

Arbitrary shell commands, file paths supplied by the model, URLs to fetch, SQL, or FFmpeg filtergraphs are not accepted as edit operations. The renderer compiles validated operations into allowlisted worker arguments.

## 8.6 Context and resource strategy

Start with bounded tasks and an 8K–16K working context as an engineering configuration to benchmark, not the maximum advertised model context. Retrieve evidence instead of loading entire libraries. Keep visual sampling sparse and demand-driven.

Run one heavy local inference task at a time by default. Avoid overlapping heavy transcription, vision, and rendering when memory pressure is high. Unload idle models where the adapter safely supports it. Expose balanced, quiet, and throughput modes only after measuring their behavior.

Task roles such as Planner, Selector, and Feedback Interpreter are logical responsibilities; they do not require separate always-running models. A swarm is not a product requirement. Fine-tuning is not an initial dependency; collect consented evaluation data first.

---

# 9. Architecture

## 9.1 Proposed stack

| Layer | Choice | Responsibility |
|---|---|---|
| Desktop UI | React + TypeScript + Vite inside Tauri | Editing workflow and responsive local UI. |
| Native core | Rust/Tauri commands | Typed operations, project permissions, filesystem access, job coordination, process lifecycle. |
| Local persistence | SQLite plus project manifests | Project metadata, jobs, revisions, feedback mirror, audit events. |
| Media workers | Pinned FFmpeg and ffprobe binaries | Inspection, proxies, rendering, signal processing, verification. |
| Speech worker | Pinned whisper.cpp binary | Local transcription. |
| Local AI adapter | Ollama first | Discover installed models and run validated requests. |
| Search | SQLite lexical index plus local embedding storage/search | Source retrieval without a mandatory vector service. |
| Review portal/API | Next.js | Browser review experience and authenticated review endpoints. |
| Optional hosted data | Supabase Postgres, Auth, private Storage | Review membership, comments, artifacts, and authorization. |
| Tests | Rust tests, TypeScript tests, browser tests, media fixtures, evaluation harness | Correctness and regression protection. |

Tauri supports bundled external binaries and a capability-based security model. Those are useful primitives, not automatic application security. [S12, S15]

Supabase Storage supports authorization through row-level security policies; every policy still needs adversarial tests. [S16]

Do not introduce Redis, Kubernetes, a separate vector database, a general workflow platform, or a Python server just to make the architecture look substantial. A Python research worker can be added later for an explicitly needed model, behind the same isolated job contract.

## 9.2 Desktop/cloud boundary

The desktop owns the editable project, originals, local indexes, and processing. The optional cloud service owns published review packages, cloud identities, comments, review decisions, and delivery-access metadata.

The cloud is not a synchronization database for live local project files. It never receives a live SQLite database or arbitrary local paths. Local creation/edit/export must not call a cloud API.

## 9.3 Preview and render boundary

A composition schema is the shared source of truth. The preview compiler and final renderer consume the same supported edit semantics. Unsupported operations are rejected, not approximated silently.

A proxy preview can be faster and lower resolution. The UI states this. Cached rendered drafts provide an initial trustworthy preview path while a richer playback engine can be developed later.

OpenTimelineIO is a useful future interchange layer for editorial structures, but its adapter availability and fidelity must be tested. It is not a complete playback or rendering engine, and it does not guarantee perfect round-trip support for every effect or editor. [S17]

---

# 10. Data model and storage

## 10.1 Core entities

`Workspace`, `Project`, `BriefRevision`, `Asset`, `AssetLocation`, `AssetDerivative`, `Transcript`, `TranscriptSegment`, `TranscriptWord`, `TextCorrection`, `Composition`, `CompositionRevision`, `ClipInstance`, `Track`, `CaptionTrack`, `CaptionCue`, `BrandPreset`, `DeliverableSpec`, `WorkflowRecipe`, `WorkflowRun`, `Job`, `JobAttempt`, `AIReceipt`, `Artifact`, `ReviewPackage`, `ReviewMembership`, `ReviewComment`, `ReviewDecision`, `DeliveryManifest`, `AuditEvent`, and `OutboxEvent`.

Every tenant-scoped cloud entity carries workspace/project ownership where appropriate. Each comment includes revision/rendition identity. Each job carries input digests, configuration digest, worker identity, and output references. Credentials do not live in project records.

The project database is the operational authority; immutable revision manifests are generated and checked against its committed revision digests, not edited as a competing source of truth. Use explicit foreign keys, schema migrations, transaction boundaries, and soft-deletion semantics where appropriate. Avoid one enormous JSON blob as the only project representation; use normalized records for queries and immutable manifests for portable revisions.

## 10.2 Illustrative project layout

```text
MyProject.cutroom/
  project.json
  project.sqlite
  revisions/
  originals/          # only managed imports
  analysis/
  proxies/
  previews/
  renders/
  exports/
  receipts/
  backups/
  temp/
```

The exact folder arrangement can change before implementation. Managed originals are not removable cache. Linked assets have location records; archives can optionally consolidate them after verifying available space and user approval.

Keep paths relative where possible and resolve external locations through explicit permissions. Do not bake Parth's SSD path into product code.

## 10.3 Integrity and durability

Use streamed hashes for large assets. Verify copied files before marking managed imports complete. Use temporary files and a final rename on the same filesystem for completed artifacts. Cross-filesystem moves require explicit copy/verify behavior.

Use SQLite's supported backup/snapshot mechanisms; do not copy a live database file and assume the result is complete. SQLite WAL has associated persistent state and is unsuitable for shared access over network filesystems. Do not put the active project database on a network mount or blindly sync its live files through a cloud folder. [S18]

Backups should be recoverable on a clean installation. Migrations must have pre-migration backups and failure recovery. Cache keys include inputs and dependency versions. A changed caption preset invalidates the relevant preview/render, not the original transcript.

---

# 11. Job engine and execution semantics

Jobs transition through `queued`, `running`, `waiting_for_input`, `waiting_for_approval`, `retrying`, `succeeded`, `failed`, or `canceled`. A displayed “paused” state must say whether a worker is genuinely suspended or a chunked workflow is between steps.

Use a persisted dependency graph. Typical dependencies are import verification → probe → proxy/transcription → index → AI proposal → revision → render → artifact verification → optional upload.

Each job has an idempotency key, attempt record, heartbeat/lease, cancellation request, input versions, output references, structured error, and bounded retry policy. At startup, reconcile stale leases and partial artifacts before retrying.

Retry is not universal. A temporary network failure can retry with backoff. Unsupported codecs need an explanation. Permission denial needs user intervention. Missing media waits for relinking. Invalid AI plans have bounded repair, not endless loops.

Cancellation stops the child process tree when appropriate, cleans incomplete temp files safely, and leaves successful dependency artifacts available. Some encoders cannot resume an arbitrary partially written output; such a render restarts while reusing completed upstream jobs.

Never announce “exactly once” execution for arbitrary external side effects. Use idempotency, deduplication, and verified completion to prevent duplicate uploads and deliveries in known cases.

---

# 12. Interface contracts

## 12.1 Desktop commands

Use typed IPC rather than an unnecessary open local HTTP server. Proposed operations include `project.create`, `project.open`, `asset.import`, `asset.relink`, `analysis.start`, `search.query`, `plan.propose`, `plan.validate`, `plan.apply`, `revision.create`, `revision.compare`, `revision.restore`, `render.enqueue`, `job.cancel`, `job.retry`, `review.prepare_upload`, `review.publish`, and `project.export_archive`.

Mutating operations include an operation ID and an expected current revision where appropriate. Stale writes return a conflict rather than silently overwriting newer work. Every result carries success or a structured error code with a recovery action.

## 12.2 Optional cloud endpoints

An initial review API can expose:

```text
POST   /v1/review-packages
POST   /v1/review-packages/{id}/upload-authorizations
POST   /v1/review-packages/{id}/publish
GET    /v1/review-packages/{id}
GET    /v1/review-packages/{id}/comments?cursor=...
POST   /v1/review-packages/{id}/comments
POST   /v1/review-packages/{id}/decisions
POST   /v1/review-packages/{id}/links
DELETE /v1/review-links/{id}
GET    /v1/sync/events?cursor=...
```

Authorization, scoped identifiers, input-size limits, pagination, rate limits, token expiry, and idempotency must be implemented, not merely documented. Upload authorization is limited to the selected object's size/type and permitted package. Approval requires the relevant reviewer role and exact rendition ID.

A guest share token is exchanged for scoped access; it is not a universal database key. Never expose a storage service-role key in the browser or desktop bundle.

---

# 13. Privacy, security, and permissions

## 13.1 Separate modes

**Local production:** originals, derivatives, transcripts, edit decisions, and local inference stay on the machine. No account is required after installation.

**Local production with hosted review:** selected review artifacts and chosen metadata leave the machine after confirmation. Inference may still be entirely local.

**Optional hosted inference:** selected task content goes to the chosen provider after consent. The provider, payload categories, and spending controls are visible.

These are different privacy properties. Do not call hosted review “nothing ever leaves your computer.” Do not claim end-to-end encryption unless an actual client-side encryption and key-management design is implemented and tested. Normal private object storage with TLS and server-side controls is not that claim.

## 13.2 Threat model

Treat imported media, captions, metadata, transcript text, review comments, model responses, and downloaded models as untrusted inputs. Important threats include malicious media exploiting decoders, prompt injection, path traversal, unauthorized project reads, stolen share links, storage-policy mistakes, cross-site scripting, secret leakage, and resource exhaustion.

Constrain worker filesystem access, network access, resource budgets, and permitted arguments. Keep parsers updated and execute decoding out of the UI process. Restrict FFmpeg inputs/protocols to required local media operations; do not allow imported playlist-like content or model text to trigger arbitrary network fetches.

Use an operating-system credential store for tokens. Scope Tauri capabilities narrowly, restrict content security policy, sanitize web content, redact logs, and prevent remote content from gaining native privileges. Prompt instructions supplement these controls; they do not replace them. [S15]

Cloud access needs tenant isolation tests, private buckets, restricted signed URLs, revocation behavior, and authorization on every object and action. Storage access-control mechanisms are only effective when policies are correct. [S16]

## 13.3 Consent and retention

Ask before sharing media, uploading transcripts, storing provider credentials, enabling telemetry, or sending diagnostic bundles. Product telemetry is opt-in and avoids content. Locally record enough operational metadata to diagnose failures without retaining full private prompts indefinitely by default.

Define retention for cloud artifacts, comments, logs, and backups before public launch. Show users how to remove a review package. Distinguish active deletion from backup-retention expiry.

---

# 14. Reliability, performance, and operational requirements

Publish a benchmark report for the exact device, models, runtime, export preset, and media fixtures. Report cold and warm runs separately. Record end-to-end elapsed time, transcription real-time factor, retrieval latency, plan latency, preview latency, render throughput, peak memory, output sizes, and recovery behavior.

Proposed initial responsiveness targets: indexed text search under 500 ms at the 95th percentile within the tested envelope; ordinary UI interactions under 100 ms where no media decoding is required; a hot bounded AI task under 30 seconds at the 95th percentile. These are targets to validate and adjust, not promises to advertise before measuring.

Do not require a throughput target such as “4K renders in real time” without a specific benchmark. Let the UI remain responsive while work continues. Show disk-pressure warnings, resource limits, and a graceful downgrade path.

For media integrity, use golden fixtures and tolerate encoded output differences appropriately. Frame-boundary correctness can be tested on controlled constant-frame-rate inputs. Word-timing quality is a separate ASR metric and must not be confused with a one-frame editing guarantee.

The collaboration service needs health checks, database backups, schema migration discipline, storage and bandwidth monitoring, upload limits, abuse controls, and a simple incident/maintenance page. A creator's desktop going offline must not corrupt a review package.

---

# 15. Evaluation and release acceptance

## 15.1 Evaluation dataset

Start with an owned or properly licensed set of 20–30 recordings spanning clean speech, accents, noise, screen recordings, overlapping speech, quiet intervals, music, mixed source rates, orientation metadata, missing media, and malformed files.

Hold out a subset of recordings for final evaluation. Do not tune prompts repeatedly on every test clip and report those same results as generalization.

Annotate retrieval queries and expected relevant intervals, source-grounded edit requests, quote boundaries, feedback interpretation tasks, missing-evidence cases, permission attacks, and media timing fixtures. Store annotation guidance so results are repeatable.

## 15.2 Proposed release gates

| Area | Gate and method |
|---|---|
| Offline operation | A clean installed system completes import → local AI draft → edit → export with networking disabled. |
| Structured proposals | At least 98% schema-valid responses on the defined suite after no more than one schema repair; report first-pass rate too. |
| Deterministic safety | Every tested out-of-bounds interval, prohibited source, unauthorized path, and permission escalation is rejected. Passing a finite suite is not a universal guarantee. |
| Retrieval | Measure Recall@5 or Recall@10 on annotated source queries and no-match handling; select a release threshold from pilot needs. |
| Editorial usefulness | Human ratings and candidate acceptance with explicit rubrics; a proposed initial target is at least 80% of standard recipe requests yielding a usable draft after minor correction. |
| Transcription | Word-error rate and timestamp-error distribution by recording condition; no pooled number hiding weak cases. |
| Timing | Controlled source cuts within one frame of intended boundaries on certified CFR fixtures; independently verify A/V sync and VFR mappings. |
| Recovery | Crash/worker-kill/disk-full/unplug/retry fixtures preserve revisions and never mark partial artifacts successful. |
| Collaboration | Cross-project access, expired/revoked link, role, and stale-approval tests pass. |
| Version fidelity | Approved revisions/renditions stay immutable and compare/restore operations behave as specified. |
| Accessibility | Keyboard-only core workflow, focus order, readable contrast, reduced-motion/transparency behavior, and zoom tests. |
| Privacy | No unexpected application/worker network egress in local-only test runs. |

Every numeric gate above is proposed. Actual published results must include sample sizes, conditions, exclusions, and failures.

## 15.3 Comparisons that matter

Compare manual workflow, a simple transcript/heuristic baseline, E2B, E4B, and any optional larger/hosted model using the same tasks. The useful question is which route produces accepted edits with the best latency, memory use, and cost—not which model has the highest unrelated benchmark.

Track correction time as well as AI completion time. A fast draft needing extensive repairs is not a productivity win. Use separate safety validation independent of model judgment.

---

# 16. Build sequence

## Gate A — De-risk the hardest mechanics

Before polishing screens, build small executable probes for media import/proxy/final timing, a valid composition render, local schema-constrained selection with Gemma E2B/E4B, interruption/retry, and a private browser review upload. Produce measurements and a compatibility matrix.

Exit when the chosen architecture can support the core promise. If a preview engine or model route fails, change that component before the main build—not after a polished shell has locked in false assumptions.

## Gate B — Complete local manual workflow

Ship a real local vertical slice: create project, import source, transcript, select/trim/reorder, captions, preview, render, named revisions, reopen, and recover after interruption. AI is not yet required for the manual core.

Exit when a creator can finish one bounded production without external editing software.

## Gate C — Bounded AI automation

Add capability discovery, the source index, brief extraction, candidate selections, draft recipes, validated operations, dry-run previews, resource scheduling, and receipts. Run the evaluation suite.

Exit when the promised recipes work on held-out media with bounded failures and useful fallback behavior.

## Gate D — Real client review and revision

Add private hosted review, invitations/roles, comments anchored to versions, feedback proposals, new-version comparison, and exact-version approval. Demonstrate a real client in another browser receiving and approving a revision.

Exit when the end-to-end collaboration path is functional—not a static mockup.

## Gate E — Release hardening and showcase

Complete onboarding, model downloads, packaging, dependency/license review, accessibility, security tests, backup/restore, storage cleanup, public sample project, documentation, benchmark report, and a reproducible demo.

The first product release includes Gates B–E. The gates are a build order, not permission to label a partial clipper as the completed studio.

---

# 17. Expansion backlog — not first-release promises

Possible follow-ons include certified Windows/Linux builds, stronger multilingual captioning, explicit transcript translation, tested automatic speaker segmentation, multicam alignment/switching, advanced tracking/reframing, editor interchange adapters, portable team handoff, configurable workflow authoring, self-hosted review deployment, and game-specific highlight detectors.

Later workflow improvements could include ingest watchers, reusable B-roll search with rights metadata, richer audio cleanup, publishing integrations with approvals, and consented analytics integrations.

Do not front-load voice cloning, synthetic actors, a generative-video studio, a marketplace, a social network, a general automation platform, live streaming, mobile editing, simultaneous shared timelines, or a full color-grading system. These expand risk faster than they strengthen the initial product promise.

---

# 18. Business and distribution

A reasonable business hypothesis is a useful local edition and a paid hosted collaboration/service tier. Charge for a service with ongoing operating costs—review storage, transfer, administration, or team features—rather than making privacy contingent on a subscription.

Do not set a public price until storage, bandwidth, support, and willingness-to-pay are measured. Local inference has no per-token vendor bill, but it still uses hardware, electricity, model downloads, and storage. Hosted review is not automatically free or unlimited.

Package a signed/notarized desktop build when ready, a hosted review portal, and a public landing page with screenshots, demo, architecture, limitations, and download instructions. Confirm current distribution requirements during implementation rather than assuming a checklist remains unchanged.

Use owned or licensed demo media. Application licensing, bundled model licenses, FFmpeg build configuration, codec considerations, and fonts/assets require a release checklist. FFmpeg licensing depends on build components and can involve LGPL/GPL obligations. Do not assume any arbitrary downloaded binary can be redistributed under the application's chosen license. [S19]

The product name is a working title; branding, domain availability, and legal clearance have not been established.

---

# 19. Portfolio and showcase package

## 19.1 Demonstration narrative

Use a three-to-five-minute recording of a real workflow, edited for viewing length without implying the full processing happened instantaneously. Label time jumps and distinguish cached from cold operations.

Show an owned source recording, offline/local mode, a brief with a required segment, locally generated source-grounded selections, an editable composition, a failed or rejected unsafe suggestion, a rendered version, browser feedback, a proposed revision, exact-version approval, and a delivery manifest. Include one recovery demonstration in a separate technical clip if necessary.

The memorable moment is: “The client asked for a change, Cutroom mapped it to the correct version, proposed a valid edit, and produced an approved deliverable without overwriting the original.”

## 19.2 Evidence to publish

Publish the usable product or reproducible build instructions, a public sample project, architecture and data-flow explanations, threat model, supported-format matrix, model evaluation results, job-recovery tests, known limitations, and screenshots of real states.

Explain Parth's actual work and the role of AI coding tools honestly. Do not imply training a foundation model when the accomplishment is integrating and evaluating one. Do not imply business adoption from synthetic test data.

A showcase description should state the problem, intended users, implemented workflow, actual model/runtime, and measured outcome. Handshake explicitly recommends describing what the submitter personally built and avoiding confidential information. [S01]

## 19.3 Draft project description — revise after implementation

“Cutroom is a local-first production studio for independent creators. It turns existing recordings into editable, versioned deliverables using local media processing and source-grounded AI edit plans. Creators can review every proposed change, share selected drafts with clients, convert feedback into new versions, and deliver the approved output. I built the desktop workflow, processing engine, version model, review service, and evaluation harness. Measured performance and supported configurations are documented in the project.”

This description is a template. Remove or change every claim not implemented before publication.

---

# 20. Risk register

| Risk | Product/engineering response |
|---|---|
| Product feels like a weaker established editor | Focus on the complete local-to-review-to-delivery workflow and test willingness to use it. |
| Small model selects misleading passages | Source references, context checks, user preview, constrained recipes, and human evaluation. |
| UI polish hides a weak processing engine | Complete media and recovery probes before broad interface work. |
| Timing drift corrupts edits or comments | Rational time representation, proxy/source maps, controlled fixtures, immutable review anchors. |
| Laptop resource exhaustion | Bounded context, one heavy job by default, memory-aware queueing, measured model profiles. |
| Unsupported codec surprises | Explicit compatibility matrix, early probing, preserved originals, actionable errors. |
| Lost or changed linked media | Content identity, relinking, changed-file detection, and managed archive option. |
| Cloud feature contradicts privacy messaging | Separate local inference and hosted-review policies; enumerate uploads. |
| Unauthorized client access | Tenant/role checks, private storage, short-lived scoped access, adversarial tests. |
| Model or runtime update causes regressions | Pinned digests, capability tests, certification status, regression suite. |
| Too many dependencies impede installation | Bundled pinned workers and one primary inference adapter; no unnecessary infrastructure. |
| Huge media storage/egress costs | Quotas, retention choices, review-resolution control, usage reporting. |
| Unrealistic product scope | Gate-based first release, bounded editor, no simultaneous timeline collaboration. |
| Portfolio claims exceed evidence | Publish measurements, implementation status, known failures, and exact contribution. |

---

# 21. Proposed decisions to lock before implementation

Build a desktop-first production studio with an optional browser review service. Target speech-led videos for individual creators and small teams. Make the manual editing/export loop reliable independently of AI. Use Gemma 4 E4B as the first planner candidate and E2B as a lighter certified route, subject to task-specific tests. Use dedicated speech recognition and deterministic rendering. Make edits source-grounded, typed, reversible, and bound to explicit versions. Keep originals local by default, require approval for sharing, and do not require paid inference for core functionality.

Ship a bounded but complete workflow rather than a broad editor with unfinished core screens. The primary differentiator to validate is controlled local production with reliable revision and client-delivery semantics.

---

# 22. Sources checked

Public sources support the factual capability/licensing references above. They do not validate the proposed Cutroom design or guarantee implementation performance. URLs are provided as reference text for portability.

```text
[S01] Handshake — AI Showcase in Handshake (updated August 26, 2026)
https://support.joinhandshake.com/hc/en-us/articles/39163147630487-AI-Showcase-in-Handshake

[S02] Descript — Underlord
https://www.descript.com/underlord

[S03] OpusClip — AI Video Editor / AI Producer
https://www.opus.pro/ai-video-editor

[S04] Frame.io — Review and Approval
https://frame.io/features/review-and-approval

[S05] Blackmagic Design — DaVinci Resolve What's New
https://www.blackmagicdesign.com/products/davinciresolve/whatsnew

[S06] Google AI for Developers — Gemma 4 model card (updated July 30, 2026)
https://ai.google.dev/gemma/docs/core/model_card_4

[S07] Ollama — Gemma 4 model library
https://ollama.com/library/gemma4

[S08] Google AI for Developers — EmbeddingGemma model overview
https://ai.google.dev/gemma/docs/embeddinggemma

[S09] Ollama — EmbeddingGemma library
https://ollama.com/library/embeddinggemma

[S10] ggml-org — whisper.cpp official repository
https://github.com/ggml-org/whisper.cpp

[S11] Ollama — Structured Outputs
https://docs.ollama.com/capabilities/structured-outputs

[S12] Tauri — Embedding External Binaries
https://v2.tauri.app/develop/sidecar/

[S13] FFmpeg — Filters Documentation
https://ffmpeg.org/ffmpeg-filters.html

[S14] FFmpeg — ffprobe Documentation
https://ffmpeg.org/ffprobe.html

[S15] Tauri — Security
https://v2.tauri.app/security/

[S16] Supabase — Storage Access Control
https://supabase.com/docs/guides/storage/security/access-control

[S17] OpenTimelineIO — Documentation and plugin documentation
https://opentimelineio.readthedocs.io/en/latest/
https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-plugins.html

[S18] SQLite — Write-Ahead Logging
https://www.sqlite.org/wal.html

[S19] FFmpeg — License and Legal Considerations
https://ffmpeg.org/legal.html
```
