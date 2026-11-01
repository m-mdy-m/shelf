import assert from "node:assert/strict";
import test from "node:test";
import {
  DocumentLibraryService,
  MAX_DOCUMENT_READ_BYTES,
  Sha256,
  toOpaqueId,
} from "../../packages/reader-core/dist/index.js";

const encoder = new TextEncoder();

function pdfBytes(body = "Shelf local PDF fixture") {
  return encoder.encode("%PDF-1.7\n" + body + "\n%%EOF\n");
}

function createHarness() {
  const files = new Map();
  const permissionStates = new Map();
  const locatorsByDocument = new Map();
  const documentsById = new Map();
  const readLengths = [];
  const copyLocators = new Set();
  let sourceHandleSequence = 0;
  let copySequence = 0;
  let documentSequence = 0;
  let closeCount = 0;
  let copyDeleteCount = 0;
  let failDocumentSave = false;
  let failLocatorSave = false;

  const addFile = (locator, bytes, metadata = {}) => {
    files.set(locator.value, {
      bytes,
      metadata: {
        displayName: metadata.displayName ?? "sample.pdf",
        mediaType: metadata.mediaType ?? "application/pdf",
        sizeBytes: bytes.byteLength,
        modifiedAt: metadata.modifiedAt ?? 1,
      },
    });
    if (!permissionStates.has(locator.value)) permissionStates.set(locator.value, "granted");
    return locator;
  };

  const source = {
    async inspect(locator) {
      const file = files.get(locator.value);
      if (file === undefined) {
        return { ok: false, error: { code: "document-missing", message: "PDF is missing", retryable: false } };
      }
      return { ok: true, value: file.metadata };
    },
    async open(locator) {
      const file = files.get(locator.value);
      if (file === undefined) {
        return { ok: false, error: { code: "document-missing", message: "PDF is missing", retryable: false } };
      }
      sourceHandleSequence += 1;
      return {
        ok: true,
        value: {
          id: toOpaqueId("source-" + sourceHandleSequence),
          metadata: file.metadata,
        },
      };
    },
    async read(handleId, range) {
      const activeFile = activeFilesByHandle.get(handleId);
      if (activeFile === undefined) {
        return { ok: false, error: { code: "document-missing", message: "PDF is missing", retryable: false } };
      }
      readLengths.push(range.length);
      if (!Number.isSafeInteger(range.offset) || range.offset < 0 ||
          !Number.isSafeInteger(range.length) || range.length <= 0 ||
          range.length > MAX_DOCUMENT_READ_BYTES ||
          range.offset + range.length > activeFile.bytes.byteLength) {
        return { ok: false, error: { code: "invalid-range", message: "Range is invalid", retryable: false } };
      }
      return {
        ok: true,
        value: activeFile.bytes.slice(range.offset, range.offset + range.length),
      };
    },
    async close() {
      closeCount += 1;
      return { ok: true, value: undefined };
    },
  };
  const activeFilesByHandle = new Map();
  const realOpen = source.open.bind(source);
  source.open = async (locator) => {
    const opened = await realOpen(locator);
    if (opened.ok) {
      activeFilesByHandle.set(opened.value.id, files.get(locator.value));
    }
    return opened;
  };

  const locators = {
    async getLocator(id) {
      return { ok: true, value: locatorsByDocument.get(id) ?? null };
    },
    async saveLocator(id, locator) {
      if (failLocatorSave) {
        return { ok: false, error: { code: "write-failed", message: "Locator store failed", retryable: true } };
      }
      locatorsByDocument.set(id, locator);
      return { ok: true, value: undefined };
    },
    async deleteLocator(id) {
      locatorsByDocument.delete(id);
      return { ok: true, value: undefined };
    },
  };

  const permissions = {
    async query(locator) {
      return { ok: true, value: permissionStates.get(locator.value) ?? "unavailable" };
    },
    async request(locator) {
      return { ok: true, value: permissionStates.get(locator.value) ?? "unavailable" };
    },
    async release() {
      return { ok: true, value: undefined };
    },
  };

  const copies = {
    async copyFromSource(sourcePort, handleId, metadata) {
      const chunks = [];
      for (let offset = 0; offset < (metadata.sizeBytes ?? 0); ) {
        const length = Math.min(MAX_DOCUMENT_READ_BYTES, (metadata.sizeBytes ?? 0) - offset);
        const read = await sourcePort.read(handleId, { offset, length });
        if (!read.ok) return read;
        if (read.value.byteLength !== length) {
          return { ok: false, error: { code: "read-failed", message: "Incomplete copy", retryable: true } };
        }
        chunks.push(read.value);
        offset += length;
      }
      const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      copySequence += 1;
      const locator = {
        kind: "filesystem",
        providerId: "app-library",
        value: "copy-" + copySequence,
        persistence: "reopenable",
      };
      addFile(locator, bytes, metadata);
      copyLocators.add(locator.value);
      return { ok: true, value: locator };
    },
    async deleteCopy(locator) {
      if (copyLocators.delete(locator.value)) {
        files.delete(locator.value);
        copyDeleteCount += 1;
      }
      return { ok: true, value: undefined };
    },
  };

  const documents = {
    async getById(id) {
      return { ok: true, value: documentsById.get(id) ?? null };
    },
    async findByFingerprint(fingerprint) {
      return {
        ok: true,
        value: [...documentsById.values()].find((document) => document.fingerprint === fingerprint) ?? null,
      };
    },
    async list() {
      return { ok: true, value: [...documentsById.values()] };
    },
    async save(document) {
      if (failDocumentSave) {
        return { ok: false, error: { code: "write-failed", message: "Document store failed", retryable: true } };
      }
      documentsById.set(document.id, document);
      return { ok: true, value: undefined };
    },
    async delete(id) {
      documentsById.delete(id);
      return { ok: true, value: undefined };
    },
  };

  const clock = { now: () => 1_800_000_000_000 };
  const ids = {
    next(kind) {
      documentSequence += 1;
      return toOpaqueId(kind + "-" + documentSequence);
    },
  };
  const service = new DocumentLibraryService({
    source,
    locators,
    permissions,
    copies,
    documents,
    clock,
    ids,
  });

  return {
    service,
    files,
    permissionStates,
    locatorsByDocument,
    documentsById,
    readLengths,
    copyLocators,
    closeCount: () => closeCount,
    copyDeleteCount: () => copyDeleteCount,
    failDocumentSave(value) { failDocumentSave = value; },
    failLocatorSave(value) { failLocatorSave = value; },
    addFile,
  };
}

