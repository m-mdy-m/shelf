# @shelf/library

Application service for registering and reopening local PDF documents.

## Import and identity

The library owns stable DocumentId values. File paths, browser handles, OS URIs, and provider locators remain in DocumentLocatorStorePort and never enter the exportable Document record.

Import supports two explicit source modes:

- **imported-copy**: Shelf stores its own local copy. The original may be moved or deleted after import.
- **external-reference**: Shelf stores a reopenable handle to the original file. The source remains outside Shelf and may require permission again later.

Both modes use the same DocumentSourcePort, bounded reads, permission contract, and stable ID model. Removing a Shelf reference must never delete the user's external file.

## Fingerprints and duplicates

fingerprintPdf reads the complete file in ranges no larger than the Reader Core 1 MiB limit. It validates the PDF header and computes a versioned SHA-256 chain over the file, so duplicate detection does not allocate the entire PDF in memory. The stored value uses the sha256-chain-v1: prefix; it is a Shelf fingerprint format, not a claim to be the conventional one-shot SHA-256 digest.

An import whose fingerprint already exists returns the existing document with duplicate: true. It does not create another document or replace the original source locator. The optional cleanup port removes the newly staged copy/reference record, never the original external file.

## Open lifecycle

openDocument resolves the stable document ID, loads its opaque locator, checks the permission state, and requests access only when the adapter reports prompt. Expired, denied, and unavailable states remain distinct errors. The returned source handle must be closed with closeDocument when the caller finishes.

The service is local-only. It has no network client and does not upload PDF bytes.
