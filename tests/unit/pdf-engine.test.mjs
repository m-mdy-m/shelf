import assert from "node:assert/strict";
import test from "node:test";
import {
  PdfDocumentAdapter,
  PdfPageRenderer,
  PageVirtualizer,
  createPdfPageLayers,
  createPdfJsRuntime,
} from "../../packages/pdf-engine/dist/index.js";
import { MAX_DOCUMENT_READ_BYTES, toPageIndex } from "../../packages/reader-core/dist/index.js";
import {
  buildMalformedPdfFixture,
  buildMixedPagePdfFixture,
} from "../fixtures/pdf/fixture-builder.mjs";

const documentId = "doc-fixture";

function namedError(name, message = "fixture error") {
  const error = new Error(message);
  error.name = name;
  return error;
}

function createFakePage({ width = 612, height = 792, rotate = 0, renderCalls = [] } = {}) {
  return {
    rotate,
    getViewport({ scale }) {
      const swaps = rotate === 90 || rotate === 270;
      return {
        width: (swaps ? height : width) * scale,
        height: (swaps ? width : height) * scale,
        rotation: rotate,
        scale,
      };
    },
    render(options) {
      renderCalls.push(options);
      return { promise: Promise.resolve(), cancel() {} };
    },
    streamTextContent() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({ items: [], styles: {} });
          controller.close();
        },
      });
    },
  };
}

function createFakeEnvironment(options = {}) {
  const reads = [];
  const deliveredRanges = [];
  const pageRequests = [];
  const renderCalls = [];
  let sourceCloseCount = 0;
  let workerDestroyed = false;
  let workerCreateCount = 0;
  const workerNames = [];
  const destroyedWorkerNames = [];
  let passwordUpdateCount = 0;
  let taskDestroyCount = 0;
  let rangeAbortCount = 0;
  let rangeConfig = null;
  let passwordPromptCalls = 0;

  const pages = [
    createFakePage({ width: 612, height: 792, rotate: 0, renderCalls }),
    createFakePage({ width: 360, height: 540, rotate: 90, renderCalls }),
    createFakePage({ width: 595, height: 842, rotate: 270, renderCalls }),
  ];

  const pdfDocument = {
    numPages: options.numPages ?? pages.length,
    fingerprints: ["fixture-fingerprint"],
    async getOutline() {
      return options.outline ?? null;
    },
    async getDestination(name) {
      return options.destinations?.[name] ?? null;
    },
    async getPageIndex(reference) {
      return typeof reference === "number" ? reference : Number(reference);
    },
    async getPage(pageNumber) {
      pageRequests.push(pageNumber);
      const page = pages[pageNumber - 1];
      if (page === undefined) throw namedError("InvalidPDFException");
      return page;
    },
    async getMetadata() {
      return { info: { Title: "  Fixture PDF  ", Author: "Shelf Tests", Subject: "Mixed pages" } };
    },
  };

  const sourceHandle = {
    id: "source-handle",
    metadata: {
      displayName: "fixture.pdf",
      mediaType: "application/pdf",
      sizeBytes: 3 * 1024 * 1024,
      modifiedAt: null,
    },
  };

  const source = {
    async inspect() {
      return { ok: true, value: sourceHandle.metadata };
    },
    async open() {
      return { ok: true, value: sourceHandle };
    },
    async read(_handleId, range) {
      reads.push(range);
      if (options.readFailure) {
        return { ok: false, error: { code: "read-failed", message: "fixture read failure", retryable: true } };
      }
      return { ok: true, value: new Uint8Array(range.length) };
    },
    async close() {
      sourceCloseCount += 1;
      return { ok: true, value: undefined };
    },
  };

  const locatorStore = {
    async getLocator() {
      return {
        ok: true,
        value: {
          kind: "opaque",
          providerId: "fixture",
          value: "sensitive-locator-never-exported",
          persistence: "reopenable",
        },
      };
    },
    async saveLocator() { return { ok: true, value: undefined }; },
    async deleteLocator() { return { ok: true, value: undefined }; },
  };

  const runtime = {
    annotationModeDisable: 0,
    passwordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
    createWorker(name) {
      workerCreateCount += 1;
      workerNames.push(name);
      return {
        promise: Promise.resolve(),
        destroy() { workerDestroyed = true; destroyedWorkerNames.push(name); },
      };
    },
    createRangeTransport(_length, _filename, requestRange, onAbort) {
      const transport = {
        requestDataRange(begin, end) { requestRange(begin, end); },
        deliverRange(begin, chunk) { deliveredRanges.push({ begin, byteLength: chunk.byteLength }); },
        abort() {
          rangeAbortCount += 1;
          onAbort();
        },
      };
      return transport;
    },
    getDocument(configuration) {
      rangeConfig = configuration;
      let resolveDocument;
      let rejectDocument;
      const promise = new Promise((resolve, reject) => {
        resolveDocument = resolve;
        rejectDocument = reject;
      });
      const task = {
        promise,
        onPassword: null,
        async destroy() {
          taskDestroyCount += 1;
          workerDestroyed = true;
          configuration.worker.destroy();
          if (options.rejectOnDestroy === true) {
            rejectDocument(namedError("AbortException"));
          }
        },
      };

      if (options.failure !== undefined) {
        queueMicrotask(() => rejectDocument(options.failure));
      } else if (options.passwordEvent === true) {
        queueMicrotask(() => {
          task.onPassword((password) => {
            passwordUpdateCount += 1;
            if (password === "correct horse") resolveDocument(pdfDocument);
            else rejectDocument(namedError("PasswordException"));
          }, runtime.passwordResponses.NEED_PASSWORD);
        });
      } else {
        queueMicrotask(() => resolveDocument(pdfDocument));
      }

      return task;
    },
    createTextLayer() {
      return {
        async render() {},
        cancel() {},
      };
    },
  };

  const adapter = new PdfDocumentAdapter(runtime, source, locatorStore, options.adapterOptions);
  return {
    adapter,
    source,
    runtime,
    reads,
    deliveredRanges,
    pageRequests,
    renderCalls,
    sourceCloseCount: () => sourceCloseCount,
    workerDestroyed: () => workerDestroyed,
    workerCreateCount: () => workerCreateCount,
    workerNames: () => [...workerNames],
    destroyedWorkerNames: () => [...destroyedWorkerNames],
    passwordUpdateCount: () => passwordUpdateCount,
    taskDestroyCount: () => taskDestroyCount,
    rangeAbortCount: () => rangeAbortCount,
    rangeConfig: () => rangeConfig,
    passwordPromptCalls: () => passwordPromptCalls,
    countPasswordPrompt() { passwordPromptCalls += 1; },
  };
}

