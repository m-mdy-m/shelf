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
