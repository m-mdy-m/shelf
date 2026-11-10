export interface PdfTextItemGeometry {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly direction?: "ltr" | "rtl" | "ttb";
  readonly hasEOL?: boolean;
}

export interface PdfReadingLine<T extends PdfTextItemGeometry> {
  readonly items: readonly T[];
  readonly top: number;
  readonly bottom: number;
  readonly centerY: number;
  readonly height: number;
}

const COLUMN_GUTTER_RATIO = 0.14;

function lineGroups<T extends PdfTextItemGeometry>(items: readonly T[]): PdfReadingLine<T>[] {
  const sorted = [...items].sort((left, right) => {
    const leftCenter = (left.top + left.bottom) / 2;
    const rightCenter = (right.top + right.bottom) / 2;
    return leftCenter - rightCenter || left.left - right.left;
  });
  const lines: Array<{ items: T[]; top: number; bottom: number; centerY: number; height: number }> = [];

  for (const item of sorted) {
    const previous = lines[lines.length - 1];
    const previousItem = previous?.items[previous.items.length - 1];
    const itemHeight = item.bottom - item.top;
    const tolerance = Math.max(2.5, Math.min(itemHeight, previous?.height ?? itemHeight) * 0.55);
    const centerY = (item.top + item.bottom) / 2;
    if (previous !== undefined && previousItem?.hasEOL !== true &&
        Math.abs(centerY - previous.centerY) <= tolerance) {
      previous.items.push(item);
      previous.top = Math.min(previous.top, item.top);
      previous.bottom = Math.max(previous.bottom, item.bottom);
      previous.centerY = (previous.top + previous.bottom) / 2;
      previous.height = Math.max(previous.height, itemHeight);
    } else {
      lines.push({
        items: [item],
        top: item.top,
        bottom: item.bottom,
        centerY,
        height: itemHeight,
      });
    }
  }
  return lines;
}

function predominantDirection(items: readonly PdfTextItemGeometry[]): "ltr" | "rtl" | "ttb" {
  const rtl = items.filter((item) => item.direction === "rtl").length;
  const vertical = items.filter((item) => item.direction === "ttb").length;
  if (vertical > items.length / 2) return "ttb";
  return rtl > items.length / 2 ? "rtl" : "ltr";
}

function detectColumnSplit<T extends PdfTextItemGeometry>(
  lines: readonly PdfReadingLine<T>[],
  pageWidth: number,
): number | null {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) return null;
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

/**
 * Groups text boxes into visual lines and, when a stable gutter is present,
 * orders the complete left column before the right column (reversed for RTL).
 * This shared ordering is used by both text extraction and the selectable DOM.
 */
export function groupPdfTextItemsByReadingOrder<T extends PdfTextItemGeometry>(
  items: readonly T[],
  pageWidth: number,
): readonly PdfReadingLine<T>[] {
  if (items.length === 0) return [];
  const initialLines = lineGroups(items);
  const splitAt = detectColumnSplit(initialLines, pageWidth);
  const columns = splitAt === null
    ? [items]
    : [
      items.filter((item) => item.left + item.right < splitAt * 2),
      items.filter((item) => item.left + item.right >= splitAt * 2),
    ].filter((column) => column.length > 0);

  if (predominantDirection(items) === "rtl") columns.reverse();

  return columns.flatMap((column) => lineGroups(column).map((line) => {
    const direction = predominantDirection(line.items);
    const orderedItems = [...line.items].sort((left, right) =>
      direction === "rtl" ? right.right - left.right : left.left - right.left,
    );
    return { ...line, items: orderedItems };
  }));
}
