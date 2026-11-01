import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "apps", "web");
const output = path.join(root, "dist", "web");

await mkdir(output, { recursive: true });
await cp(path.join(source, "index.html"), path.join(output, "index.html"));
await cp(path.join(source, "src", "styles.css"), path.join(output, "styles.css"));
await cp(path.join(source, "public"), output, { recursive: true });

console.log(`Built standalone web shell at ${path.relative(root, output)}.`);
