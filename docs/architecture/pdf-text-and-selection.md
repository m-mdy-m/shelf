# PDF text extraction, local search, and selection

`@shelf/pdf-engine` owns PDF.js text extraction and exposes only Shelf-defined text records. Page text is read from PDF.js's `streamTextContent` API in bounded batches; the adapter stops after 50,000 text items per page and `buildPdfPageText` caps the reconstructed page at 500,000 UTF-16 code units. An aborted search cancels the active page stream.

## Text reconstruction

Each `PdfPageText` contains the original extracted string, an NFKC-normalized search string, ordered text runs, and page-relative rectangles. Runs carry UTF-16 offsets into the exact source string, direction, and line-break metadata. PDF.js stream order is kept intact; geometry is used only to infer spaces and paragraph breaks when the source item stream does not explicitly provide them. This avoids sorting columns or right-to-left text purely by x/y coordinates.

Text that is absent from a page remains absent. The adapter does not OCR image-only pages or fabricate text; the UI reports that no selectable/searchable text was found in the scanned pages.

## Local search

`searchPdfDocument` scans pages on-device in the requested start-page order and yields periodically so an AbortSignal can cancel the operation. Default limits are 5,000 pages and 500 results; the maximum accepted result limit is 5,000. Query length is bounded to 256 characters.

The query and each page are normalized with Unicode NFKC and whitespace folding for matching (for example, a ligature can match its expanded spelling). A source-offset map projects each normalized match back to UTF-16 offsets in the original exact page text. A result carries zero-based `PageIndex`, exact text, context snippets, source offsets, and one or more normalized rectangles. Content is never sent to a network service.

## Browser text selection

The Reader workspace observes the browser Selection API and intersects the active Range with each currently mounted PDF.js text layer. It creates one Shelf selection fragment per intersected page, clipping the DOM range to that page and translating client rectangles into page-relative coordinates.

A selection contains exact and normalized text, zero-based page index, text-layer DOM offsets, bounded prefix/suffix context, and up to 128 normalized rectangles. The anchor labels its offset basis as `pdfjs-text-layer-dom`; it is not confused with a PDF.js object or an offset into normalized search text. The application emits a local `shelf:pdf-selection` event carrying the document ID and page fragments so the annotation workflow can consume them without coupling PDF.js to the annotation package.

Selections that do not intersect the PDF text layer or have no measurable page-relative rectangle are not returned. Multi-page browser selections become multiple fragments rather than a single rectangle spanning different pages.

## Layer ownership

PDF canvas pixels, selectable PDF.js text, search-hit indicators, and saved Shelf annotations remain separate DOM layers. Search hits are temporary overlay markers and are removed when the query changes; saved annotations are persisted through their own use cases. Neither search nor selection writes to the annotation repository implicitly.