function locator(value, persistence = "reopenable") {
  return {
    kind: "filesystem",
    providerId: "test-files",
    value,
    persistence,
  };
}

test("SHA-256 supports streaming updates and standard known vectors", () => {
  const empty = new Sha256();
  assert.equal(
    empty.digestHex(),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );

  const abc = new Sha256();
  abc.update(encoder.encode("a"));
  abc.update(encoder.encode("b"));
  abc.update(encoder.encode("c"));
  assert.equal(
    abc.digestHex(),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("imported-copy creates an app-owned reopenable copy with a stable safe record", async () => {
  const harness = createHarness();
  const original = locator("external://secret/path", "ephemeral");
  const bytes = pdfBytes();
  harness.addFile(original, bytes, { displayName: "Private Folder/Reader Sample.pdf" });

  const imported = await harness.service.importDocument({
    locator: original,
    mode: "imported-copy",
  });

  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.equal(imported.value.status, "imported");
  const document = imported.value.document;
  assert.equal(document.metadata.title, "Reader Sample");
  assert.equal(document.source.kind, "imported-copy");
  assert.equal(document.source.mediaType, "application/pdf");
  assert.equal(document.source.sizeBytes, bytes.byteLength);
  assert.equal(document.accessState, "available");
  assert.match(document.fingerprint ?? "", /^sha256:[a-f0-9]{64}$/u);
  assert.equal(harness.locatorsByDocument.get(document.id)?.value.startsWith("copy-"), true);
  assert.equal(document.source.displayName?.includes("Private Folder"), false);
  assert.equal(document.source.displayName, "Reader Sample.pdf");
  assert.equal("locator" in document, false);
  assert.equal(JSON.stringify(document).includes("external://secret/path"), false);
  assert.deepEqual([...harness.files.get(harness.locatorsByDocument.get(document.id).value).bytes], [...bytes]);
  assert.equal(harness.closeCount(), 1);
  assert.ok(harness.readLengths.every((length) => length <= MAX_DOCUMENT_READ_BYTES));
});

test("external references require a reopenable locator and preserve the original file", async () => {
  const harness = createHarness();
  const ephemeral = locator("picker-token", "ephemeral");
  harness.addFile(ephemeral, pdfBytes());

  const rejected = await harness.service.importDocument({
    locator: ephemeral,
    mode: "external-reference",
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, "not-supported");
  assert.equal(harness.documentsById.size, 0);

  const persistent = locator("handle:book-1");
  harness.addFile(persistent, pdfBytes());
  const imported = await harness.service.importDocument({
    locator: persistent,
    mode: "external-reference",
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.equal(imported.value.status, "imported");
  assert.equal(imported.value.document.source.kind, "external-reference");
  assert.equal(harness.locatorsByDocument.get(imported.value.document.id)?.value, "handle:book-1");
});

test("duplicate imports reuse the existing stable ID by default and allow explicit keep-both", async () => {
  const harness = createHarness();
  const firstLocator = locator("file-one");
  const secondLocator = locator("file-two");
  const bytes = pdfBytes("identical content");
  harness.addFile(firstLocator, bytes, { displayName: "first.pdf" });
  harness.addFile(secondLocator, bytes, { displayName: "second.pdf" });

  const first = await harness.service.importDocument({
    locator: firstLocator,
    mode: "external-reference",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const duplicate = await harness.service.importDocument({
    locator: secondLocator,
    mode: "external-reference",
  });
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.value.status, "duplicate");
  assert.equal(duplicate.value.document.id, first.value.document.id);
  assert.equal(harness.documentsById.size, 1);

  const kept = await harness.service.importDocument({
    locator: secondLocator,
    mode: "external-reference",
    duplicatePolicy: "keep-both",
  });
  assert.equal(kept.ok, true);
  if (!kept.ok) return;
  assert.equal(kept.value.status, "imported");
  assert.equal(kept.value.duplicateOf, first.value.document.id);
  assert.notEqual(kept.value.document.id, first.value.document.id);
  assert.equal(harness.documentsById.size, 2);
});

test("large PDFs are fingerprinted and copied in bounded one-mebibyte reads", async () => {
  const harness = createHarness();
  const bytes = new Uint8Array(MAX_DOCUMENT_READ_BYTES * 2 + 19);
  bytes.set(encoder.encode("%PDF-1.7\n"));
  for (let index = 8; index < bytes.length; index += 1) bytes[index] = index % 251;
  const original = locator("large-file", "ephemeral");
  harness.addFile(original, bytes, { displayName: "large.pdf" });

  const imported = await harness.service.importDocument({
    locator: original,
    mode: "imported-copy",
  });
  assert.equal(imported.ok, true);
  assert.ok(harness.readLengths.length >= 6);
  assert.ok(harness.readLengths.every((length) => length > 0 && length <= MAX_DOCUMENT_READ_BYTES));
  if (imported.ok) assert.equal(imported.value.document.source.sizeBytes, bytes.byteLength);
});

test("PDF header and media type are validated before a document is saved", async () => {
  const invalidHeader = createHarness();
  const locatorA = locator("not-pdf");
  invalidHeader.addFile(locatorA, encoder.encode("hello world"));
  const invalid = await invalidHeader.service.importDocument({
    locator: locatorA,
    mode: "external-reference",
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, "invalid-document");
  assert.equal(invalidHeader.documentsById.size, 0);

  const invalidType = createHarness();
  const locatorB = locator("wrong-type");
  invalidType.addFile(locatorB, pdfBytes(), { mediaType: "text/plain" });
  const unsupported = await invalidType.service.importDocument({
    locator: locatorB,
    mode: "external-reference",
  });
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.equal(unsupported.error.code, "unsupported-media-type");
});

test("failed persistence rolls back both access locator and imported copy", async () => {
  const harness = createHarness();
  const original = locator("rollback-source", "ephemeral");
  harness.addFile(original, pdfBytes());
  harness.failDocumentSave(true);

  const imported = await harness.service.importDocument({
    locator: original,
    mode: "imported-copy",
  });
  assert.equal(imported.ok, false);
  if (!imported.ok) assert.equal(imported.error.code, "write-failed");
  assert.equal(harness.documentsById.size, 0);
  assert.equal(harness.locatorsByDocument.size, 0);
  assert.equal(harness.copyLocators.size, 0);
  assert.equal(harness.copyDeleteCount(), 1);
  assert.equal(harness.closeCount(), 1);
});

test("opening reports missing files and persists the explicit missing access state", async () => {
  const harness = createHarness();
  const external = locator("deleted-file");
  harness.addFile(external, pdfBytes());
  const imported = await harness.service.importDocument({
    locator: external,
    mode: "external-reference",
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;

  harness.files.delete(external.value);
  const opened = await harness.service.openDocument(imported.value.document.id);
  assert.equal(opened.ok, false);
  if (!opened.ok) assert.equal(opened.error.code, "document-missing");
  assert.equal(
    harness.documentsById.get(imported.value.document.id)?.accessState,
    "missing",
  );
});

test("expired external permissions stay distinct from missing-file errors", async () => {
  const harness = createHarness();
  const external = locator("permissioned-file");
  harness.addFile(external, pdfBytes());
  const imported = await harness.service.importDocument({
    locator: external,
    mode: "external-reference",
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;

  harness.permissionStates.set(external.value, "expired");
  const opened = await harness.service.openDocument(imported.value.document.id);
  assert.equal(opened.ok, false);
  if (!opened.ok) assert.equal(opened.error.code, "permission-expired");
  assert.equal(
    harness.documentsById.get(imported.value.document.id)?.accessState,
    "permission-expired",
  );
});

test("external content changes are reported and relinking requires the original fingerprint", async () => {
  const harness = createHarness();
  const original = locator("original-file");
  const replacement = locator("replacement-file");
  const originalBytes = pdfBytes("same logical book");
  harness.addFile(original, originalBytes);
  harness.addFile(replacement, pdfBytes("different book"));

  const imported = await harness.service.importDocument({
    locator: original,
    mode: "external-reference",
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  const id = imported.value.document.id;

  const wrongRelink = await harness.service.relinkDocument(id, replacement);
  assert.equal(wrongRelink.ok, false);
  if (!wrongRelink.ok) assert.equal(wrongRelink.error.code, "document-changed");

  const newOriginalPath = locator("moved-original");
  harness.addFile(newOriginalPath, originalBytes);
  const relinked = await harness.service.relinkDocument(id, newOriginalPath);
  assert.equal(relinked.ok, true);
  if (!relinked.ok) return;
  assert.equal(relinked.value.accessState, "available");
  assert.equal(harness.locatorsByDocument.get(id)?.value, "moved-original");
  assert.equal((await harness.service.openDocument(id)).ok, true);
});

test("removed access locator is distinguished from a missing library record", async () => {
  const harness = createHarness();
  const external = locator("locator-deleted");
  harness.addFile(external, pdfBytes());
  const imported = await harness.service.importDocument({
    locator: external,
    mode: "external-reference",
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  harness.locatorsByDocument.delete(imported.value.document.id);

  const opened = await harness.service.openDocument(imported.value.document.id);
  assert.equal(opened.ok, false);
  if (!opened.ok) assert.equal(opened.error.code, "document-missing");
  assert.equal(harness.documentsById.get(imported.value.document.id)?.accessState, "missing");
});
