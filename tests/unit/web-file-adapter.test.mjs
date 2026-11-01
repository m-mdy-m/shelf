import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DOCUMENT_READ_BYTES,
} from "../../packages/reader-core/dist/index.js";
import {
  createWebLocalFileAdapter,
} from "../../dist/web/assets/adapters/web-local-files.js";

class FakeOpfsDirectory {
  #files = new Map();

  async getFileHandle(name, options = {}) {
    if (!this.#files.has(name) && options.create !== true) {
      throw new Error("File is missing");
    }

    if (!this.#files.has(name)) this.#files.set(name, new Blob([]));

    return {
      getFile: async () => this.#files.get(name),
      createWritable: async () => {
        const chunks = [];
        return {
          async write(chunk) {
            chunks.push(chunk.slice());
          },
          async close() {
            this.#files.set(name, new Blob(chunks));
          },
          async abort() {
            chunks.length = 0;
          },
        };
      },
    };
  }

  async removeEntry(name) {
    if (!this.#files.delete(name)) throw new Error("File is missing");
  }
}

test("web local file adapter copies a picked Blob to persistent OPFS using bounded reads", async () => {
  const directory = new FakeOpfsDirectory();
  const adapter = createWebLocalFileAdapter(directory);
  const bytes = new Uint8Array(MAX_DOCUMENT_READ_BYTES + 37);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  for (let index = 8; index < bytes.length; index += 1) bytes[index] = index % 239;

  const picked = adapter.registerPickedFile(
    new Blob([bytes], { type: "application/pdf" }),
    "Private Folder/Book.pdf",
    1234,
  );
  assert.equal(picked.persistence, "ephemeral");
  assert.equal((await adapter.query(picked)).ok, true);

  const opened = await adapter.open(picked);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;

  const firstChunk = await adapter.read(opened.value.id, { offset: 0, length: 5 });
  assert.equal(firstChunk.ok, true);
  if (firstChunk.ok) assert.equal(new TextDecoder().decode(firstChunk.value), "%PDF-");

  const copy = await adapter.copyFromSource(adapter, opened.value.id, opened.value.metadata);
  assert.equal(copy.ok, true);
  if (!copy.ok) return;
  assert.equal(copy.value.persistence, "reopenable");
  assert.equal(copy.value.providerId, "shelf-web-opfs");

  const closed = await adapter.close(opened.value.id);
  assert.equal(closed.ok, true);

  const restartedAdapter = createWebLocalFileAdapter(directory);
  assert.equal((await restartedAdapter.query(picked)).value, "unavailable");

  const reopened = await restartedAdapter.open(copy.value);
  assert.equal(reopened.ok, true);
  if (!reopened.ok) return;
  assert.equal(reopened.value.metadata.displayName, "Book.pdf");

  const reloaded = await restartedAdapter.read(reopened.value.id, {
    offset: 0,
    length: bytes.byteLength,
  });
  assert.equal(reloaded.ok, false);
  if (!reloaded.ok) assert.equal(reloaded.error.code, "invalid-range");

  const first = await restartedAdapter.read(reopened.value.id, {
    offset: 0,
    length: MAX_DOCUMENT_READ_BYTES,
  });
  const tail = await restartedAdapter.read(reopened.value.id, {
    offset: MAX_DOCUMENT_READ_BYTES,
    length: bytes.byteLength - MAX_DOCUMENT_READ_BYTES,
  });
  assert.equal(first.ok, true);
  assert.equal(tail.ok, true);
  if (first.ok && tail.ok) {
    const joined = new Uint8Array(first.value.byteLength + tail.value.byteLength);
    joined.set(first.value);
    joined.set(tail.value, first.value.byteLength);
    assert.deepEqual(joined, bytes);
  }

  const deleted = await restartedAdapter.deleteCopy(copy.value);
  assert.equal(deleted.ok, true);
  assert.equal((await restartedAdapter.query(copy.value)).value, "unavailable");
});

test("web local file adapter rejects unsupported locators and reads after close", async () => {
  const adapter = createWebLocalFileAdapter(new FakeOpfsDirectory());
  const unsupported = await adapter.open({
    kind: "content-uri",
    providerId: "android",
    value: "content://not-a-web-source",
    persistence: "reopenable",
  });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.error.code, "not-supported");

  const picked = adapter.registerPickedFile(
    new Blob(["%PDF-1.7\n"], { type: "application/pdf" }),
    "one.pdf",
  );
  const opened = await adapter.open(picked);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;

  await adapter.close(opened.value.id);
  const read = await adapter.read(opened.value.id, { offset: 0, length: 5 });
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.error.code, "document-unavailable");
});
