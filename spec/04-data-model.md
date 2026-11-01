# Shelf — Data model

## Principles

- Local storage is the default source of truth.
- Durable records use stable IDs and timestamps; evolving formats carry schema versions.
- File paths and platform URIs are locators, not document identity.
- Deletion behavior is explicit and previewable.
- Export/import is versioned and tested.
- The former TechShelf catalog remains archived until a dedicated importer is scoped.

## Entities

- **Document:** ID, title, authors, language, metadata, source kind/locator, content fingerprint, page count, outline/text extraction status, timestamps.
- **ReadingProgress:** ID, document ID, page index, scroll offset, zoom, reading mode, updated timestamp.
- **Bookmark:** ID, document ID, page index, optional anchor/label, creation timestamp.
- **Annotation:** ID, document ID, kind (highlight/note), page, selected/normalized text, text anchor, geometry, fingerprint, anchor version, optional note/style, timestamps.
- **Quote:** ID, document ID, page, text, source/author metadata, optional annotation reference/tags, timestamps.
- **AIConversation / AIMessage / AIJob:** scope, messages, bounded source references, task, status, provider/model identifiers (never secrets), context manifest, timestamps, error and cancellation state.
- **Concept (later):** candidate term, normalized key, source page/segment, confidence/review state.

## Relationships

Document owns progress, bookmarks, annotations, quotes, and document-scoped conversations. A Quote may reference an Annotation but remains independently exportable. AI output is not persisted as a Note, Quote, Highlight, or Concept until the user accepts it and the application confirms the write. All records remain valid in standalone mode.

## Migrations

Index document lookup, annotation by document/page, quotes, and update timestamps. Use transactions for multi-record writes. Migrations are ordered and covered by upgrade tests.

## Export

A versioned bundle contains a manifest/schema version, document metadata, progress, bookmarks, annotations, quotes, and optionally AI conversations/source manifests. The user chooses whether PDF bytes are included. Provider credentials are never exported.
