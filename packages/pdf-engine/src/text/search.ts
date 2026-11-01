import type { ReaderError, Result } from "@shelf/reader-core";
import type { PageIndex } from "@shelf/reader-core";
import type { PdfDocumentInfo } from "../adapter/pdf-document-adapter.js";
import type { PdfPageText, PdfTextRectangle, PdfTextRun } from "./page-text.js";

export interface PdfTextSession {
  readonly info: PdfDocumentInfo;
  getPageText(
    pageIndex: PageIndex,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Result<PdfPageText, ReaderError>>;
}

export interface PdfTextSearchOptions {
  readonly caseSensitive?: boolean;
  readonly startPage?: PageIndex;
  readonly maxPages?: number;
  readonly maxMatches?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: {
    readonly pagesScanned: number;
    readonly totalPages: number;
    readonly matchesFound: number;
  }) => void;
}

export interface PdfTextSearchMatch {
  readonly pageIndex: PageIndex;
  /** UTF-16 offsets into the original, unnormalized page text. */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly text: string;
  readonly contextBefore: string;
  readonly contextAfter: string;
  readonly rectangles: readonly PdfTextRectangle[];
}

export interface PdfTextSearchResult {
  readonly query: string;
  readonly matches: readonly PdfTextSearchMatch[];
  readonly pagesScanned: number;
  readonly totalPages: number;
  readonly pagesWithoutText: number;
  readonly truncated: boolean;
}

interface NormalizedSearchText {
  readonly text: string;
  readonly sourceStarts: readonly number[];
  readonly sourceEnds: readonly number[];
}

function failure(code: ReaderError["code"], message: string): ReaderError {
  return { code, message, retryable: false };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$\{\}()|[\]\\]/gu, "\\$&");
}

function normalizeForSearch(value: string): NormalizedSearchText {
  let text = "";
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];

  for (let offset = 0; offset < value.length; ) {
    const rawCodePoint = value.codePointAt(offset);
    if (rawCodePoint === undefined) break;
    const raw = String.fromCodePoint(rawCodePoint);
    const sourceEnd = offset + raw.length;
    const normalized = raw.normalize("NFKC");

    for (let index = 0; index < normalized.length; ) {
      const codePoint = normalized.codePointAt(index);
      if (codePoint === undefined) break;
      const character = String.fromCodePoint(codePoint);
      if (/\s/u.test(character)) {
        if (text.length > 0) {
          const last = text.length - 1;
          if (text[last] === " ") {
            sourceEnds[last] = sourceEnd;
          } else {
            text += " ";
            sourceStarts.push(offset);
            sourceEnds.push(sourceEnd);
          }
        }
      } else {
        text += character;
        for (let unit = 0; unit < character.length; unit += 1) {
          sourceStarts.push(offset);
          sourceEnds.push(sourceEnd);
        }
      }
      index += character.length;
    }
    offset = sourceEnd;
  }

  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    sourceStarts.pop();
    sourceEnds.pop();
  }

  return { text, sourceStarts, sourceEnds };
}

function rectanglesForRange(
  runs: readonly PdfTextRun[],
  startOffset: number,
  endOffset: number,
): readonly PdfTextRectangle[] {
  const rectangles: PdfTextRectangle[] = [];
  for (const run of runs) {
    if (run.endOffset <= startOffset || run.startOffset >= endOffset || run.rectangle === null) continue;
    const previous = rectangles[rectangles.length - 1];
    const current = run.rectangle;
    if (
      previous !== undefined &&
      Math.abs(previous.y - current.y) < Math.max(previous.height, current.height) * 0.25 &&
      current.x <= previous.x + previous.width + 0.002
    ) {
      const left = Math.min(previous.x, current.x);
      const top = Math.min(previous.y, current.y);
      const right = Math.max(previous.x + previous.width, current.x + current.width);
      const bottom = Math.max(previous.y + previous.height, current.y + current.height);
      rectangles[rectangles.length - 1] = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      };
    } else {
      rectangles.push(current);
    }
    if (rectangles.length >= 64) break;
  }
  return rectangles;
}

