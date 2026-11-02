import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the application shell declares its language and base direction", async () => {
  const html = await readFile(path.join(root, "apps/web/index.html"), "utf8");
  assert.equal(html.includes('<html lang="en" dir="ltr">'), true);
});

test("Reader content isolates document-controlled mixed-direction text", async () => {
  const workspace = await readFile(path.join(root, "apps/web/src/reader-workspace.ts"), "utf8");
  const annotations = await readFile(
    path.join(root, "apps/web/src/features/annotations/components/saved-items-panel.ts"),
    "utf8",
  );
  assert.equal(workspace.includes('documentTitle.dir = "auto"'), true);
  assert.equal(workspace.includes('selectionText.dir = "auto"'), true);
  assert.equal(workspace.includes('snippet.dir = "auto"'), true);
  assert.equal(workspace.includes('link.dir = "auto"'), true);
  assert.equal(workspace.includes('stage.setAttribute("aria-keyshortcuts"'), true);
  assert.equal(annotations.includes('excerpt.dir = "auto"'), true);
  assert.equal(annotations.includes('stateText.dir = "auto"'), true);
});

test("Reader mobile styles provide usable controls and respect motion and contrast settings", async () => {
  const styles = await readFile(path.join(root, "apps/web/src/styles.css"), "utf8");
  assert.equal(styles.includes("@media (max-width: 420px)"), true);
  assert.equal(styles.includes("@media (prefers-reduced-motion: reduce)"), true);
  assert.equal(styles.includes("@media (prefers-contrast: more)"), true);
  assert.equal(styles.includes("@media (forced-colors: active)"), true);
  assert.equal(styles.includes("text-size-adjust: 100%"), true);
  assert.equal(styles.includes("min-height: 2.75rem"), true);
  assert.equal(styles.includes(":focus-visible"), true);
});

test("PDF.js selectable text and Shelf saved text use explicit bidi isolation", async () => {
  const pdfStyles = await readFile(path.join(root, "packages/pdf-engine/src/styles.css"), "utf8");
  const readerStyles = await readFile(path.join(root, "apps/web/src/styles.css"), "utf8");
  assert.equal(pdfStyles.includes("unicode-bidi: plaintext"), true);
  assert.equal(pdfStyles.includes("unicode-bidi: isolate"), true);
  assert.equal(readerStyles.includes(".reader-selection-text"), true);
  assert.equal(readerStyles.includes("unicode-bidi: isolate"), true);
});

test("annotation and selection actions meet the 44px touch-target baseline", async () => {
  const controller = await readFile(
    path.join(root, "apps/web/src/features/annotations/annotation-controller.ts"),
    "utf8",
  );
  const selection = await readFile(
    path.join(root, "apps/web/src/features/annotations/components/selection-actions.ts"),
    "utf8",
  );
  const savedItems = await readFile(
    path.join(root, "apps/web/src/features/annotations/components/saved-items-panel.ts"),
    "utf8",
  );
  assert.equal(controller.includes("min-h-11"), true);
  assert.equal(selection.includes("min-h-11"), true);
  assert.equal(savedItems.includes("min-h-11"), true);
});
