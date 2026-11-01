# Architecture notes

The normative design is in [spec/01-architecture.md](../../spec/01-architecture.md). This page summarizes the rules contributors should apply when adding a module.

## Ownership

- Reader owns document lifecycle, page state, navigation, selection, and reading interactions.
- Library owns stable document records, source registration, duplicate detection, and open/relink decisions; it does not render PDFs.
- Annotation owns bookmarks, highlights, passage notes, quotes, and anchor recovery.
- AI Companion owns task routing, context assembly, generation jobs, and citation validation.
- Platform adapters own browser/native file access, local persistence integration, credentials, notifications, and lifecycle.
- Export owns portable serialization; it never exports secrets or opaque source locators.

## Dependency direction

Shells depend on UI packages. UI invokes application use cases. Application services depend on domain contracts and ports. Platform/provider adapters implement those ports.

The @shelf/library package implements source registration on top of @shelf/reader-core ports. The @shelf/platform-adapters package provides browser IndexedDB, file picker, file access, permission, and hashing implementations. The @shelf/pdf-engine package owns PDF.js rendering only.

Domain code must not depend on React, PDF.js internals, SQLite drivers, Capacitor APIs, or one model vendor. The public Reader contracts are defined in [reader-contracts.md](reader-contracts.md) and exported from the Reader Core package. PDF.js integration, rendering layers, and page virtualization live in [pdf-engine.md](pdf-engine.md), isolated inside the PDF engine package.

## When to create a package

Create a package when there is a stable concept, a clear owner, a useful public API, and tests that can run independently. Do not create packages solely to make the directory tree look modular.

## When to create a process

A separate process needs a concrete operational reason: independent lifecycle, security boundary, failure isolation, or resource policy. A feature boundary alone is not a reason.
