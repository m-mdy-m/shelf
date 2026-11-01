import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  MAX_DOCUMENT_READ_BYTES,
  toOpaqueId,
} from "../../packages/reader-core/dist/index.js";
import { DocumentLibraryService } from "../../packages/library/dist/index.js";

function digest(data) {
  return {
    async digest(input) {
      return { ok: true, value: new Uint8Array(createHash("sha256").update(input).digest()) };
    },
  };
}

function setup(options = {}) {
  const bytes = options.bytes ?? new Uint8Array(
    [...new TextEncoder().encode("%PDF-1.7\n"), ...new Uint8Array(2048)],
  );
  const records = new Map();
  const locators = new Map();
  const reads = [];
  const discarded = [];
  const opened = [];
  const closed = [];
  const permissionRequests = [];
  const permissionState = { value: options.permission ?? "granted" };
  let nextId = 0;

  const source = {
    async inspect() {
      return { ok: true, value: {
        mediaType: options.mediaType ?? "application/pdf",
        sizeBytes: bytes.byteLength,
        modifiedAt: 1700000000000,
        displayName: options.name ?? "book.pdf",
      } };
    },
    async open(locator) {
      opened.push(locator.value);
      if (options.openFailure) {
        return { ok: false, error: { code: "document-unavailable", message: "Unavailable", retryable: true } };
      }
      return { ok: true, value: {
        id: toOpaqueId("source-" + String(opened.length)),
        metadata: {
          mediaType: "application/pdf",
          sizeBytes: bytes.byteLength,
          modifiedAt: 1700000000000,
          displayName: options.name ?? "book.pdf",
        },
      } };
    },
    async read(_handle, range) {
      reads.push(range);
      if (range.length > MAX_DOCUMENT_READ_BYTES) {
        return { ok: false, error: { code: "invalid-range", message: "Too large", retryable: false } };
      }
      return { ok: true, value: bytes.slice(range.offset, range.offset + range.length) };
    },
    async close(handle) {
      closed.push(String(handle));
      return { ok: true, value: undefined };
    },
  };

  const repository = {
    async getById(id) { return { ok: true, value: records.get(String(id)) ?? null }; },
    async list() { return { ok: true, value: [...records.values()] }; },
    async save(document) { records.set(String(document.id), document); return { ok: true, value: undefined }; },
    async delete(id) { records.delete(String(id)); return { ok: true, value: undefined }; },
  };
  const locatorStore = {
    async getLocator(id) { return { ok: true, value: locators.get(String(id)) ?? null }; },
    async saveLocator(id, locator) { locators.set(String(id), locator); return { ok: true, value: undefined }; },
    async deleteLocator(id) { locators.delete(String(id)); return { ok: true, value: undefined }; },
  };
  const permissions = {
    async query() { return { ok: true, value: permissionState.value }; },
    async request(locator) {
      permissionRequests.push(locator.value);
      return { ok: true, value: options.requestedPermission ?? "granted" };
    },
    async release() { return { ok: true, value: undefined }; },
  };
  const cleanup = {
    async discard(locator) {
      discarded.push(locator.value);
      return { ok: true, value: undefined };
    },
  };
  const service = new DocumentLibraryService({
    documents: repository,
    locators: locatorStore,
    source,
    permissions,
    ids: {
      next(kind) {
        nextId += 1;
        return toOpaqueId(kind.toLowerCase() + "-" + String(nextId));
      },
    },
    clock: { now: () => 1700000000000 + nextId },
    digest: digest(),
    cleanup,
  });

  function locator(value) {
    return { kind: "opaque", providerId: "test-provider", value, persistence: "reopenable" };
  }

  return {
    service, records, locators, reads, discarded, opened, closed,
    permissionRequests, permissionState, source, repository, locatorStore,
    locator, bytes,
  };
}

