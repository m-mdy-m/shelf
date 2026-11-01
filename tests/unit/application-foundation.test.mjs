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
  const required = ["format:check", "lint", "typecheck", "test", "build", "check", "ci"];
  for (const script of required) {
    assert.equal(typeof manifest.scripts[script], "string", `missing npm script: ${script}`);
  }
});

test("the web shell is a private npm workspace with a pinned TypeScript compiler", async () => {
  const rootManifest = await json("package.json");
  const webManifest = await json("apps/web/package.json");
  const lock = await json("package-lock.json");

  assert.deepEqual(rootManifest.workspaces, ["apps/web"]);
  assert.equal(webManifest.name, "@shelf/web");
  assert.equal(rootManifest.devDependencies.typescript, "5.8.3");
  assert.equal(lock.packages["node_modules/typescript"].version, "5.8.3");
  assert.equal(lock.lockfileVersion, 3);
});

test("TypeScript compiler options enforce strict checking", async () => {
  const config = await json("tsconfig.base.json");
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.noUncheckedIndexedAccess, true);
  assert.equal(config.compilerOptions.exactOptionalPropertyTypes, true);
});

test("the application entry point and shell stay within the web application", async () => {
  const html = await readFile(path.join(root, "apps/web/index.html"), "utf8");
  const entry = await readFile(path.join(root, "apps/web/src/main.ts"), "utf8");
  const shell = await readFile(path.join(root, "apps/web/src/application.ts"), "utf8");

  assert.match(html, /src="\/assets\/main\.js"/u);
  assert.match(entry, /from "\.\/application\.js"/u);
  assert.match(shell, /export function mountShelf\(root: HTMLElement\)/u);
  assert.doesNotMatch(shell, /better-sqlite3|@capacitor\/|node:/u);
});

test("the repository declares explicit application boundaries", async () => {
  await access(path.join(root, "packages/reader-core"));
  await access(path.join(root, "packages/pdf-engine"));
  await access(path.join(root, "backend/internal/domain"));
  await access(path.join(root, "backend/internal/application"));
  await access(path.join(root, "backend/internal/ports"));
  await access(path.join(root, "backend/internal/adapters"));
});
