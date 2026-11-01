import type { PageIndex } from "@shelf/reader-core";
import type { PdfTextRectangle } from "../text/page-text.js";

export interface PdfSelectionAnchorHint {
  readonly offsetBasis: "pdfjs-text-layer-dom";
  readonly startOffset: number;
  readonly endOffset: number;
  readonly prefix: string;
  readonly suffix: string;
}

export interface PdfTextSelection {
  readonly pageIndex: PageIndex;
  readonly exactText: string;
  readonly normalizedText: string;
  readonly anchor: PdfSelectionAnchorHint;
  readonly rectangles: readonly PdfTextRectangle[];
}

export interface SelectionBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface SelectionClientRectangle {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function normalizeSelectedText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/** Map browser Range rectangles and DOM text offsets into a stable page-relative selection. */
export function createPdfTextSelection(args: {
  readonly pageIndex: PageIndex;
  readonly exactText: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly pageBounds: SelectionBounds;
  readonly clientRectangles: readonly SelectionClientRectangle[];
  readonly pageText: string;
}): PdfTextSelection | null {
  const exactText = args.exactText;
  if (
    exactText.trim().length === 0 ||
    !Number.isSafeInteger(args.startOffset) ||
    !Number.isSafeInteger(args.endOffset) ||
    args.startOffset < 0 ||
    args.endOffset <= args.startOffset ||
    args.pageBounds.width <= 0 ||
    args.pageBounds.height <= 0
  ) {
    return null;
  }

  const rectangles: PdfTextRectangle[] = [];
  for (const rectangle of args.clientRectangles.slice(0, 128)) {
    const left = clampUnit((rectangle.left - args.pageBounds.left) / args.pageBounds.width);
    const top = clampUnit((rectangle.top - args.pageBounds.top) / args.pageBounds.height);
    const right = clampUnit((rectangle.right - args.pageBounds.left) / args.pageBounds.width);
    const bottom = clampUnit((rectangle.bottom - args.pageBounds.top) / args.pageBounds.height);
    if (right <= left || bottom <= top) continue;
    rectangles.push({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  }
  if (rectangles.length === 0) return null;

  const pageText = args.pageText;
  const prefix = pageText.slice(Math.max(0, args.startOffset - 64), args.startOffset);
  const suffix = pageText.slice(args.endOffset, args.endOffset + 64);
  return {
    pageIndex: args.pageIndex,
    exactText,
    normalizedText: normalizeSelectedText(exactText),
    anchor: {
      offsetBasis: "pdfjs-text-layer-dom",
      startOffset: args.startOffset,
      endOffset: args.endOffset,
      prefix,
      suffix,
    },
    rectangles,
  };
}

/**
 * Browser bridge for a Range wholly or partly inside one PDF.js text layer.
 * A multi-page selection should call this once for each intersected mounted page.
 */
export function mapPdfSelectionRange(
  range: Range,
  pageRoot: HTMLElement,
  textLayer: HTMLElement,
  pageIndex: PageIndex,
): PdfTextSelection | null {
  if (range.collapsed || !range.intersectsNode(textLayer)) return null;

  const clipped = range.cloneRange();
  if (!textLayer.contains(clipped.startContainer)) clipped.setStart(textLayer, 0);
  if (!textLayer.contains(clipped.endContainer)) clipped.setEnd(textLayer, textLayer.childNodes.length);
  if (clipped.collapsed) return null;

  const owner = pageRoot.ownerDocument;
  const startPrefix = owner.createRange();
  startPrefix.selectNodeContents(textLayer);
  startPrefix.setEnd(clipped.startContainer, clipped.startOffset);
  const endPrefix = owner.createRange();
  endPrefix.selectNodeContents(textLayer);
  endPrefix.setEnd(clipped.endContainer, clipped.endOffset);

  const bounds = pageRoot.getBoundingClientRect();
  const rectangleList = clipped.getClientRects();
  const clientRectangles: SelectionClientRectangle[] = [];
  for (let index = 0; index < rectangleList.length; index += 1) {
    const item = rectangleList.item(index);
    if (item !== null) clientRectangles.push(item);
  }

  return createPdfTextSelection({
    pageIndex,
    exactText: clipped.toString(),
    startOffset: startPrefix.toString().length,
    endOffset: endPrefix.toString().length,
    pageBounds: {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    },
    clientRectangles,
    pageText: textLayer.textContent ?? "",
  });
}
