import type { Document, DocumentSourceMetadata } from "../domain/document.js";
import type {
  DocumentAccessState,
  DocumentImportMode,
  DuplicateDocumentPolicy,
} from "../domain/document-access.js";
import type { DocumentLocator } from "../domain/document-locator.js";
import type { ReaderError } from "../domain/errors.js";
import type {
  DocumentFingerprint,
  DocumentId,
  SourceHandleId,
} from "../domain/ids.js";
import type {
  DocumentCopyStorePort,
  DocumentLocatorStorePort,
  DocumentPermissionPort,
  DocumentPermissionState,
  DocumentSourcePort,
  DocumentRepositoryPort,
  ClockPort,
  IdGeneratorPort,
} from "../ports/index.js";
import { MAX_DOCUMENT_READ_BYTES, parseByteRange } from "../domain/byte-range.js";
import { Sha256 } from "./sha256.js";
import { toOpaqueId } from "../domain/ids.js";
import type { Result } from "../domain/result.js";

export interface ImportDocumentInput {
  readonly locator: DocumentLocator;
  readonly mode: DocumentImportMode;
  readonly duplicatePolicy?: DuplicateDocumentPolicy;
}

export type ImportDocumentResult =
  | {
      readonly status: "imported";
      readonly document: Document;
      readonly duplicateOf: DocumentId | null;
    }
  | {
      readonly status: "duplicate";
      readonly document: Document;
    };

export interface DocumentLibraryDependencies {
  readonly source: DocumentSourcePort;
  readonly locators: DocumentLocatorStorePort;
  readonly permissions: DocumentPermissionPort;
  readonly copies: DocumentCopyStorePort;
  readonly documents: DocumentRepositoryPort;
  readonly clock: ClockPort;
  readonly ids: IdGeneratorPort;
}

function failure(
  code: ReaderError["code"],
  message: string,
  retryable = false,
): ReaderError {
  return { code, message, retryable };
}

function safeDisplayName(displayName: string | null): string | null {
  if (displayName === null) return null;
  const leaf = displayName.split(/[\\/]/u).filter(Boolean).at(-1) ?? "";
  const safe = leaf.replace(/[\\u0000-\\u001f\\u007f]/gu, "").trim();
  return safe.length === 0 ? null : safe.slice(0, 255);
}

function safeTitle(displayName: string | null): string {
  const leaf = safeDisplayName(displayName);
  if (leaf === null) return "Untitled PDF";
  const title = leaf.replace(/\\.pdf$/iu, "").trim();
  return title.length === 0 ? "Untitled PDF" : title.slice(0, 512);
}

function isPdfMediaType(mediaType: string): boolean {
  const normalized = mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized === "" || normalized === "application/pdf" || normalized === "application/octet-stream";
}

function permissionError(state: DocumentPermissionState): ReaderError {
  switch (state) {
    case "denied":
      return failure("permission-denied", "Shelf does not have permission to access this PDF.");
    case "expired":
      return failure("permission-expired", "Access to this PDF has expired. Reauthorize the file to continue.");
    case "unavailable":
      return failure("document-missing", "The referenced PDF is no longer available.");
    case "prompt":
      return failure("permission-required", "Shelf needs permission to access this PDF.");
    case "granted":
      return failure("invalid-input", "Permission state is already granted.");
  }
}

function accessStateForError(error: ReaderError): DocumentAccessState {
  switch (error.code) {
    case "document-missing":
    case "document-not-found":
    case "document-unavailable":
      return "missing";
    case "permission-required":
      return "permission-required";
    case "permission-denied":
      return "permission-denied";
    case "permission-expired":
      return "permission-expired";
    case "document-changed":
    case "invalid-document":
      return "changed";
    default:
      return "available";
  }
}

