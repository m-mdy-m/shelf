import type { PageRect, TextAnchor } from "./annotation.js";
import type { DocumentFingerprint, DocumentId } from "./ids.js";
import type { PageIndex } from "./page-index.js";

export type TextDirection = "ltr" | "rtl" | "ttb";

export interface ExtractedTextRun {
  readonly text: string;
  /** UTF-16 offsets into ExtractedPageText.text, end-exclusive. */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly direction: TextDirection;
  readonly fontName: string | null;
  readonly rectangles: readonly PageRect[];
}

export interface ExtractedPageText {
  readonly pageIndex: PageIndex;
  /** Normalized page text used by search and text anchors. */
  readonly text: string;
  readonly runs: readonly ExtractedTextRun[];
  readonly hasSelectableText: boolean;
  /** True when the bounded PDF text stream ended before the full page could be extracted. */
  readonly truncated: boolean;
}

export interface TextSearchMatch {
  readonly pageIndex: PageIndex;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly matchedText: string;
  readonly snippet: string;
}

export interface TextSelection extends TextAnchor {
  readonly documentId: DocumentId;
  readonly pageIndex: PageIndex;
  readonly rectangles: readonly PageRect[];
  readonly offsetConfidence: "exact" | "nearest-text-match";
}

interface NormalizedText {
  readonly value: string;
  readonly sourceStarts: readonly number[];
  readonly sourceEnds: readonly number[];
}

function normalizeWithOffsets(source: string): NormalizedText {
  let value = "";
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];
  let pendingWhitespaceStart: number | null = null;
  let pendingWhitespaceEnd = 0;

  for (let offset = 0; offset < source.length;) {
    const codePoint = source.codePointAt(offset);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    const end = offset + character.length;
    const normalized = character.normalize("NFKC").toLowerCase();

    if (/^\s+$/u.test(normalized)) {
      if (value.length > 0) {
        if (pendingWhitespaceStart === null) pendingWhitespaceStart = offset;
        pendingWhitespaceEnd = end;
      }
    } else {
      if (pendingWhitespaceStart !== null) {
        value += " ";
        sourceStarts.push(pendingWhitespaceStart);
        sourceEnds.push(pendingWhitespaceEnd);
        pendingWhitespaceStart = null;
        pendingWhitespaceEnd = 0;
      }
      for (let index = 0; index < normalized.length; index += 1) {
        value += normalized[index];
        sourceStarts.push(offset);
        sourceEnds.push(end);
      }
    }
    offset = end;
  }

  return { value, sourceStarts, sourceEnds };
}

function normalizedQuery(query: string): string {
  return normalizeWithOffsets(query).value.trim();
}

/** Find case/compatibility-insensitive matches while returning offsets in the original page text. */
export function findTextMatches(
  page: ExtractedPageText,
  query: string,
  maxMatches = 100,
): readonly TextSearchMatch[] {
  if (!Number.isSafeInteger(maxMatches) || maxMatches < 1 || maxMatches > 1_000) {
    throw new RangeError("Maximum text search matches must be between 1 and 1000.");
  }

  const needle = normalizedQuery(query);
  if (needle.length === 0 || !page.hasSelectableText) return [];

  const normalized = normalizeWithOffsets(page.text);
  const matches: TextSearchMatch[] = [];
  let searchFrom = 0;

  while (searchFrom <= normalized.value.length - needle.length && matches.length < maxMatches) {
    const found = normalized.value.indexOf(needle, searchFrom);
    if (found < 0) break;

    const finalIndex = found + needle.length - 1;
    const startOffset = normalized.sourceStarts[found];
    const lastSourceEnd = normalized.sourceEnds[finalIndex];
    if (startOffset !== undefined && lastSourceEnd !== undefined && lastSourceEnd > startOffset) {
      const endOffset = lastSourceEnd;
      const contextStart = Math.max(0, startOffset - 48);
      const contextEnd = Math.min(page.text.length, endOffset + 64);
      matches.push({
        pageIndex: page.pageIndex,
        startOffset,
        endOffset,
        matchedText: page.text.slice(startOffset, endOffset),
        snippet: page.text.slice(contextStart, contextEnd).replace(/\s+/gu, " ").trim(),
      });
    }
    searchFrom = found + Math.max(1, needle.length);
  }

  return matches;
}

