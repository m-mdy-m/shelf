import type {
  ClockPort,
  Document,
  DocumentId,
  DocumentLocator,
  DocumentLocatorStorePort,
  DocumentPermissionPort,
  DocumentPermissionState,
  DocumentRepositoryPort,
  DocumentSourceKind,
  DocumentSourcePort,
  IdGeneratorPort,
  OpenDocumentHandle,
  ReaderError,
  Result,
  Sha256DigestPort,
} from "@shelf/reader-core";
import { fingerprintPdf } from "./fingerprint.js";

export type LibrarySourceKind = Extract<
  DocumentSourceKind,
  "imported-copy" | "external-reference"
>;

export interface ImportDocumentInput {
  readonly locator: DocumentLocator;
  readonly sourceKind: LibrarySourceKind;
}

export interface ImportDocumentResult {
  readonly document: Document;
  /** True when identical PDF bytes were already registered. */
  readonly duplicate: boolean;
}

export interface DocumentSourceCleanupPort {
  /** Removes an uncommitted copy or reference record; never deletes an external file. */
  discard(locator: DocumentLocator): Promise<Result<void, ReaderError>>;
}

export interface DocumentLibraryDependencies {
  readonly documents: DocumentRepositoryPort;
  readonly locators: DocumentLocatorStorePort;
  readonly source: DocumentSourcePort;
  readonly permissions: DocumentPermissionPort;
  readonly ids: IdGeneratorPort;
  readonly clock: ClockPort;
  readonly digest: Sha256DigestPort;
  readonly cleanup?: DocumentSourceCleanupPort;
}

export interface OpenLibraryDocument {
  readonly document: Document;
  readonly source: OpenDocumentHandle;
}

function failure(
  code: ReaderError["code"],
  message: string,
  retryable = false,
): Result<never, ReaderError> {
  return { ok: false, error: { code, message, retryable } };
}

function permissionFailure(state: DocumentPermissionState): ReaderError {
  switch (state) {
    case "denied":
      return { code: "permission-denied", message: "Shelf does not have permission to read this file.", retryable: false };
    case "expired":
      return { code: "permission-expired", message: "Access to this file has expired. Relink the original file to continue.", retryable: true };
    case "unavailable":
      return { code: "document-unavailable", message: "The original file is no longer available.", retryable: true };
    case "prompt":
      return { code: "permission-required", message: "Permission is required to read this file.", retryable: true };
    case "granted":
      return { code: "read-failed", message: "The file permission state could not be resolved.", retryable: true };
  }
}

function isPdfMetadata(mediaType: string, displayName: string | null): boolean {
  return mediaType.toLowerCase() === "application/pdf" ||
    (displayName !== null && displayName.toLowerCase().endsWith(".pdf"));
}

export class DocumentLibraryService {
  readonly #dependencies: DocumentLibraryDependencies;

  constructor(dependencies: DocumentLibraryDependencies) {
    this.#dependencies = dependencies;
  }

  async getDocument(id: DocumentId): Promise<Result<Document | null, ReaderError>> {
    return this.#dependencies.documents.getById(id);
  }

  async listDocuments(): Promise<Result<readonly Document[], ReaderError>> {
    return this.#dependencies.documents.list();
  }

  async importDocument(
    input: ImportDocumentInput,
  ): Promise<Result<ImportDocumentResult, ReaderError>> {
    const discardStagedSource = async (): Promise<void> => {
      await this.#dependencies.cleanup?.discard(input.locator);
    };

    const inspected = await this.#dependencies.source.inspect(input.locator);
    if (!inspected.ok) {
      await discardStagedSource();
      return inspected;
    }
    if (!isPdfMetadata(inspected.value.mediaType, inspected.value.displayName)) {
      await discardStagedSource();
      return failure("unsupported-document", "Shelf currently imports PDF documents only.");
    }
    const size = inspected.value.sizeBytes;
    if (size === null || !Number.isSafeInteger(size) || size < 5) {
      await discardStagedSource();
      return failure("invalid-document", "The selected PDF has an invalid or empty file size.");
    }

    const opened = await this.#dependencies.source.open(input.locator);
    if (!opened.ok) {
      await discardStagedSource();
      return opened;
    }
    const fingerprint = await fingerprintPdf(
      this.#dependencies.source,
      opened.value,
      this.#dependencies.digest,
    );
    const closed = await this.#dependencies.source.close(opened.value.id);
    if (!fingerprint.ok) {
      await discardStagedSource();
      return fingerprint;
    }
    if (!closed.ok) {
      await discardStagedSource();
      return closed;
    }

    const existing = await this.#dependencies.documents.list();
    if (!existing.ok) {
      await this.#dependencies.cleanup?.discard(input.locator);
      return existing;
    }

    const duplicate = existing.value.find((document) =>
      document.fingerprint === fingerprint.value &&
      document.source.sizeBytes === size
    );
    if (duplicate !== undefined) {
      await this.#dependencies.cleanup?.discard(input.locator);
      return { ok: true, value: { document: duplicate, duplicate: true } };
    }

    const now = this.#dependencies.clock.now();
    const document: Document = {
      id: this.#dependencies.ids.next<"DocumentId">("DocumentId"),
      metadata: {
        title: inspected.value.displayName ?? "Untitled PDF",
        authors: [],
        language: null,
        pageCount: null,
        pdfTitle: null,
        pdfSubject: null,
      },
      source: {
        kind: input.sourceKind,
        displayName: inspected.value.displayName,
        mediaType: inspected.value.mediaType,
        sizeBytes: size,
        modifiedAt: inspected.value.modifiedAt,
      },
      fingerprint: fingerprint.value,
      createdAt: now,
      updatedAt: now,
    };

    const locatorSaved = await this.#dependencies.locators.saveLocator(document.id, input.locator);
    if (!locatorSaved.ok) {
      await this.#dependencies.cleanup?.discard(input.locator);
      return locatorSaved;
    }

    const documentSaved = await this.#dependencies.documents.save(document);
    if (!documentSaved.ok) {
      await this.#dependencies.locators.deleteLocator(document.id);
      await this.#dependencies.cleanup?.discard(input.locator);
      return documentSaved;
    }

    return { ok: true, value: { document, duplicate: false } };
  }

  async openDocument(id: DocumentId): Promise<Result<OpenLibraryDocument, ReaderError>> {
    const found = await this.#dependencies.documents.getById(id);
    if (!found.ok) return found;
    if (found.value === null) {
      return failure("document-not-found", "This document is not in the Shelf library.");
    }

    const locator = await this.#dependencies.locators.getLocator(id);
    if (!locator.ok) return locator;
    if (locator.value === null) {
      return failure("document-unavailable", "The source for this document is unavailable.");
    }

    const permission = await this.#dependencies.permissions.query(locator.value);
    if (!permission.ok) return permission;
    let state = permission.value;
    if (state === "prompt") {
      const requested = await this.#dependencies.permissions.request(locator.value);
      if (!requested.ok) return requested;
      state = requested.value;
    }
    if (state !== "granted") {
      return { ok: false, error: permissionFailure(state) };
    }

    const source = await this.#dependencies.source.open(locator.value);
    if (!source.ok) return source;
    return { ok: true, value: { document: found.value, source: source.value } };
  }

  async closeDocument(handle: OpenDocumentHandle): Promise<Result<void, ReaderError>> {
    return this.#dependencies.source.close(handle.id);
  }
}