async function openFixture(environment) {
  const opened = await environment.adapter.open(documentId);
  assert.equal(opened.ok, true);
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.value;
}

test("mixed-page fixture covers MediaBox, rotations, and several font resources", () => {
  const pdf = new TextDecoder().decode(buildMixedPagePdfFixture());
  assert.match(pdf, /^%PDF-1\.7/u);
  assert.equal((pdf.match(/\/Type \/Page\b/gu) ?? []).length, 3);
  assert.match(pdf, /\/MediaBox \[0 0 612 792\]/u);
  assert.match(pdf, /\/MediaBox \[0 0 360 540\]/u);
  assert.match(pdf, /\/MediaBox \[0 0 595 842\]/u);
  assert.match(pdf, /\/Rotate 90/u);
  assert.match(pdf, /\/Rotate 270/u);
  assert.match(pdf, /\/BaseFont \/Helvetica/u);
  assert.match(pdf, /\/BaseFont \/Times-Roman/u);
  assert.match(pdf, /\/BaseFont \/Courier/u);
  assert.match(pdf, /startxref/u);

  const malformed = new TextDecoder().decode(buildMalformedPdfFixture());
  assert.match(malformed, /^%PDF-1\.7/u);
  assert.doesNotMatch(malformed, /\bxref\b/u);
});

test("PDF.js range requests are capped and use the Reader source port", async () => {
  const environment = createFakeEnvironment({
    adapterOptions: { rangeChunkSize: MAX_DOCUMENT_READ_BYTES * 4 },
  });
  const session = await openFixture(environment);
  assert.equal(environment.rangeConfig().rangeChunkSize, MAX_DOCUMENT_READ_BYTES);

  environment.rangeConfig().range.requestDataRange(4096, 4096 + MAX_DOCUMENT_READ_BYTES);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(environment.reads.length, 1);
  assert.deepEqual(environment.reads[0], { offset: 4096, length: MAX_DOCUMENT_READ_BYTES });
  assert.deepEqual(environment.deliveredRanges, [{ begin: 4096, byteLength: MAX_DOCUMENT_READ_BYTES }]);
  assert.ok(environment.reads.every((range) => range.length <= MAX_DOCUMENT_READ_BYTES));

  await session.close();
});