/** Resolve browser-selected text to the closest occurrence in the extracted page representation. */
export function resolveTextSelectionOffsets(
  pageText: string,
  selectedText: string,
  approximateStart: number,
): {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly confidence: TextSelection["offsetConfidence"];
} | null {
  const selectedNormalized = normalizedQuery(selectedText);
  if (selectedNormalized.length === 0 || pageText.length === 0) return null;

  const normalized = normalizeWithOffsets(pageText);
  const preferredStart = Number.isFinite(approximateStart)
    ? Math.max(0, Math.min(pageText.length, approximateStart))
    : 0;
  let searchFrom = 0;
  let closestStart = -1;
  let closestEnd = -1;
  let closestDistance = Number.POSITIVE_INFINITY;

  while (searchFrom <= normalized.value.length - selectedNormalized.length) {
    const found = normalized.value.indexOf(selectedNormalized, searchFrom);
    if (found < 0) break;

    const finalIndex = found + selectedNormalized.length - 1;
    const sourceStart = normalized.sourceStarts[found];
    const sourceEnd = normalized.sourceEnds[finalIndex];
    if (sourceStart !== undefined && sourceEnd !== undefined && sourceEnd > sourceStart) {
      const distance = Math.abs(sourceStart - preferredStart);
      if (distance < closestDistance) {
        closestStart = sourceStart;
        closestEnd = sourceEnd;
        closestDistance = distance;
        if (distance === 0) break;
      }
    }
    searchFrom = found + 1;
  }

  if (closestStart < 0 || closestEnd <= closestStart) return null;
  const exact = pageText.slice(closestStart, closestEnd) === selectedText;
  return {
    startOffset: closestStart,
    endOffset: closestEnd,
    confidence: exact ? "exact" : "nearest-text-match",
  };
}


export type TextAnchorResolution =
  | {
      readonly status: "resolved";
      readonly startOffset: number;
      readonly endOffset: number;
      readonly confidence: "stored-offset" | "unique-text-match";
    }
  | {
      readonly status: "unresolved";
      readonly reason: "not-found" | "ambiguous";
    };

/** Resolve a persisted anchor without guessing between repeated passages. */
export function resolveTextAnchor(pageText: string, anchor: TextAnchor): TextAnchorResolution {
  const needle = normalizedQuery(
    anchor.normalizedText.length > 0 ? anchor.normalizedText : anchor.selectedText,
  );
  if (needle.length === 0) return { status: "unresolved", reason: "not-found" };

  if (
    Number.isSafeInteger(anchor.startOffset) &&
    Number.isSafeInteger(anchor.endOffset) &&
    anchor.startOffset >= 0 &&
    anchor.endOffset > anchor.startOffset &&
    anchor.endOffset <= pageText.length &&
    normalizedQuery(pageText.slice(anchor.startOffset, anchor.endOffset)) === needle
  ) {
    return {
      status: "resolved",
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      confidence: "stored-offset",
    };
  }

  const normalized = normalizeWithOffsets(pageText);
  let searchFrom = 0;
  let onlyMatch: { readonly startOffset: number; readonly endOffset: number } | null = null;

  while (searchFrom <= normalized.value.length - needle.length) {
    const found = normalized.value.indexOf(needle, searchFrom);
    if (found < 0) break;
    const finalIndex = found + needle.length - 1;
    const startOffset = normalized.sourceStarts[found];
    const endOffset = normalized.sourceEnds[finalIndex];
    if (startOffset !== undefined && endOffset !== undefined && endOffset > startOffset) {
      if (onlyMatch !== null) return { status: "unresolved", reason: "ambiguous" };
      onlyMatch = { startOffset, endOffset };
    }
    searchFrom = found + 1;
  }

  if (onlyMatch === null) return { status: "unresolved", reason: "not-found" };
  return { status: "resolved", ...onlyMatch, confidence: "unique-text-match" };
}
