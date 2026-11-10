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
const html = `<!doctype html><meta charset="utf-8"><style>
  #page { position:relative;width:612px;height:792px }
  #layer { position:absolute;inset:0;width:612px;height:792px }
  #layer span { position:absolute;display:block;white-space:pre;font:14px Arial;user-select:text }
</style><main id="root"></main><script type="module" src="/p0-harness.js"></script>`;
const themeHtml = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
<body class="reader-active"><div id="app"><main class="shelf-shell reader-active">
<header class="shelf-header">Shelf</header><p class="shelf-status">Ready</p><section class="library-section">Library</section>
<section class="reader-viewer"><div class="reader-toolbar">
<button class="button" id="primary-control">Next</button>
<button class="button reader-secondary-button" id="secondary-control">Contents</button>
</div><div class="reader-stage"><div class="reader-page-mount" id="pdf-surface"></div></div></section>
</main></div></body>`;
const libraryThemeHtml = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">
<body><div id="app"><main class="shelf-shell"><section class="library-section">
<div class="library-catalog">
  <div class="library-toolbar">
    <label class="library-search"><span class="visually-hidden">Search</span><input class="library-search-input" placeholder="Search books"></label>
    <select class="library-filter-select" aria-label="Sort library"><option>Recently added</option></select>
    <button class="button button-secondary library-clear-filters" hidden>Clear filters</button>
    <div class="library-layout-toggle"><button class="button library-layout-button is-active">Grid</button></div>
    <details class="library-advanced-filters">
      <summary class="library-advanced-filters-toggle">More filters</summary>
      <div class="library-advanced-filters-content"><select class="library-filter-select" aria-label="Filter by author"><option>Author</option></select></div>
    </details>
  </div>
  <div class="library-quick-filters"><button class="library-status-chip is-active">All books 1</button></div>
  <div class="library-grid"><article class="library-card" id="library-card">
    <div class="library-book-cover"><strong class="library-book-cover-title">Example book</strong></div>
    <div class="library-card-body"><h3 class="library-card-title">Example book</h3><div class="library-progress-track"><span class="library-progress-fill" style="width:42%"></span></div></div>
  </article></div>
</div></section></main></div></body>`;
const harness = `import { reorderPdfTextLayer } from "/assets/packages/pdf-engine/renderer/pdf-text-layer-order.js";
import { createSelectionActions } from "/assets/features/annotations/components/selection-actions.js";
const root = document.querySelector("#root");
const page = document.createElement("div");
page.id = "page";
const layer = document.createElement("div");
layer.id = "layer";
page.append(layer);
root.append(page);
const fixture = [
  { id: "left-a", text: "LEFT COLUMN A ", left: 40, top: 70, width: 128 },
  { id: "right-a", text: "RIGHT COLUMN A ", left: 360, top: 70, width: 150 },
  { id: "left-b", text: "Left passage for order reconstruction.", left: 40, top: 100, width: 245 },
  { id: "right-b", text: "Right passage for order reconstruction.", left: 360, top: 100, width: 245 },
];
for (const item of fixture) {
  const span = document.createElement("span");
  span.dataset.item = item.id;
  span.textContent = item.text;
  span.style.left = item.left + "px";
  span.style.top = item.top + "px";
  span.style.width = item.width + "px";
  span.style.height = "16px";
  layer.append(span);
}
reorderPdfTextLayer(layer, 612);
const records = [];
const actions = createSelectionActions(document, {
  onHighlight: () => records.push({ kind: "highlight", text: getSelection().toString() }),
  onNote: () => records.push({ kind: "note", text: getSelection().toString() }),
  onQuote: () => records.push({ kind: "quote", text: getSelection().toString() }),
});
actions.setEnabled(true);
const panel = document.createElement("section");
panel.className = "reader-selection-panel";
panel.append(actions.element);
root.append(panel);
function getSelection() { return window.getSelection(); }
window.__shelfE2E = { records };
`;

async function chromePath() {
  for (const candidate of [
    process.env.CHROME_BIN, "/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/chromium-browser",
  ].filter(Boolean)) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* try next */ }
  }
  return null;
}