test("source range failures destroy the active PDF.js task instead of returning empty bytes", async () => {
  const environment = createFakeEnvironment({ readFailure: true });
  const session = await openFixture(environment);

  environment.rangeConfig().range.requestDataRange(0, 1024);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(environment.reads.length, 1);
  assert.equal(environment.taskDestroyCount(), 1);
  assert.equal(environment.workerDestroyed(), true);
  const pageAfterFailure = await session.getPage(toPageIndex(0));
  assert.equal(pageAfterFailure.ok, false);
  if (!pageAfterFailure.ok) {
    assert.equal(pageAfterFailure.error.code, "read-failed");
    assert.equal(pageAfterFailure.error.retryable, false);
  }

  const closed = await session.close();
  assert.equal(closed.ok, true);
  assert.equal(environment.taskDestroyCount(), 1);
  assert.equal(environment.sourceCloseCount(), 1);
});

test("PDF document close releases its own worker without affecting another session", async () => {
  const environment = createFakeEnvironment();
  const session = await openFixture(environment);
  const secondSession = await openFixture(environment);
  const [firstWorkerName, secondWorkerName] = environment.workerNames();
  assert.notEqual(firstWorkerName, secondWorkerName);

  const first = await session.close();
  assert.equal(first.ok, true);
  assert.deepEqual(environment.destroyedWorkerNames(), [firstWorkerName]);

  const secondPage = await secondSession.getPage(toPageIndex(0));
  assert.equal(secondPage.ok, true);
  const second = await secondSession.close();
  assert.equal(second.ok, true);
  assert.deepEqual(environment.destroyedWorkerNames(), [firstWorkerName, secondWorkerName]);

  const repeated = await session.close();
  assert.equal(repeated.ok, true);
  assert.equal(environment.taskDestroyCount(), 2);
  assert.equal(environment.workerDestroyed(), true);
  assert.equal(environment.rangeAbortCount(), 2);
  assert.equal(environment.sourceCloseCount(), 2);
  assert.equal(environment.workerCreateCount(), 2);
});

test("Shelf page indexes map to PDF.js one-based pages without leaking PDF.js proxies", async () => {
  const environment = createFakeEnvironment();
  const session = await openFixture(environment);

  const page = await session.getPage(toPageIndex(1));
  assert.equal(page.ok, true);
  if (!page.ok) return;
  assert.deepEqual(environment.pageRequests, [2]);
  assert.deepEqual(page.value.geometry, {
    index: 1,
    width: 540,
    height: 360,
    rotation: 90,
  });
  assert.equal("renderProxy" in page.value, false);

  const invalid = await session.getPage(toPageIndex(10));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, "invalid-input");

  await session.close();
});

test("password-protected and malformed PDFs produce explicit safe errors", async () => {
  const passwordEnvironment = createFakeEnvironment({ passwordEvent: true });
  const passwordResult = await passwordEnvironment.adapter.open(documentId);
  assert.equal(passwordResult.ok, false);
  if (!passwordResult.ok) assert.equal(passwordResult.error.code, "password-required");
  assert.equal(passwordEnvironment.sourceCloseCount(), 1);
  assert.equal(passwordEnvironment.workerDestroyed(), true);

  const malformedEnvironment = createFakeEnvironment({
    failure: namedError("InvalidPDFException"),
  });
  const malformedResult = await malformedEnvironment.adapter.open(documentId);
  assert.equal(malformedResult.ok, false);
  if (!malformedResult.ok) assert.equal(malformedResult.error.code, "invalid-document");
  assert.equal(malformedEnvironment.sourceCloseCount(), 1);
  assert.equal(malformedEnvironment.workerDestroyed(), true);
});

