# Shelf — Data model

## Principles

- Local storage is the default source of truth.
- Durable records use stable IDs and timestamps; evolving formats carry schema versions.
- File paths, content URIs, browser handles, and platform locators are access references, not document identity. Keep them in adapter-owned access storage keyed by the stable Document ID, outside exportable document records.
- A document source is explicitly an imported copy or an external reference. An imported copy belongs to Shelf's local storage; an external reference remains user-owned and must never be deleted when Shelf forgets the record.
- Page indexes are zero-based: the first physical PDF page has index 0. Human-readable page ordinals and PDF page labels are presentation concerns.
- A single source read is bounded to 1 MiB; adapters read larger sources in successive chunks.
- Fingerprints are versioned content identifiers for duplicate detection, not primary document IDs. A fingerprint change does not silently replace a Document ID.
- Deletion behavior is explicit and previewable.
- Export/import is versioned and tested.
- The former TechShelf catalog remains archived until a dedicated importer is scoped.

## Entities

- **Document:** stable ID, title, authors, language, safe source metadata (kind/display name/media type/size/modified time), versioned content fingerprint, page count, outline/text extraction status, timestamps. No raw path, content URI, or platform access handle.
- **Document access locator:** opaque path/URI/provider handle stored separately by an adapter and keyed by Document ID; may expire and is never exported by default.
- **ReadingProgress:** document ID, zero-based page index, normalized scroll offset, zoom, reading mode, updated timestamp.
- **Bookmark:** stable ID, document ID, zero-based page index, optional text anchor/label, creation timestamp.
- **Annotation:** stable ID, document ID, kind (highlight/note), zero-based page index, selected/normalized text, text anchor, normalized page geometry, fingerprint, anchor version, optional note/style, timestamps.
- **Quote:** stable ID, document ID, zero-based page index, text, source/author metadata, optional annotation reference/tags, timestamps.
- **AIConversation / AIMessage / AIJob:** scope, messages, bounded source references, task, status, provider/model identifiers (never secrets), context manifest, timestamps, error and cancellation state.
- **Concept (later):** candidate term, normalized key, source page/segment, confidence/review state.

## Relationships

Document owns progress, bookmarks, annotations, quotes, and document-scoped conversations. The separate access-locator record is keyed by Document ID and is removed when the document is forgotten or its access is revoked. A Quote may reference an Annotation but remains independently exportable. AI output is not persisted as a Note, Quote, Highlight, or Concept until the user accepts it and the application confirms the write. All records remain valid in standalone mode.

## Migrations

Index document lookup, annotation by document/page, quotes, and update timestamps. Keep locator storage isolated from export serialization and apply platform-appropriate protection. Use transactions for multi-record writes. Migrations are ordered and covered by upgrade tests.

## Export

A versioned bundle contains a manifest/schema version, safe document metadata, progress, bookmarks, annotations, quotes, and optionally AI conversations/source manifests. The user chooses whether PDF bytes are included. Opaque access locators and provider credentials are never exported.


## Text extraction and transient selection

Extracted page text is derived from PDF.js text-content streams and is not a durable entity by itself. Selection metadata includes exact selected text, normalized fallback text, UTF-16 offsets in the extracted page representation, document fingerprint, anchor schema version, page index, and normalized rectangles. Persisting these anchors belongs to the Annotation workflow. OCR output is not present unless a separate OCR capability explicitly creates it.

- **ExtractedPageText (transient):** page index, normalized text, geometry-bearing runs, selectable-text status, and a truncation flag. It is session/cache data, not a durable record or export field.
- **TextSelection (transient anchor draft):** exact selected text, normalized fallback, page-local offsets, document fingerprint, anchor version, normalized page rectangles, and offset confidence. It can be passed to annotation workflows but becomes durable only after an explicit annotation or quote write succeeds.
