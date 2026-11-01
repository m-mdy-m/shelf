import type { ReaderError } from "./errors.js";
import type { Result } from "./result.js";

declare const pageIndexBrand: unique symbol;

/**
 * Zero-based PDF page index. The first physical PDF page is index 0.
 * This is not a PDF page label or a human-facing one-based page number.
 */
export type PageIndex = number & {
  readonly [pageIndexBrand]: true;
};

/** Parse untrusted page indexes into the declared operational error channel. */
export function parsePageIndex(value: number): Result<PageIndex, ReaderError> {
  if (!Number.isSafeInteger(value) || value < 0) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "Page index must be a non-negative safe integer (zero-based).",
        retryable: false,
      },
    };
  }

  return { ok: true, value: value as PageIndex };
}

/**
 * Trusted-input convenience constructor. Throws RangeError for invalid values;
 * use parsePageIndex when handling untrusted input inside Result-based flows.
 */
export function toPageIndex(value: number): PageIndex {
  const parsed = parsePageIndex(value);
  if (!parsed.ok) throw new RangeError(parsed.error.message);
  return parsed.value;
}

/** Convert an index to the ordinary one-based ordinal shown in simple UIs. */
export function toDisplayPageNumber(index: PageIndex): number {
  return index + 1;
}