async function updateAccessState(
  documents: DocumentRepositoryPort,
  document: Document,
  state: DocumentAccessState,
  now: number,
): Promise<Result<Document, ReaderError>> {
  const updated: Document = { ...document, accessState: state, updatedAt: now };
  const saved = await documents.save(updated);
  if (!saved.ok) return saved;
  return { ok: true, value: updated };
}

async function requestAccess(
  permissions: DocumentPermissionPort,
  locator: DocumentLocator,
): Promise<Result<void, ReaderError>> {
  const queried = await permissions.query(locator);
  if (!queried.ok) return queried;
  if (queried.value === "granted") return { ok: true, value: undefined };
  if (queried.value === "denied" || queried.value === "unavailable") {
    return { ok: false, error: permissionError(queried.value) };
  }

  const requested = await permissions.request(locator);
  if (!requested.ok) return requested;
  if (requested.value === "granted") return { ok: true, value: undefined };
  return { ok: false, error: permissionError(requested.value) };
}

async function fingerprintSource(
  source: DocumentSourcePort,
  handleId: SourceHandleId,
  sizeBytes: number,
): Promise<Result<DocumentFingerprint, ReaderError>> {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 5) {
    return {
      ok: false,
      error: failure("invalid-document", "The selected PDF has no valid file size."),
    };
  }
  const hasher = new Sha256();
  let offset = 0;
  let isPdf = false;

  while (offset < sizeBytes) {
    const length = Math.min(MAX_DOCUMENT_READ_BYTES, sizeBytes - offset);
    const range = parseByteRange({ offset, length });
    if (!range.ok) return range;
    let read: Awaited<ReturnType<DocumentSourcePort["read"]>>;
    try {
      read = await source.read(handleId, range.value);
    } catch {
      return {
        ok: false,
        error: failure("read-failed", "Shelf could not read a PDF byte range.", true),
      };
    }
    if (!read.ok) return read;
    if (read.value.byteLength !== length) {
      return {
        ok: false,
        error: failure("read-failed", "The PDF source returned an incomplete byte range.", true),
      };
    }

    if (offset === 0) {
      isPdf = read.value.byteLength >= 5 &&
        read.value[0] === 0x25 &&
        read.value[1] === 0x50 &&
        read.value[2] === 0x44 &&
        read.value[3] === 0x46 &&
        read.value[4] === 0x2d;
      if (!isPdf) {
        return {
          ok: false,
          error: failure("invalid-document", "The selected file does not contain a PDF header."),
        };
      }
    }

    hasher.update(read.value);
    offset += length;
  }

  return {
    ok: true,
    value: toOpaqueId<"DocumentFingerprint">("sha256:" + hasher.digestHex()),
  };
}

function buildDocument(
  id: DocumentId,
  mode: DocumentImportMode,
  metadata: DocumentSourceMetadata,
  fingerprint: DocumentFingerprint,
  now: number,
): Document {
  return {
    id,
    metadata: {
      title: safeTitle(metadata.displayName),
      authors: [],
      language: null,
      pageCount: null,
      pdfTitle: null,
      pdfSubject: null,
    },
    source: {
      kind: mode,
      displayName: safeDisplayName(metadata.displayName),
      mediaType: "application/pdf",
      sizeBytes: metadata.sizeBytes,
      modifiedAt: metadata.modifiedAt,
    },
    fingerprint,
    accessState: "available",
    createdAt: now,
    updatedAt: now,
  };
}

export class DocumentLibraryService {
  readonly #dependencies: DocumentLibraryDependencies;

  constructor(dependencies: DocumentLibraryDependencies) {
    this.#dependencies = dependencies;
  }

