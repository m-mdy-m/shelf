# Shelf — GitHub work plan

This document records the issue taxonomy, release milestones, and dependency plan used by the repository.

## Milestones

| Milestone | Goal | Exit |
|---|---|---|
| 0.1 — Reader Foundation | Offline PDF Reader and durable annotations | Reader MVP passes |
| 0.2 — AI Companion | Local/cloud AI with grounded citations | AI tasks and cancellation pass |
| 0.3 — Knowledge & Portability | Portable quotes/notes and reviewed knowledge drafts | Export preserves source references |
| 1.0 — Cross-platform Standalone Release | Installable Windows/macOS/Linux/Android/iOS | Offline core flow passes each target |

## Custom labels

Types: type:epic, type:feature, type:task, type:research, type:bug.

Areas: area:architecture, area:reader, area:pdf, area:library, area:annotations, area:storage, area:ai, area:ai-local, area:ai-cloud, area:privacy, area:platform, area:desktop, area:mobile, area:knowledge, area:export, area:quality.

Priority: priority:P0, priority:P1, priority:P2.

Platforms: platform:windows, platform:macos, platform:linux, platform:android, platform:ios, platform:all.

## Parent epics and children

### Epic A — Reader Foundation (0.1)
- #6 Architecture/build/CI skeleton.
- #7 Domain contracts and platform ports.
- #8 PDF.js adapter, worker lifecycle, virtualization.
- #9 Document import and local library.
- #10 Navigation, zoom, outline, reading modes.
- #11 Text extraction, search, and selection.
- #12 Bookmarks, highlights, notes, and resilient anchors.
- #13 Local storage, progress, resume, migrations, and export.
- #14 Reader UX, RTL/LTR, keyboard, and accessibility.
- #15 PDF corpus, performance, and E2E tests.

### Epic B — AI Companion (0.2)
- #16 Provider/model capability contract and secure configuration.
- #17 Local provider adapter.
- #18 Cloud provider adapters and remote-consent UX.
- #19 Bounded page/passage context builder.
- #20 Structured citations and source validator.
- #21 Streaming jobs, cancellation, retry, and stale-output protection.
- #22 Explain/Ask/Summarize workflows.
- #23 Translation alignment and reviewed evaluation corpus.

### Epic C — Knowledge & Portability (0.3)
- #24 Quote/note export.
- #25 Versioned deep links within Shelf.
- #29 Concept extraction, flashcard, and quiz drafts.

### Epic D — Cross-platform Standalone Release (1.0)
- #30 Desktop runtime/package decision.
- #31 Windows/macOS/Linux installers and secure credential adapters.
- #32 Android document access and local persistence.
- #33 iOS document access and local persistence.
- #34 Native notifications, lifecycle, backup, and permissions.
- #35 Platform E2E matrix, signing, release automation, and docs.

## Dependency rules

- Epic A contracts and Reader source metadata unblock AI work.
- AI UI depends on selection/page metadata.
- Citation validation depends on context assembly and stable source IDs.
- Knowledge capture depends on persisted annotations/quotes.
- Mobile standalone release depends on native file access and local persistence, not merely a Capacitor WebView.
- OCR, sync, and cross-document retrieval remain deferred until the single-document local flow is reliable.
