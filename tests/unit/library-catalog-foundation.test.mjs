import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function source(relative) {
  return readFile(path.join(root, relative), "utf8");
}

test("book library is composed as a Web feature over Reader and platform ports", async () => {
  const app = await source("apps/web/src/application.ts");
  const catalog = await source("apps/web/src/features/library/library-catalog.ts");
  const store = await source("packages/platform-adapters/src/browser/indexeddb-store.ts");
  const ports = await source("packages/reader-core/src/ports/library.ts");
  const barrel = await source("packages/reader-core/src/index.ts");

  assert.equal(app.includes('import { mountLibraryCatalog } from "./features/library/library-catalog.js";'), true);
  assert.equal(app.includes("mountLibraryCatalog(librarySection"), true);
  assert.equal(catalog.includes("LibraryEntry"), true);
  assert.equal(catalog.includes("SavedLibraryView"), true);
  assert.equal(catalog.includes("filterLibraryItems(items, filters)"), true);
  assert.equal(catalog.includes("store.saveLibraryEntry(next)"), true);
  assert.equal(catalog.includes("store.saveSavedLibraryView(view)"), true);
  assert.equal(store.includes("LibraryEntryRepositoryPort"), true);
  assert.equal(store.includes("SavedLibraryViewRepositoryPort"), true);
  assert.equal(ports.includes("LibraryEntryRepositoryPort"), true);
  assert.equal(ports.includes("SavedLibraryViewRepositoryPort"), true);
  assert.equal(barrel.includes('./domain/library.js'), true);
});

test("per-book README preview uses a restrictive renderer and never parses raw HTML", async () => {
  const markdown = await source("apps/web/src/features/library/safe-markdown.ts");
  const catalog = await source("apps/web/src/features/library/library-catalog.ts");

  assert.equal(markdown.includes("parseSafeMarkdown"), true);
  assert.equal(markdown.includes("renderSafeMarkdown"), true);
  assert.equal(markdown.includes("textContent"), true);
  assert.equal(markdown.includes('link.rel = "noopener noreferrer"'), true);
  assert.equal(markdown.includes("innerHTML"), false);
  assert.equal(markdown.includes("insertAdjacentHTML"), false);
  assert.equal(markdown.includes("DOMParser"), false);
  assert.equal(catalog.includes("MAX_LIBRARY_README_CHARACTERS"), true);
  assert.equal(catalog.includes("Import README.md"), true);
  assert.equal(catalog.includes("Download README.md"), true);
  assert.equal(catalog.includes("readmeEditor.hidden = true"), true);
  assert.equal(catalog.includes("renderSafeMarkdown(readmePreview"), true);
});

test("library catalog exposes filters and responsive grid/list layouts", async () => {
  const catalog = await source("apps/web/src/features/library/library-catalog.ts");
  const styles = await source("apps/web/src/styles.css");
  for (const feature of [
    "statusFilter", "authorFilter", "tagFilter", "progressFilter", "formatFilter",
    "sortFilter", "saveViewForm", "renderSavedViews", "renderQuickFilters",
    "lastOpenedAt", "completionPercent",
  ]) assert.equal(catalog.includes(feature), true, "missing catalog capability: " + feature);
  assert.equal(styles.includes(".library-grid--list"), true);
  assert.equal(styles.includes("@media (max-width:780px)"), true);
  assert.equal(styles.includes("@media (max-width:520px)"), true);
});