  async importDocument(
    input: ImportDocumentInput,
  ): Promise<Result<ImportDocumentResult, ReaderError>> {
    const { source, locators, permissions, copies, documents, clock, ids } = this.#dependencies;
    if (input.mode === "external-reference" && input.locator.persistence !== "reopenable") {
      return {
        ok: false,
        error: failure("not-supported", "External references must support reopening after the app restarts."),
      };
    }

    const access = await requestAccess(permissions, input.locator);
    if (!access.ok) return access;

    const opened = await source.open(input.locator);
    if (!opened.ok) return opened;
    const sourceHandle = opened.value;
    const metadata = sourceHandle.metadata;
    if (metadata.sizeBytes === null || !Number.isSafeInteger(metadata.sizeBytes) || metadata.sizeBytes < 5) {
      await source.close(sourceHandle.id);
      return {
        ok: false,
        error: failure("invalid-document", "The selected PDF has no valid file size."),
      };
    }
    if (!isPdfMediaType(metadata.mediaType)) {
      await source.close(sourceHandle.id);
      return {
        ok: false,
        error: failure("unsupported-media-type", "Only PDF documents can be added to this library."),
      };
    }

    let fingerprintResult: Result<DocumentFingerprint, ReaderError>;
    try {
      fingerprintResult = await fingerprintSource(source, sourceHandle.id, metadata.sizeBytes);
    } catch {
      await source.close(sourceHandle.id);
      return {
        ok: false,
        error: failure("read-failed", "Shelf could not fingerprint the selected PDF.", true),
      };
    }
    if (!fingerprintResult.ok) {
      await source.close(sourceHandle.id);
      return fingerprintResult;
    }

    const duplicateResult = await documents.findByFingerprint(fingerprintResult.value);
    if (!duplicateResult.ok) {
      await source.close(sourceHandle.id);
      return duplicateResult;
    }
    const existing = duplicateResult.value;
    const duplicatePolicy = input.duplicatePolicy ?? "reuse-existing";
    if (existing !== null && duplicatePolicy === "reuse-existing") {
      const closed = await source.close(sourceHandle.id);
      if (!closed.ok) return closed;
      return { ok: true, value: { status: "duplicate", document: existing } };
    }

    let storedLocator: DocumentLocator = input.locator;
    let copiedLocator: DocumentLocator | null = null;
    if (input.mode === "imported-copy") {
      const copy = await copies.copyFromSource(source, sourceHandle.id, metadata);
      if (!copy.ok) {
        await source.close(sourceHandle.id);
        return copy;
      }
      copiedLocator = copy.value;
      storedLocator = copy.value;
      if (storedLocator.persistence !== "reopenable") {
        await copies.deleteCopy(storedLocator);
        await source.close(sourceHandle.id);
        return {
          ok: false,
          error: failure("not-supported", "Imported copies must be stored in reopenable app-managed storage."),
        };
      }
    }

    const closed = await source.close(sourceHandle.id);
    if (!closed.ok) {
      if (copiedLocator !== null) await copies.deleteCopy(copiedLocator);
      return closed;
    }

    const id = ids.next<"DocumentId">("DocumentId");
    const now = clock.now();
    const document = buildDocument(id, input.mode, metadata, fingerprintResult.value, now);
    const locatorSaved = await locators.saveLocator(id, storedLocator);
    if (!locatorSaved.ok) {
      if (copiedLocator !== null) await copies.deleteCopy(copiedLocator);
      return locatorSaved;
    }

    const documentSaved = await documents.save(document);
    if (!documentSaved.ok) {
      await locators.deleteLocator(id);
      if (copiedLocator !== null) await copies.deleteCopy(copiedLocator);
      return documentSaved;
    }

    return {
      ok: true,
      value: {
        status: "imported",
        document,
        duplicateOf: existing?.id ?? null,
      },
    };
  }

