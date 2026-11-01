# Shelf — Roadmap

## Locked decisions
Start with PDF Reader; support local and cloud AI; design for Windows/macOS/Linux/Android/iOS from the beginning; standalone/local-first; optional IDIOS integration; preserve the old catalog in archive/.

## Phase 0 — Specification/foundation
Module boundaries, CI/build conventions, platform ports, document identity/anchor schema, migrations, desktop runtime packaging decision, mobile persistence strategy.
**Exit:** skeleton builds, core contracts documented, test fixtures/CI work.

## Phase 1 — PDF Reader MVP
Local import/open, PDF.js lazy rendering, navigation/zoom/TOC/search, progress/resume, selection, bookmarks/highlights/notes, local persistence/export, desktop reference vertical slice with other platform contracts tested.
**Exit:** reliable offline Reader; annotation restoration; large-PDF performance baseline.

## Phase 2 — AI Companion
Provider contracts; local and cloud adapters; explain/ask/summarize/translate; bounded context; verified citations; streaming/cancel/retry; privacy disclosure.
**Exit:** source-grounded answers and correct cancellation; provider outage never breaks Reader.

## Phase 3 — Knowledge and IDIOS integration
Quote/note export; draft concepts/flashcards; versioned deep links; optional Notes/Graph/Notifications adapters.
**Exit:** standalone use remains fully valid without IDIOS.

## Phase 4 — Cross-platform standalone 1.0
Native Android/iOS storage and permissions; Windows/macOS/Linux package parity; native notifications, secure credentials, backup/export, signing, device/OS test matrix.
**Exit:** offline Reader passes on all five platform families with tested installable release artifacts.

## Deferred
OCR, cross-book retrieval, sync service, collaboration, full PDF editing, advanced graph exploration.
