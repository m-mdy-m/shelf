# @shelf/pdf-engine

PDF.js integration for Shelf. This package owns PDF.js objects, the PDF worker, range transport, page geometry, rendering, and page virtualization. It depends on `@shelf/reader-core` only through its platform-neutral ports and domain values.

## Public API

Use the package root:

```ts
import {
  createPdfDocumentAdapter,
  createPdfPageLayers,
  PageVirtualizer,
  PdfPageRenderer,
} from "@shelf/pdf-engine";
```

Create the adapter with an implementation of `DocumentSourcePort` and `DocumentLocatorStorePort`:

```ts
const pdf = createPdfDocumentAdapter(
  documentSource,
  documentLocatorStore,
  document.baseURI,
  {
    passwordPrompt: async ({ reason }) => {
      return passwordDialog.request({ reason });
    },
  },
);

const opened = await pdf.open(documentId);
if (opened.ok) {
  const page = await opened.value.getPage(toPageIndex(0));
  // A Shelf-owned page handle contains geometry, not a PDF.js proxy.
  await opened.value.close();
}
```

Page indexes are zero-based. `getPage(toPageIndex(0))` requests physical PDF page 1. Page labels and human-facing numbers remain presentation concerns.

## Range reads and memory

PDF.js is configured with a custom `PDFDataRangeTransport`. The default range chunk is 64 KiB; configured values are capped at `MAX_DOCUMENT_READ_BYTES` (1 MiB). Every request is validated with `parseByteRange` and passed to the source port as one bounded read. Streaming and auto-fetch are disabled so the viewer does not eagerly fetch the entire document. The underlying source adapter still must enforce the same limit and permission rules.

## Worker lifecycle and errors

Each open session receives a unique worker name, so closing one view cannot tear down another concurrently opened view of the same document. The worker is awaited before document loading. The returned session owns the PDF.js loading task and source handle. `close()` is idempotent: it aborts outstanding ranges, awaits `PDFDocumentLoadingTask.destroy()` (which tears down the worker), waits for outstanding source reads, then closes the platform source handle.

PDF.js password requests are bridged to the optional asynchronous `passwordPrompt`. Late prompt results are ignored after teardown, and password callbacks are guarded against synchronous failures. The default attempt limit is three, and values outside 1–10 are rejected. Missing/cancelled passwords, malformed files, unavailable sources, invalid ranges, and read failures map to safe `ReaderError` results; provider errors and locators are not exposed. A byte-range failure terminates the current PDF.js loading task and is marked non-retryable for that session; callers must close and reopen the document to retry against the source.

## Rendering layers

`createPdfPageLayers(root)` creates separate canvas, text, transient interaction, and Shelf annotation elements. `PdfPageRenderer` renders PDF.js into the canvas with the built-in annotation layer disabled, runs the PDF.js TextLayer separately, and draws only persisted Shelf annotation markers in the annotation overlay. The package stylesheet implements PDF.js TextLayer positioning and selection rules inside Shelf's isolated page classes. Text selection therefore remains independent from saved bookmarks/highlights/notes and no global PDF.js viewer stylesheet is required.

The interaction layer is reserved for transient search/selection overlays and is cleared on cancellation. It is separate from persisted annotations. The renderer materializes at most 200 annotation markers per page render and expects the caller to supply records scoped to the requested page. The canvas pixel budget defaults to 16,777,216 pixels. Page scale is capped at 8 and device pixel ratio at 4. Render tasks and text streams can be cancelled before a virtual page is unmounted. The renderer also rejects allocations above the configured pixel budget before touching canvas memory.

## Page virtualization

`PageVirtualizer` uses a Fenwick tree over estimated page heights. When PDF.js yields an actual page viewport, call `updatePageSize(index, { width, height })`. A viewport query computes visible pages plus a bounded overscan window in logarithmic time, without walking or mounting every page in the document. It supports mixed page sizes and rotated page geometry.

The Reader workspace owns the scroll container and calls `getWindow` as it scrolls; only the returned `pages` are mounted and rendered. Navigation, local text search, and selection are wired in the web workspace while PDF.js remains behind the adapter.

## Runtime assets

The web build copies the pinned PDF.js worker and auxiliary assets into same-origin `dist/web/assets/pdfjs` paths:
- `build/pdf.worker.min.mjs` (kept in its original relative directory)
- CMaps and ICC profiles
- image decoders, standard fonts, and WebAssembly decoders
- the upstream Apache-2.0 license and per-asset license notices

It copies Shelf's isolated page-layer/TextLayer stylesheet. `resolvePdfJsAssetUrls`/`createPdfDocumentAdapter` resolve the worker and auxiliary data relative to the web base URL. Serve the copied assets with the application and permit same-origin workers and WebAssembly compilation in the Content Security Policy. Blob-backed workers are not enabled; the adapter uses the copied same-origin worker asset.

## Tests

`tests/unit/pdf-engine.test.mjs` uses deterministic fake platform ports and a fake PDF.js runtime to verify range limits, worker cleanup, page indexing, password/malformed errors, layer separation, and virtual-window bounds. The fixture builder generates a three-page PDF with mixed MediaBox dimensions, 0°/90°/270° rotations, and Helvetica/Times/Courier resources, plus a malformed PDF.


## Page text extraction

A session exposes `getPageText(toPageIndex(index), signal?)`. It reads PDF.js text-content chunks from `streamTextContent()`, not from an unbounded full-page text allocation. Extraction is capped at 50,000 items and 500,000 characters per page, records truncation explicitly, and is cached for at most 24 pages per session. AbortSignal cancels the active stream and returns a `cancelled` Result.

The returned `ExtractedPageText` contains normalized text, source-preserving UTF-16 offsets, direction/font metadata, and viewport-projected page rectangles. NFKC normalization expands compatibility ligatures; geometric line grouping, paragraph-gap detection, punctuation-aware space inference, simple gutter-based column ordering, and RTL ordering provide deterministic layout fallbacks. They do not replace OCR or guarantee semantic order for malformed PDFs.

Use the Reader Core `findTextMatches` helper to search normalized text while retaining offsets into the extracted string. The Reader shell bounds a search to 2,000 pages, 2,000,000 characters, 100 results, 20 matches per page, and a 256-character query. Image-only pages are explicitly represented with `hasSelectableText: false`.

The ReaderWorkspace controller exposes the active transient selection via `getSelection()` and an optional callback. The selection includes the exact text, normalized fallback, document/page identity, UTF-16 offsets, document fingerprint, anchor version, normalized page rectangles, and offset confidence. Its geometry is capped at 512 fragments and transient interaction overlays at 500 markers per page.