  async openDocument(id: DocumentId): Promise<Result<Document, ReaderError>> {
    const { source, locators, permissions, documents, clock } = this.#dependencies;
    const found = await documents.getById(id);
    if (!found.ok) return found;
    if (found.value === null) {
      return { ok: false, error: failure("document-not-found", "This document is not in the Shelf library.") };
    }
    const document = found.value;
    const locatorResult = await locators.getLocator(id);
    if (!locatorResult.ok) return locatorResult;
    const locator = locatorResult.value;
    if (locator === null) {
      const updated = await updateAccessState(documents, document, "missing", clock.now());
      if (!updated.ok) return updated;
      return { ok: false, error: failure("document-missing", "The original PDF location is no longer available.") };
    }

    const access = await requestAccess(permissions, locator);
    if (!access.ok) {
      const updated = await updateAccessState(
        documents,
        document,
        accessStateForError(access.error),
        clock.now(),
      );
      if (!updated.ok) return updated;
      return access;
    }

    const opened = await source.open(locator);
    if (!opened.ok) {
      const updated = await updateAccessState(
        documents,
        document,
        accessStateForError(opened.error),
        clock.now(),
      );
      if (!updated.ok) return updated;
      return opened;
    }

    const sourceHandle = opened.value;
    const currentFingerprint = await fingerprintSource(
      source,
      sourceHandle.id,
      sourceHandle.metadata.sizeBytes ?? 0,
    );
    const closeResult = await source.close(sourceHandle.id);
    if (!currentFingerprint.ok) {
      const updated = await updateAccessState(
        documents,
        document,
        accessStateForError(currentFingerprint.error),
        clock.now(),
      );
      if (!updated.ok) return updated;
      return currentFingerprint;
    }
    if (!closeResult.ok) return closeResult;

    if (document.fingerprint !== null && document.fingerprint !== currentFingerprint.value) {
      const changed = await updateAccessState(documents, document, "changed", clock.now());
      if (!changed.ok) return changed;
      return {
        ok: false,
        error: failure("document-changed", "This PDF has changed since it was added to Shelf. Relink or reimport it to continue."),
      };
    }

    if (document.accessState !== "available") {
      const available = await updateAccessState(documents, document, "available", clock.now());
      if (!available.ok) return available;
      return available;
    }
    return { ok: true, value: document };
  }

  async relinkDocument(
    id: DocumentId,
    locator: DocumentLocator,
  ): Promise<Result<Document, ReaderError>> {
    const { source, locators, permissions, documents, clock } = this.#dependencies;
    const found = await documents.getById(id);
    if (!found.ok) return found;
    if (found.value === null) {
      return { ok: false, error: failure("document-not-found", "This document is not in the Shelf library.") };
    }
    if (locator.persistence !== "reopenable") {
      return { ok: false, error: failure("not-supported", "A relinked document must be reopenable after restart.") };
    }

    const access = await requestAccess(permissions, locator);
    if (!access.ok) return access;
    const opened = await source.open(locator);
    if (!opened.ok) return opened;
    const sourceHandle = opened.value;
    const fingerprint = await fingerprintSource(
      source,
      sourceHandle.id,
      sourceHandle.metadata.sizeBytes ?? 0,
    );
    const closed = await source.close(sourceHandle.id);
    if (!fingerprint.ok) return fingerprint;
    if (!closed.ok) return closed;

    const document = found.value;
    if (document.fingerprint !== null && fingerprint.value !== document.fingerprint) {
      return {
        ok: false,
        error: failure("document-changed", "The selected file does not match the original document fingerprint."),
      };
    }

    const previous = await locators.getLocator(id);
    if (!previous.ok) return previous;
    const saved = await locators.saveLocator(id, locator);
    if (!saved.ok) return saved;

    const updated: Document = {
      ...document,
      source: {
        ...document.source,
        displayName: sourceHandle.metadata.displayName,
        sizeBytes: sourceHandle.metadata.sizeBytes,
        modifiedAt: sourceHandle.metadata.modifiedAt,
      },
      accessState: "available",
      updatedAt: clock.now(),
    };
    const persisted = await documents.save(updated);
    if (!persisted.ok) {
      if (previous.value !== null) await locators.saveLocator(id, previous.value);
      else await locators.deleteLocator(id);
      return persisted;
    }
    return { ok: true, value: updated };
  }
}
