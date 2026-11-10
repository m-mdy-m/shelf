export { toOpaqueId, parseOpaqueId } from "./domain/ids.js";
export { toDisplayPageNumber, toPageIndex, parsePageIndex } from "./domain/page-index.js";
export { MAX_DOCUMENT_READ_BYTES, parseByteRange } from "./domain/byte-range.js";

export type * from "./domain/annotation.js";
export type * from "./domain/bookmark.js";
export type * from "./domain/byte-range.js";
export type * from "./domain/document.js";
export type * from "./domain/document-locator.js";
export type * from "./domain/errors.js";
export type * from "./domain/ids.js";
export type * from "./domain/library.js";
export type * from "./domain/page-index.js";
export type * from "./domain/quote.js";
export type * from "./domain/reading-progress.js";
export type * from "./domain/result.js";

export type * from "./ports/index.js";
export type * from "./application/reader-use-cases.js";
export { ReaderAnnotationService } from "./application/reader-annotations.js";
export { findTextMatches, resolveTextAnchor, resolveTextSelectionOffsets } from "./domain/text.js";
export type * from "./domain/text.js";
