import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "apps", "web");
const output = path.join(root, "dist", "web");
const entryAsset = path.join(output, "assets", "main.js");
const pdfPackage = path.join(root, "node_modules", "pdfjs-dist");

try {
  await access(entryAsset);
} catch {
  throw new Error("Compiled web entry asset is missing. Run the TypeScript build before copying web assets.");
}

await mkdir(path.join(output, "assets"), { recursive: true });
await cp(path.join(source, "index.html"), path.join(output, "index.html"));
await cp(path.join(source, "src", "styles.css"), path.join(output, "styles.css"));
await cp(path.join(source, "public"), output, { recursive: true });

const pdfAssets = [
  ["LICENSE", "assets/pdfjs/LICENSE"],
  ["build/pdf.worker.min.mjs", "assets/pdfjs/build/pdf.worker.min.mjs"],
  ["cmaps", "assets/pdfjs/cmaps"],
  ["iccs", "assets/pdfjs/iccs"],
  ["image_decoders", "assets/pdfjs/image_decoders"],
  ["standard_fonts", "assets/pdfjs/standard_fonts"],
  ["wasm", "assets/pdfjs/wasm"],
];

for (const [relativeSource, relativeDestination] of pdfAssets) {
  const input = path.join(pdfPackage, relativeSource);
  const destination = path.join(output, relativeDestination);
  try {
    await access(input);
  } catch {
    throw new Error(`Required PDF.js runtime asset is missing: pdfjs-dist/${relativeSource}`);
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await cp(input, destination, { recursive: true });
}

await cp(
  path.join(root, "packages", "pdf-engine", "src", "styles.css"),
  path.join(output, "assets", "pdf-engine.css"),
);

console.log(
  `Built standalone web shell with the PDF.js worker, CMaps, ICC profiles, image decoders, standard fonts, WASM, license notices, and Reader layer styles at ${path.relative(root, output)}.`,
);
