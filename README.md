# Shelf

**Shelf by IDIOS** is a cross-platform, local-first reading workspace for PDF books, papers, manuals, and technical documents.

**Read. Understand. Connect.**

## Locked product decisions
- First implementation priority: PDF Reader.
- AI: local and cloud providers, selectable per task.
- Platforms: Windows, macOS, Linux, Android, and iOS designed from day one, delivered in stages.
- Standalone/local-first operation; IDIOS integration and future sync are optional.
- Modular application with explicit ports/adapters; no premature microservices.

## Repository status
This repository is being reset for the Shelf reading product. The previous TechShelf book catalog and schema are preserved byte-for-byte in [archive/](archive/README.md). They are historical data, not the new application source or schema.

## Start here
- [Specification index](spec/README.md)
- [Product brief](spec/00-product-brief.md)
- [Architecture](spec/01-architecture.md)
- [Reader engine](spec/02-reader-engine.md)
- [AI Companion](spec/03-ai-companion.md)
- [Data model](spec/04-data-model.md)
- [Cross-platform strategy](spec/05-cross-platform.md)
- [Quality, privacy and security](spec/06-quality-security.md)
- [Roadmap](spec/07-roadmap.md)
- [GitHub work plan](spec/08-github-work-plan.md)

## Initial technology direction
React + TypeScript UI; Mozilla PDF.js behind a Shelf adapter; Go application services + SQLite for the initial desktop/local runtime; Capacitor plus native adapters for mobile; provider-neutral local/cloud AI contracts.

These are starting points, not claims that the targets are already implemented. See the specification and linked issues for acceptance criteria.
