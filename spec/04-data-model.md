# Shelf — Data model

## Principles

- Local storage is the default source of truth.
- Durable records use stable IDs and timestamps; evolving formats carry schema versions.
- File paths, content URIs, browser handles, and platform locators are access references, not document identity.
- Page indexes are zero-based: the first physical PDF page has index 0. Human-readable page ordinals and PDF page labels are presentation concerns.
- Deletion behavior is explicit and previewable.
- Export/import is versioned and tested.
- The former TechShelf catalog remains archived until a dedicated importer is scoped.

## Entities

- **Document:** stable ID, title, authors, language, metadata, source kind/opaque locator, content fingerprint, page count, outline/text extraction status, timestamps.
- **ReadingProgress:** document ID, zero-based page index, normalized scroll offset, zoom, reading mode, updated timestamp.
- **Bookmark:** stable ID, document ID, zero-based page index, optional text anchor/label, creation timestamp.
- **Annotation:** stable ID, document ID, kind (highlight/note), zero-based page index, selected/normalized text, text anchor, normalized page geometry, fingerprint, anchor version, optional note/style, timestamps.
- **Quote:** stable ID, document ID, zero-based page index, text, source/author metadata, optional annotation reference/tags, timestamps.
- **AIConversation / AIMessage / AIJob:** scope, messages, bounded source references, task, status, provider/model identifiers (never secrets), context manifest, timestamps, error and cancellation state.
- **Concept (later):** candidate term, normalized key, source page/segment, confidence/review state.

## Relationships

Document owns progress, bookmarks, annotations, quotes, and document-scoped conversations. A Quote may reference an Annotation but remains independently exportable. AI output is not persisted as a Note, Quote, Highlight, or Concept until the user accepts it and the application confirms the write. All records remain valid in standalone mode.

## Migrations

Index document lookup, annotation by document/page, quotes, and update timestamps. Use transactions for multi-record writes. Migrations are ordered and covered by upgrade tests.

## Export

A versioned bundle contains a manifest/schema version, document metadata, progress, bookmarks, annotations, quotes, and optionally AI conversations/source manifests. The user chooses whether PDF bytes are included. Provider credentials are never exported.
