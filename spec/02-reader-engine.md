# Shelf — Reader engine

## Responsibilities
Own document lifecycle, navigation, rendered page state, selection, reading position, and user-facing annotations. Do not own AI provider calls or external note-export integrations.

## Rendering
- Start with Mozilla PDF.js behind a Shelf adapter; use its worker where supported.
- Render pages on demand and virtualize off-screen pages; never mount every page of a large PDF.
- Support continuous/single-page modes, zoom, fit-width/page, page jump, previous/next, outline/TOC, and document metadata.
- Handle password-protected, malformed, encrypted, and unavailable PDFs explicitly.
- Keep canvas, text, annotation, and interaction layers distinct.
- Test large documents, mixed sizes, rotations, embedded fonts, ligatures, columns, and RTL.

## DocumentSource port
Provide stable document ID, display name/type, read or byte/range access, size/modified metadata where available, permission/reopen behavior, and explicit missing/expired-permission errors. Adapters may use browser file handles, desktop files, Android content URIs, and iOS document-picker/security-scoped access. Reader core must not depend on one URI scheme.

## Text and selection
- Use PDF text layer where present; never pretend image-only PDFs contain selectable text.
- Preserve spacing, line breaks, paragraph gaps, punctuation, and reading order as far as the source permits.
- Map selections to page rectangles using text geometry.
- Normalize text for AI while retaining exact selection and geometry for persistence.
- Expose document ID, documented page-index convention, selected text, offsets/anchors, and geometry.

## Annotation types
Bookmark = reading location. Highlight = visual text range. Note = user-authored content optionally attached to a passage. Quote = reusable excerpt attributed to document and location. Keep them distinct. AI actions are proposals; show saved only after a confirmed write.

## Resilient anchors
Never rely only on screen pixels. Persist document ID/page, selected and normalized text, offsets or structural anchor, page-relative rectangles, document fingerprint, and anchor schema version. Resolve text anchor first, geometry second. Ambiguous anchors become visibly unresolved, not silently attached elsewhere.

## Progress/search/accessibility
Persist last document, page/scroll, zoom, reading mode, and timestamps; debounce frequent writes. MVP search is local over extractable text with cancellable, bounded indexing. OCR is deferred and image-only documents must explain why selection/search is unavailable. Include keyboard navigation, semantic lang/dir, mixed RTL/LTR tests, screen-reader support, reduced motion, scalable typography, contrast, and mobile touch targets.
