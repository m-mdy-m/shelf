import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findTextMatches,
  resolveTextAnchor,
  ReaderAnnotationService,
  toOpaqueId,
  toPageIndex,
} from "../../packages/reader-core/dist/index.js";
import { DocumentLibraryService } from "../../packages/library/dist/index.js";
import { PageVirtualizer } from "../../packages/pdf-engine/dist/index.js";
import { createPdfFixtureCorpus, validateBasicPdfStructure } from "../fixtures/pdf/create-corpus.mjs";

function createReaderHarness(bytes, fileName) {
  const documents = new Map();
  const locators = new Map();
  const readingProgress = new Map();
  const bookmarks = new Map();
  const annotations = new Map();
  const quotes = new Map();
  let sequence = 0;
  let time = 1_800_000_000_000;
  let openCount = 0;
  let closeCount = 0;

  const source = {
    async inspect() {
      return { ok: true, value: {
        mediaType: "application/pdf",
        sizeBytes: bytes.byteLength,
        modifiedAt: null,
        displayName: fileName,
      } };
    },
    async open() {
      openCount += 1;
      return { ok: true, value: {
        id: toOpaqueId("fixture-source-" + String(openCount)),
        metadata: {
          mediaType: "application/pdf",
          sizeBytes: bytes.byteLength,
          modifiedAt: null,
          displayName: fileName,
        },
      } };
    },
    async read(_handle, range) {
      if (range.offset < 0 || range.length < 0 || range.offset + range.length > bytes.length) {
        return { ok: false, error: { code: "invalid-range", message: "Out of range", retryable: false } };
      }
      return { ok: true, value: bytes.slice(range.offset, range.offset + range.length) };
    },
    async close() {
      closeCount += 1;
      return { ok: true, value: undefined };
    },
  };
  const documentRepository = {
    async getById(id) { return { ok: true, value: documents.get(String(id)) ?? null }; },
    async list() { return { ok: true, value: [...documents.values()] }; },
    async save(record) { documents.set(String(record.id), record); return { ok: true, value: undefined }; },
    async delete(id) { documents.delete(String(id)); return { ok: true, value: undefined }; },
  };
  const locatorRepository = {
    async getLocator(id) { return { ok: true, value: locators.get(String(id)) ?? null }; },
    async saveLocator(id, locator) { locators.set(String(id), locator); return { ok: true, value: undefined }; },
    async deleteLocator(id) { locators.delete(String(id)); return { ok: true, value: undefined }; },
  };
  const progressRepository = {
    async getByDocumentId(id) {
      return { ok: true, value: readingProgress.get(String(id)) ?? null };
    },
    async save(record) {
      readingProgress.set(String(record.documentId), record);
      return { ok: true, value: undefined };
    },
    async deleteByDocumentId(id) {
      readingProgress.delete(String(id));
      return { ok: true, value: undefined };
    },
  };
  const ids = {
    next(kind) {
      sequence += 1;
      return toOpaqueId(kind.toLowerCase() + "-" + String(sequence));
    },
  };
  const clock = { now: () => time++ };
  const digest = {
    async digest(input) {
      return { ok: true, value: new Uint8Array(createHash("sha256").update(input).digest()) };
    },
  };
  const permissions = {
    async query() { return { ok: true, value: "granted" }; },
    async request() { return { ok: true, value: "granted" }; },
  };
  const library = new DocumentLibraryService({
    documents: documentRepository,
    locators: locatorRepository,
    source,
    permissions,
    ids,
    clock,
    digest,
  });

  function createAnnotationUseCases() {
    return new ReaderAnnotationService({
      ids,
      clock,
      bookmarks: {
        listByDocumentId: async (id) => ({
          ok: true,
          value: [...bookmarks.values()].filter((item) => item.documentId === id),
        }),
        save: async (record) => {
          bookmarks.set(String(record.id), record);
          return { ok: true, value: undefined };
        },
        delete: async (id) => {
          bookmarks.delete(String(id));
          return { ok: true, value: undefined };
        },
      },
      annotations: {
        listByDocumentId: async (id) => ({
          ok: true,
          value: [...annotations.values()].filter((item) => item.documentId === id),
        }),
        save: async (record) => {
          annotations.set(String(record.id), record);
          return { ok: true, value: undefined };
        },
        delete: async (id) => {
          annotations.delete(String(id));
          return { ok: true, value: undefined };
        },
      },
      quotes: {
        listByDocumentId: async (id) => ({
          ok: true,
          value: [...quotes.values()].filter((item) => item.documentId === id),
        }),
        save: async (record) => {
          quotes.set(String(record.id), record);
          return { ok: true, value: undefined };
        },
        delete: async (id) => {
          quotes.delete(String(id));
          return { ok: true, value: undefined };
        },
      },
    });
  }

  return {
    library,
    source,
    progressRepository,
    readingProgress,
    createAnnotationUseCases,
    documents,
    locators,
    bookmarks,
    annotations,
    quotes,
    counts: () => ({ openCount, closeCount }),
  };
}

