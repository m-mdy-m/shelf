import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webRoot = path.join(root, "dist", "web");
const harnessHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    html, body { margin: 0; padding: 0; font: 14px Arial, sans-serif; }
    #reader { width: 920px; min-height: 940px; padding: 16px; }
    .reader-toolbar, .reader-control-group, .reader-panels { display: flex; gap: 8px; flex-wrap: wrap; }
    .reader-stage { position: relative; width: 900px; height: 820px; overflow: auto; }
    .reader-scroll-spacer { position: relative; width: 100%; }
    .reader-page-mount, .shelf-pdf-page { position: relative; width: 612px; height: 792px; }
    .shelf-pdf-text-layer { position: absolute; inset: 0; width: 612px; height: 792px; }
    .shelf-pdf-text-layer > span { position: absolute; display: block; white-space: pre; font: 14px Arial; user-select: text; }
    .shelf-pdf-interaction-layer, .shelf-pdf-annotation-layer { position: absolute; inset: 0; pointer-events: none; }
    .reader-selection-panel, .reader-saved-items { padding: 8px; }
    button { min-height: 32px; }
  </style>
  <script type="importmap">{"imports":{"@shelf/reader-core":"/assets/packages/reader-core/index.js","@shelf/pdf-engine":"/assets/packages/pdf-engine/index.js","pdfjs-dist":"/assets/pdfjs/build/pdf.mjs"}}</script>
</head>
<body>
  <main id="reader"></main>
  <output id="status"></output>
  <script type="module" src="/p0-harness.js"></script>
</body>
</html>`;

const harnessJs = `import { mountReaderWorkspace } from "/assets/reader-workspace.js";
import { ReaderAnnotationService, toOpaqueId, toPageIndex } from "@shelf/reader-core";
import { reorderPdfTextLayer, PageVirtualizer } from "@shelf/pdf-engine";

const sourceItems = [
  { key: "left-a", text: "LEFT COLUMN A ", left: 40, top: 70, width: 128, height: 16 },
  { key: "right-a", text: "RIGHT COLUMN A ", left: 360, top: 70, width: 150, height: 16 },
  { key: "left-b", text: "Left passage for order reconstruction.", left: 40, top: 100, width: 245, height: 16 },
  { key: "right-b", text: "Right passage for order reconstruction.", left: 360, top: 100, width: 245, height: 16 },
];
const documentText = "LEFT COLUMN A\\nLeft passage for order reconstruction.\\nRIGHT COLUMN A\\nRight passage for order reconstruction.";
const pageRuns = [];
let cursor = 0;
for (let index = 0; index < sourceItems.length; index += 1) {
  const item = sourceItems[index];
  if (item === undefined) continue;
  const text = item.text.trimEnd();
  pageRuns.push({
    text,
    startOffset: cursor,
    endOffset: cursor + text.length,
    direction: "ltr",
    fontName: "fixture",
    rectangles: [{ x: item.left / 612, y: item.top / 792, width: item.width / 612, height: item.height / 792 }],
  });
  cursor += text.length + 1;
}
const pageText = { pageIndex: toPageIndex(0), text: documentText, runs: pageRuns, hasSelectableText: true, truncated: false };

