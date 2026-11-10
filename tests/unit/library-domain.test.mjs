import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LIBRARY_FILTERS,
  createDefaultLibraryEntry,
  deriveLibraryProgress,
  filterLibraryItems,
} from "../../packages/reader-core/dist/index.js";

function documentRecord(id, title, authors, pageCount = 12) {
  return {
    id,
    metadata: {
      title,
      authors,
      language: "en",
      pageCount,
      pdfTitle: null,
      pdfSubject: "Practical systems notes",
    },
    source: {
      kind: "imported-copy",
      displayName: title + ".pdf",
      mediaType: "application/pdf",
      sizeBytes: 4096,
      modifiedAt: null,
    },
    fingerprint: null,
    createdAt: 100,
    updatedAt: 200,
  };
}

function progress(documentId, pageIndex, updatedAt = 300) {
  return {
    documentId,
    pageIndex,
    scrollOffset: 0.2,
    zoom: 1,
    readingMode: "single-page",
    updatedAt,
  };
}

test("default book metadata is stable, local and not started", () => {
  const entry = createDefaultLibraryEntry("document-1", 123);
  assert.equal(entry.documentId, "document-1");
  assert.equal(entry.readingStatus, "not-started");
  assert.deepEqual(entry.tags, []);
  assert.equal(entry.readmeMarkdown, "");
  assert.equal(entry.lastOpenedAt, null);
  assert.equal(entry.createdAt, 123);
  assert.equal(entry.updatedAt, 123);
});

test("progress percentage is an estimate from the saved page position and real page count", () => {
  const document = documentRecord("document-1", "Operating Systems");
  const entry = { ...createDefaultLibraryEntry(document.id, 10), readingStatus: "reading" };
  const summary = deriveLibraryProgress(document, entry, progress(document.id, 4));
  assert.equal(summary.totalPages, 12);
  assert.equal(summary.currentPageNumber, 5);
  assert.equal(summary.pagesRead, 5);
  assert.equal(summary.pagesRemaining, 7);
  assert.equal(summary.completionPercent, 42);
  assert.equal(summary.state, "in-progress");
});

test("unknown page count preserves the last page position without inventing a percentage", () => {
  const document = documentRecord("document-2", "Scanned Manual", [], null);
  const entry = createDefaultLibraryEntry(document.id, 11);
  const summary = deriveLibraryProgress(document, entry, progress(document.id, 7));
  assert.equal(summary.totalPages, null);
  assert.equal(summary.currentPageNumber, 8);
  assert.equal(summary.pagesRead, 8);
  assert.equal(summary.pagesRemaining, null);
  assert.equal(summary.completionPercent, null);
  assert.equal(summary.state, "in-progress");
});

test("completed status is respected even when the PDF page count is unavailable", () => {
  const document = documentRecord("document-3", "Archived paper", [], null);
  const entry = { ...createDefaultLibraryEntry(document.id), readingStatus: "completed" };
  const summary = deriveLibraryProgress(document, entry, null);
  assert.equal(summary.state, "completed");
  assert.equal(summary.completionPercent, null);
  assert.equal(summary.pagesRemaining, null);
});

test("filter and sort combine book metadata, README content, tags and persisted progress", () => {
  const firstDocument = documentRecord("document-1", "Operating Systems", ["Ada Reader"]);
  const secondDocument = documentRecord("document-2", "Network Design", ["Grace Hopper"]);
  const firstEntry = {
    ...createDefaultLibraryEntry(firstDocument.id, 10),
    tags: ["systems", "kernel"],
    readingStatus: "reading",
    readmeMarkdown: "# Review\n\nRemember the scheduler invariants.",
    lastOpenedAt: 500,
  };
  const secondEntry = {
    ...createDefaultLibraryEntry(secondDocument.id, 11),
    tags: ["network"],
    readingStatus: "completed",
    readmeMarkdown: "# Reference",
    lastOpenedAt: 400,
  };
  const items = [
    { document: firstDocument, entry: firstEntry, progress: progress(firstDocument.id, 3) },
    { document: secondDocument, entry: secondEntry, progress: progress(secondDocument.id, 11) },
  ];

  const review = filterLibraryItems(items, {
    ...DEFAULT_LIBRARY_FILTERS,
    query: "scheduler invariants",
    tag: "kernel",
    author: "ada",
    progress: "in-progress",
    format: "complete",
  });
  assert.deepEqual(review.map((item) => item.document.id), ["document-1"]);

  const completed = filterLibraryItems(items, {
    ...DEFAULT_LIBRARY_FILTERS,
    progress: "completed",
    sort: "last-opened",
  });
  assert.deepEqual(completed.map((item) => item.document.id), ["document-2"]);

  const byAuthor = filterLibraryItems(items, {
    ...DEFAULT_LIBRARY_FILTERS,
    sort: "author",
  });
  assert.deepEqual(byAuthor.map((item) => item.document.id), ["document-1", "document-2"]);
});