function cdpConnection(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Chrome DevTools connection failed.")), { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (typeof message.id !== "number") return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result ?? {});
  });
  return {
    socket,
    ready,
    async send(method, params = {}) {
      const id = ++nextId;
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return promise;
    },
    async evaluate(expression) {
      const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result?.value;
    },
  };
}

test("Chromium keeps native PDF text selection column-bounded and preserves it for Highlight/Note actions", async (context) => {
  const chrome = await chromePath();
  if (!chrome) { context.skip("Chromium is unavailable; CI must provide CHROME_BIN."); return; }

  await writeFile(path.join(webRoot, "p0-harness.html"), html);
  await writeFile(path.join(webRoot, "p0-harness.js"), harness);
  await writeFile(path.join(webRoot, "reader-theme-harness.html"), themeHtml);
  await writeFile(path.join(webRoot, "library-theme-harness.html"), libraryThemeHtml);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const file = path.resolve(webRoot, "." + pathname);
      if (!file.startsWith(webRoot + path.sep)) { response.writeHead(403).end(); return; }
      const content = await readFile(file);
      const contentType = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
      response.writeHead(200, { "content-type": contentType });
      response.end(content);
    } catch {
      if (!response.headersSent) response.writeHead(404).end();
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("E2E server did not bind.");
  const profile = await mkdtemp(path.join(os.tmpdir(), "shelf-p0-chrome-"));
  const browser = spawn(chrome, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0",
    "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  let cdp;
  try {
    const debugUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Chrome DevTools endpoint timed out.")), 12000);
      browser.stderr.on("data", (chunk) => {
        const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/u);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      browser.once("exit", (code) => { clearTimeout(timer); reject(new Error("Chrome exited: " + String(code))); });
    });
    const debugPort = new URL(debugUrl).port;
    const targetResponse = await fetch("http://127.0.0.1:" + debugPort + "/json/new?" +
      encodeURIComponent("http://127.0.0.1:" + String(address.port) + "/p0-harness.html"), { method: "PUT" });
    if (!targetResponse.ok) throw new Error("Could not create Chrome target: " + targetResponse.status);
    const target = await targetResponse.json();
    cdp = cdpConnection(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + String(address.port) + "/p0-harness.html" });
    const started = Date.now();
    while (Date.now() - started < 12000) {
      if (await cdp.evaluate("Boolean(window.__shelfE2E && document.querySelector('#layer span'))")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(await cdp.evaluate("Boolean(window.__shelfE2E && document.querySelector('#layer span'))"), true);

    const left = await cdp.evaluate(`(() => {
      const spans = [...document.querySelectorAll("#layer span")];
      const start = spans.find((span) => span.dataset.item === "left-a");
      const end = spans.find((span) => span.dataset.item === "left-b");
      const range = document.createRange();
      range.setStart(start.firstChild, 0);
      range.setEnd(end.firstChild, end.firstChild.textContent.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return { order: spans.map((span) => span.dataset.item), text: selection.toString() };
    })()`);
    assert.deepEqual(left.order, ["left-a", "left-b", "right-a", "right-b"]);
    assert.match(left.text, /LEFT COLUMN A Left passage for order reconstruction\./u);
    assert.doesNotMatch(left.text, /RIGHT COLUMN/u);

    for (const [label, kind] of [["Save highlight", "highlight"], ["Add note", "note"]]) {
      const result = await cdp.evaluate(`(() => {
        const button = [...document.querySelectorAll(".reader-selection-panel button")]
          .find((item) => item.textContent === ${JSON.stringify(label)});
        const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        button.dispatchEvent(down);
        button.click();
        return { prevented: down.defaultPrevented, text: window.getSelection().toString() };
      })()`);
      assert.equal(result.prevented, true);
      assert.equal(result.text, left.text);
      assert.equal(await cdp.evaluate("window.__shelfE2E.records.length"), kind === "highlight" ? 1 : 2);
    }
    const saved = await cdp.evaluate("window.__shelfE2E.records");
    assert.deepEqual(saved.map((record) => record.kind), ["highlight", "note"]);
    assert.ok(saved.every((record) => record.text === left.text));

    const right = await cdp.evaluate(`(() => {
      const spans = [...document.querySelectorAll("#layer span")];
      const start = spans.find((span) => span.dataset.item === "right-a");
      const end = spans.find((span) => span.dataset.item === "right-b");
      const range = document.createRange();
      range.setStart(start.firstChild, 0);
      range.setEnd(end.firstChild, end.firstChild.textContent.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    })()`);
    assert.match(right, /RIGHT COLUMN A Right passage/u);
    assert.doesNotMatch(right, /LEFT COLUMN/u);

    await cdp.send("Page.navigate", {
      url: "http://127.0.0.1:" + String(address.port) + "/reader-theme-harness.html",
    });
    const themeStarted = Date.now();
    while (Date.now() - themeStarted < 12000) {
      const loaded = await cdp.evaluate("Boolean(document.querySelector('#pdf-surface') && getComputedStyle(document.body).backgroundColor === 'rgb(9, 14, 20)')");
      if (loaded) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const theme = await cdp.evaluate(`(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      shell: getComputedStyle(document.querySelector(".reader-viewer")).backgroundColor,
      pdf: getComputedStyle(document.querySelector("#pdf-surface")).backgroundColor,
      header: getComputedStyle(document.querySelector(".shelf-header")).display,
      primary: getComputedStyle(document.querySelector("#primary-control")).backgroundColor,
      secondary: getComputedStyle(document.querySelector("#secondary-control")).backgroundColor,
    }))()`);
    assert.equal(theme.body, "rgb(9, 14, 20)");
    assert.equal(theme.shell, "rgb(16, 23, 34)");
    assert.equal(theme.pdf, "rgb(255, 255, 255)");
    assert.equal(theme.header, "none");
    assert.notEqual(theme.primary, theme.secondary, "secondary actions should be visually quieter than primary controls");
    const returnedToLibrary = await cdp.evaluate(`(() => {
      document.body.classList.remove("reader-active");
      document.querySelector(".shelf-shell").classList.remove("reader-active");
      return getComputedStyle(document.body).backgroundColor;
    })()`);
    assert.notEqual(returnedToLibrary, "rgb(9, 14, 20)");

    await cdp.send("Page.navigate", {
      url: "http://127.0.0.1:" + String(address.port) + "/library-theme-harness.html",
    });
    const libraryStarted = Date.now();
    while (Date.now() - libraryStarted < 12000) {
      const loaded = await cdp.evaluate("Boolean(document.querySelector('#library-card') && getComputedStyle(document.querySelector('#library-card')).backgroundColor === 'rgb(18, 24, 33)')");
      if (loaded) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const libraryTheme = await cdp.evaluate(`(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      card: getComputedStyle(document.querySelector("#library-card")).backgroundColor,
      toolbar: getComputedStyle(document.querySelector(".library-toolbar")).display,
      disclosure: getComputedStyle(document.querySelector(".library-advanced-filters-content")).display,
    }))()`);
    assert.equal(libraryTheme.body, "rgb(9, 12, 17)");
    assert.equal(libraryTheme.card, "rgb(18, 24, 33)");
    assert.equal(libraryTheme.toolbar, "grid");
    assert.equal(libraryTheme.disclosure, "none", "secondary filters should stay collapsed by default");

    const expandedFilters = await cdp.evaluate(`(() => {
      const disclosure = document.querySelector(".library-advanced-filters");
      disclosure.open = true;
      return getComputedStyle(document.querySelector(".library-advanced-filters-content")).display;
    })()`);
    assert.equal(expandedFilters, "grid", "advanced filters should appear when the disclosure is opened");

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    const mobileLayout = await cdp.evaluate(`(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      card: document.querySelector("#library-card").getBoundingClientRect().width,
    }))()`);
    assert.ok(mobileLayout.card > 0, "the book card should remain visible at a mobile width");
    assert.ok(mobileLayout.document <= mobileLayout.viewport, "the dark library must not overflow horizontally on mobile");
  } finally {
    cdp?.socket.close();
    const browserClosed = browser.exitCode !== null || browser.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => browser.once("close", resolve));
    browser.kill("SIGTERM");
    await browserClosed;
    server.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await rm(path.join(webRoot, "p0-harness.html"), { force: true });
    await rm(path.join(webRoot, "p0-harness.js"), { force: true });
    await rm(path.join(webRoot, "reader-theme-harness.html"), { force: true });
    await rm(path.join(webRoot, "library-theme-harness.html"), { force: true });
  }
});