const records = { bookmarks: new Map(), annotations: new Map(), quotes: new Map() };
let sequence = 0;
let now = 1000;
const read = (map, documentId) => ({ ok: true, value: [...map.values()].filter((item) => item.documentId === documentId) });
const save = (map, record) => { map.set(record.id, record); return { ok: true, value: undefined }; };
const remove = (map, id) => { map.delete(id); return { ok: true, value: undefined }; };
const annotations = new ReaderAnnotationService({
  ids: { next: (kind) => toOpaqueId(kind.toLowerCase() + "-" + String(++sequence)) },
  clock: { now: () => now++ },
  bookmarks: { listByDocumentId: (id) => read(records.bookmarks, id), save: (item) => save(records.bookmarks, item), delete: (id) => remove(records.bookmarks, id) },
  annotations: { listByDocumentId: (id) => read(records.annotations, id), save: (item) => save(records.annotations, item), delete: (id) => remove(records.annotations, id) },
  quotes: { listByDocumentId: (id) => read(records.quotes, id), save: (item) => save(records.quotes, item), delete: (id) => remove(records.quotes, id) },
});
const documentId = toOpaqueId("browser-e2e-document");
const session = {
  info: {
    documentId,
    pageCount: 1,
    title: "Two-column browser fixture",
    displayName: "two-columns.pdf",
    sizeBytes: 4096,
    author: null,
    subject: null,
    fingerprint: "fixture-fingerprint",
  },
  createVirtualizer(options) {
    return new PageVirtualizer(1, { ...options, estimatedPageWidth: 612, estimatedPageHeight: 792 });
  },
  async getPage(index) {
    return { ok: true, value: { geometry: { index, width: 612, height: 792, rotation: 0 } } };
  },
  async getPageText() { return { ok: true, value: pageText }; },
  async getOutline() { return { ok: true, value: [] }; },
  async close() { return { ok: true, value: undefined }; },
};
const renderer = {
  async render(page, layers) {
    layers.root.style.position = "relative";
    layers.root.style.width = "612px";
    layers.root.style.height = "792px";
    layers.text.style.width = "612px";
    layers.text.style.height = "792px";
    for (const item of sourceItems) {
      const span = document.createElement("span");
      span.dataset.fixtureItem = item.key;
      span.textContent = item.text;
      span.style.left = item.left + "px";
      span.style.top = item.top + "px";
      span.style.width = item.width + "px";
      span.style.height = item.height + "px";
      layers.text.append(span);
    }
    reorderPdfTextLayer(layers.text, page.geometry.width);
    return { ok: true, value: { width: 612, height: 792 } };
  },
  updateAnnotations(layers, _pageIndex, items) {
    layers.annotations.replaceChildren();
    for (const item of items) {
      const marker = document.createElement("span");
      marker.dataset.annotationId = item.id;
      marker.dataset.kind = item.kind;
      layers.annotations.append(marker);
    }
  },
  cancel() {},
};
const progressRepository = {
  async save() { return { ok: true, value: undefined }; },
};
window.prompt = () => "Browser E2E note";
window.__shelfE2E = { records, sourceItems };
mountReaderWorkspace({
  root: document.querySelector("#reader"),
  session,
  renderer,
  progressRepository,
  annotationUseCases: annotations,
  initialProgress: null,
  onStatus(message) { document.querySelector("#status").textContent = message; },
  onClose() {},
});
`;

async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next known Chrome/Chromium path.
    }
  }
  return null;
}

function mimeType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".wasm")) return "application/wasm";
  if (file.endsWith(".json") || file.endsWith(".webmanifest")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function waitUntil(predicate, description, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for " + description);
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const events = [];
  let nextId = 0;
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Chrome DevTools WebSocket failed.")), { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (typeof message.id !== "number") {
      events.push(message);
      return;
    }
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result ?? {});
  });
  return {
    socket,
    events() { return [...events]; },
    async opened() { await opened; },
    async send(method, params = {}) {
      const id = ++nextId;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    async evaluate(expression) {
      const response = await this.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      }
      return response.result?.result?.value;
    },
  };
}

test("Chromium Reader selection remains column-bounded and highlight/note actions persist", async (context) => {
  const chrome = await findChrome();
  if (chrome === null) {
    context.skip("Chromium is not installed; the CI browser job must provide CHROME_BIN.");
    return;
  }

  await writeFile(path.join(webRoot, "p0-harness.html"), harnessHtml, "utf8");
  await writeFile(path.join(webRoot, "p0-harness.js"), harnessJs, "utf8");
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const file = path.resolve(webRoot, "." + pathname);
      if (file !== webRoot && !file.startsWith(webRoot + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const content = await readFile(file);
      response.writeHead(200, { "content-type": mimeType(file) });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Could not bind the E2E static server.");
  const baseUrl = "http://127.0.0.1:" + String(address.port);
  const profile = await mkdtemp(path.join(os.tmpdir(), "shelf-chromium-p0-"));
  const browser = spawn(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  let stderr = "";
  let cdp;
  try {
    const debugUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Chrome did not expose a DevTools endpoint.")), 12000);
      browser.stderr.on("data", (chunk) => {
        stderr += String(chunk);
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/u);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      browser.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error("Chrome exited before starting (code " + String(code) + "): " + stderr));
      });
    });
    const debugPort = new URL(debugUrl).port;
    const targetResponse = await fetch("http://127.0.0.1:" + debugPort + "/json/new?" +
      encodeURIComponent(baseUrl + "/p0-harness.html"), { method: "PUT" });
    if (!targetResponse.ok) throw new Error("Could not create a Chrome page target: " + targetResponse.status);
    const target = await targetResponse.json();
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1200,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.navigate", { url: baseUrl + "/p0-harness.html" });

    try {
      await waitUntil(async () => await cdp.evaluate(
        "Boolean(window.__shelfE2E && document.querySelector('.shelf-pdf-text-layer > span'))",
      ), "Reader page rendering");
    } catch (cause) {
      const pageState = await cdp.evaluate(`(() => ({
        readyState: document.readyState,
        title: document.title,
        bodyText: document.body.innerText,
        harnessLoaded: Boolean(window.__shelfE2E),
        readerChildren: document.querySelector("#reader")?.innerHTML.slice(0, 3000) ?? null,
        resources: performance.getEntriesByType("resource").map((entry) => entry.name).slice(-30),
      }))()`);
      const browserEvents = cdp.events().filter((event) =>
        event.method === "Runtime.exceptionThrown" ||
        event.method === "Runtime.consoleAPICalled" ||
        event.method === "Log.entryAdded" ||
        event.method === "Network.loadingFailed",
      ).slice(-30);
      throw new Error(String(cause) + " Browser diagnostics: " + JSON.stringify({ pageState, browserEvents }));
    }

    const selected = await cdp.evaluate(`(() => {
      const layer = document.querySelector(".shelf-pdf-text-layer");
      const spans = Array.from(layer.querySelectorAll(":scope > span"));
      const order = spans.map((span) => span.dataset.fixtureItem);
      const start = spans.find((span) => span.dataset.fixtureItem === "left-a");
      const end = spans.find((span) => span.dataset.fixtureItem === "left-b");
      const range = document.createRange();
      range.setStart(start.firstChild, 0);
      range.setEnd(end.firstChild, end.firstChild.textContent.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return { order, text: selection.toString() };
    })()`);
    assert.deepEqual(selected.order, ["left-a", "left-b", "right-a", "right-b"]);
    assert.match(selected.text, /LEFT COLUMN A Left passage for order reconstruction\./u);
    assert.doesNotMatch(selected.text, /RIGHT COLUMN/u);

    await waitUntil(async () => await cdp.evaluate(
      "Boolean(document.querySelector('.reader-selection-panel:not([hidden]) button:not([disabled])'))",
    ), "the selection action toolbar to become enabled");

    const highlight = await cdp.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll(".reader-selection-panel button"))
        .find((item) => item.textContent === "Save highlight");
      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      button.dispatchEvent(down);
      button.click();
      return { prevented: down.defaultPrevented, selected: window.getSelection().toString() };
    })()`);
    assert.equal(highlight.prevented, true);
    assert.doesNotMatch(highlight.selected, /RIGHT COLUMN/u);
    await waitUntil(async () => await cdp.evaluate("window.__shelfE2E.records.annotations.size === 1"),
      "the highlight to be persisted");

    const note = await cdp.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll(".reader-selection-panel button"))
        .find((item) => item.textContent === "Add note");
      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      button.dispatchEvent(down);
      button.click();
      return { prevented: down.defaultPrevented, selected: window.getSelection().toString() };
    })()`);
    assert.equal(note.prevented, true);
    assert.doesNotMatch(note.selected, /RIGHT COLUMN/u);
    await waitUntil(async () => await cdp.evaluate("window.__shelfE2E.records.annotations.size === 2"),
      "the passage note to be persisted");

    await cdp.evaluate(`(() => {
      const toggle = Array.from(document.querySelectorAll("button"))
        .find((item) => item.textContent === "Saved items");
      toggle.click();
    })()`);
    await waitUntil(async () => await cdp.evaluate(
      "Array.from(document.querySelectorAll('section')).some((item) => item.getAttribute('aria-label') === 'Saved reader items' && item.textContent.includes('Browser E2E note'))",
    ), "the saved highlight and note to be rendered");

    const rightSelected = await cdp.evaluate(`(() => {
      const spans = Array.from(document.querySelectorAll(".shelf-pdf-text-layer > span"));
      const start = spans.find((span) => span.dataset.fixtureItem === "right-a");
      const end = spans.find((span) => span.dataset.fixtureItem === "right-b");
      const range = document.createRange();
      range.setStart(start.firstChild, 0);
      range.setEnd(end.firstChild, end.firstChild.textContent.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return selection.toString();
    })()`);
    assert.match(rightSelected, /RIGHT COLUMN A Right passage/u);
    assert.doesNotMatch(rightSelected, /LEFT COLUMN/u);
  } finally {
    cdp?.socket.close();
    browser.kill("SIGTERM");
    await new Promise((resolve) => {
      if (browser.exitCode !== null) resolve();
      else {
        browser.once("exit", resolve);
        setTimeout(resolve, 3000);
      }
    });
    server.close();
    await rm(profile, { recursive: true, force: true });
    await rm(path.join(webRoot, "p0-harness.html"), { force: true });
    await rm(path.join(webRoot, "p0-harness.js"), { force: true });
  }
});