function cancelled(): Result<never, ReaderError> {
  return { ok: false, error: failure("cancelled", "PDF text search was cancelled.") };
}

/** Search extracted local page text only; no document content leaves the device. */
export async function searchPdfDocument(
  session: PdfTextSession,
  rawQuery: string,
  options: PdfTextSearchOptions = {},
): Promise<Result<PdfTextSearchResult, ReaderError>> {
  const query = normalizeForSearch(rawQuery).text;
  if (query.length === 0 || rawQuery.length > 256) {
    return {
      ok: false,
      error: failure("invalid-input", "Enter a search term between 1 and 256 characters."),
    };
  }

  const pageCount = session.info.pageCount;
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    return { ok: false, error: failure("invalid-document", "This PDF has no searchable pages.") };
  }

  const requestedStart = options.startPage as number | undefined;
  const startPage = requestedStart === undefined ? 0 : requestedStart;
  if (!Number.isSafeInteger(startPage) || startPage < 0 || startPage >= pageCount) {
    return { ok: false, error: failure("invalid-input", "The search start page is outside this document.") };
  }

  const maxPages = options.maxPages ?? 5_000;
  const maxMatches = options.maxMatches ?? 500;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 ||
      !Number.isSafeInteger(maxMatches) || maxMatches < 1 || maxMatches > 5_000) {
    return {
      ok: false,
      error: failure("invalid-input", "Search page and result limits are invalid."),
    };
  }

  const pageLimit = Math.min(pageCount, maxPages);
  const matches: PdfTextSearchMatch[] = [];
  let pagesScanned = 0;
  let pagesWithoutText = 0;
  let truncated = pageLimit < pageCount;
  const expression = new RegExp(
    escapeRegExp(query),
    options.caseSensitive === true ? "gu" : "giu",
  );

  for (let offset = 0; offset < pageLimit; offset += 1) {
    if (options.signal?.aborted === true) return cancelled();
    const pageIndex = ((startPage + offset) % pageCount) as PageIndex;
    const page = await session.getPageText(pageIndex, { signal: options.signal });
    if (!page.ok) {
      if (page.error.code === "cancelled" || options.signal?.aborted === true) return cancelled();
      return { ok: false, error: page.error };
    }
    pagesScanned += 1;

    if (!page.value.hasSelectableText) {
      pagesWithoutText += 1;
    } else {
      const normalized = normalizeForSearch(page.value.text);
      expression.lastIndex = 0;
      for (const match of normalized.text.matchAll(expression)) {
        const normalizedStart = match.index;
        if (normalizedStart === undefined || match[0].length === 0) continue;
        const normalizedEnd = normalizedStart + match[0].length;
        const start = normalized.sourceStarts[normalizedStart];
        const end = normalized.sourceEnds[normalizedEnd - 1];
        if (start === undefined || end === undefined || end <= start) continue;

        matches.push({
          pageIndex,
          startOffset: start,
          endOffset: end,
          text: page.value.text.slice(start, end),
          contextBefore: page.value.text.slice(Math.max(0, start - 48), start),
          contextAfter: page.value.text.slice(end, end + 64),
          rectangles: rectanglesForRange(page.value.runs, start, end),
        });
        if (matches.length >= maxMatches) {
          truncated = true;
          break;
        }
      }
    }

    try {
      options.onProgress?.({
        pagesScanned,
        totalPages: pageCount,
        matchesFound: matches.length,
      });
    } catch {
      // Progress reporting must not break a local search operation.
    }

    if (matches.length >= maxMatches) break;
    if (pagesScanned % 2 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  if (options.signal?.aborted === true) return cancelled();
  return {
    ok: true,
    value: {
      query: rawQuery.trim(),
      matches,
      pagesScanned,
      totalPages: pageCount,
      pagesWithoutText,
      truncated,
    },
  };
}
