import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["apps/web", "scripts", "tests"];
const extensions = new Set([".css", ".json", ".mjs", ".ts"]);
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
    } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
      files.push(relative);
    }
  }
  return files;
}

const files = [...new Set((await Promise.all(roots.map(collect))).flat())].sort();

for (const file of files) {
  const source = await readFile(path.join(root, file), "utf8");
  if (source.includes("\r")) failures.push(`${file}: use LF line endings`);
  if (source.length > 0 && !source.endsWith("\n")) failures.push(`${file}: missing final newline`);
  if (/[^\S\n]+\n/u.test(source)) failures.push(`${file}: trailing whitespace`);
  if (source.startsWith("\uFEFF")) failures.push(`${file}: remove UTF-8 BOM`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS: source formatting checks (${files.length} files)`);
}
