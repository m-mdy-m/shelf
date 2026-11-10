import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function source(relative) {
  return readFile(path.join(root, relative), "utf8");
}

test("Shelf defaults to the IDIOS-inspired dark design tokens", async () => {
  const styles = await source("apps/web/src/styles.css");
  const rootTheme = styles.match(/:root\s*\{[\s\S]*?--shelf-bg:\s*#090c11;[\s\S]*?\}/u);

  assert.ok(rootTheme, "the shared root theme must define the dark Shelf palette");
  assert.match(rootTheme[0], /color-scheme:\s*dark/u);
  assert.match(rootTheme[0], /--shelf-surface:\s*#121821/u);
  assert.match(rootTheme[0], /--shelf-border:\s*#273241/u);
  assert.match(rootTheme[0], /--shelf-accent:\s*#b9d0ef/u);
});

test("the standalone library exposes dark styling for its full book workflow", async () => {
  const styles = await source("apps/web/src/styles.css");
  const requiredSelectors = [
    ".library-catalog",
    ".library-summary",
    ".library-toolbar",
    ".library-search",
    ".library-status-chip",
    ".library-saved-views",
    ".library-card",
    ".library-book-cover",
    ".library-progress-track",
    ".library-detail-input",
    ".library-readme-preview",
    ".library-empty-state",
  ];

  for (const selector of requiredSelectors) {
    assert.ok(styles.includes(selector), "missing Shelf theme selector: " + selector);
  }
  assert.match(styles, /\.library-card\s*\{[^}]*background:\s*var\(--shelf-surface\)/su);
  assert.match(styles, /\.library-readme-preview\s*\{[^}]*background:\s*var\(--shelf-surface-subtle\)/su);
});

test("dark reader chrome never applies the application theme to the PDF page surface", async () => {
  const styles = await source("apps/web/src/styles.css");
  const readerPage = styles.match(/\.reader-page-mount\s*\{[^}]*\}/su);

  assert.ok(readerPage, "PDF page surface styling must remain explicit");
  assert.match(readerPage[0], /background:\s*#fff/u);
});

test("browser and installed PWA theme colors match the dark application canvas", async () => {
  const html = await source("apps/web/index.html");
  const manifest = JSON.parse(await source("apps/web/public/site.webmanifest"));

  assert.match(html, /<meta name="theme-color" content="#090c11">/u);
  assert.equal(manifest.theme_color, "#090c11");
  assert.equal(manifest.background_color, "#090c11");
});


test("the library toolbar keeps secondary filters behind an accessible disclosure", async () => {
  const catalog = await source("apps/web/src/features/library/library-catalog.ts");
  const styles = await source("apps/web/src/styles.css");

  assert.match(catalog, /element\(owner, "details", "library-advanced-filters"\)/u);
  assert.match(catalog, /toolbar\.append\(searchLabel, sortFilter, clearFiltersButton, layoutToggle, advancedFilters\)/u);
  assert.match(catalog, /syncAdvancedFilterLabel\(\)/u);
  assert.match(styles, /\.library-advanced-filters-toggle:focus-visible/u);
  assert.match(styles, /\.library-advanced-filters-content\s*\{/u);
});
