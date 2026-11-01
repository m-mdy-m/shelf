# @shelf/reader-core

Platform-independent Reader domain types, error contracts, application use cases, and ports.

## Guarantees

- Document IDs are stable identities; paths, URIs, and provider handles are opaque locators only.
- Opaque access locators are stored through an adapter-owned port, separately from exportable `Document` records.
- All page indexes are zero-based: the first PDF page is index `0`. Human-facing numbering is a presentation concern.
- One document-source read is limited to 1 MiB; larger files must be read using successive bounded ranges.
- Untrusted page indexes, IDs, and byte ranges have Result-based parsers.
- Contracts use plain TypeScript and platform-neutral values. They do not import React, PDF.js, SQLite, Capacitor, or OS SDKs.
- Port methods return a discriminated `Result` so expected access and persistence failures are explicit.
- Annotation anchors are versioned and keep text identity separate from rendering geometry.

## Public API

Import the package root rather than internal files:

```ts
import type {
  Annotation,
  Document,
  DocumentId,
  DocumentLocator,
  DocumentSourcePort,
  PageIndex,
  ReaderUseCases,
  Result,
} from "@shelf/reader-core";
import {
  parseByteRange,
  parseOpaqueId,
  parsePageIndex,
  toPageIndex,
} from "@shelf/reader-core";
```

Use `parsePageIndex`, `parseOpaqueId`, and `parseByteRange` at untrusted boundaries. The `to*` constructors are convenience assertions for trusted values and throw on invalid input.

The package defines contracts only. Concrete browser, desktop, and mobile adapters are implemented separately and must satisfy these interfaces. No concrete adapter or storage engine is included in this package yet.
