import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createReaderDataBundle,
  parseReaderDataBundle,
} from "../../packages/platform-adapters/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function records() {
  const document = {
    id: "document-1",
    metadata: {
      title: "A local PDF",
      authors: ["Shelf Reader"],
      language: "en",
      pageCount: 4,
      pdfTitle: null,
      pdfSubject: null,
    },
    source: {
      kind: "imported-copy",
      displayName: "reader.pdf",
      mediaType: "application/pdf",
      sizeBytes: 1024,
      modifiedAt: null,
    },
    fingerprint: "sha256-chain-v1:test",
    createdAt: 100,
    updatedAt: 200,
    accessLocator: { value: "/private/user/path.pdf" },
    credentials: { apiKey: "must-not-export" },
  };
  const readingProgress = [{
    documentId: document.id,
    pageIndex: 2,
    scrollOffset: 0.25,
    zoom: 1.5,
    readingMode: "continuous",
    updatedAt: 300,
  }];
  const bookmarks = [{
    id: "bookmark-1",
    documentId: document.id,
    pageIndex: 2,
    label: "Important",
    anchor: null,
    createdAt: 301,
  }];
  const annotations = [{
    id: "annotation-1",
    documentId: document.id,
    pageIndex: 2,
    kind: "highlight",
    color: "yellow",
    anchor: null,
    rectangles: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.05 }],
    createdAt: 302,
    updatedAt: 303,
  }];
  const quotes = [{
    id: "quote-1",
    documentId: document.id,
    pageIndex: 2,
    text: "A quoted passage",
    attribution: null,
    annotationId: null,
    anchor: null,
    tags: ["research"],
    createdAt: 304,
    updatedAt: 305,
  }];
  return { document, readingProgress, bookmarks, annotations, quotes };
}

test("Reader data bundle round-trips the portable document and saved Reader records", () => {
  const sample = records();
  const created = createReaderDataBundle({
    documents: [sample.document],
    readingProgress: sample.readingProgress,
    bookmarks: sample.bookmarks,
    annotations: sample.annotations,
    quotes: sample.quotes,
  }, 4, 400);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const restored = parseReaderDataBundle(JSON.parse(JSON.stringify(created.value)));
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.value.version, 1);
  assert.equal(restored.value.sourceSchemaVersion, 4);
  assert.equal(restored.value.exportedAt, 400);
  assert.equal(restored.value.documents.length, 1);
  assert.equal(restored.value.readingProgress[0].pageIndex, 2);
  assert.equal(restored.value.bookmarks[0].label, "Important");
  assert.equal(restored.value.annotations[0].kind, "highlight");
  assert.equal(restored.value.quotes[0].text, "A quoted passage");
});

test("Reader bundle serialization strips opaque access data and unknown secret fields", () => {
  const sample = records();
  const created = createReaderDataBundle({
    documents: [sample.document],
    readingProgress: sample.readingProgress,
    bookmarks: sample.bookmarks,
    annotations: sample.annotations,
    quotes: sample.quotes,
  }, 4, 401);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const serialized = JSON.stringify(created.value);
  assert.equal(serialized.includes("accessLocator"), false);
  assert.equal(serialized.includes("credentials"), false);
  assert.equal(serialized.includes("must-not-export"), false);
  assert.equal(serialized.includes("/private/user/path.pdf"), false);
  assert.equal(Object.hasOwn(created.value, "locators"), false);
  assert.equal(Object.hasOwn(created.value.documents[0], "accessLocator"), false);
});

test("Reader bundle parser rejects unsupported versions, duplicate IDs, and orphan records", () => {
  const sample = records();
  const base = {
    format: "shelf-reader-data",
    version: 1,
    sourceSchemaVersion: 4,
    exportedAt: 500,
    documents: [sample.document],
    readingProgress: sample.readingProgress,
    bookmarks: sample.bookmarks,
    annotations: sample.annotations,
    quotes: sample.quotes,
  };
  assert.equal(parseReaderDataBundle({ ...base, version: 99 }).ok, false);
  assert.equal(parseReaderDataBundle({
    ...base,
    documents: [sample.document, sample.document],
  }).ok, false);
  assert.equal(parseReaderDataBundle({
    ...base,
    bookmarks: [{ ...sample.bookmarks[0], documentId: "missing-document" }],
  }).ok, false);
});

test("Reader bundle parser rejects invalid progress and page geometry before restore", () => {
  const sample = records();
  const base = {
    format: "shelf-reader-data",
    version: 1,
    sourceSchemaVersion: 4,
    exportedAt: 501,
    documents: [sample.document],
    readingProgress: sample.readingProgress,
    bookmarks: sample.bookmarks,
    annotations: sample.annotations,
    quotes: sample.quotes,
  };
  assert.equal(parseReaderDataBundle({
    ...base,
    readingProgress: [{ ...sample.readingProgress[0], scrollOffset: 2 }],
  }).ok, false);
  assert.equal(parseReaderDataBundle({
    ...base,
    annotations: [{
      ...sample.annotations[0],
      rectangles: [{ x: 0.9, y: 0.2, width: 0.5, height: 0.1 }],
    }],
  }).ok, false);
});

test("IndexedDB version 4 adds indexes without dropping the version 3 Reader stores", async () => {
  const source = await readFile(
    path.join(root, "packages/platform-adapters/src/browser/indexeddb-store.ts"),
    "utf8",
  );
  assert.equal(source.includes("const DATABASE_VERSION = 4;"), true);
  assert.equal(source.includes('factory.open(this.#databaseName, DATABASE_VERSION)'), true);
  for (const store of [
    "documents", "locators", "copies", "references", "readingProgress",
    "bookmarks", "annotations", "quotes",
  ]) assert.equal(source.includes('"'+store+'"'), true, "missing retained store: "+store);
  assert.equal(source.includes('store.createIndex("updatedAt", "updatedAt"'), true);
  assert.equal(source.includes("async restoreReaderData(input: unknown)"), true);
  assert.equal(source.includes('database.transaction(names, "readwrite")'), true);
});
