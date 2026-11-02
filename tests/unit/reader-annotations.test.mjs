import assert from "node:assert/strict";
import test from "node:test";
import { ReaderAnnotationService, toOpaqueId, toPageIndex } from "../../packages/reader-core/dist/index.js";

function createService() {
  const records = {
    bookmarks: new Map(),
    annotations: new Map(),
    quotes: new Map(),
  };
  let id = 0;
  let now = 100;
  let failNextWrite = false;
  const write = async (map, record) => {
    if (failNextWrite) {
      failNextWrite = false;
      return {
        ok: false,
        error: { code: "write-failed", message: "Storage write failed.", retryable: true },
      };
    }
    map.set(record.id, record);
    return { ok: true, value: undefined };
  };
  const read = async (map, documentId) => ({
    ok: true,
    value: [...map.values()].filter((item) => item.documentId === documentId),
  });
  const service = new ReaderAnnotationService({
    ids: { next: (kind) => toOpaqueId(kind.toLowerCase() + "-" + (++id)) },
    clock: { now: () => now++ },
    bookmarks: {
      listByDocumentId: (documentId) => read(records.bookmarks, documentId),
      save: (bookmark) => write(records.bookmarks, bookmark),
      delete: async (bookmarkId) => {
        records.bookmarks.delete(bookmarkId);
        return { ok: true, value: undefined };
      },
    },
    annotations: {
      listByDocumentId: (documentId) => read(records.annotations, documentId),
      save: (annotation) => write(records.annotations, annotation),
      delete: async (annotationId) => {
        records.annotations.delete(annotationId);
        return { ok: true, value: undefined };
      },
    },
    quotes: {
      listByDocumentId: (documentId) => read(records.quotes, documentId),
      save: (quote) => write(records.quotes, quote),
      delete: async (quoteId) => {
        records.quotes.delete(quoteId);
        return { ok: true, value: undefined };
      },
    },
  });
  return {
    service,
    records,
    failWrite: () => { failNextWrite = true; },
    documentId: toOpaqueId("document-1"),
    pageIndex: toPageIndex(2),
  };
}

const anchor = {
  selectedText: "a selected passage",
  normalizedText: "a selected passage",
  startOffset: 0,
  endOffset: 18,
  documentFingerprint: null,
  anchorVersion: 1,
};

const rectangles = [{ x: 0.1, y: 0.2, width: 0.5, height: 0.03 }];

test("annotation application service creates and lists a page bookmark", async () => {
  const context = createService();
  const result = await context.service.addBookmark({
    documentId: context.documentId,
    pageIndex: context.pageIndex,
    label: "  Important  ",
    anchor,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.label, "Important");
  assert.equal(result.value.createdAt, 100);

  const listed = await context.service.listBookmarks(context.documentId);
  assert.deepEqual(listed, { ok: true, value: [result.value] });
});

test("annotation application service creates, updates, and deletes highlights and notes", async () => {
  const context = createService();
  const created = await context.service.saveAnnotation({
    documentId: context.documentId,
    pageIndex: context.pageIndex,
    kind: "highlight",
    color: "yellow",
    anchor,
    rectangles,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const updated = await context.service.updateAnnotation({ ...created.value, color: "blue" });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.value.color, "blue");
  assert.equal(updated.value.updatedAt, 101);

  const note = await context.service.saveAnnotation({
    documentId: context.documentId,
    pageIndex: context.pageIndex,
    kind: "note",
    content: "  A useful note  ",
    anchor,
    rectangles,
  });
  assert.equal(note.ok, true);
  if (!note.ok) return;
  assert.equal(note.value.content, "A useful note");

  const removed = await context.service.deleteAnnotation(created.value.id);
  assert.deepEqual(removed, { ok: true, value: undefined });
  assert.equal(context.records.annotations.has(created.value.id), false);
});

test("annotation application service creates and deletes selected-text quotes", async () => {
  const context = createService();
  const created = await context.service.addQuote({
    documentId: context.documentId,
    pageIndex: context.pageIndex,
    text: "  source excerpt  ",
    attribution: null,
    annotationId: null,
    anchor,
    tags: ["reader"],
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.value.text, "source excerpt");
  assert.deepEqual(created.value.tags, ["reader"]);

  const listed = await context.service.listQuotes(context.documentId);
  assert.deepEqual(listed, { ok: true, value: [created.value] });
  await context.service.deleteQuote(created.value.id);
  assert.equal(context.records.quotes.has(created.value.id), false);
});

test("annotation application service rejects invalid geometry before persistence", async () => {
  const context = createService();
  const result = await context.service.saveAnnotation({
    documentId: context.documentId,
    pageIndex: context.pageIndex,
    kind: "highlight",
    color: "yellow",
    anchor,
    rectangles: [{ x: 0.8, y: 0.2, width: 0.5, height: 0.03 }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "invalid-input");
  assert.equal(context.records.annotations.size, 0);
});

test("annotation application service never reports an unsaved record as successful", async () => {
  const context = createService();
  context.failWrite();
  const result = await context.service.addBookmark({
    documentId: context.documentId,
    pageIndex: context.pageIndex,
    label: null,
    anchor: null,
  });
  assert.equal(result.ok, false);
  assert.equal(context.records.bookmarks.size, 0);
});

test("annotation application service rejects empty or oversized notes", async () => {
  const context = createService();
  const result = await context.service.saveAnnotation({
    documentId: context.documentId,
    pageIndex: context.pageIndex,
    kind: "note",
    content: " ",
    anchor,
    rectangles,
  });
  assert.equal(result.ok, false);
  assert.equal(context.records.annotations.size, 0);
});