test("imports a local PDF with stable Shelf identity and safe source metadata", async () => {
  const env = setup();
  const result = await env.service.importDocument({
    locator: env.locator("copy-a"),
    sourceKind: "imported-copy",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.duplicate, false);
  assert.equal(result.value.document.source.kind, "imported-copy");
  assert.equal(result.value.document.source.displayName, "book.pdf");
  assert.match(result.value.document.fingerprint, /^sha256-chain-v1:[a-f0-9]{64}$/u);
  assert.equal(env.locators.size, 1);
  assert.equal(env.reads.length, 1);
  assert.equal("locator" in result.value.document, false);
});

test("fingerprinting streams a large PDF in bounded byte ranges", async () => {
  const size = MAX_DOCUMENT_READ_BYTES + 17;
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  const env = setup({ bytes });

  const result = await env.service.importDocument({
    locator: env.locator("large-copy"),
    sourceKind: "imported-copy",
  });

  assert.equal(result.ok, true);
  assert.equal(env.reads.length, 2);
  assert.deepEqual(env.reads.map((range) => range.length), [MAX_DOCUMENT_READ_BYTES, 17]);
  assert.ok(env.reads.every((range) => range.length <= MAX_DOCUMENT_READ_BYTES));
});

test("duplicate bytes return the existing document and discard only the staged duplicate", async () => {
  const env = setup();
  const first = await env.service.importDocument({
    locator: env.locator("copy-original"),
    sourceKind: "imported-copy",
  });
  const second = await env.service.importDocument({
    locator: env.locator("copy-duplicate"),
    sourceKind: "external-reference",
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(second.value.duplicate, true);
  assert.equal(second.value.document.id, first.value.document.id);
  assert.equal(env.records.size, 1);
  assert.equal(env.locators.size, 1);
  assert.equal(env.discarded.includes("copy-duplicate"), true);
  assert.equal(env.discarded.includes("copy-original"), false);
});

test("rejects non-PDF media before opening or persisting a document", async () => {
  const env = setup({ mediaType: "image/png", name: "cover.png" });
  const result = await env.service.importDocument({
    locator: env.locator("image"),
    sourceKind: "imported-copy",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "unsupported-document");
  assert.equal(env.opened.length, 0);
  assert.equal(env.records.size, 0);
});

test("opening requests prompted permission and returns the open source handle", async () => {
  const env = setup({ permission: "prompt" });
  const imported = await env.service.importDocument({
    locator: env.locator("reference-a"),
    sourceKind: "external-reference",
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;

  const opened = await env.service.openDocument(imported.value.document.id);
  assert.equal(opened.ok, true);
  assert.deepEqual(env.permissionRequests, ["reference-a"]);
  if (opened.ok) {
    assert.equal(opened.value.document.id, imported.value.document.id);
    const closed = await env.service.closeDocument(opened.value.source);
    assert.equal(closed.ok, true);
  }
});

test("expired, denied, and missing access are distinct recoverable states", async () => {
  for (const [permission, expected] of [
    ["expired", "permission-expired"],
    ["denied", "permission-denied"],
    ["unavailable", "document-unavailable"],
  ]) {
    const env = setup({ permission });
    const imported = await env.service.importDocument({
      locator: env.locator("external-" + permission),
      sourceKind: "external-reference",
    });
    assert.equal(imported.ok, true);
    if (!imported.ok) continue;

    const opened = await env.service.openDocument(imported.value.document.id);
    assert.equal(opened.ok, false);
    if (!opened.ok) assert.equal(opened.error.code, expected);
    assert.equal(env.opened.length, 1, "only import fingerprinting opens the source");
  }
});

test("a missing locator returns unavailable without opening a source", async () => {
  const env = setup();
  const fakeId = toOpaqueId("missing-document");
  const result = await env.service.openDocument(fakeId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "document-not-found");
  assert.equal(env.opened.length, 0);
});


test("re-registering the same locator never discards the source still owned by the existing record", async () => {
  const env = setup();
  const original = env.locator("same-source");
  const first = await env.service.importDocument({
    locator: original,
    sourceKind: "imported-copy",
  });
  const duplicate = await env.service.importDocument({
    locator: original,
    sourceKind: "imported-copy",
  });

  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(env.records.size, 1);
  assert.equal(env.locators.size, 1);
  assert.deepEqual(env.discarded, []);
});