test("PDF.js runtime instances can resolve independent worker asset roots", () => {
  const firstAssets = {
    workerSrc: "https://shelf.example/one/assets/pdfjs/build/pdf.worker.min.mjs",
    cMapUrl: "https://shelf.example/one/assets/pdfjs/cmaps/",
    iccUrl: "https://shelf.example/one/assets/pdfjs/iccs/",
    standardFontDataUrl: "https://shelf.example/one/assets/pdfjs/standard_fonts/",
    wasmUrl: "https://shelf.example/one/assets/pdfjs/wasm/",
  };
  const secondAssets = {
    ...firstAssets,
    workerSrc: "https://shelf.example/two/assets/pdfjs/build/pdf.worker.min.mjs",
  };

  assert.doesNotThrow(() => createPdfJsRuntime(firstAssets));
  assert.doesNotThrow(() => createPdfJsRuntime(secondAssets));
});

test("late password prompt responses are ignored after a document teardown", async () => {
  let resolvePassword;
  const environment = createFakeEnvironment({
    passwordEvent: true,
    readFailure: true,
    rejectOnDestroy: true,
    adapterOptions: {
      passwordPrompt: () => new Promise((resolve) => { resolvePassword = resolve; }),
    },
  });
  const opening = environment.adapter.open(documentId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof resolvePassword, "function");

  environment.rangeConfig().range.requestDataRange(0, 1024);
  const result = await opening;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "read-failed");

  resolvePassword("correct horse");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(environment.passwordUpdateCount(), 0);
  assert.equal(environment.sourceCloseCount(), 1);
});

test("password prompt supports retries and explicit cancellation", async () => {
  const accepted = createFakeEnvironment({
    passwordEvent: true,
    adapterOptions: {
      passwordPrompt: async () => "correct horse",
    },
  });
  const acceptedResult = await accepted.adapter.open(documentId);
  assert.equal(acceptedResult.ok, true);
  if (acceptedResult.ok) await acceptedResult.value.close();

  const cancelled = createFakeEnvironment({
    passwordEvent: true,
    adapterOptions: {
      passwordPrompt: async () => {
        cancelled.countPasswordPrompt();
        return null;
      },
    },
  });
  const cancelledResult = await cancelled.adapter.open(documentId);
  assert.equal(cancelledResult.ok, false);
  if (!cancelledResult.ok) assert.equal(cancelledResult.error.code, "cancelled");
  assert.equal(cancelled.passwordPromptCalls(), 1);
});

