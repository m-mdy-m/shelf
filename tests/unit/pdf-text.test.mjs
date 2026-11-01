import assert from "node:assert/strict";
import test from "node:test";
import { toPageIndex } from "../../packages/reader-core/dist/index.js";
import {
  buildPdfPageText,
  createPdfTextSelection,
  normalizePdfText,
  searchPdfDocument,
} from "../../packages/pdf-engine/dist/index.js";

function item(str, x, baseline, width, options = {}) {
  return {
    str,
    dir: options.dir ?? "ltr",
    transform: options.transform ?? [10, 0, 0, 10, x, baseline],
    width,
    height: 10,
    hasEOL: options.hasEOL ?? false,
  };
}

const viewport = {
  width: 600,
  height: 800,
  convertToViewportPoint(x, y) {
    return [x, 800 - y];
  },
};

test("PDF text extraction preserves item order, ligatures, RTL, columns, lines and page geometry", () => {
  const page = buildPdfPageText(toPageIndex(0), [
    item("of\uFB01ce", 20, 780, 28),
    item("manual", 54, 780, 38),
    item("Right column", 350, 780, 82),
    item("ستون", 300, 750, 22, { dir: "rtl" }),
    item("الف", 260, 750, 16, { dir: "rtl", hasEOL: true }),
    item("Second paragraph", 20, 710, 96),
  ], viewport);

  assert.match(page.text, /of\uFB01ce manual Right column/u);
  assert.match(page.text, /ستون الف/u);
  assert.match(page.text, /\n\nSecond paragraph/u);
  assert.match(page.normalizedText, /office manual Right column/u);
  assert.equal(page.hasSelectableText, true);
  assert.equal(page.runs[0].startOffset, 0);
  assert.ok(page.runs[0].rectangle !== null);
  assert.ok(page.runs.every((run) => run.rectangle === null || [
    run.rectangle.x,
    run.rectangle.y,
    run.rectangle.width,
    run.rectangle.height,
  ].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)));
});

test("PDF text extraction enforces per-page item and character limits", () => {
  const page = buildPdfPageText(toPageIndex(0), [
    item("one", 10, 780, 20),
    item("two", 40, 780, 20),
    item("three", 70, 780, 30),
  ], viewport, { maxItems: 2, maxCharacters: 5 });

  assert.equal(page.truncated, true);
  assert.ok(page.text.length <= 5);
  assert.equal(page.sourceItemCount, 2);
});

test("normalization uses Unicode compatibility forms without mutating exact source text", () => {
  assert.equal(normalizePdfText("  of\uFB01ce\n\n  reader  "), "office\n\nreader");
});

test("local search maps normalized ligature and whitespace matches back to exact source offsets", async () => {
  const first = buildPdfPageText(toPageIndex(0), [
    item("A of\uFB01ne", 20, 780, 38),
    item("book", 65, 780, 25),
  ], viewport);
  const second = buildPdfPageText(toPageIndex(1), [], viewport);
  const session = {
    info: { pageCount: 2 },
    async getPageText(index) {
      return { ok: true, value: index === 0 ? first : second };
    },
  };

  const result = await searchPdfDocument(session, "FINE   BOOK");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.matches.length, 1);
  const match = result.value.matches[0];
  assert.equal(match.pageIndex, 0);
  assert.equal(match.text, "\uFB01ne book");
  assert.equal(first.text.slice(match.startOffset, match.endOffset), match.text);
  assert.ok(match.rectangles.length > 0);
  assert.equal(result.value.pagesWithoutText, 0);
  assert.equal(result.value.pagesScanned, 2);
  assert.equal(result.value.truncated, false);
});

test("local search reports scanned-page and match limits and never emits remote work", async () => {
  const page = buildPdfPageText(toPageIndex(0), [
    item("shelf shelf shelf", 20, 780, 110),
  ], viewport);
  const session = {
    info: { pageCount: 3 },
    async getPageText() {
      return { ok: true, value: page };
    },
  };

  const limitedPages = await searchPdfDocument(session, "shelf", { maxPages: 1 });
  assert.equal(limitedPages.ok, true);
  if (limitedPages.ok) {
    assert.equal(limitedPages.value.pagesScanned, 1);
    assert.equal(limitedPages.value.truncated, true);
  }

  const limitedMatches = await searchPdfDocument(session, "shelf", { maxMatches: 2 });
  assert.equal(limitedMatches.ok, true);
  if (limitedMatches.ok) {
    assert.equal(limitedMatches.value.matches.length, 2);
    assert.equal(limitedMatches.value.truncated, true);
  }

  const emptyQuery = await searchPdfDocument(session, "   ");
  assert.equal(emptyQuery.ok, false);
  if (!emptyQuery.ok) assert.equal(emptyQuery.error.code, "invalid-input");
});

test("local search can be cancelled from its progress callback", async () => {
  const page = buildPdfPageText(toPageIndex(0), [item("local text", 20, 780, 60)], viewport);
  const controller = new AbortController();
  const session = {
    info: { pageCount: 10 },
    async getPageText() {
      return { ok: true, value: page };
    },
  };
  const result = await searchPdfDocument(session, "text", {
    signal: controller.signal,
    onProgress: ({ pagesScanned }) => {
      if (pagesScanned === 1) controller.abort();
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "cancelled");
});

test("selection mapping returns exact and normalized text, context, offsets and page-relative boxes", () => {
  const selection = createPdfTextSelection({
    pageIndex: toPageIndex(4),
    exactText: "of\uFB01ce\nparagraph",
    startOffset: 7,
    endOffset: 22,
    pageText: "prefix of\uFB01ce\nparagraph suffix",
    pageBounds: { left: 100, top: 200, width: 200, height: 100 },
    clientRectangles: [
      { left: 110, top: 210, right: 160, bottom: 230 },
      { left: 110, top: 235, right: 170, bottom: 255 },
      { left: 500, top: 500, right: 510, bottom: 510 },
    ],
  });

  assert.ok(selection !== null);
  assert.equal(selection.pageIndex, 4);
  assert.equal(selection.exactText, "of\uFB01ce\nparagraph");
  assert.equal(selection.normalizedText, "office paragraph");
  assert.equal(selection.anchor.offsetBasis, "pdfjs-text-layer-dom");
  assert.equal(selection.anchor.startOffset, 7);
  assert.equal(selection.anchor.endOffset, 22);
  assert.equal(selection.anchor.prefix, "prefix ");
  assert.equal(selection.anchor.suffix, " suffix");
  assert.deepEqual(selection.rectangles, [
    { x: 0.05, y: 0.1, width: 0.25, height: 0.2 },
    { x: 0.05, y: 0.35, width: 0.3, height: 0.2 },
  ]);
});

test("selection mapping rejects empty text and empty/outside geometry", () => {
  const base = {
    pageIndex: toPageIndex(0),
    exactText: " ",
    startOffset: 0,
    endOffset: 1,
    pageText: " ",
    pageBounds: { left: 0, top: 0, width: 100, height: 100 },
    clientRectangles: [{ left: 1, top: 1, right: 20, bottom: 20 }],
  };
  assert.equal(createPdfTextSelection(base), null);
  assert.equal(createPdfTextSelection({
    ...base,
    exactText: "text",
    endOffset: 4,
    pageText: "text",
    clientRectangles: [{ left: 200, top: 200, right: 210, bottom: 210 }],
  }), null);
});
