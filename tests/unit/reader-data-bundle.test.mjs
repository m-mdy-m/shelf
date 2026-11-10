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
  const libraryEntries = [{
    documentId: document.id,
    titleOverride: "Local title",
    authorsOverride: ["Ada Reader"],
    summaryOverride: "A short private summary.",
    tags: ["systems", "research"],
    readingStatus: "reading",
    readmeMarkdown: "# Reading notes\\n\\nDo not upload this book.",
    lastOpenedAt: 306,
    createdAt: 307,
    updatedAt: 308,
  }];
  const savedLibraryViews = [{
    id: "view-reading",
    name: "Currently reading",
    filters: {
      query: "",
      status: "reading",
      author: "",
      tag: "all",
      progress: "in-progress",
      format: "all",
      sort: "last-opened",
    },
    createdAt: 309,
    updatedAt: 310,
  }];
  return { document, readingProgress, bookmarks, annotations, quotes, libraryEntries, savedLibraryViews };
}

test("Reader data bundle round-trips the portable document and saved Reader records", () => {
  const sample = records();
  const created = createReaderDataBundle({
    documents: [sample.document],
    readingProgress: sample.readingProgress,
    bookmarks: sample.bookmarks,
    annotations: sample.annotations,
    quotes: sample.quotes,
    libraryEntries: sample.libraryEntries,
    savedLibraryViews: sample.savedLibraryViews,
  }, 5, 400);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const restored = parseReaderDataBundle(JSON.parse(JSON.stringify(created.value)));
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.value.version, 2);
  assert.equal(restored.value.sourceSchemaVersion, 5);
  assert.equal(restored.value.exportedAt, 400);
  assert.equal(restored.value.documents.length, 1);
  assert.equal(restored.value.readingProgress[0].pageIndex, 2);
  assert.equal(restored.value.bookmarks[0].label, "Important");
  assert.equal(restored.value.annotations[0].kind, "highlight");
  assert.equal(restored.value.quotes[0].text, "A quoted passage");
  assert.equal(restored.value.libraryEntries[0].titleOverride, "Local title");
  assert.equal(restored.value.libraryEntries[0].readmeMarkdown.includes("Reading notes"), true);
  assert.equal(restored.value.savedLibraryViews[0].name, "Currently reading");
  assert.equal(restored.value.savedLibraryViews[0].filters.sort, "last-opened");
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
  assert.equal(created.value.libraryEntries.length, 0);
  assert.equal(created.value.savedLibraryViews.length, 0);
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

test("legacy v1 backups migrate to v2 with empty library metadata", () => {
  const sample = records();
  const legacy = {
    format: "shelf-reader-data",
    version: 1,
    sourceSchemaVersion: 4,
    exportedAt: 600,
    documents: [sample.document],
    readingProgress: sample.readingProgress,
    bookmarks: sample.bookmarks,
    annotations: sample.annotations,
    quotes: sample.quotes,
  };
  const migrated = parseReaderDataBundle(legacy);
  assert.equal(migrated.ok, true);
  if (!migrated.ok) return;
  assert.equal(migrated.value.version, 2);
  assert.deepEqual(migrated.value.libraryEntries, []);
  assert.deepEqual(migrated.value.savedLibraryViews, []);
});

test("Reader backup parser rejects duplicate/orphan library records and unsafe metadata", () => {
  const sample = records();
  const base = {
    format: "shelf-reader-data",
    version: 2,
    sourceSchemaVersion: 5,
    exportedAt: 601,
    documents: [sample.document],
    readingProgress: sample.readingProgress,
    bookmarks: sample.bookmarks,
    annotations: sample.annotations,
    quotes: sample.quotes,
    libraryEntries: sample.libraryEntries,
    savedLibraryViews: sample.savedLibraryViews,
  };
  assert.equal(parseReaderDataBundle({
    ...base,
    libraryEntries: [sample.libraryEntries[0], sample.libraryEntries[0]],
  }).ok, false);
  assert.equal(parseReaderDataBundle({
    ...base,
    libraryEntries: [{ ...sample.libraryEntries[0], documentId: "missing-document" }],
  }).ok, false);
  assert.equal(parseReaderDataBundle({
    ...base,
    libraryEntries: [{ ...sample.libraryEntries[0], readmeMarkdown: "x".repeat(262_145) }],
  }).ok, false);
  assert.equal(parseReaderDataBundle({
    ...base,
    savedLibraryViews: [{ ...sample.savedLibraryViews[0], filters: { ...sample.savedLibraryViews[0].filters, sort: "arbitrary" } }],
  }).ok, false);
});

test("IndexedDB version 5 adds library stores without dropping Reader or source stores", async () => {
  const source = await readFile(
    path.join(root, "packages/platform-adapters/src/browser/indexeddb-store.ts"),
    "utf8",
  );
  assert.equal(source.includes("const DATABASE_VERSION = 5;"), true);
  assert.equal(source.includes('factory.open(this.#databaseName, DATABASE_VERSION)'), true);
  for (const store of [
    "documents", "locators", "copies", "references", "readingProgress",
    "bookmarks", "annotations", "quotes", "libraryEntries", "libraryViews",
  ]) assert.equal(source.includes('"'+store+'"'), true, "missing retained store: "+store);
  assert.equal(source.includes('store.createIndex("readingStatus", "readingStatus"'), true);
  assert.equal(source.includes('store.createIndex("updatedAt", "updatedAt"'), true);
  assert.equal(source.includes("async restoreReaderData(input: unknown)"), true);
  assert.equal(source.includes('database.transaction(names, "readwrite")'), true);
});