class FakeClassList {
  #values = new Set();
  add(...values) { for (const value of values) this.#values.add(value); }
  contains(value) { return this.#values.has(value); }
}

class FakeElement {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.children = [];
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = { setProperty() {} };
    this.attributes = {};
    this.width = 0;
    this.height = 0;
    this.title = "";
    this.context = {};
  }
  replaceChildren(...children) { this.children = [...children]; }
  append(child) { this.children.push(child); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getContext() { return this.context; }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(this, tagName); }
}

test("page renderer keeps canvas, text, and Shelf annotation layers separate", async () => {
  const environment = createFakeEnvironment();
  const session = await openFixture(environment);
  const page = await session.getPage(toPageIndex(0));
  assert.equal(page.ok, true);
  if (!page.ok) return;

  const root = new FakeElement(new FakeDocument(), "div");
  const layers = createPdfPageLayers(root);
  assert.deepEqual(root.children, [layers.canvas, layers.text, layers.annotations]);

  const annotation = {
    id: "annotation-1",
    documentId,
    pageIndex: toPageIndex(0),
    kind: "highlight",
    color: "yellow",
    anchor: null,
    rectangles: Array.from({ length: 250 }, () => ({
      x: 0.1, y: 0.2, width: 0.3, height: 0.05,
    })),
    createdAt: 1,
    updatedAt: 1,
  };
  const renderer = new PdfPageRenderer(environment.runtime);
  const rendered = await renderer.render(page.value, layers, [annotation], {
    scale: 1,
    devicePixelRatio: 2,
  });

  assert.equal(rendered.ok, true);
  assert.equal(layers.annotations.children.length, 200);
  assert.equal(layers.text.children.length, 0);
  assert.equal(environment.renderCalls.length, 1);
  assert.equal(environment.renderCalls[0].annotationMode, environment.runtime.annotationModeDisable);
  assert.equal(environment.renderCalls[0].canvasContext, layers.canvas.context);
  assert.deepEqual(environment.renderCalls[0].transform, [2, 0, 0, 2, 0, 0]);

  await session.close();
});

test("page virtualization bounds mounted pages for a large document", () => {
  const virtualizer = new PageVirtualizer(50_000, {
    estimatedPageHeight: 800,
    maxMountedPages: 8,
    overscanPages: 2,
  });
  const result = virtualizer.getWindow({
    scrollTop: 20_000 * 824,
    viewportWidth: 1200,
    viewportHeight: 900,
    scale: 1,
  });

  assert.equal(result.totalPageCount, 50_000);
  assert.equal(result.totalHeight, 50_000 * 824 - 24);
  assert.ok(result.pages.length <= 8);
  assert.ok(result.pages.some((page) => page.visible));
  assert.ok(result.firstVisibleIndex >= 19_999);
});

test("virtualizer rejects pathological page counts and geometry", () => {
  assert.throws(() => new PageVirtualizer(1_000_001), RangeError);
  const virtualizer = new PageVirtualizer(1);
  assert.throws(() => virtualizer.updatePageSize(toPageIndex(0), { width: 100_001, height: 1 }), RangeError);
  assert.throws(() => virtualizer.getWindow({
    scrollTop: Number.MAX_VALUE,
    viewportWidth: 100,
    viewportHeight: Number.MAX_VALUE,
    scale: 1,
  }), RangeError);
});

test("virtualization updates offsets after discovering mixed page dimensions", () => {
  const virtualizer = new PageVirtualizer(3, {
    estimatedPageWidth: 100,
    estimatedPageHeight: 100,
    pageGap: 10,
    maxMountedPages: 3,
    overscanPages: 1,
  });
  const before = virtualizer.getWindow({
    scrollTop: 220,
    viewportWidth: 600,
    viewportHeight: 10,
    scale: 1,
  });
  assert.equal(before.firstVisibleIndex, 2);

  virtualizer.updatePageSize(toPageIndex(0), { width: 200, height: 200 });
  const after = virtualizer.getWindow({
    scrollTop: 220,
    viewportWidth: 600,
    viewportHeight: 10,
    scale: 1,
  });
  assert.equal(after.firstVisibleIndex, 1);
  assert.equal(after.pages.find((page) => page.index === 2)?.top, 320);
  assert.equal(after.totalHeight, 200 + 10 + 100 + 10 + 100);
});


test("PDF outline destinations resolve to zero-based pages and keep nested hierarchy", async () => {
  const environment = createFakeEnvironment({
    outline: [
      {
        title: "  Chapter One  ",
        dest: [0],
        items: [
          { title: "Section 1.1", dest: "section-1-1", items: [] },
          { title: "Unsupported destination", dest: null, items: [] },
        ],
      },
    ],
    destinations: {
      "section-1-1": [2],
    },
  });
  const session = await openFixture(environment);
  const result = await session.getOutline();
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.length, 1);
    assert.equal(result.value[0].title, "Chapter One");
    assert.equal(result.value[0].pageIndex, 0);
    assert.equal(result.value[0].children[0].pageIndex, 2);
    assert.equal(result.value[0].children[1].pageIndex, null);
  }
  await session.close();
});

test("PDF outline treats missing contents as empty and rejects access after close", async () => {
  const environment = createFakeEnvironment({ outline: null });
  const session = await openFixture(environment);
  const empty = await session.getOutline();
  assert.deepEqual(empty, { ok: true, value: [] });
  await session.close();
  const closed = await session.getOutline();
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.error.code, "cancelled");
});

test("virtualizer exposes measured page tops and sizes for scroll synchronization", () => {
  const virtualizer = new PageVirtualizer(4, {
    estimatedPageWidth: 600,
    estimatedPageHeight: 800,
    pageGap: 20,
  });
  assert.equal(virtualizer.getPageTop(toPageIndex(2)), 1640);
  assert.deepEqual(virtualizer.getPageSize(toPageIndex(1)), { width: 600, height: 800 });

  virtualizer.updatePageSize(toPageIndex(0), { width: 400, height: 500 });
  assert.equal(virtualizer.getPageTop(toPageIndex(2)), 1340);
  assert.deepEqual(virtualizer.getPageSize(toPageIndex(0)), { width: 400, height: 500 });
  assert.throws(() => virtualizer.getPageTop(toPageIndex(4)), RangeError);
  assert.throws(() => virtualizer.getPageTop(toPageIndex(0), 9), RangeError);
});
