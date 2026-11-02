# Reader domain contracts and platform ports

The public, platform-neutral TypeScript API lives in packages/reader-core. Shells and adapters depend on this API; the core package does not import UI frameworks, PDF renderers, databases, or OS SDKs.

## Identity, locators, and page convention

- DocumentId is a Shelf-owned, stable identity.
- DocumentLocator is adapter-owned access information. Its opaque value may encode a filesystem path, content URI, security-scoped URL, browser handle, or provider-specific token.
- A locator is not an ID. It may expire, change, or be unavailable after import. It must not appear in the exportable Document record, UI, logs, or exports.
- Adapters persist or retain locator values separately through DocumentLocatorStorePort, keyed by DocumentId. Store access material using platform-appropriate protection and clear it when the document is removed or access is released.
- Document.source contains only source category and safe display metadata. It never contains an opaque path/URI/handle.
- The source category distinguishes imported-copy from external-reference. Removing a Shelf reference must never delete the user's original external file.
- Opaque IDs are nominal TypeScript types; a bookmark ID cannot be passed where a document ID is required.
- PageIndex is always zero-based. The first physical page is index 0; simple human-facing numbering is index + 1. PDF page labels are presentation metadata and do not redefine the index.

## Domain records

| Record | Purpose |
|---|---|
| Document | Stable identity, metadata, safe source metadata, optional content fingerprint, and timestamps. |
| ReadingProgress | Last page index, normalized scroll offset, zoom, reading mode, and update time. |
| Bookmark | A reading destination with an optional text anchor and user label. |
| Annotation | Discriminated highlight or note; passage anchors and normalized page geometry are independent. |
| Quote | Independently exportable selected passage with source page, optional attribution, annotation link, and tags. |
| ReaderSession | One opened-document session; it is not the durable document identity. |

Content fingerprints are derived by the Library package from bounded source reads. Shelf v1 uses the versioned sha256-chain-v1 format: each step hashes the previous digest, the byte offset, and one source chunk. This makes duplicate detection deterministic without buffering the complete PDF. The version marker is part of the stored value, so the algorithm can change without silently mixing formats.

Text anchors retain exact selected text, normalized fallback text, offsets in the extracted page text, document fingerprint, and an anchor schema version. Page rectangles use normalized coordinates from 0 to 1. An adapter or application service must validate ranges and geometry before persistence.

Timestamps are Unix epoch milliseconds. Unknown metadata is represented as null, not an invented default.

## Error and result model

Port and use-case methods return Result<Value, ReaderError>. Expected access, parsing, cancellation, conflict, and persistence errors are represented as a discriminated { ok: false, error } result. A ReaderError carries a stable code, safe user-facing message, and retryable flag. Do not forward native exceptions, filesystem paths, secrets, provider credentials, or document contents in error messages or diagnostic context.

Use parsePageIndex, parseOpaqueId, and parseByteRange for untrusted input; they return typed errors. The toPageIndex and toOpaqueId convenience constructors throw on invalid values and are intended for trusted values after validation. Unexpected programmer errors may still throw.

## Ports

- DocumentSourcePort: inspect a locator, open a handle, read a bounded byte range, and close the handle.
- DocumentLocatorStorePort: store and retrieve the adapter-owned locator separately from the exportable Document record.
- DocumentPermissionPort: query, request, and release access to the underlying source.
- Repository ports: save/read/delete documents, reading progress, bookmarks, annotations, and quotes without exposing SQL or storage-driver types.
- ClockPort and IdGeneratorPort: deterministic time and ID generation at application boundaries.
- Sha256DigestPort: platform-provided SHA-256 digest for bounded fingerprint steps.
- SecureCredentialStorePort: transient secret access via a secure platform store; values must never be logged or exported.
- LocalNotificationPort and ApplicationLifecyclePort: optional native capabilities behind narrow contracts.

A byte range uses a zero-based offset and a positive length no larger than MAX_DOCUMENT_READ_BYTES (1 MiB). The parser also rejects unsafe integers and overflow. Adapters must independently enforce the same limit and return invalid-range rather than allocating an unbounded buffer. Read larger files as successive chunks.

