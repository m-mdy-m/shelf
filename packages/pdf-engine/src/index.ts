export { PdfDocumentAdapter } from "./adapter/pdf-document-adapter.js";
export type {
  PdfDocumentAdapterOptions,
  PdfDocumentInfo,
  PdfDocumentSession,
  PdfPageGeometry,
  PdfPageHandle,
  PdfOutlineItem,
  PdfPasswordPrompt,
  PdfPasswordReason,
  PdfPasswordRequest,
} from "./adapter/pdf-document-adapter.js";
export { createPdfJsRuntime, resolvePdfJsAssetUrls } from "./adapter/pdfjs-runtime.js";
export type { PdfJsAssetUrls, PdfJsRuntime } from "./adapter/pdfjs-runtime.js";
export { createPdfPageLayers, PdfPageRenderer } from "./renderer/pdf-page-renderer.js";
export type { PdfPageLayers, PdfPageRenderOptions } from "./renderer/pdf-page-renderer.js";
export { PageVirtualizer } from "./virtualization/page-virtualizer.js";
export type {
  PageSize,
  PageViewportPosition,
  PageVirtualWindow,
  PageVirtualizerOptions,
  VirtualPage,
} from "./virtualization/page-virtualizer.js";
export { createPdfDocumentAdapter } from "./create-pdf-document-adapter.js";

export { buildPdfPageText, normalizePdfText } from "./text/page-text.js";
export type {
  PdfPageText,
  PdfTextDirection,
  PdfTextExtractionOptions,
  PdfTextRectangle,
  PdfTextRun,
} from "./text/page-text.js";
export { searchPdfDocument } from "./text/search.js";
export type {
  PdfTextSearchMatch,
  PdfTextSearchOptions,
  PdfTextSearchResult,
  PdfTextSession,
} from "./text/search.js";
export {
  createPdfTextSelection,
  mapPdfSelectionRange,
  normalizeSelectedText,
} from "./selection/pdf-selection.js";
export type {
  PdfSelectionAnchorHint,
  PdfTextSelection,
  SelectionBounds,
  SelectionClientRectangle,
} from "./selection/pdf-selection.js";
