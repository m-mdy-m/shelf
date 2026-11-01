declare const pageIndexBrand: unique symbol;

/**
 * Zero-based PDF page index. The first physical PDF page is index 0.
 * This is not a PDF page label or a human-facing one-based page number.
 */
export type PageIndex = number & {
  readonly [pageIndexBrand]: true;
};

/** Validate an untrusted number before using it as a page index. */
export function toPageIndex(value: number): PageIndex {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("PageIndex must be a non-negative safe integer (zero-based).");
  }

  return value as PageIndex;
}

/** Convert an index to the ordinary one-based ordinal shown in simple UIs. */
export function toDisplayPageNumber(index: PageIndex): number {
  return index + 1;
}