## Library and browser implementation

The @shelf/library package provides import/list/get/open/close behavior. It accepts an explicit imported-copy or external-reference source, validates PDF metadata, fingerprints the content, and returns the existing entry when a matching fingerprint is already present. A new source locator is only stored after validation; failed writes attempt to roll back the locator and discard the staged source record.

The browser adapter stores document records, locators, imported Blob copies, and external File System Access handles in separate IndexedDB object stores. The external-reference path requires the browser's persistent file handle API; when unavailable, the UI offers copy import instead. Expired permission and a missing file remain distinct errors. These browser adapters do not claim desktop, Android, or iOS implementations.

## Reader use cases

ReaderUseCases defines the application-facing operations for import/list/get/open/close, progress, bookmarks, annotations, and quotes. This is a contract, not an implementation. On import, application services store the safe Document record and the access locator through their separate ports. Opening resolves the locator by stable DocumentId and handles permission renewal. Persistence transactions, source release, and record consistency belong to application services and concrete adapters—not UI components.

## Adapter rules

- Adapters translate their platform's locators, permission errors, and lifecycle events into these contracts.
- No platform object (FileSystemHandle, Android Uri, NSURL, SQLite connection, Capacitor plugin instance) crosses the port boundary.
- A file handle or source handle must be released deterministically on close, error, and cancellation.
- File access is requested explicitly; expired permission is distinct from a missing document.
- Keep opaque locators out of document exports and logs; clear them when the source is deleted or access is revoked.
- Do not persist provider credentials or raw OS errors in Reader records.
- Unit tests can use in-memory fakes because the contracts contain no concrete platform dependency.

## Build and verification

    npm run typecheck
    npm run build
    npm test

The TypeScript type tests assert ID separation, locator separation, PageIndex branding, discriminated annotation drafts, and structural compatibility of fake source/permission/locator-store ports. Runtime tests validate page-index parsing, bounded byte ranges, and opaque-ID parsing.


## Extracted text and selection

- `ExtractedPageText` is a session-level, page-local representation, not a durable document record. It contains normalized text, zero-based PageIndex, selectable-text status, and runs with UTF-16 offsets, direction, font name, and normalized page rectangles.
- `TextSelection` carries the exact browser-selected text, normalized fallback, page-local UTF-16 offsets, document fingerprint, anchor version, and normalized selection rectangles. `offsetConfidence` distinguishes exact offsets from nearest normalized-text resolution.
- `findTextMatches` performs NFKC/case/whitespace-insensitive matching while returning offsets into the original extracted page string. Query normalization never changes the stored selected text.
- The PDF adapter exposes no PDF.js objects: it consumes the text-content stream under per-page item/character limits and observes AbortSignal between stream chunks.
- Search is local and bounded by page, character, and result limits. Image-only pages return an empty extraction with `hasSelectableText: false`; OCR is explicitly not run by this feature.


The `ExtractedPageText.truncated` flag is true when the adapter stops at the per-page item/character budget. The Reader reports those pages in search summaries rather than implying full coverage. Search queries are capped at 256 characters, result count at 100, and transient interaction markers at 500 per page. Browser selection geometry is capped at 512 rectangles. `ReaderWorkspaceController.getSelection()` and the optional `onSelection` callback expose the current transient `TextSelection` to annotation workflows without persisting it.


## Saved Reader records and anchor resolution

The browser adapter's IndexedDB version 3 adds separate ID-keyed bookmark, annotation, and quote stores with DocumentId indexes; existing version-2 stores are preserved during upgrade. Repository methods return Result values so the Reader only presents a new or edited saved state after a confirmed write.

The Reader maps a transient TextSelection to a versioned TextAnchor. On reopen, exact stored offsets are preferred; otherwise a unique normalized text match may relocate the anchor. Multiple matches remain unresolved. Saved geometry is used only as a fallback when the content fingerprint is unchanged, and annotations render in the PDF engine's dedicated annotation layer.
