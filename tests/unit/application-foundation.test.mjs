import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

test("the root workspace exposes all required quality gates", async () => {
  const manifest = await json("package.json");
  const required = ["format:check", "lint", "typecheck", "test", "build:core", "build:library", "build:platform", "build:pdf", "build", "check", "ci"];
  for (const script of required) {
    assert.equal(typeof manifest.scripts[script], "string", "missing npm script: " + script);
  }
});

test("web, reader, PDF, library, and platform adapters are locked workspaces", async () => {
  const rootManifest = await json("package.json");
  const webManifest = await json("apps/web/package.json");
  const readerManifest = await json("packages/reader-core/package.json");
  const pdfManifest = await json("packages/pdf-engine/package.json");
  const libraryManifest = await json("packages/library/package.json");
  const platformManifest = await json("packages/platform-adapters/package.json");
  const lock = await json("package-lock.json");

  assert.deepEqual(rootManifest.workspaces, [
    "apps/web", "packages/reader-core", "packages/pdf-engine",
    "packages/library", "packages/platform-adapters",
  ]);
  assert.equal(webManifest.name, "@shelf/web");
  assert.equal(webManifest.private, true);
  for (const name of ["@shelf/library", "@shelf/platform-adapters", "@shelf/pdf-engine", "@shelf/reader-core"]) {
    assert.equal(webManifest.dependencies[name], "0.1.0");
  }
  assert.equal(readerManifest.name, "@shelf/reader-core");
  assert.equal(readerManifest.private, true);
  assert.equal(readerManifest.types, "./dist/index.d.ts");
  assert.equal(pdfManifest.name, "@shelf/pdf-engine");
  assert.equal(pdfManifest.private, true);
  assert.equal(pdfManifest.dependencies["@shelf/reader-core"], "0.1.0");
  assert.equal(pdfManifest.dependencies["pdfjs-dist"], "6.4.299");
  assert.equal(libraryManifest.name, "@shelf/library");
  assert.equal(libraryManifest.private, true);
  assert.equal(libraryManifest.dependencies["@shelf/reader-core"], "0.1.0");
  assert.equal(platformManifest.name, "@shelf/platform-adapters");
  assert.equal(platformManifest.private, true);
  assert.equal(platformManifest.dependencies["@shelf/reader-core"], "0.1.0");

  for (const [key, name] of [
    ["packages/reader-core", "@shelf/reader-core"],
    ["packages/pdf-engine", "@shelf/pdf-engine"],
    ["packages/library", "@shelf/library"],
    ["packages/platform-adapters", "@shelf/platform-adapters"],
  ]) {
    assert.equal(lock.packages[key].name, name);
    assert.equal(lock.packages["node_modules/" + name].resolved, key);
  }
  assert.equal(lock.packages["node_modules/typescript"].version, "5.8.3");
  assert.equal(lock.packages["node_modules/pdfjs-dist"].version, "6.4.299");
  assert.equal(lock.packages["node_modules/pdfjs-dist"].integrity.length > 20, true);
  assert.equal(lock.lockfileVersion, 3);
});

test("Node runtime pin matches the declared engine range", async () => {
  const manifest = await json("package.json");
  const version = (await readFile(path.join(root, ".nvmrc"), "utf8")).trim();
  const segments = version.split(".");
  assert.equal(segments.length, 3);
  assert.ok(segments.every((part) => part.length > 0 && [...part].every((character) => character >= "0" && character <= "9")));
  assert.ok(manifest.engines.node.includes(">=" + version));
});

test("TypeScript compiler options enforce strict checking", async () => {
  const config = await json("tsconfig.base.json");
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.noUncheckedIndexedAccess, true);
  assert.equal(config.compilerOptions.exactOptionalPropertyTypes, true);
});

test("the web entry point contains local import and reader wiring", async () => {
  const html = await readFile(path.join(root, "apps/web/index.html"), "utf8");
  const entry = await readFile(path.join(root, "apps/web/src/main.ts"), "utf8");
  const shell = await readFile(path.join(root, "apps/web/src/application.ts"), "utf8");
  const workspace = await readFile(path.join(root, "apps/web/src/reader-workspace.ts"), "utf8");
  const buildScript = await readFile(path.join(root, "scripts/build-web.mjs"), "utf8");

  assert.equal(html.includes('src="/assets/main.js"'), true);
  assert.equal(html.includes('role="application"'), false);
  assert.equal(html.includes("frame-ancestors"), false);
  assert.equal(entry.includes('from "./application.js"'), true);
  assert.equal(shell.includes("new DocumentLibraryService"), true);
  assert.equal(shell.includes("registerCopy"), true);
  assert.equal(shell.includes("registerReference"), true);
  assert.equal(shell.includes("mountReaderWorkspace"), true);
  assert.equal(workspace.includes("createPdfPageLayers"), true);
  assert.equal(buildScript.includes("access(entryAsset)"), true);
  assert.equal(shell.includes("fetch("), false);
  assert.equal(shell.includes("XMLHttpRequest"), false);
});

test("the repository declares explicit application boundaries", async () => {
  for (const relative of [
    "packages/reader-core", "packages/pdf-engine", "packages/library",
    "packages/platform-adapters", "backend/internal/domain",
    "backend/internal/application", "backend/internal/ports", "backend/internal/adapters",
  ]) await access(path.join(root, relative));
});
