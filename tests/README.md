# Tests

Organize tests by unit, integration, and end-to-end scope. Use redistributable PDF fixtures only. Never commit private books or personal documents.

## Unit coverage

- `reader-contracts.test.mjs`: zero-based page IDs, opaque IDs, and bounded source ranges.
- `pdf-engine.test.mjs`: PDF.js lifecycle, range transport, outline resolution, streaming text extraction, image-only pages, and cancellation.
- `pdf-text.test.mjs`: geometry-backed text reconstruction, RTL/columns/ligatures, bounded extraction, local search, normalized-to-exact offsets, cancellation, and page-relative selection mapping.
- `document-library.test.mjs`: streaming SHA-256, PDF signature validation, copy/reference behavior, duplicate reuse/keep-both, rollback, missing/expired access, and fingerprint-verified relinking.
- `browser-document-source.test.mjs`: IndexedDB-backed local copies/references, permissions, and bounded reads.

Reader search operates only on extracted local page text. No document content or search query is transmitted to a remote endpoint.
