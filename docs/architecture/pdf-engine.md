# PDF engine boundary

`@shelf/pdf-engine` is the only package allowed to import `pdfjs-dist`. Its public surface is Shelf-owned: document info, page geometry, page handles, rendering layers, and page virtual windows. No `PDFDocumentProxy`, `PDFPageProxy`, worker, loading task, PDF.js exception, or PDF.js type belongs in Reader Core or a persisted domain record.

## Document lifecycle

1. Resolve an opaque `DocumentLocator` through `DocumentLocatorStorePort`.
2. Open the source through `DocumentSourcePort`; do not turn its path/URI into a document ID.
3. Create and await a dedicated PDF.js worker.
4. Pass a bounded custom range transport into `getDocument`.
5. Adapt password callbacks and PDF.js failures to safe `ReaderError` values.
6. Return a session with metadata and zero-based page access.
7. On close, abort outstanding range transport, await loading-task destruction, wait for pending source reads, and release the source handle. A failed byte-range read is terminal for that session: the adapter stops the loading task and returns a non-retryable session error; a caller must open a new session to retry.

The adapter uses a 64 KiB default PDF.js chunk and caps configurable chunks at 1 MiB. It disables streaming and background auto-fetch while using range transport. This avoids eagerly materializing the complete file and keeps every source-port read within the Reader Core byte-range limit. The upstream worker and auxiliary asset URLs are version-matched and served on the same origin.

## Page rendering

The renderer creates four sibling layers:
- Canvas: pixels produced by PDF.js; PDF.js's own annotation layer is disabled.
- Text: PDF.js TextLayer from the page's text-content stream; it remains selectable and independently cancellable.
- Interaction: transient search and browser-selection rectangles; never persisted as annotations.
- Annotations: Shelf-owned DOM markers projected from normalized page rectangles.

Canvas pixel budgets are checked before allocation. Render tasks and text streams are cancelled when a page is rerendered or removed. At most 200 Shelf annotation markers are materialized per page render, and callers pass page-scoped annotations. TextLayer positioning and selection rules live in the PDF engine's scoped stylesheet; no global PDF.js viewer stylesheet is loaded.

## Virtualization

Page heights begin with a configurable estimate. Measured page dimensions update a Fenwick tree so a page height/rotation change adjusts later offsets in O(log n). A query finds the visible page interval and adds bounded overscan, returning only a small set of page descriptors. UI code mounts those descriptors and requests the corresponding page lazily.

Virtualization does not force a one-size-fits-all page layout: each page retains its measured width and height, including mixed page sizes and PDF rotation. The virtualizer rejects impossible page counts, viewport values, and dimensions.

## Asset deployment

The web build copies the version-matched worker, CMaps, ICC profiles, standard fonts, WebAssembly decoder assets, the PDF.js Apache-2.0 license, and per-asset license notices from the locked `pdfjs-dist` dependency. The worker source and auxiliary URLs are resolved on the same application origin. The application CSP explicitly allows same-origin workers and WebAssembly compilation for PDF.js decoders. Blob workers are not enabled because the adapter loads the copied same-origin worker asset.

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


## Reader navigation and persistence

The adapter exposes a Shelf-owned outline tree. PDF.js destinations are resolved to zero-based PageIndex values within the adapter; unresolved destinations are represented with a null pageIndex, and external outline actions are never executed by the web shell. Outline traversal is bounded to 1,000 items and 16 levels, with at most 12 active destination/page-index lookups. The web shell loads the outline lazily when the Contents panel is first opened, so large tables of contents do not delay the initial page render.

PageVirtualizer exposes page offsets and measured page sizes so the shell can place a bounded set of page roots inside one scroll spacer. The continuous Reader uses the scroll viewport as the source of truth for the current page; single-page mode mounts only one page. Page roots are cancelled and unmounted when they leave the virtual window.

ReadingProgress is stored per DocumentId in the IndexedDB readingProgress object store. Its pageIndex is zero-based, scrollOffset is a clamped fraction within that page, zoom is bounded by the Reader UI, and readingMode distinguishes continuous from single-page presentation. The UI debounces writes, persists when the document becomes hidden, and makes a final best-effort write on pagehide after synchronously disposing render resources.

The web shell treats page loading and rendering as one bounded in-flight operation per mount. A render scale is committed only after a successful render; failed pages retain a single recoverable error state and require an explicit Retry action rather than repeated work on each scroll event. The PDF adapter takes ownership of a supplied, pre-authorized source handle: it releases the handle on every failed open, while a successful session releases it from session.close().


## Text extraction, search, and selection

`PdfDocumentSession.getPageText(PageIndex, AbortSignal?)` returns a Shelf-owned `ExtractedPageText`: normalized page text, selectable-text status, and text runs with UTF-16 start/end offsets, direction, font identity, and page-normalized geometry. The adapter consumes PDF.js `streamTextContent()` incrementally rather than materializing an unbounded `getTextContent()` result. It stops at 50,000 text items or 500,000 characters per page, cancels the stream when the caller aborts or the session closes, and retains an LRU cache of at most 24 extracted pages per session. Each page model carries a `truncated` flag when the source stream exceeds those budgets.

The extractor applies Unicode NFKC normalization (including compatibility ligatures), derives rectangles through the page viewport so rotation is included, groups text geometrically into lines, infers word spaces from gaps while avoiding punctuation spacing, and uses a large horizontal gutter to identify simple two-column layouts. RTL lines are read from right to left; columns are emitted in reading order. These are deterministic fallbacks, not a claim that PDF content streams always encode semantic reading order.

Reader Core search normalizes case, compatibility characters, and whitespace while retaining a source-offset map, so each match points back to UTF-16 offsets in the extracted page string. The web shell searches sequentially and locally, with caps of 2,000 pages, 2,000,000 indexed characters, 100 total results, 20 matches per page, and a 256-character query. Each page's extracted text is itself bounded; cancellation stops the scan and cancels the active text stream. Search results are transient and are not persisted.

Selection is derived from the browser Range inside a page's PDF.js text layer and exposed as transient state through `ReaderWorkspaceController.getSelection()` and an optional `onSelection` callback. The shell captures the exact selected string and page-local client rectangles, then resolves the closest matching occurrence in the extracted text to provide start/end offsets. It reports whether offsets are exact or were resolved to the nearest normalized text occurrence. This selection model is an input contract for annotations; persistence and anchor-recovery workflows belong to the annotation work.

The web shell caps a single selection at 512 geometry fragments and the per-page transient search/selection overlay at 500 markers. Search summaries disclose pages where text extraction failed or was truncated; an empty text result is never silently represented as a complete document index.