test("redistributable PDF corpus contains valid mixed-size, rotated, columns, large, and image-only PDFs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shelf-pdf-corpus-"));
  try {
    const fixtures = createPdfFixtureCorpus();
    for (const [name, bytes] of fixtures) {
      await writeFile(path.join(directory, name), bytes);
    }
    const mixed = await readFile(path.join(directory, "mixed-page-sizes.pdf"));
    const rotated = await readFile(path.join(directory, "rotated-page.pdf"));
    const columns = await readFile(path.join(directory, "two-columns.pdf"));
    const large = await readFile(path.join(directory, "large-250-pages.pdf"));
    const imageOnly = await readFile(path.join(directory, "image-only.pdf"));
    const encrypted = await readFile(path.join(directory, "password-protected.pdf"));
    const malformed = await readFile(path.join(directory, "malformed-truncated.pdf"));

    for (const sample of [mixed, rotated, columns, large, imageOnly, encrypted]) {
      assert.equal(validateBasicPdfStructure(sample), true);
    }
    assert.equal(validateBasicPdfStructure(malformed), false);
    assert.ok(large.byteLength > mixed.byteLength);\n    assert.equal(large.toString("ascii").includes("/Count 250"), true);
    assert.equal(encrypted.toString("ascii").includes("/Encrypt"), true);
    assert.equal(fixtures.size, 8);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Reader flow imports, searches, annotates, closes, restarts, and resumes without cloud services", async () => {
  const fixture = createPdfFixtureCorpus().get("mixed-page-sizes.pdf");
  assert.ok(fixture instanceof Buffer);
  const harness = createReaderHarness(fixture, "mixed-page-sizes.pdf");

  const imported = await harness.library.importDocument({
    locator: {
      kind: "opaque",
      providerId: "fixture-local-copy",
      value: "local-pdf-copy",
      persistence: "reopenable",
    },
    sourceKind: "imported-copy",
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  const documentId = imported.value.document.id;

  const opened = await harness.library.openDocument(documentId);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;

  const extractedText = "Introduction\nA searchable passage to annotate in Shelf.";
  const page = {
    pageIndex: toPageIndex(0),
    text: extractedText,
    runs: [],
    hasSelectableText: true,
    truncated: false,
  };
  const matches = findTextMatches(page, "searchable passage", 10);
  assert.equal(matches.length, 1);
  const match = matches[0];
  assert.ok(match);
  const anchor = {
    selectedText: match.matchedText,
    normalizedText: match.matchedText.toLowerCase(),
    startOffset: match.startOffset,
    endOffset: match.endOffset,
    documentFingerprint: imported.value.document.fingerprint,
    anchorVersion: 1,
  };
  assert.equal(resolveTextAnchor(extractedText, anchor).status, "resolved");

  const annotations = harness.createAnnotationUseCases();
  const bookmark = await annotations.addBookmark({
    documentId,
    pageIndex: toPageIndex(0),
    label: "Resume here",
    anchor,
  });
  assert.equal(bookmark.ok, true);
  const highlight = await annotations.saveAnnotation({
    documentId,
    pageIndex: toPageIndex(0),
    kind: "highlight",
    color: "yellow",
    anchor,
    rectangles: [{ x: 0.12, y: 0.22, width: 0.52, height: 0.04 }],
  });
  assert.equal(highlight.ok, true);
  const note = await annotations.saveAnnotation({
    documentId,
    pageIndex: toPageIndex(0),
    kind: "note",
    content: "Review this passage",
    anchor,
    rectangles: [{ x: 0.12, y: 0.22, width: 0.52, height: 0.04 }],
  });
  assert.equal(note.ok, true);
  const quote = await annotations.addQuote({
    documentId,
    pageIndex: toPageIndex(0),
    text: match.matchedText,
    attribution: null,
    annotationId: highlight.ok ? highlight.value.id : null,
    anchor,
    tags: ["e2e", "reader"],
  });
  assert.equal(quote.ok, true);

  const savedProgress = await harness.progressRepository.save({
    documentId,
    pageIndex: toPageIndex(0),
    scrollOffset: 0.35,
    zoom: 1.25,
    readingMode: "continuous",
    updatedAt: Date.now(),
  });
  assert.equal(savedProgress.ok, true);
  const closed = await harness.library.closeDocument(opened.value.source);
  assert.equal(closed.ok, true);

  // A fresh application service instance simulates a clean restart while the
  // same local database remains available.
  const afterRestart = new DocumentLibraryService({
    documents: {
      getById: async (id) => ({ ok: true, value: harness.documents.get(String(id)) ?? null }),
      list: async () => ({ ok: true, value: [...harness.documents.values()] }),
      save: async (record) => {
        harness.documents.set(String(record.id), record);
        return { ok: true, value: undefined };
      },
      delete: async (id) => {
        harness.documents.delete(String(id));
        return { ok: true, value: undefined };
      },
    },
    locators: {
      getLocator: async (id) => ({ ok: true, value: harness.locators.get(String(id)) ?? null }),
      saveLocator: async (id, value) => {
        harness.locators.set(String(id), value);
        return { ok: true, value: undefined };
      },
      deleteLocator: async (id) => {
        harness.locators.delete(String(id));
        return { ok: true, value: undefined };
      },
    },
    source: harness.source,
    permissions: { query: async () => ({ ok: true, value: "granted" }), request: async () => ({ ok: true, value: "granted" }) },
    ids: { next: (kind) => toOpaqueId(kind.toLowerCase() + "-after-restart") },
    clock: { now: () => Date.now() },
    digest: { digest: async (input) => ({ ok: true, value: new Uint8Array(createHash("sha256").update(input).digest()) }) },
  });
  const restoredOpen = await afterRestart.openDocument(documentId);
  assert.equal(restoredOpen.ok, true);
  const restoredProgress = await harness.progressRepository.getByDocumentId(documentId);
  assert.equal(restoredProgress.ok, true);
  if (restoredProgress.ok) {
    assert.equal(restoredProgress.value?.pageIndex, 0);
    assert.equal(restoredProgress.value?.zoom, 1.25);
    assert.equal(restoredProgress.value?.scrollOffset, 0.35);
  }

  const restoredAnnotations = harness.createAnnotationUseCases();
  const restoredBookmarks = await restoredAnnotations.listBookmarks(documentId);
  const restoredHighlights = await restoredAnnotations.listAnnotations(documentId);
  const restoredQuotes = await restoredAnnotations.listQuotes(documentId);
  assert.equal(restoredBookmarks.ok, true);
  assert.equal(restoredHighlights.ok, true);
  assert.equal(restoredQuotes.ok, true);
  if (restoredBookmarks.ok) assert.equal(restoredBookmarks.value.length, 1);
  if (restoredHighlights.ok) assert.equal(restoredHighlights.value.length, 2);
  if (restoredQuotes.ok) assert.equal(restoredQuotes.value.length, 1);
  if (restoredOpen.ok) await afterRestart.closeDocument(restoredOpen.value.source);
  assert.deepEqual(harness.counts(), { openCount: 3, closeCount: 3 });
});

test("large-document viewport work stays bounded and reports a reproducible timing baseline", () => {
  const virtualizer = new PageVirtualizer(50_000, {
    estimatedPageWidth: 612,
    estimatedPageHeight: 792,
    maxMountedPages: 10,
    overscanPages: 2,
  });
  const started = performance.now();
  let maxMountedPages = 0;
  let totalMountedPages = 0;
  const iterations = 1_000;
  for (let index = 0; index < iterations; index += 1) {
    const viewport = virtualizer.getWindow({
      scrollTop: index * 39_000,
      viewportWidth: 1200,
      viewportHeight: 900,
      scale: 1,
    });
    maxMountedPages = Math.max(maxMountedPages, viewport.pages.length);
    totalMountedPages += viewport.pages.length;
  }
  const durationMs = Number((performance.now() - started).toFixed(2));
  assert.ok(maxMountedPages <= 10);
  assert.ok(totalMountedPages <= iterations * 10);
  console.log("[reader-performance-baseline] " + JSON.stringify({
    pageCount: 50_000,
    iterations,
    maxMountedPages,
    averageMountedPages: Number((totalMountedPages / iterations).toFixed(2)),
    durationMs,
  }));
});


test("generated compatibility PDFs are accepted by PDF.js and expose page geometry and text", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fixtures = createPdfFixtureCorpus();
  for (const [name, bytes] of fixtures) {
    if (name === "malformed-truncated.pdf") continue;
    const loadingTask = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
      password: name === "password-protected.pdf" ? "shelf-test" : undefined,
    });
    const document = await loadingTask.promise;
    try {
      if (name === "large-250-pages.pdf") assert.equal(document.numPages, 250);
      if (name === "mixed-page-sizes.pdf") assert.equal(document.numPages, 2);
      const firstPage = await document.getPage(1);
      if (name === "rotated-page.pdf") assert.equal(firstPage.rotate, 90);
      if (name === "image-only.pdf") {
        const extracted = await firstPage.getTextContent();
        assert.equal(extracted.items.length, 0);
      }
      if (name === "two-columns.pdf") {
        const extracted = await firstPage.getTextContent();
        const strings = extracted.items.map((item) => "str" in item ? item.str : "").join(" ");
        assert.equal(strings.includes("LEFT COLUMN A"), true);
        assert.equal(strings.includes("RIGHT COLUMN A"), true);
      }
    } finally {
      await loadingTask.destroy();
    }
  }
});

test("malformed corpus PDF is rejected by PDF.js without leaking unhandled errors", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const malformed = createPdfFixtureCorpus().get("malformed-truncated.pdf");
  assert.ok(malformed instanceof Buffer);
  const loadingTask = getDocument({
    data: new Uint8Array(malformed),
    useSystemFonts: true,
    disableFontFace: true,
  });
  await assert.rejects(loadingTask.promise);
  await loadingTask.destroy();
});
