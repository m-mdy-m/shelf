# @shelf/reader-core

Platform-independent Reader domain types, application services, error contracts, and ports.

## Guarantees

- Document IDs are stable identities; paths, URIs, and provider handles are opaque locators only.
- Opaque access locators are stored through an adapter-owned port, separately from exportable `Document` records.
- Imported copies and external references have distinct semantics and both require reopenable library locators after import.
- Content identity uses streaming SHA-256 over bounded reads; each `DocumentSourcePort.read` is limited to 1 MiB.
- Duplicate imports reuse the existing stable ID by default; callers may explicitly keep a separate library entry.
- Missing sources, changed content, and permission-required/denied/expired states are distinct and persisted without retaining OS error text.
- All page indexes are zero-based: the first PDF page is index `0`. Human-facing numbering is a presentation concern.
- Untrusted page indexes, IDs, and byte ranges have Result-based parsers.
- Contracts use plain TypeScript and platform-neutral values. They do not import React, PDF.js, SQLite, Capacitor, or OS SDKs.
- Port methods return a discriminated `Result` so expected access and persistence failures are explicit.

## Public API

Import the package root rather than internal files:

```ts
import type {
  Document,
  DocumentId,
  DocumentImportMode,
  DocumentLocator,
  DocumentSourcePort,
  PageIndex,
  ReaderUseCases,
  Result,
} from "@shelf/reader-core";
import {
  DocumentLibraryService,
  parseByteRange,
  parseOpaqueId,
  parsePageIndex,
  toPageIndex,
} from "@shelf/reader-core";
```

Use `parsePageIndex`, `parseOpaqueId`, and `parseByteRange` at untrusted boundaries. The `to*` constructors are convenience assertions for trusted values and throw on invalid input.

`DocumentLibraryService` coordinates local import, fingerprint duplicate detection, permission checks, access-state updates, and fingerprint-verified relinking. Platform-specific source, copy-store, permission, locator, and repository adapters are injected through ports; no platform implementation or database driver lives in this package.
