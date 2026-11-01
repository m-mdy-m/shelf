import {
  parseByteRange,
  toOpaqueId,
} from "@shelf/reader-core";
import type {
  DocumentLocator,
  DocumentPermissionPort,
  DocumentPermissionState,
  DocumentSourceMetadata,
  DocumentSourcePort,
  OpenDocumentHandle,
  ReaderError,
  Result,
  SourceHandleId,
} from "@shelf/reader-core";
import type {
  BrowserDocumentStoragePort,
  BrowserFileHandleLike,
} from "./storage-port.js";

const COPY_PROVIDER = "shelf-browser-copy";
const REFERENCE_PROVIDER = "shelf-browser-reference";

function failure(
  code: ReaderError["code"],
  message: string,
  retryable = false,
): Result<never, ReaderError> {
  return { ok: false, error: { code, message, retryable } };
}

function randomKey(): string {
  if (globalThis.crypto?.randomUUID !== undefined) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function isPdf(file: File): boolean {
  return file.type.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function fileMetadata(file: File): DocumentSourceMetadata {
  return {
    mediaType: isPdf(file) ? "application/pdf" : file.type || "application/octet-stream",
    sizeBytes: file.size,
    modifiedAt: Number.isSafeInteger(file.lastModified) ? file.lastModified : null,
    displayName: file.name || null,
  };
}

function mapFileError(error: unknown): ReaderError {
  const name = typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { code: "permission-expired", message: "Access to the original file has expired. Relink it to continue.", retryable: true };
  }
  if (name === "NotFoundError") {
    return { code: "document-unavailable", message: "The original file is no longer available.", retryable: true };
  }
  return { code: "read-failed", message: "Shelf could not access the selected local PDF.", retryable: true };
}

export class BrowserDocumentSource implements DocumentSourcePort, DocumentPermissionPort {
  readonly #storage: BrowserDocumentStoragePort;
  readonly #openFiles = new Map<string, File>();

  constructor(storage: BrowserDocumentStoragePort) {
    this.#storage = storage;
  }

  async registerCopy(file: File): Promise<Result<DocumentLocator, ReaderError>> {
    if (!isPdf(file) || file.size < 5) {
      return failure("unsupported-document", "Choose a non-empty PDF file.");
    }
    const key = randomKey();
    try {
      await this.#storage.saveCopy(key, {
        blob: file.slice(0, file.size, "application/pdf"),
        displayName: file.name,
        mediaType: "application/pdf",
        modifiedAt: file.lastModified,
      });
      return {
        ok: true,
        value: {
          kind: "opaque",
          providerId: COPY_PROVIDER,
          value: key,
          persistence: "reopenable",
        },
      };
    } catch {
      return failure("write-failed", "Shelf could not save a local copy. Check available browser storage.", true);
    }
  }

  async registerReference(
    handle: BrowserFileHandleLike,
  ): Promise<Result<DocumentLocator, ReaderError>> {
    let file: File;
    try {
      file = await handle.getFile();
    } catch (error) {
      return { ok: false, error: mapFileError(error) };
    }
    if (!isPdf(file) || file.size < 5) {
      return failure("unsupported-document", "Choose a non-empty PDF file.");
    }
    const key = randomKey();
    try {
      await this.#storage.saveReference(key, handle);
      return {
        ok: true,
        value: {
          kind: "browser-handle",
          providerId: REFERENCE_PROVIDER,
          value: key,
          persistence: "reopenable",
        },
      };
    } catch {
      return failure("write-failed", "Shelf could not save the external file reference.", true);
    }
  }

  async #resolveFile(locator: DocumentLocator): Promise<Result<File, ReaderError>> {
    try {
      if (locator.providerId === COPY_PROVIDER) {
        const copy = await this.#storage.getCopy(locator.value);
        if (copy === null) {
          return failure("document-unavailable", "The imported PDF copy is missing.", true);
        }
        return {
          ok: true,
          value: new File([copy.blob], copy.displayName, {
            type: copy.mediaType,
            lastModified: copy.modifiedAt ?? 0,
          }),
        };
      }

      if (locator.providerId === REFERENCE_PROVIDER) {
        const handle = await this.#storage.getReference(locator.value);
        if (handle === null) {
          return failure("document-unavailable", "The original file reference is missing.", true);
        }
        try {
          return { ok: true, value: await handle.getFile() };
        } catch (error) {
          return { ok: false, error: mapFileError(error) };
        }
      }
      return failure("document-unavailable", "Shelf does not recognize this local file reference.");
    } catch {
      return failure("read-failed", "Shelf could not read the local file record.", true);
    }
  }

  async inspect(locator: DocumentLocator): Promise<Result<DocumentSourceMetadata, ReaderError>> {
    const file = await this.#resolveFile(locator);
    if (!file.ok) return file;
    if (!isPdf(file.value)) return failure("unsupported-document", "Shelf currently supports PDF documents only.");
    return { ok: true, value: fileMetadata(file.value) };
  }

  async open(locator: DocumentLocator): Promise<Result<OpenDocumentHandle, ReaderError>> {
    const file = await this.#resolveFile(locator);
    if (!file.ok) return file;
    if (!isPdf(file.value) || file.value.size < 5) {
      return failure("invalid-document", "The selected file is not a valid PDF source.");
    }

    const key = randomKey();
    const id = toOpaqueId<"SourceHandleId">(key) as SourceHandleId;
    this.#openFiles.set(key, file.value);
    return { ok: true, value: { id, metadata: fileMetadata(file.value) } };
  }

  async read(
    handleId: SourceHandleId,
    range: { readonly offset: number; readonly length: number },
  ): Promise<Result<Uint8Array, ReaderError>> {
    const parsed = parseByteRange(range);
    if (!parsed.ok) return parsed;
    const file = this.#openFiles.get(String(handleId));
    if (file === undefined) {
      return failure("document-not-found", "The local PDF read handle is no longer open.");
    }
    const end = range.offset + range.length;
    if (end > file.size) {
      return failure("invalid-range", "The requested byte range exceeds the PDF file size.");
    }
    try {
      const bytes = new Uint8Array(await file.slice(range.offset, end).arrayBuffer());
      if (bytes.byteLength !== range.length) {
        return failure("read-failed", "The local PDF returned an incomplete byte range.", true);
      }
      return { ok: true, value: bytes };
    } catch {
      return failure("read-failed", "Shelf could not read this part of the local PDF.", true);
    }
  }

  async close(handleId: SourceHandleId): Promise<Result<void, ReaderError>> {
    this.#openFiles.delete(String(handleId));
    return { ok: true, value: undefined };
  }

  async query(locator: DocumentLocator): Promise<Result<DocumentPermissionState, ReaderError>> {
    if (locator.providerId === COPY_PROVIDER) {
      const copy = await this.#storage.getCopy(locator.value).catch(() => null);
      return { ok: true, value: copy === null ? "unavailable" : "granted" };
    }
    if (locator.providerId !== REFERENCE_PROVIDER) {
      return { ok: true, value: "unavailable" };
    }
    const handle = await this.#storage.getReference(locator.value).catch(() => null);
    if (handle === null) return { ok: true, value: "unavailable" };
    try {
      return { ok: true, value: await handle.queryPermission({ mode: "read" }) };
    } catch (error) {
      return { ok: false, error: mapFileError(error) };
    }
  }

  async request(locator: DocumentLocator): Promise<Result<DocumentPermissionState, ReaderError>> {
    if (locator.providerId === COPY_PROVIDER) return this.query(locator);
    if (locator.providerId !== REFERENCE_PROVIDER) {
      return { ok: true, value: "unavailable" };
    }
    const handle = await this.#storage.getReference(locator.value).catch(() => null);
    if (handle === null) return { ok: true, value: "unavailable" };
    try {
      return { ok: true, value: await handle.requestPermission({ mode: "read" }) };
    } catch (error) {
      return { ok: false, error: mapFileError(error) };
    }
  }

  async release(_locator: DocumentLocator): Promise<Result<void, ReaderError>> {
    return { ok: true, value: undefined };
  }

  /** Discards only Shelf-owned blobs or its saved handle reference, never the original file. */
  async discard(locator: DocumentLocator): Promise<Result<void, ReaderError>> {
    try {
      if (locator.providerId === COPY_PROVIDER) {
        await this.#storage.deleteCopy(locator.value);
      } else if (locator.providerId === REFERENCE_PROVIDER) {
        await this.#storage.deleteReference(locator.value);
      }
      return { ok: true, value: undefined };
    } catch {
      return failure("write-failed", "Shelf could not clean up an unused local source record.", true);
    }
  }
}
