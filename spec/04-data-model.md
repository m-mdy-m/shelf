# Shelf — Data model

## Principles

- Local storage is the default source of truth.
- Durable records use stable IDs and timestamps; evolving formats carry schema versions.
- File paths, content URIs, browser handles, and platform locators are access references, not document identity. Keep them in adapter-owned access storage keyed by the stable Document ID, outside exportable document records.
- Page indexes are zero-based: the first physical PDF page has index 0. Human-readable page ordinals and PDF page labels are presentation concerns.
- A single source read is bounded to 1 MiB; adapters read larger sources in successive chunks.
- Deletion behavior is explicit and previewable.
- Export/import is versioned and tested.
- The former TechShelf catalog remains archived until a dedicated importer is scoped.

## Entities

- **Document:** stable ID, title, authors, language, safe source metadata (imported copy/external reference/provider, display name/media type/size/modified time), SHA-256 content fingerprint, explicit access state, page count, outline/text extraction status, timestamps. No raw path, content URI, or platform access handle.
- **Document access locator:** opaque path/URI/provider handle stored separately by an adapter and keyed by Document ID; may expire and is never exported by default.
- **ReadingProgress:** document ID, zero-based page index, normalized scroll offset, zoom, reading mode, updated timestamp.
- **Bookmark:** stable ID, document ID, zero-based page index, optional text anchor/label, creation timestamp.
- **Annotation:** stable ID, document ID, kind (highlight/note), zero-based page index, selected/normalized text, text anchor, normalized page geometry, fingerprint, anchor version, optional note/style, timestamps.
- **Quote:** stable ID, document ID, zero-based page index, text, source/author metadata, optional annotation reference/tags, timestamps.
- **AIConversation / AIMessage / AIJob:** scope, messages, bounded source references, task, status, provider/model identifiers (never secrets), context manifest, timestamps, error and cancellation state.
- **Concept (later):** candidate term, normalized key, source page/segment, confidence/review state.

## Relationships

Document owns progress, bookmarks, annotations, quotes, and document-scoped conversations. The separate access-locator record is keyed by Document ID and is removed when the document is forgotten or its access is revoked. An imported copy is stored in app-managed reopenable storage; an external reference points to the original source and requires reopenable permission material. Duplicate imports default to reusing the existing stable document ID and can explicitly keep a second library entry. A Quote may reference an Annotation but remains independently exportable. AI output is not persisted as a Note, Quote, Highlight, or Concept until the user accepts it and the application confirms the write. All records remain valid in standalone mode.

## Migrations

Index document lookup, annotation by document/page, quotes, and update timestamps. Keep locator storage isolated from export serialization and apply platform-appropriate protection. Use transactions for multi-record writes. Migrations are ordered and covered by upgrade tests.

## Export

A versioned bundle contains a manifest/schema version, safe document metadata, progress, bookmarks, annotations, quotes, and optionally AI conversations/source manifests. The user chooses whether PDF bytes are included. Opaque access locators and provider credentials are never exported.
