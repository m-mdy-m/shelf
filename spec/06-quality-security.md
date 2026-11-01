# Shelf — Quality, privacy and security

## Test layers
Unit tests for domain rules, anchors, context limits, citations, jobs. Component tests for reader controls, selection, annotation states, AI panel, RTL/LTR. Integration tests for PDF adapter, content fingerprinting, duplicate import/reuse, copy rollback, permission renewal, external-reference relinking, persistence, migration, file access, providers. E2E for import → read → annotate → restart → resume → ask AI → inspect citation. Platform tests on real target OS/device. Evaluation fixtures for translation and source fidelity.

## PDF corpus
Include large files, mixed page sizes, rotated pages, embedded fonts, ligatures, columns, image-only/scanned, password protected, malformed, and RTL/mixed-script documents. Use redistributable fixtures only.

## Performance
Measure first visible page, navigation latency, memory on large PDFs, indexing memory/cancellation, annotation restore, and context assembly. Set numerical budgets after recording a baseline. Render only visible/near-visible pages and bound caches/history.

## Privacy/security
- Documents local unless remote provider is deliberately configured.
- Disclose provider/model and exact context scope.
- Store secrets in OS secure storage or trusted local backend.
- Protect loopback APIs from untrusted origins, CSRF, and network exposure.
- Never log document text, prompts, credentials, or sensitive file paths.
- Treat PDFs and model responses as untrusted input.
- Validate file sizes/types, PDF signatures, content fingerprints, URLs, and provider endpoints.
- Fingerprint large files incrementally using bounded reads; never buffer an entire PDF solely to detect duplicates.
- Never include provider secrets in export.

## Accessibility and localization
Keyboard navigation, focus management, screen-reader semantics, scalable text, high contrast, reduced motion, touch targets, and RTL/LTR mixed-content tests are release requirements.

## Release gates
Do not claim a platform is supported until core workflows pass there. Distinguish build artifacts, signed distributable packages, and manually tested behavior.
