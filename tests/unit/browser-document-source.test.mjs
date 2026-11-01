import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { BrowserDocumentSource } from "../../packages/platform-adapters/dist/index.js";

function createStorage() {
  const copies = new Map();
  const references = new Map();
  return {
    copies,
    references,
    async saveCopy(key, copy) { copies.set(key, copy); },
    async getCopy(key) { return copies.get(key) ?? null; },
    async deleteCopy(key) { copies.delete(key); },
    async saveReference(key, handle) { references.set(key, handle); },
    async getReference(key) { return references.get(key) ?? null; },
    async deleteReference(key) { references.delete(key); },
  };
}

function makePdf(name = "fixture.pdf") {
  return new File([new TextEncoder().encode("%PDF-1.7\n0123456789")], name, {
    type: "application/pdf",
    lastModified: 1700000000000,
  });
}

test("copy import stores a Shelf-owned Blob and reads bounded ranges", async () => {
  const storage = createStorage();
  const source = new BrowserDocumentSource(storage);
  const registered = await source.registerCopy(makePdf());
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  assert.equal(storage.copies.size, 1);
  const inspected = await source.inspect(registered.value);
  assert.equal(inspected.ok, true);
  const opened = await source.open(registered.value);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;

  const read = await source.read(opened.value.id, { offset: 5, length: 4 });
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(new TextDecoder().decode(read.value), "1.7\n");

  const permission = await source.query(registered.value);
  assert.deepEqual(permission, { ok: true, value: "granted" });
  await source.close(opened.value.id);
  await source.discard(registered.value);
  assert.equal(storage.copies.size, 0);
});

test("external reference honors browser permission state and never deletes original", async () => {
  const storage = createStorage();
  const source = new BrowserDocumentSource(storage);
  let state = "prompt";
  let fileReadCount = 0;
  const original = makePdf("original.pdf");
  const handle = {
    kind: "file",
    name: "original.pdf",
    async getFile() { fileReadCount += 1; return original; },
    async queryPermission() { return state; },
    async requestPermission() { state = "granted"; return state; },
  };

  const registered = await source.registerReference(handle);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  assert.equal(storage.references.size, 1);

  const query = await source.query(registered.value);
  assert.deepEqual(query, { ok: true, value: "prompt" });
  const requested = await source.request(registered.value);
  assert.deepEqual(requested, { ok: true, value: "granted" });

  const opened = await source.open(registered.value);
  assert.equal(opened.ok, true);
  if (opened.ok) await source.close(opened.value.id);

  await source.discard(registered.value);
  assert.equal(storage.references.size, 0);
  assert.ok(fileReadCount >= 2);
  assert.equal(original.size > 0, true);
});

test("expired external access and missing source return distinct errors", async () => {
  const storage = createStorage();
  const source = new BrowserDocumentSource(storage);
  const locator = {
    kind: "browser-handle",
    providerId: "shelf-browser-reference",
    value: "ref-expired",
    persistence: "reopenable",
  };
  storage.references.set("ref-expired", {
    kind: "file",
    name: "expired.pdf",
    async getFile() { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); },
    async queryPermission() { return "denied"; },
    async requestPermission() { return "denied"; },
  });

  const expired = await source.inspect(locator);
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.error.code, "permission-expired");

  await storage.deleteReference("ref-expired");
  const missing = await source.inspect(locator);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, "document-unavailable");
});

test("rejects invalid ranges and does not read when a source handle is closed", async () => {
  const storage = createStorage();
  const source = new BrowserDocumentSource(storage);
  const registered = await source.registerCopy(makePdf());
  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  const opened = await source.open(registered.value);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;

  const invalid = await source.read(opened.value.id, { offset: 0, length: 1024 * 1024 + 1 });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, "invalid-range");

  await source.close(opened.value.id);
  const closed = await source.read(opened.value.id, { offset: 0, length: 1 });
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.error.code, "document-not-found");
});
