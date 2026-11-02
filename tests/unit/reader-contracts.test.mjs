import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DOCUMENT_READ_BYTES,
  parseByteRange,
  parseOpaqueId,
  parsePageIndex,
  toDisplayPageNumber,
  toPageIndex,
} from "../../packages/reader-core/dist/index.js";

test("PageIndex is zero-based and converts to a one-based display ordinal", () => {
  const first = toPageIndex(0);
  const tenth = toPageIndex(9);

  assert.equal(first, 0);
  assert.equal(tenth, 9);
  assert.equal(toDisplayPageNumber(first), 1);
  assert.equal(toDisplayPageNumber(tenth), 10);
});

test("PageIndex rejects negative, fractional, unsafe, and non-finite values", () => {
  for (const invalid of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => toPageIndex(invalid), RangeError);
    const parsed = parsePageIndex(invalid);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.error.code, "invalid-input");
  }
});

test("opaque identifiers reject empty values through the Result contract", () => {
  const valid = parseOpaqueId("doc-123");
  const invalid = parseOpaqueId("   ");

  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.value, "doc-123");
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, "invalid-input");
});

test("byte ranges are validated and capped at one mebibyte per read", () => {
  const valid = parseByteRange({ offset: 0, length: MAX_DOCUMENT_READ_BYTES });
  assert.equal(valid.ok, true);

  for (const range of [
    { offset: -1, length: 1 },
    { offset: 0, length: 0 },
    { offset: 0, length: -1 },
    { offset: 0, length: MAX_DOCUMENT_READ_BYTES + 1 },
    { offset: Number.MAX_SAFE_INTEGER, length: 1 },
  ]) {
    const parsed = parseByteRange(range);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.error.code, "invalid-range");
  }
});


test("text search normalizes case, Unicode ligatures, and whitespace while preserving source offsets", async () => {
  const { findTextMatches, resolveTextSelectionOffsets } = await import("../../packages/reader-core/dist/index.js");
  const page = {
    pageIndex: toPageIndex(4),
    text: "Intro\\nThe ﬁrst  READER guide ends here.\\n",
    runs: [],
    hasSelectableText: true,
    truncated: false,
  };
  const matches = findTextMatches(page, "FIRST reader", 10);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].pageIndex, 4);
  assert.equal(matches[0].matchedText, "ﬁrst  READER");
  assert.equal(page.text.slice(matches[0].startOffset, matches[0].endOffset), "ﬁrst  READER");

  const selection = resolveTextSelectionOffsets(page.text, "first READER", matches[0].startOffset);
  assert.deepEqual(selection, {
    startOffset: matches[0].startOffset,
    endOffset: matches[0].endOffset,
    confidence: "nearest-text-match",
  });
});

test("text search ignores empty queries and pages without selectable text", async () => {
  const { findTextMatches } = await import("../../packages/reader-core/dist/index.js");
  const page = {
    pageIndex: toPageIndex(0),
    text: "",
    runs: [],
    hasSelectableText: false,
    truncated: false,
  };
  assert.deepEqual(findTextMatches(page, "anything"), []);
  assert.deepEqual(findTextMatches({ ...page, text: "plain text", hasSelectableText: true }, "  "), []);
});

test("text search bounds result counts and rejects invalid limits", async () => {
  const { findTextMatches } = await import("../../packages/reader-core/dist/index.js");
  const page = {
    pageIndex: toPageIndex(1),
    text: "match match match match",
    runs: [],
    hasSelectableText: true,
    truncated: false,
  };
  assert.equal(findTextMatches(page, "match", 2).length, 2);
  assert.throws(() => findTextMatches(page, "match", 0), RangeError);
});


test("selection offset resolution finds the nearest repeated passage beyond the search result cap", async () => {
  const { resolveTextSelectionOffsets } = await import("../../packages/reader-core/dist/index.js");
  const pageText = "repeat ".repeat(1_100) + "repeat";
  const expectedStart = pageText.lastIndexOf("repeat");
  const result = resolveTextSelectionOffsets(pageText, "repeat", expectedStart + 2);

  assert.deepEqual(result, {
    startOffset: expectedStart,
    endOffset: expectedStart + "repeat".length,
    confidence: "exact",
  });
});


test("saved text anchors prefer still-valid offsets in repeated passages", async () => {
  const { resolveTextAnchor } = await import("../../packages/reader-core/dist/index.js");
  const anchor = {
    selectedText: "passage",
    normalizedText: "passage",
    startOffset: 10,
    endOffset: 17,
    documentFingerprint: null,
    anchorVersion: 1,
  };
  assert.deepEqual(resolveTextAnchor("passage / passage", anchor), {
    status: "resolved",
    startOffset: 10,
    endOffset: 17,
    confidence: "stored-offset",
  });
});

test("saved text anchors relocate only when normalized text has a unique match", async () => {
  const { resolveTextAnchor } = await import("../../packages/reader-core/dist/index.js");
  const anchor = {
    selectedText: "Selected ﬁrst passage",
    normalizedText: "selected first passage",
    startOffset: 0,
    endOffset: 8,
    documentFingerprint: null,
    anchorVersion: 1,
  };
  assert.deepEqual(resolveTextAnchor("Prefix: selected first passage.", anchor), {
    status: "resolved",
    startOffset: 8,
    endOffset: 30,
    confidence: "unique-text-match",
  });
});

test("saved text anchors refuse ambiguous moved passages", async () => {
  const { resolveTextAnchor } = await import("../../packages/reader-core/dist/index.js");
  const anchor = {
    selectedText: "passage",
    normalizedText: "passage",
    startOffset: 1,
    endOffset: 8,
    documentFingerprint: null,
    anchorVersion: 1,
  };
  assert.deepEqual(resolveTextAnchor("passage / passage", anchor), {
    status: "unresolved",
    reason: "ambiguous",
  });
});

test("saved text anchors report missing text instead of guessing", async () => {
  const { resolveTextAnchor } = await import("../../packages/reader-core/dist/index.js");
  const anchor = {
    selectedText: "original passage",
    normalizedText: "original passage",
    startOffset: 0,
    endOffset: 16,
    documentFingerprint: null,
    anchorVersion: 1,
  };
  assert.deepEqual(resolveTextAnchor("different page content", anchor), {
    status: "unresolved",
    reason: "not-found",
  });
});
