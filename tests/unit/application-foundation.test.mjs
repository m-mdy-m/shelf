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
    assert.equal(typeof manifest.scripts[script], "string", "missing pnpm script: " + script);
  }
});

test("web, reader, PDF, library, and platform adapters are locked pnpm workspaces", async () => {
  const rootManifest = await json("package.json");
  const webManifest = await json("apps/web/package.json");
  const readerManifest = await json("packages/reader-core/package.json");
  const pdfManifest = await json("packages/pdf-engine/package.json");
  const libraryManifest = await json("packages/library/package.json");
  const platformManifest = await json("packages/platform-adapters/package.json");
  const workspace = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
  const lock = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8");
  const workspacePackages = [...workspace.matchAll(/^\s+-\s+([^\s#]+)\s*$/gm)].map((match) => match[1]);

  assert.equal(rootManifest.packageManager, "pnpm@12.17.0");
  assert.equal(rootManifest.engines.pnpm, ">=12.17.0 <13");
  assert.equal("workspaces" in rootManifest, false);
  assert.deepEqual(workspacePackages, [
    "apps/web", "packages/reader-core", "packages/pdf-engine",
    "packages/library", "packages/platform-adapters",
  ]);
  assert.match(lock, /^lockfileVersion:\s*['"]?9\.0/m);
  for (const importer of [".", "apps/web", "packages/reader-core", "packages/pdf-engine", "packages/library", "packages/platform-adapters"]) {
    assert.equal(lock.includes("  " + importer + ":"), true, "missing pnpm importer: " + importer);
  }
  for (const dependency of ["typescript@5.8.3", "pdfjs-dist@6.4.299", "tailwindcss@4.3.3", "@tailwindcss/cli@4.3.3"]) {
    assert.equal(lock.includes(dependency), true, "missing locked dependency: " + dependency);
  }

  assert.equal(webManifest.name, "@shelf/web");
  assert.equal(webManifest.private, true);
  for (const name of ["@shelf/library", "@shelf/platform-adapters", "@shelf/pdf-engine", "@shelf/reader-core"]) {
    assert.equal(webManifest.dependencies[name], "workspace:0.1.0");
  }
  assert.equal(readerManifest.name, "@shelf/reader-core");
  assert.equal(readerManifest.private, true);
  assert.equal(readerManifest.types, "./dist/index.d.ts");
  assert.equal(pdfManifest.name, "@shelf/pdf-engine");
  assert.equal(pdfManifest.private, true);
  assert.equal(pdfManifest.dependencies["@shelf/reader-core"], "workspace:0.1.0");
  assert.equal(pdfManifest.dependencies["pdfjs-dist"], "6.4.299");
  assert.equal(libraryManifest.name, "@shelf/library");
  assert.equal(libraryManifest.private, true);
  assert.equal(libraryManifest.dependencies["@shelf/reader-core"], "workspace:0.1.0");
  assert.equal(platformManifest.name, "@shelf/platform-adapters");
  assert.equal(platformManifest.private, true);
  assert.equal(platformManifest.dependencies["@shelf/reader-core"], "workspace:0.1.0");
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
  const store = await readFile(path.join(root, "packages/platform-adapters/src/browser/indexeddb-store.ts"), "utf8");
  const repositories = await readFile(path.join(root, "packages/platform-adapters/src/browser/indexeddb-reader-repositories.ts"), "utf8");
  const pdfRenderer = await readFile(path.join(root, "packages/pdf-engine/src/renderer/pdf-page-renderer.ts"), "utf8");
  const buildScript = await readFile(path.join(root, "scripts/build-web.mjs"), "utf8");

  assert.equal(html.includes('src="/assets/main.js"'), true);
  assert.equal(html.includes('role="application"'), false);
  assert.equal(html.includes("frame-ancestors"), false);
  assert.equal(entry.includes('from "./application.js"'), true);
  assert.equal(shell.includes("new DocumentLibraryService"), true);
  assert.equal(shell.includes("registerCopy"), true);
  assert.equal(shell.includes("registerReference"), true);
  assert.equal(shell.includes("mountReaderWorkspace"), true);
  assert.equal(shell.includes("let documentLoadAttempt = 0"), true);
  assert.equal(shell.includes("if (isCurrentAttempt() && activeSession === opened.value)"), true);
  assert.equal(shell.includes("The linked original PDF is unavailable"), true);
  assert.equal(shell.includes("Re-import it if the source is damaged"), true);
  assert.equal(workspace.includes("createPdfPageLayers"), true);
  assert.equal(workspace.includes("if (index === currentPage && renderScale === zoom)"), true);
  assert.equal(workspace.includes('onStatus("Ready · " + session.info.pageCount + " pages.", false)'), true);
  assert.equal(workspace.includes('if (!disposed) onStatus("Ready · " + session.info.pageCount + " pages.")'), false);
  assert.equal(workspace.includes("Loading PDF page"), true);
  assert.equal(workspace.includes("Retry page"), true);
  assert.equal(workspace.includes("Retry contents"), true);
  assert.equal(workspace.includes("runSearch"), true);
  assert.equal(workspace.includes("cancelSearch"), true);
  assert.equal(workspace.includes("captureTextSelection"), true);
  assert.equal(workspace.includes("MAX_SEARCH_PAGES"), true);
  assert.equal(workspace.includes("MAX_SEARCH_CHARACTERS"), true);
  assert.equal(workspace.includes("MAX_SEARCH_QUERY_CHARACTERS"), true);
  assert.equal(workspace.includes("MAX_SELECTION_RECTANGLES"), true);
  assert.equal(workspace.includes("MAX_INTERACTION_MARKERS_PER_PAGE"), true);
  assert.equal(workspace.includes("getSelection(): TextSelection"), true);
  assert.equal(workspace.includes("onSelection?: (selection: TextSelection | null) => void;"), true);
  assert.equal(workspace.includes("options.onSelection?.(activeSelection)"), true);
  assert.equal(workspace.includes("pageText.truncated"), true);
  assert.equal(workspace.includes("jumpToSearchMatch"), true);
  assert.equal(pdfRenderer.includes("shelf-pdf-interaction-layer"), true);
  assert.equal(workspace.includes("let outlineLoaded = false"), true);
  assert.equal(workspace.includes("await loadOutline()"), false);
  assert.equal(store.includes("function isReadingProgress"), true);
  assert.equal(store.includes('"pageIndex" in record'), true);
  assert.equal(shell.includes("document.addEventListener(\"visibilitychange\""), true);
  assert.equal(shell.includes("workspace.dispose()"), true);
  assert.equal(shell.includes("Ownership of the permission-checked source handle transfers"), true);
  assert.equal(shell.includes("getPageText"), false);
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


test("Web annotations are a public feature module and Tailwind is compiled as a local asset", async () => {
  const controller = await readFile(path.join(root, "apps/web/src/features/annotations/annotation-controller.ts"), "utf8");
  const panel = await readFile(path.join(root, "apps/web/src/features/annotations/components/saved-items-panel.ts"), "utf8");
  const entry = await readFile(path.join(root, "apps/web/src/features/annotations/index.ts"), "utf8");
  const tailwind = await readFile(path.join(root, "apps/web/src/tailwind.css"), "utf8");
  const build = await readFile(path.join(root, "scripts/build-web.mjs"), "utf8");
  assert.equal(entry.includes("mountReaderAnnotationsFeature"), true);
  assert.equal(controller.includes("ReaderAnnotationUseCases"), true);
  assert.equal(controller.includes('savedToggle.setAttribute("aria-controls", savedPanel.element.id)'), true);
  assert.equal(controller.includes("scheduleSavedItemsRender"), true);
  assert.equal(controller.includes("supportedColors.includes(normalizedColor)"), true);
  assert.equal(panel.includes("nextSavedItemsPanelId"), true);
  assert.equal(controller.includes("reader-workspace"), false);
  assert.equal(controller.includes("ReaderAnnotationService"), false);
  assert.equal(tailwind.includes('@import "tailwindcss"'), true);
  assert.equal(tailwind.includes("@source"), true);
  assert.equal(build.includes("pnpm"), true);
  assert.equal(/\bnpm(?:\.cmd)?\b/.test(build), false);
  assert.equal(build.includes('pdfEngineRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")'), true);
  assert.equal(build.includes('path.join(output, "styles.css")'), true);
});


test("Reader annotation use cases are composed outside the Web feature", async () => {
  const service = await readFile(path.join(root, "packages/reader-core/src/application/reader-annotations.ts"), "utf8");
  const contract = await readFile(path.join(root, "packages/reader-core/src/application/reader-use-cases.ts"), "utf8");
  const app = await readFile(path.join(root, "apps/web/src/application.ts"), "utf8");
  const workspace = await readFile(path.join(root, "apps/web/src/reader-workspace.ts"), "utf8");
  const feature = await readFile(path.join(root, "apps/web/src/features/annotations/annotation-controller.ts"), "utf8");
  const store = await readFile(path.join(root, "packages/platform-adapters/src/browser/indexeddb-store.ts"), "utf8");
  const repositories = await readFile(path.join(root, "packages/platform-adapters/src/browser/indexeddb-reader-repositories.ts"), "utf8");

  assert.equal(contract.includes("ReaderAnnotationUseCases"), true);
  assert.equal(contract.includes("updateAnnotation(annotation"), true);
  assert.equal(service.includes("class ReaderAnnotationService"), true);
  assert.equal(service.includes("BookmarkRepositoryPort"), true);
  assert.equal(service.includes("ClockPort"), true);
  assert.equal(service.includes("IdGeneratorPort"), true);
  assert.equal(app.includes("new ReaderAnnotationService"), true);
  assert.equal(app.includes("annotationUseCases"), true);
  assert.equal(workspace.includes("mountReaderAnnotationsFeature"), true);
  assert.equal(workspace.includes("new ReaderAnnotationService"), false);
  assert.equal(feature.includes("ReaderAnnotationUseCases"), true);
  assert.equal(feature.includes("IndexedDbShelfStore"), false);
  assert.equal(feature.includes("PdfPageRenderer"), false);
  assert.equal(store.includes("factory.open(this.#databaseName, DATABASE_VERSION)"), true);
  assert.equal(store.includes('"bookmarks"'), true);
  assert.equal(store.includes('"annotations"'), true);
  assert.equal(store.includes('"quotes"'), true);
  assert.equal(store.includes('createIndex("documentId", "documentId"'), true);
  assert.equal(store.includes("async listBookmarks"), true);
  assert.equal(store.includes("async listAnnotations"), true);
  assert.equal(store.includes("async listQuotes"), true);
  assert.equal(store.includes("const DATABASE_VERSION = 4;"), true);
  assert.equal(store.includes("async exportReaderData"), true);
  assert.equal(store.includes("async restoreReaderData"), true);
  assert.equal(store.includes('database.transaction(names, "readwrite")'), true);
  assert.equal(store.includes('store.createIndex("updatedAt", "updatedAt"'), true);
  assert.equal(store.includes("copies").valueOf(), true);
  assert.equal(store.includes("references").valueOf(), true);
  assert.equal(store.includes("BookmarkRepositoryPort"), false);
  assert.equal(repositories.includes("createIndexedDbReaderRepositories"), true);
  assert.equal(repositories.includes("BookmarkRepositoryPort"), true);
  assert.equal(repositories.includes("AnnotationRepositoryPort"), true);
  assert.equal(repositories.includes("QuoteRepositoryPort"), true);
});

test("backend is split into domain, application, ports, HTTP and SQLite adapters", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const backendModule = await readFile(path.join(root, "backend/go.mod"), "utf8");
  const service = await readFile(path.join(root, "backend/internal/application/annotations.go"), "utf8");
  const ports = await readFile(path.join(root, "backend/internal/ports/annotations.go"), "utf8");
  const sqlite = await readFile(path.join(root, "backend/internal/adapters/storage/sqlite/annotations.go"), "utf8");
  const http = await readFile(path.join(root, "backend/internal/adapters/httpapi/annotations.go"), "utf8");
  const migration = await readFile(path.join(root, "backend/migrations/0001_reader_annotations.sql"), "utf8");

  assert.equal(backendModule.includes("module shelf/backend"), true);
  assert.equal(service.includes("func (s *AnnotationService) CreateAnnotation"), true);
  assert.equal(ports.includes("type ReaderAnnotationRepository interface"), true);
  assert.equal(sqlite.includes("database/sql"), true);
  assert.equal(http.includes("http.NewServeMux()"), true);
  assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS reader_bookmarks"), true);
  assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS reader_annotations"), true);
  assert.equal(migration.includes("CREATE TABLE IF NOT EXISTS reader_quotes"), true);
  assert.equal(workflow.includes("working-directory: backend"), true);
  assert.equal(workflow.includes("go test ./..."), true);
});
