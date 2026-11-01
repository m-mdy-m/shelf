# PDF engine boundary

`@shelf/pdf-engine` is the only package allowed to import `pdfjs-dist`. Its public surface is Shelf-owned: document info, page geometry, page handles, rendering layers, and page virtual windows. No `PDFDocumentProxy`, `PDFPageProxy`, worker, loading task, PDF.js exception, or PDF.js type belongs in Reader Core or a persisted domain record.

## Document lifecycle

1. Resolve an opaque `DocumentLocator` through `DocumentLocatorStorePort`.
2. Open the source through `DocumentSourcePort`; do not turn its path/URI into a document ID.
3. Create and await a dedicated PDF.js worker.
4. Pass a bounded custom range transport into `getDocument`.
5. Adapt password callbacks and PDF.js failures to safe `ReaderError` values.
6. Return a session with metadata and zero-based page access.
7. On close, abort outstanding range transport, await loading-task destruction, wait for pending source reads, and release the source handle.

The adapter uses a 64 KiB default PDF.js chunk and caps configurable chunks at 1 MiB. It disables streaming and background auto-fetch while using range transport. This avoids eagerly materializing the complete file and keeps every source-port read within the Reader Core byte-range limit. The upstream worker and auxiliary asset URLs are version-matched and served on the same origin.

## Page rendering

The renderer creates three sibling layers:
- Canvas: pixels produced by PDF.js; PDF.js's own annotation layer is disabled.
- Text: PDF.js TextLayer from the page's text-content stream; it remains selectable and independently cancellable.
- Annotations: Shelf-owned DOM markers projected from normalized page rectangles.

Canvas pixel budgets are checked before allocation. Render tasks and text streams are cancelled when a page is rerendered or removed. The PDF.js text-layer stylesheet is shipped as a separate asset so its selectors do not apply to the rest of Shelf's document.

## Virtualization

Page heights begin with a configurable estimate. Measured page dimensions update a Fenwick tree so a page height/rotation change adjusts later offsets in O(log n). A query finds the visible page interval and adds bounded overscan, returning only a small set of page descriptors. UI code mounts those descriptors and requests the corresponding page lazily.

Virtualization does not force a one-size-fits-all page layout: each page retains its measured width and height, including mixed page sizes and PDF rotation. The virtualizer rejects impossible page counts, viewport values, and dimensions.

## Asset deployment

The web build copies the version-matched worker, CMaps, ICC profiles, standard fonts, WebAssembly decoder assets, the PDF.js Apache-2.0 license, and per-asset license notices from the locked `pdfjs-dist` dependency. The worker source and auxiliary URLs are resolved on the same application origin. The application CSP explicitly allows same-origin workers and WebAssembly compilation for PDF.js decoders.

## Failure model

| PDF.js/source condition | Shelf result |
|---|---|
| Password needed or incorrect | `password-required` (or `cancelled` when the prompt is dismissed) |
| Invalid/malformed PDF | `invalid-document` |
| Missing/unavailable source | `document-unavailable` |
| Permission failures | Preserved from the source port |
| Invalid or oversized byte range | `invalid-range` |
| Aborted page/document work | `cancelled` |
| Other read/render failures | Safe, retryable `read-failed` |

No native exception text, local path, URI, provider token, or document text is copied into an error message.
