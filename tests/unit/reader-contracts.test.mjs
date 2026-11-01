import assert from "node:assert/strict";
import test from "node:test";
import {
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
  }
});
