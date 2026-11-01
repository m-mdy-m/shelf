# Architecture notes

The normative design is in [spec/01-architecture.md](../../spec/01-architecture.md). This page summarizes the rules contributors should apply when adding a module.

## Ownership

- Reader owns document lifecycle, page state, navigation, selection, and reading interactions.
- Library owns document metadata and source registration, not PDF rendering.
- Annotation owns bookmarks, highlights, passage notes, quotes, and anchor recovery.
- AI Companion owns task routing, context assembly, generation jobs, and citation validation.
- Platform adapters own native file access, local persistence integration, credentials, notifications, and lifecycle.
- Export owns portable serialization; it never exports secrets.

## Dependency direction

Shells depend on UI packages. UI invokes application use cases. Application use cases depend on domain contracts and ports. Platform/provider adapters implement those ports.

Domain code must not depend on React, PDF.js internals, SQLite drivers, Capacitor APIs, or one model vendor. The public Reader contracts are defined in [reader-contracts.md](reader-contracts.md) and exported from `@shelf/reader-core`. PDF.js integration, rendering layers, and page virtualization live in [`pdf-engine.md`](pdf-engine.md), isolated inside `@shelf/pdf-engine`.

## When to create a package

Create a package when there is a stable concept, a clear owner, a useful public API, and tests that can run independently. Do not create packages solely to make the directory tree look modular.

## When to create a process

A separate process needs a concrete operational reason: independent lifecycle, security boundary, failure isolation, or resource policy. A feature boundary alone is not a reason.
