import { toPageIndex } from "@shelf/reader-core";
import type { ExtractedPageText, ExtractedTextRun, PageRect, TextDirection } from "@shelf/reader-core";
import type { PdfJsTextContent, PdfJsTextContentItem, PdfJsViewport } from "../adapter/pdfjs-runtime.js";

interface PositionedTextItem {
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly centerY: number;
  readonly height: number;
  readonly direction: TextDirection;
  readonly fontName: string | null;
  readonly rectangle: PageRect | null;
  readonly hasEOL: boolean;
}

interface TextLine {
  readonly items: readonly PositionedTextItem[];
  readonly top: number;
  readonly bottom: number;
  readonly centerY: number;
  readonly height: number;
}

const MAX_TEXT_ITEMS_PER_PAGE = 50_000;
const MAX_TEXT_CHARACTERS_PER_PAGE = 500_000;
const COLUMN_GUTTER_RATIO = 0.14;
const PUNCTUATION_PREFIX = /^[,.;:!?…،؛؟٪%)\]}»]/u;
const PUNCTUATION_SUFFIX = /[(\[{«]$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function directionOf(value: unknown): TextDirection {
  if (value === "rtl") return "rtl";
  if (value === "ttb") return "ttb";
  return "ltr";
}

function rectangleFor(
  item: PdfJsTextContentItem,
  viewport: PdfJsViewport,
): { readonly rect: PageRect; readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } | null {
  const transform = item.transform;
  if (transform.length < 6 || !transform.every(Number.isFinite)) return null;
  if (!Number.isFinite(item.width) || !Number.isFinite(item.height) || item.width <= 0 || item.height <= 0) {
    return null;
  }

  const x = transform[4] ?? 0;
  const y = transform[5] ?? 0;
  const points = viewport.convertToViewportRectangle([x, y - item.height, x + item.width, y]);
  if (points.length < 4 || !points.every(Number.isFinite)) return null;

  const left = Math.max(0, Math.min(points[0] ?? 0, points[2] ?? 0));
  const right = Math.min(viewport.width, Math.max(points[0] ?? 0, points[2] ?? 0));
  const top = Math.max(0, Math.min(points[1] ?? 0, points[3] ?? 0));
  const bottom = Math.min(viewport.height, Math.max(points[1] ?? 0, points[3] ?? 0));
  if (right <= left || bottom <= top || viewport.width <= 0 || viewport.height <= 0) return null;

  return {
    left,
    right,
    top,
    bottom,
    rect: {
      x: left / viewport.width,
      y: top / viewport.height,
      width: (right - left) / viewport.width,
      height: (bottom - top) / viewport.height,
    },
  };
}

function positionedItems(
  content: PdfJsTextContent,
  viewport: PdfJsViewport,
): PositionedTextItem[] {
  const output: PositionedTextItem[] = [];
  let characterCount = 0;

  for (const candidate of content.items.slice(0, MAX_TEXT_ITEMS_PER_PAGE)) {
    if (!isRecord(candidate) || typeof candidate.str !== "string" || !Array.isArray(candidate.transform)) continue;
    const text = candidate.str.normalize("NFKC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
    if (text.length === 0) continue;
    if (characterCount + text.length > MAX_TEXT_CHARACTERS_PER_PAGE) {
      const remaining = MAX_TEXT_CHARACTERS_PER_PAGE - characterCount;
      if (remaining <= 0) break;
      output.push(...positionedItemFromRecord({ ...candidate, str: text.slice(0, remaining) }, viewport));
      break;
    }
    characterCount += text.length;
    output.push(...positionedItemFromRecord({ ...candidate, str: text }, viewport));
  }
  return output;
}

function positionedItemFromRecord(
  candidate: Record<string, unknown>,
  viewport: PdfJsViewport,
): PositionedTextItem[] {
  const text = typeof candidate.str === "string" ? candidate.str : "";
  const transform = candidate.transform;
  if (!Array.isArray(transform) || !transform.every(finiteNumber)) return [];

  const item: PdfJsTextContentItem = {
    str: text,
    dir: typeof candidate.dir === "string" ? candidate.dir : "ltr",
    transform,
    width: finiteNumber(candidate.width) ? candidate.width : 0,
    height: finiteNumber(candidate.height) ? candidate.height : 0,
    fontName: typeof candidate.fontName === "string" ? candidate.fontName : null,
    hasEOL: candidate.hasEOL === true,
  };
  const positioned = rectangleFor(item, viewport);
  if (positioned === null) return [];
  return [{
    text,
    left: positioned.left,
    right: positioned.right,
    top: positioned.top,
    bottom: positioned.bottom,
    centerY: (positioned.top + positioned.bottom) / 2,
    height: positioned.bottom - positioned.top,
    direction: directionOf(item.dir),
    fontName: item.fontName,
    rectangle: positioned.rect,
    hasEOL: item.hasEOL,
  }];
}

function groupIntoLines(items: readonly PositionedTextItem[]): TextLine[] {
  const sorted = [...items].sort((left, right) => left.centerY - right.centerY || left.left - right.left);
  const lines: Array<{ items: PositionedTextItem[]; top: number; bottom: number; centerY: number; height: number }> = [];

  for (const item of sorted) {
    const previous = lines[lines.length - 1];
    const tolerance = Math.max(2.5, Math.min(item.height, previous?.height ?? item.height) * 0.55);
    if (previous !== undefined && Math.abs(item.centerY - previous.centerY) <= tolerance) {
      previous.items.push(item);
      previous.top = Math.min(previous.top, item.top);
      previous.bottom = Math.max(previous.bottom, item.bottom);
      previous.centerY = (previous.top + previous.bottom) / 2;
      previous.height = Math.max(previous.height, item.height);
    } else {
      lines.push({
        items: [item],
        top: item.top,
        bottom: item.bottom,
        centerY: item.centerY,
        height: item.height,
      });
    }
  }
  return lines;
}

function predominantDirection(items: readonly PositionedTextItem[]): TextDirection {
  const rtl = items.filter((item) => item.direction === "rtl").length;
  const vertical = items.filter((item) => item.direction === "ttb").length;
  if (vertical > items.length / 2) return "ttb";
  return rtl > items.length / 2 ? "rtl" : "ltr";
}

function detectColumnSplit(lines: readonly TextLine[], pageWidth: number): number | null {
  let largestGap = 0;
  let splitAt: number | null = null;
  for (const line of lines) {
    const ordered = [...line.items].sort((left, right) => left.left - right.left);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous === undefined || current === undefined) continue;
      const gap = current.left - previous.right;
      if (gap > pageWidth * COLUMN_GUTTER_RATIO && gap > largestGap) {
        largestGap = gap;
        splitAt = (previous.right + current.left) / 2;
      }
    }
  }
  return splitAt;
}

function joinLine(line: TextLine): readonly { readonly text: string; readonly item: PositionedTextItem }[] {
  const direction = predominantDirection(line.items);
  const items = [...line.items].sort((left, right) =>
    direction === "rtl" ? right.right - left.right : left.left - right.left,
  );
  const output: Array<{ text: string; item: PositionedTextItem }> = [];
  let previous: PositionedTextItem | null = null;

  for (const item of items) {
    let prefix = "";
    if (previous !== null) {
      const gap = direction === "rtl"
        ? previous.left - item.right
        : item.left - previous.right;
      const threshold = Math.max(1.5, Math.min(previous.height, item.height) * 0.16);
      const needsSpace = gap > threshold &&
        !/\s$/u.test(previous.text) &&
        !/^\s/u.test(item.text) &&
        !PUNCTUATION_PREFIX.test(item.text) &&
        !PUNCTUATION_SUFFIX.test(previous.text);
      if (needsSpace) prefix = " ";
    }
    output.push({ text: prefix + item.text, item });
    previous = item;
  }
  return output;
}

/**
 * Convert PDF.js text items to a stable, normalized, page-local text representation.
 * Geometry is transformed through the page viewport so rotation is included.
 */
export function extractPdfPageText(
  pageIndex: number,
  content: PdfJsTextContent,
  viewport: PdfJsViewport,
): ExtractedPageText {
  const items = positionedItems(content, viewport);
  if (items.length === 0) {
    return { pageIndex: toPageIndex(pageIndex), text: "", runs: [], hasSelectableText: false };
  }

  const initialLines = groupIntoLines(items);
  const splitAt = detectColumnSplit(initialLines, viewport.width);
  const columns = splitAt === null
    ? [items]
    : [
      items.filter((item) => item.left + item.right < splitAt * 2),
      items.filter((item) => item.left + item.right >= splitAt * 2),
    ].filter((column) => column.length > 0);

  if (predominantDirection(items) === "rtl") columns.reverse();

  let text = "";
  const runs: ExtractedTextRun[] = [];
  let previousLine: TextLine | null = null;

  for (const column of columns) {
    const lines = groupIntoLines(column);
    for (const line of lines) {
      if (text.length > 0) {
        const gap = previousLine === null ? 0 : line.top - previousLine.bottom;
        const typicalHeight = previousLine?.height ?? line.height;
        text += gap > typicalHeight * 1.65 ? "\n\n" : "\n";
      }

      for (const entry of joinLine(line)) {
        const startOffset = text.length;
        text += entry.text;
        const endOffset = text.length;
        if (endOffset <= startOffset) continue;
        runs.push({
          text: entry.text,
          startOffset,
          endOffset,
          direction: entry.item.direction,
          fontName: entry.item.fontName,
          rectangles: entry.item.rectangle === null ? [] : [entry.item.rectangle],
        });
      }
      previousLine = line;
    }
  }

  const normalizedText = text.trim();
  if (normalizedText !== text) {
    const leading = text.length - text.trimStart().length;
    const trimmedEnd = text.trimEnd().length;
    const adjustedRuns = runs
      .map((run) => ({
        ...run,
        startOffset: Math.max(0, run.startOffset - leading),
        endOffset: Math.min(normalizedText.length, run.endOffset - leading),
      }))
      .filter((run) => run.endOffset > run.startOffset);
    return {
      pageIndex: toPageIndex(pageIndex),
      text: normalizedText.slice(0, Math.max(0, trimmedEnd - leading)),
      runs: adjustedRuns,
      hasSelectableText: normalizedText.length > 0,
    };
  }

  return {
    pageIndex: toPageIndex(pageIndex),
    text,
    runs,
    hasSelectableText: text.length > 0,
  };
}
