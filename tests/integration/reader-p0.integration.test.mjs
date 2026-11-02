import assert from "node:assert/strict";
import test from "node:test";
import {
  ReaderAnnotationService,
  resolveTextAnchor,
  toOpaqueId,
  toPageIndex,
} from "../../packages/reader-core/dist/index.js";
import { groupPdfTextItemsByReadingOrder } from "../../packages/pdf-engine/dist/index.js";

function createAnnotationService(records) {
  let sequence = 0;
  let timestamp = 1000;
  const list = (map, documentId) => ({
    ok: true,
    value: [...map.values()].filter((record) => record.documentId === documentId),
  });
  const write = (map, record) => {
    map.set(record.id, record);
    return { ok: true, value: undefined };
  };
  const remove = (map, id) => {
    map.delete(id);
    return { ok: true, value: undefined };
  };
  return new ReaderAnnotationService({
    ids: { next: (kind) => toOpaqueId(kind.toLowerCase() + "-" + String(++sequence)) },
    clock: { now: () => timestamp++ },
    bookmarks: {
      listByDocumentId: (id) => list(records.bookmarks, id),
      save: (record) => write(records.bookmarks, record),
      delete: (id) => remove(records.bookmarks, id),
    },
    annotations: {
      listByDocumentId: (id) => list(records.annotations, id),
      save: (record) => write(records.annotations, record),
      delete: (id) => remove(records.annotations, id),
    },
    quotes: {
      listByDocumentId: (id) => list(records.quotes, id),
      save: (record) => write(records.quotes, record),
      delete: (id) => remove(records.quotes, id),
    },
  });
}

test("two-column selection anchors and both annotation kinds survive service recreation", async () => {
  const sourceItems = [
    { text: "Left A", left: 40, right: 110, top: 70, bottom: 82, direction: "ltr" },
    { text: "Right A", left: 360, right: 430, top: 70, bottom: 82, direction: "ltr" },
    { text: "Left B", left: 40, right: 110, top: 100, bottom: 112, direction: "ltr" },
    { text: "Right B", left: 360, right: 430, top: 100, bottom: 112, direction: "ltr" },
  ];
  const orderedLines = groupPdfTextItemsByReadingOrder(sourceItems, 612);
  const pageText = orderedLines.map((line) =>
    line.items.map((item) => item.text).join(" "),
  ).join("\n");
  assert.equal(pageText, "Left A\nLeft B\nRight A\nRight B");

  const selectedText = "Left A Left B";
  const startOffset = pageText.indexOf("Left A");
  const anchor = {
    selectedText,
    normalizedText: selectedText.normalize("NFKC").replace(/\\s+/gu, " ").trim().toLowerCase(),
    startOffset,
    endOffset: startOffset + selectedText.length,
    documentFingerprint: null,
    anchorVersion: 1,
  };
  assert.equal(resolveTextAnchor(pageText, anchor).status, "resolved");

  const documentId = toOpaqueId("two-column-document");
  const pageIndex = toPageIndex(0);
  const rectangles = [
    { x: 40 / 612, y: 70 / 792, width: 70 / 612, height: 12 / 792 },
    { x: 40 / 612, y: 100 / 792, width: 70 / 612, height: 12 / 792 },
  ];
  const records = {
    bookmarks: new Map(),
    annotations: new Map(),
    quotes: new Map(),
  };
  const firstSession = createAnnotationService(records);

  const highlight = await firstSession.saveAnnotation({
    documentId,
    pageIndex,
    kind: "highlight",
    color: "yellow",
    anchor,
    rectangles,
  });
  const note = await firstSession.saveAnnotation({
    documentId,
    pageIndex,
    kind: "note",
    content: "Remember the distinction between the two columns.",
    anchor,
    rectangles,
  });
  assert.equal(highlight.ok, true);
  assert.equal(note.ok, true);

  // Recreate the application service over the same repository state, as a
  // Reader reopen does after its UI/controller instance has been disposed.
  const reopenedSession = createAnnotationService(records);
  const restored = await reopenedSession.listAnnotations(documentId);
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.deepEqual(restored.value.map((item) => item.kind), ["highlight", "note"]);
  assert.deepEqual(restored.value[0]?.rectangles, rectangles);
  assert.equal(restored.value[1]?.content, "Remember the distinction between the two columns.");
  assert.equal(resolveTextAnchor(pageText, restored.value[0]?.anchor ?? anchor).status, "resolved");
  assert.equal(resolveTextAnchor(pageText, restored.value[1]?.anchor ?? anchor).status, "resolved");
});
