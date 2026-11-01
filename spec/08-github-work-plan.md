# Shelf — GitHub work plan

This is the repository source manifest for project metadata. It keeps taxonomy and delivery planning reviewable if GitHub administration needs to be applied separately.

## Milestones
| Milestone | Goal | Exit |
|---|---|---|
| 0.1 — Reader Foundation | Offline PDF Reader and durable annotations | Reader MVP passes |
| 0.2 — AI Companion | Local/cloud AI with grounded citations | AI tasks and cancellation pass |
| 0.3 — Knowledge & IDIOS Integration | Portable notes/quotes and optional adapters | Shelf remains standalone |
| 1.0 — Cross-platform Standalone | Installable Windows/macOS/Linux/Android/iOS | Core offline flow passes each target |

## Proposed custom labels

Types: `type:epic`, `type:feature`, `type:task`, `type:research`, `type:bug`.

Areas: `area:architecture`, `area:reader`, `area:pdf`, `area:library`, `area:annotations`, `area:storage`, `area:ai`, `area:ai-local`, `area:ai-cloud`, `area:privacy`, `area:platform`, `area:desktop`, `area:mobile`, `area:knowledge`, `area:integration`, `area:quality`.

Priority: `priority:P0`, `priority:P1`, `priority:P2`.

Platforms: `platform:windows`, `platform:macos`, `platform:linux`, `platform:android`, `platform:ios`, `platform:all`.

## Parent epics and children

### Epic A — Reader Foundation (0.1)
- Architecture/build/CI skeleton.
- Domain contracts and platform ports.
- PDF.js adapter, worker lifecycle, virtualization.
- Document import and local library.
- Navigation, zoom, outline and text search.
- Text extraction and selection.
- Bookmarks, highlights, notes, resilient anchors.
- Local storage, progress, resume, migrations and export.
- Reader UX, RTL/LTR, keyboard and accessibility.
- PDF corpus, performance and E2E tests.

### Epic B — AI Companion (0.2)
- Provider/model capability contract and secret storage.
- Local provider adapter (Ollama first).
- Cloud adapters and remote-consent UX.
- Bounded page/passage context builder.
- Structured citations and source validator.
- Streaming jobs, cancellation, retry and stale-output protection.
- Explain/Ask/Summarize workflows.
- Translation alignment and reviewed evaluation corpus.
- Privacy/resource/failure testing.

### Epic C — Knowledge & IDIOS Integration (0.3)
- Quote/note capture and export.
- Versioned deep links.
- Optional IDIOS Notes/Graph/Notifications adapters.
- Concept extraction, flashcard and quiz drafts.

### Epic D — Cross-platform Standalone Release (1.0)
- Desktop runtime/package decision.
- Windows/macOS/Linux installers and secure credential adapters.
- Android document access and local persistence.
- iOS document access and local persistence.
- Native notifications, lifecycle, backup, permissions.
- Platform E2E matrix, signing, release automation and docs.

## Dependency rules
- Epic A contracts and Reader metadata unblock AI work.
- AI UI depends on source selection/page metadata.
- Citation validator depends on context builder and stable source IDs.
- Knowledge capture depends on persisted annotations/quotes.
- IDIOS integration depends on stable public contracts and remains optional.
- Mobile standalone release depends on native file access and local persistence, not merely a Capacitor WebView.
- OCR, sync, and cross-book retrieval remain deferred until the single-document local flow is reliable.
