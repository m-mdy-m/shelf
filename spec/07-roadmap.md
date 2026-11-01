# Shelf — Roadmap

## Locked decisions

Start with PDF Reader; support local and cloud AI; design for Windows/macOS/Linux/Android/iOS from the beginning; standalone/local-first; preserve the former catalog under archive/.

## Phase 0 — Specification and foundation

Module boundaries, CI/build conventions, platform ports, document identity/anchor schema, migrations, desktop runtime packaging decision, and mobile persistence strategy.

**Exit:** skeleton builds, core contracts are documented, test fixtures and CI work.

## Phase 1 — PDF Reader MVP

Local import/open, PDF.js lazy rendering, navigation/zoom/TOC/search, progress/resume, selection, bookmarks/highlights/notes, local persistence/export, and a desktop reference vertical slice with other platform contracts tested.

**Exit:** reliable offline Reader, restored annotations, and a large-PDF performance baseline.

## Phase 2 — AI Companion

Provider contracts, local and cloud adapters, explain/ask/summarize/translate, bounded context, verified citations, streaming/cancel/retry, and privacy disclosure.

**Exit:** source-grounded answers and correct cancellation; provider outage never breaks Reader.

## Phase 3 — Knowledge and portability

Quote/note export, draft concepts/flashcards, and versioned deep links within Shelf.

**Exit:** knowledge records are portable and retain source context.

## Phase 4 — Cross-platform standalone 1.0

Native Android/iOS storage and permissions; Windows/macOS/Linux package parity; native notifications, secure credentials, backup/export, signing, and device/OS test matrix.

**Exit:** offline Reader passes on all five platform families with tested installable release artifacts.

## Deferred

OCR, cross-document retrieval, sync service, collaboration, full PDF editing, and advanced graph exploration.
