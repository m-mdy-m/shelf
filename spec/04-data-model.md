# Shelf — Data model

## Principles
Local DB is default source of truth; stable IDs and timestamps; version evolving schemas; file paths/URIs are locators, not identity; deletion is previewable; export/import is versioned; old TechShelf catalog remains archival until an explicit importer is scoped.

## Entities
- **Document:** ID, title, authors, language, metadata, source kind/locator, content fingerprint, page count, outline/text extraction status, timestamps.
- **ReadingProgress:** ID, document ID, page index, scroll offset, zoom, reading mode, updated timestamp.
- **Bookmark:** ID, document ID, page index, optional anchor/label, created timestamp.
- **Annotation:** ID, document ID, kind (highlight/note), page, selected/normalized text, text anchor, geometry, fingerprint, anchor version, optional note/style, timestamps.
- **Quote:** ID, document ID, page, text, source/author metadata, optional annotation reference/tags, timestamps.
- **AIConversation/Message/Job:** scope, role/content, bounded sources, task, status, provider/model (not secrets), context manifest, timestamps, error and cancellation state.
- **Concept (later):** candidate term, normalized key, source page/segment, confidence/review state, optional external IDIOS link.

## Relationships
Document owns progress, bookmarks, annotations, quotes, and document-scoped conversations. Quote may reference Annotation but stays independently exportable. AI output is not persisted as a Note/Quote/Highlight/Concept until user acceptance and confirmed write. IDIOS integration uses explicit external references/export; records survive disconnection. Graph references stable IDs but does not own Shelf content.

## Migrations and export
Index document lookup, annotations by document/page, quotes, and update timestamps. Use transactions. Migrations are ordered and covered by upgrade tests. Export bundle contains manifest/schema version, document metadata, progress, bookmarks, annotations, quotes, and optional conversations/source manifests; user chooses whether PDFs are included. Never export provider credentials.
