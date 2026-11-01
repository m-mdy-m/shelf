import type { PageIndex } from "@shelf/reader-core";

export interface PdfTextRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type PdfTextDirection = "ltr" | "rtl";

export interface PdfTextRun {
  readonly text: string;
  /** UTF-16 offsets into PdfPageText.text. */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly direction: PdfTextDirection;
  /** Page-relative coordinates normalized to the unit square. */
  readonly rectangle: PdfTextRectangle | null;
  readonly hasLineBreakAfter: boolean;
}

export interface PdfPageText {
  readonly pageIndex: PageIndex;
  readonly text: string;
  readonly normalizedText: string;
  readonly runs: readonly PdfTextRun[];
  readonly hasSelectableText: boolean;
  readonly sourceItemCount: number;
  readonly truncated: boolean;
}

export interface PdfTextViewport {
  readonly width: number;
  readonly height: number;
  convertToViewportPoint(x: number, y: number): readonly [number, number];
}

export interface PdfTextExtractionOptions {
  readonly maxItems?: number;
  readonly maxCharacters?: number;
}

interface TextItem {
  readonly str: string;
  readonly dir?: string;
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly hasEOL?: boolean;
}

const DEFAULT_MAX_ITEMS = 50_000;
const DEFAULT_MAX_CHARACTERS = 500_000;

function asTextItem(value: unknown): TextItem | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item["str"] !== "string" ||
    !Array.isArray(item["transform"]) ||
    item["transform"].length < 6 ||
    !item["transform"].slice(0, 6).every(Number.isFinite) ||
    typeof item["width"] !== "number" ||
    !Number.isFinite(item["width"]) ||
    typeof item["height"] !== "number" ||
    !Number.isFinite(item["height"])
  ) {
    return null;
  }
  return item as unknown as TextItem;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function textRectangle(item: TextItem, viewport: PdfTextViewport): PdfTextRectangle | null {
  const [a, b, c, d, e, f] = item.transform;
  if (
    a === undefined || b === undefined || c === undefined ||
    d === undefined || e === undefined || f === undefined ||
    viewport.width <= 0 || viewport.height <= 0 ||
    item.width <= 0 || item.height <= 0
  ) {
    return null;
  }

  const horizontalLength = Math.hypot(a, b);
  const verticalLength = Math.hypot(c, d);
  if (horizontalLength === 0 || verticalLength === 0) return null;
  const x2 = e + (a / horizontalLength) * item.width;
  const y2 = f + (b / horizontalLength) * item.width;
  const x4 = e + (c / verticalLength) * item.height;
  const y4 = f + (d / verticalLength) * item.height;
  const x3 = x2 + (x4 - e);
  const y3 = y2 + (y4 - f);
  const points = [
    viewport.convertToViewportPoint(e, f),
    viewport.convertToViewportPoint(x2, y2),
    viewport.convertToViewportPoint(x3, y3),
    viewport.convertToViewportPoint(x4, y4),
  ];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) return null;

  const left = clampUnit(Math.min(...xs) / viewport.width);
  const top = clampUnit(Math.min(...ys) / viewport.height);
  const right = clampUnit(Math.max(...xs) / viewport.width);
  const bottom = clampUnit(Math.max(...ys) / viewport.height);
  if (right <= left || bottom <= top) return null;

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function inferredSeparator(
  previous: PdfTextRun | null,
  previousItem: TextItem | null,
  current: TextItem,
  currentRectangle: PdfTextRectangle | null,
): string {
  if (previous === null || previousItem === null) return "";

  if (previousItem.hasEOL === true) {
    return previousRectangleLineGap(previous.rectangle, currentRectangle, previousItem);
  }

  if (previous.rectangle === null || currentRectangle === null) return " ";

  const previousCenter = previous.rectangle.y + previous.rectangle.height / 2;
  const currentCenter = currentRectangle.y + currentRectangle.height / 2;
  const height = Math.max(previous.rectangle.height, currentRectangle.height);
  if (Math.abs(currentCenter - previousCenter) > height * 0.55) {
    const verticalGap = currentRectangle.y - (previous.rectangle.y + previous.rectangle.height);
    return verticalGap > height * 0.7 ? "\n\n" : "\n";
  }

  const rtl = current.dir === "rtl" || previous.direction === "rtl";
  const gap = rtl
    ? previous.rectangle.x - (currentRectangle.x + currentRectangle.width)
    : currentRectangle.x - (previous.rectangle.x + previous.rectangle.width);
  const currentStartsWithPunctuation = /^[.,;:!?%)\]}،؛؟»]/u.test(current.str);
  const previousEndsWithOpeningPunctuation = /[(\[{«]$/u.test(previous.text);
  const threshold = Math.max(height * 0.12, 0.0015);
  if (
    gap > threshold &&
    !currentStartsWithPunctuation &&
    !previousEndsWithOpeningPunctuation &&
    !previous.text.endsWith(" ") &&
    !current.str.startsWith(" ")
  ) {
    return " ";
  }
  return "";
}

function previousRectangleLineGap(
  previous: PdfTextRectangle | null,
  current: PdfTextRectangle | null,
  previousItem: TextItem,
): string {
  if (previous === null || current === null) return "\n";
  const lineHeight = Math.max(previous.height, current.height);
  const gap = current.y - (previous.y + previous.height);
  return gap > lineHeight * 0.7 ? "\n\n" : "\n";
}

/** Canonical text for local search/AI context; original text and offsets remain available. */
export function normalizePdfText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\t\f\v ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/**
 * Reconstruct text in PDF.js stream order. Geometry only supplies separator
 * fallbacks; it never sorts runs, which avoids reordering multi-column or RTL
 * content against PDF.js's reading sequence.
 */
export function buildPdfPageText(
  pageIndex: PageIndex,
  sourceItems: readonly unknown[],
  viewport: PdfTextViewport,
  options: PdfTextExtractionOptions = {},
): PdfPageText {
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 ||
      !Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    throw new RangeError("PDF text extraction limits must be positive safe integers.");
  }

  const items: TextItem[] = [];
  let visited = 0;
  let truncated = false;
  for (const sourceItem of sourceItems) {
    visited += 1;
    if (visited > maxItems) {
      truncated = true;
      break;
    }
    const item = asTextItem(sourceItem);
    if (item !== null && item.str.length > 0) items.push(item);
  }

  let text = "";
  const runs: PdfTextRun[] = [];
  let previousRun: PdfTextRun | null = null;
  let previousItem: TextItem | null = null;

  for (const item of items) {
    const rectangle = textRectangle(item, viewport);
    const separator = inferredSeparator(previousRun, previousItem, item, rectangle);
    const remaining = maxCharacters - text.length - separator.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const value = item.str.slice(0, remaining);
    if (value.length < item.str.length) truncated = true;
    if (value.length === 0) break;
    text += separator;

    const startOffset = text.length;
    text += value;
    const run: PdfTextRun = {
      text: value,
      startOffset,
      endOffset: text.length,
      direction: item.dir === "rtl" ? "rtl" : "ltr",
      rectangle,
      hasLineBreakAfter: item.hasEOL === true,
    };
    runs.push(run);
    previousRun = run;
    previousItem = item;
    if (truncated) break;
  }

  return {
    pageIndex,
    text,
    normalizedText: normalizePdfText(text),
    runs,
    hasSelectableText: text.trim().length > 0,
    sourceItemCount: Math.min(visited, maxItems),
    truncated,
  };
}
