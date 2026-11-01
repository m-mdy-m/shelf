import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await rm(path.join(root, "dist"), { recursive: true, force: true });
await rm(path.join(root, "apps", "web", "tsconfig.tsbuildinfo"), { force: true });
console.log("Cleaned generated Shelf build output.");
