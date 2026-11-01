# Reader domain contracts and platform ports

The public, platform-neutral TypeScript API lives in `packages/reader-core`. Shells and adapters depend on this API; the core package does not import UI frameworks, PDF renderers, databases, or OS SDKs.

## Identity, locators, and page convention

- `DocumentId` is a Shelf-owned, stable identity.
- `DocumentLocator` is adapter-owned access information. Its opaque value may encode a filesystem path, content URI, security-scoped URL, browser handle, or provider-specific token.
- A locator is not an ID. It may expire, change, or be unavailable after import. Never use it as a database primary key, expose it in UI, log it, or include it in an export by default.
- Opaque IDs are nominal TypeScript types; a bookmark ID cannot be passed where a document ID is required.
- `PageIndex` is always zero-based. The first physical page is index `0`; simple human-facing numbering is index + 1. PDF page labels are presentation metadata and do not redefine the index.

## Domain records

| Record | Purpose |
|---|---|
| `Document` | Stable identity, metadata, source locator, optional content fingerprint, and timestamps. |
| `ReadingProgress` | Last page index, normalized scroll offset, zoom, reading mode, and update time. |
| `Bookmark` | A reading destination with an optional text anchor and user label. |
| `Annotation` | Discriminated highlight or note; passage anchors and normalized page geometry are independent. |
| `Quote` | Independently exportable selected passage with source page, optional attribution, annotation link, and tags. |
| `ReaderSession` | One opened-document session; it is not the durable document identity. |

Text anchors retain exact selected text, normalized fallback text, offsets in the extracted page text, document fingerprint, and an anchor schema version. Page rectangles use normalized coordinates from 0 to 1. An adapter or application service must validate ranges and geometry before persistence.

Timestamps are Unix epoch milliseconds. Unknown metadata is represented as `null`, not an invented default.

## Error and result model

Port and use-case methods return `Result<Value, ReaderError>`. Expected access, parsing, cancellation, conflict, and persistence errors are represented as a discriminated `{ ok: false, error }` result. A `ReaderError` carries a stable code, safe user-facing message, and retryable flag. Do not forward native exceptions, filesystem paths, secrets, provider credentials, or document contents in error messages or diagnostic context.

Unexpected programmer errors may still throw; the Result contract is for expected operational outcomes.

## Ports

- `DocumentSourcePort`: inspect a locator, open a handle, read a bounded byte range, and close the handle.
- `DocumentPermissionPort`: query, request, and release access to the underlying source.
- Repository ports: save/read/delete documents, reading progress, bookmarks, annotations, and quotes without exposing SQL or storage-driver types.
- `ClockPort` and `IdGeneratorPort`: deterministic time and ID generation at application boundaries.
- `SecureCredentialStorePort`: transient secret access via a secure platform store; values must never be logged or exported.
- `LocalNotificationPort` and `ApplicationLifecyclePort`: optional native capabilities behind narrow contracts.

## Reader use cases

`ReaderUseCases` defines the application-facing operations for import/list/get/open/close, progress, bookmarks, annotations, and quotes. This is a contract, not an implementation. Persistence transactions, permission renewal, source release, and record consistency belong to application services and concrete adapters—not UI components.

## Adapter rules

- Adapters translate their platform's locators, permission errors, and lifecycle events into these contracts.
- No platform object (FileSystemHandle, Android Uri, NSURL, SQLite connection, Capacitor plugin instance) crosses the port boundary.
- A file handle or source handle must be released deterministically on close, error, and cancellation.
- File access is requested explicitly; expired permission is distinct from a missing document.
- Do not persist provider credentials or raw OS errors in Reader records.
- Unit tests can use in-memory fakes because the contracts contain no concrete platform dependency.

## Build and verification

```sh
npm run typecheck
npm run build
npm test
```

The TypeScript type tests assert ID separation and the PageIndex brand. Runtime tests validate the zero-based page convention and reject invalid indexes.
