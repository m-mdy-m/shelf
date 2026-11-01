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

The worker is awaited before document loading. The returned session owns the PDF.js loading task and source handle. `close()` is idempotent: it aborts outstanding ranges, awaits `PDFDocumentLoadingTask.destroy()` (which tears down the worker), waits for outstanding source reads, then closes the platform source handle.

PDF.js password requests are bridged to the optional asynchronous `passwordPrompt`. The default attempt limit is three, and values outside 1–10 are rejected. Missing/cancelled passwords, malformed files, unavailable sources, invalid ranges, and read failures map to safe `ReaderError` results; provider errors and locators are not exposed.

## Rendering layers

`createPdfPageLayers(root)` creates separate canvas, text, and Shelf annotation elements. `PdfPageRenderer` renders PDF.js into the canvas with the built-in annotation layer disabled, runs the PDF.js TextLayer separately, and draws only persisted Shelf annotation markers in the annotation overlay. The version-matched PDF.js TextLayer stylesheet is deployed separately from the app's global styles. Text selection therefore remains independent from saved bookmarks/highlights/notes.

The canvas pixel budget defaults to 16,777,216 pixels. Page scale is capped at 8 and device pixel ratio at 4. Render tasks and text streams can be cancelled before a virtual page is unmounted. The renderer also rejects allocations above the configured pixel budget before touching canvas memory.

## Page virtualization

`PageVirtualizer` uses a Fenwick tree over estimated page heights. When PDF.js yields an actual page viewport, call `updatePageSize(index, { width, height })`. A viewport query computes visible pages plus a bounded overscan window in logarithmic time, without walking or mounting every page in the document. It supports mixed page sizes and rotated page geometry.

The UI owns the scroll container and calls `getWindow` as it scrolls; only the returned `pages` should be mounted and rendered. The UI integration and navigation controls are built in the Reader UI issue.

## Runtime assets

The web build copies the pinned PDF.js worker and auxiliary assets into same-origin `dist/web/assets/pdfjs` paths:
- `pdf.worker.min.mjs`
- CMaps and ICC profiles
- standard fonts and WebAssembly decoders
- the upstream Apache-2.0 license and per-asset license notices

It also copies PDF.js's text-layer stylesheet and Shelf's layer stylesheet. `resolvePdfJsAssetUrls`/`createPdfDocumentAdapter` resolve the worker and auxiliary data relative to the web base URL. Serve the copied assets with the application and permit same-origin workers and WebAssembly compilation in the Content Security Policy.

## Tests

`tests/unit/pdf-engine.test.mjs` uses deterministic fake platform ports and a fake PDF.js runtime to verify range limits, worker cleanup, page indexing, password/malformed errors, layer separation, and virtual-window bounds. The fixture builder generates a three-page PDF with mixed MediaBox dimensions, 0°/90°/270° rotations, and Helvetica/Times/Courier resources, plus a malformed PDF.
