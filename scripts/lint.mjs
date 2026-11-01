import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["apps/web/src", "packages", "backend/internal"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".go"]);
const failures = [];

async function collect(directory) {
  let entries;
  try {
    entries = await readdir(path.join(root, directory), { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collect(relative)));
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(relative);
    }
  }
  return files;
}

function report(file, message) {
  failures.push(`${file}: ${message}`);
}

const files = (await Promise.all(sourceRoots.map(collect))).flat();

for (const file of files) {
  const source = await readFile(path.join(root, file), "utf8");
  if (/\bdebugger\s*;?/u.test(source)) report(file, "remove debugger statements");
  if (/\/\/\s*@ts-ignore\b/u.test(source)) report(file, "use a typed fix instead of @ts-ignore");
  if (/\bas\s+any\b|:\s*any\b/u.test(source)) report(file, "avoid the any type");

  const imports = source.matchAll(
    /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(["']([^"']+)["']\)/gu,
  );

  for (const match of imports) {
    const specifier = match[1] ?? match[2] ?? "";
    if (file.startsWith("apps/web/src/")) {
      if (/^(?:\.\.\/)+backend\//u.test(specifier) || /^(?:node:|better-sqlite3$|@capacitor\/)/u.test(specifier)) {
        report(file, `web shell must use application ports, not backend/native internals (${specifier})`);
      }
    }
    if (file.startsWith("packages/")) {
      if (/^(?:\.\.\/)+apps\//u.test(specifier) || /^(?:\.\.\/)+backend\//u.test(specifier)) {
        report(file, `shared packages must not depend on application shells or backend internals (${specifier})`);
      }
    }
    if (file.includes("/domain/") && /^(?:react|react-dom|pdfjs-dist|better-sqlite3|@capacitor\/|node:)/u.test(specifier)) {
      report(file, `domain code must remain platform and framework independent (${specifier})`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS: architecture and source lint (${files.length} files)`);
}
