import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["apps/web/src", "packages", "backend/internal"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
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
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      files.push(...(await collect(relative)));
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(relative);
    }
  }
  return files;
}

function report(file, line, message) {
  failures.push(`${file}:${line}: ${message}`);
}

function visit(node, sourceFile, file, moduleSpecifiers) {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  if (ts.isDebuggerStatement(node)) report(file, line, "remove debugger statements");
  if (node.kind === ts.SyntaxKind.AnyKeyword) report(file, line, "avoid explicit any types");

  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const specifier = node.moduleSpecifier;
    if (specifier && ts.isStringLiteralLike(specifier)) moduleSpecifiers.push(specifier.text);
  }

  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0])
  ) {
    moduleSpecifiers.push(node.arguments[0].text);
  }

  ts.forEachChild(node, (child) => visit(child, sourceFile, file, moduleSpecifiers));
}

function checkComments(file, source, scriptKind) {
  const languageVariant = scriptKind === ts.ScriptKind.TSX ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, languageVariant, source);

  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      if (/@ts-ignore\b/u.test(scanner.getTokenText())) {
        const line = source.slice(0, scanner.getTokenPos()).split("\n").length;
        report(file, line, "use a typed fix instead of @ts-ignore");
      }
    }
  }
}

const files = (await Promise.all(sourceRoots.map(collect))).flat();

for (const file of files) {
  const source = await readFile(path.join(root, file), "utf8");
  const extension = path.extname(file);
  const scriptKind = extension === ".tsx" ? ts.ScriptKind.TSX :
    extension === ".js" || extension === ".mjs" ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const moduleSpecifiers = [];

  visit(sourceFile, sourceFile, file, moduleSpecifiers);
  checkComments(file, source, scriptKind);

  for (const specifier of moduleSpecifiers) {
    if (file.startsWith("apps/web/src/")) {
      if (/^(?:\.\.\/)+backend\//u.test(specifier) || /^(?:node:|better-sqlite3$|@capacitor\/)/u.test(specifier)) {
        report(file, 1, `web shell must use application ports, not backend/native internals (${specifier})`);
      }
    }
    if (file.startsWith("packages/")) {
      if (/^(?:\.\.\/)+apps\//u.test(specifier) || /^(?:\.\.\/)+backend\//u.test(specifier)) {
        report(file, 1, `shared packages must not depend on application shells or backend internals (${specifier})`);
      }
    }
    if (file.includes("/domain/") && /^(?:react|react-dom|pdfjs-dist|better-sqlite3|@capacitor\/|node:)/u.test(specifier)) {
      report(file, 1, `domain code must remain platform and framework independent (${specifier})`);
    }
    if (specifier === "pdfjs-dist" && file !== "packages/pdf-engine/src/adapter/pdfjs-runtime.ts") {
      report(file, 1, `PDF.js may only be imported by the isolated PDF.js runtime adapter (${specifier})`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS: AST architecture and source lint (${files.length} files)`);
}
