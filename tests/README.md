# Tests

Organize tests by unit, integration, and end-to-end scope. Use redistributable PDF fixtures only. Never commit private books or personal documents.

## Unit coverage

- `reader-contracts.test.mjs`: zero-based page IDs, opaque IDs, and bounded source ranges.
- `document-library.test.mjs`: streaming SHA-256, PDF signature validation, copy/external-reference behavior, duplicate reuse/keep-both, rollback, missing/expired access, and fingerprint-verified relinking.
- `web-file-adapter.test.mjs`: ephemeral picker handles, OPFS copy/reopen, bounded Blob reads, and deletion.
- `pdf-engine.test.mjs`: PDF.js adapter lifecycle, range transport, rendering layers, and virtualized page windows.

The tests use in-memory port fakes and a fake OPFS directory; they do not require network access or a real device picker.
