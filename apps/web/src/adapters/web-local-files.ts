import type {
  DocumentSourceMetadata,
} from "@shelf/reader-core";
import type {
  DocumentCopyStorePort,
  DocumentLocator,
  DocumentPermissionPort,
  DocumentPermissionState,
  DocumentSourcePort,
  OpenDocumentHandle,
  ReaderError,
  Result,
  SourceHandleId,
} from "@shelf/reader-core";
import {
  MAX_DOCUMENT_READ_BYTES,
  parseByteRange,
  toOpaqueId,
} from "@shelf/reader-core";

interface OpfsWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

interface OpfsFileHandle {
  getFile(): Promise<Blob>;
  createWritable(): Promise<OpfsWritable>;
}

export interface OpfsDirectoryHandle {
  getFileHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<OpfsFileHandle>;
  removeEntry(name: string): Promise<void>;
}

interface StoredBlob {
  readonly blob: Blob;
  readonly metadata: DocumentSourceMetadata;
}

function failure(
  code: ReaderError["code"],
  message: string,
  retryable = false,
): ReaderError {
  return { code, message, retryable };
}

function isOpfsLocator(locator: DocumentLocator): boolean {
  return locator.kind === "filesystem" && locator.providerId === "shelf-web-opfs" &&
    locator.persistence === "reopenable";
}

function metadataFor(blob: Blob, displayName: string | null, modifiedAt: number | null): DocumentSourceMetadata {
  return {
    mediaType: blob.type || "application/pdf",
    sizeBytes: blob.size,
    modifiedAt,
    displayName: safeDisplayName(displayName),
  };
}

function safeDisplayName(value: string | null): string | null {
  if (value === null) return null;
  const leaf = value.split(/[\\/]/u).filter(Boolean).at(-1) ?? "";
  const safe = leaf.replace(/[\\u0000-\\u001f\\u007f]/gu, "").trim();
  return safe.length === 0 ? null : safe.slice(0, 255);
}

let nextToken = 0;

function newToken(prefix: string): string {
  nextToken += 1;
  const random = globalThis.crypto?.randomUUID?.();
  return prefix + "-" + (random ?? String(nextToken));
}

/**
 * Web adapter for local file imports. Picker File/Blob references are ephemeral;
 * copied library files live in OPFS and are reopened using opaque Shelf locators.
 */
export class WebLocalFileAdapter implements
  DocumentSourcePort,
  DocumentCopyStorePort,
  DocumentPermissionPort {
  readonly #directory: OpfsDirectoryHandle;
  readonly #picked = new Map<string, StoredBlob>();
  readonly #openHandles = new Map<SourceHandleId, StoredBlob>();

  constructor(directory: OpfsDirectoryHandle) {
    this.#directory = directory;
  }

  registerPickedFile(
    file: Blob,
    displayName: string | null,
    modifiedAt: number | null = null,
  ): DocumentLocator {
    const token = newToken("picked");
    this.#picked.set(token, {
      blob: file,
      metadata: metadataFor(file, displayName, modifiedAt),
    });
    return {
      kind: "browser-handle",
      providerId: "shelf-web-picker",
      value: token,
      persistence: "ephemeral",
    };
  }

  async inspect(locator: DocumentLocator): Promise<Result<DocumentSourceMetadata, ReaderError>> {
    const resolved = await this.#resolve(locator);
    if (!resolved.ok) return resolved;
    return { ok: true, value: resolved.value.metadata };
  }

  async open(locator: DocumentLocator): Promise<Result<OpenDocumentHandle, ReaderError>> {
    const resolved = await this.#resolve(locator);
    if (!resolved.ok) return resolved;
    const handleId = toOpaqueId<"SourceHandleId">(newToken("web-source"));
    this.#openHandles.set(handleId, resolved.value);
    return {
      ok: true,
      value: {
        id: handleId,
        metadata: resolved.value.metadata,
      },
    };
  }

  async read(
    handleId: SourceHandleId,
    range: { readonly offset: number; readonly length: number },
  ): Promise<Result<Uint8Array, ReaderError>> {
    const opened = this.#openHandles.get(handleId);
    if (opened === undefined) {
      return {
        ok: false,
        error: failure("document-unavailable", "The local PDF handle is no longer open."),
      };
    }

    const parsed = parseByteRange(range);
    if (!parsed.ok || parsed.value.offset + parsed.value.length > opened.blob.size) {
      return {
        ok: false,
        error: failure("invalid-range", "The requested local PDF byte range is invalid."),
      };
    }

    try {
      return {
        ok: true,
        value: new Uint8Array(
          await opened.blob.slice(
            parsed.value.offset,
            parsed.value.offset + parsed.value.length,
          ).arrayBuffer(),
        ),
      };
    } catch {
      return {
        ok: false,
        error: failure("read-failed", "Shelf could not read the selected local PDF.", true),
      };
    }
  }

  async close(handleId: SourceHandleId): Promise<Result<void, ReaderError>> {
    this.#openHandles.delete(handleId);
    return { ok: true, value: undefined };
  }

  async copyFromSource(
    source: DocumentSourcePort,
    sourceHandleId: SourceHandleId,
    metadata: DocumentSourceMetadata,
  ): Promise<Result<DocumentLocator, ReaderError>> {
    if (metadata.sizeBytes === null || !Number.isSafeInteger(metadata.sizeBytes) || metadata.sizeBytes < 5) {
      return {
        ok: false,
        error: failure("invalid-document", "The selected PDF has no valid file size."),
      };
    }

    const displayName = safeDisplayName(metadata.displayName) ?? "document.pdf";
    const name = newToken("document") + "--" + displayName;
    let writable: OpfsWritable | null = null;
    let created = false;
    try {
      const fileHandle = await this.#directory.getFileHandle(name, { create: true });
      created = true;
      writable = await fileHandle.createWritable();

      for (let offset = 0; offset < metadata.sizeBytes; ) {
        const length = Math.min(MAX_DOCUMENT_READ_BYTES, metadata.sizeBytes - offset);
        const parsed = parseByteRange({ offset, length });
        if (!parsed.ok) throw new Error("Invalid source range.");

        const chunk = await source.read(sourceHandleId, parsed.value);
        if (!chunk.ok) {
          await writable.abort();
          await this.#directory.removeEntry(name);
          return chunk;
        }
        if (chunk.value.byteLength !== length) {
          throw new Error("Incomplete source range.");
        }

        await writable.write(chunk.value);
        offset += length;
      }

      await writable.close();
      return {
        ok: true,
        value: {
          kind: "filesystem",
          providerId: "shelf-web-opfs",
          value: name,
          persistence: "reopenable",
        },
      };
    } catch {
      if (writable !== null) {
        try {
          await writable.abort();
        } catch {
          // Best-effort abort; the partial entry is removed below.
        }
      }
      if (created) {
        try {
          await this.#directory.removeEntry(name);
        } catch {
          // The OPFS entry may already have been removed by the browser.
        }
      }
      return {
        ok: false,
        error: failure("write-failed", "Shelf could not create the local library copy.", true),
      };
    }
  }

  async deleteCopy(locator: DocumentLocator): Promise<Result<void, ReaderError>> {
    if (!isOpfsLocator(locator)) {
      return {
        ok: false,
        error: failure("invalid-input", "The supplied locator is not a Shelf-managed web copy."),
      };
    }
    try {
      await this.#directory.removeEntry(locator.value);
      return { ok: true, value: undefined };
    } catch {
      return {
        ok: false,
        error: failure("write-failed", "Shelf could not remove the local library copy.", true),
      };
    }
  }

  async query(locator: DocumentLocator): Promise<Result<DocumentPermissionState, ReaderError>> {
    if (locator.kind === "browser-handle" && locator.providerId === "shelf-web-picker") {
      return {
        ok: true,
        value: this.#picked.has(locator.value) ? "granted" : "unavailable",
      };
    }
    if (isOpfsLocator(locator)) {
      try {
        await this.#directory.getFileHandle(locator.value);
        return { ok: true, value: "granted" };
      } catch {
        return { ok: true, value: "unavailable" };
      }
    }
    return { ok: true, value: "unavailable" };
  }

  async request(locator: DocumentLocator): Promise<Result<DocumentPermissionState, ReaderError>> {
    // The browser file picker itself is the permission prompt. OPFS is scoped to
    // the current origin; unsupported providers are not silently reauthorized.
    return this.query(locator);
  }

  async release(): Promise<Result<void, ReaderError>> {
    return { ok: true, value: undefined };
  }

  async #resolve(locator: DocumentLocator): Promise<Result<StoredBlob, ReaderError>> {
    if (locator.kind === "browser-handle" && locator.providerId === "shelf-web-picker") {
      const picked = this.#picked.get(locator.value);
      if (picked === undefined) {
        return {
          ok: false,
          error: failure("document-missing", "The selected file is no longer available. Choose it again or import a copy."),
        };
      }
      return { ok: true, value: picked };
    }

    if (!isOpfsLocator(locator)) {
      return {
        ok: false,
        error: failure("not-supported", "This file locator is not supported by the web adapter."),
      };
    }

    try {
      const fileHandle = await this.#directory.getFileHandle(locator.value);
      const blob = await fileHandle.getFile();
      return {
        ok: true,
        value: {
          blob,
          metadata: metadataFor(blob, locator.value.split("--").slice(1).join("--") || null, null),
        },
      };
    } catch {
      return {
        ok: false,
        error: failure("document-missing", "The local library copy is missing from browser storage."),
      };
    }
  }
}

export function createWebLocalFileAdapter(
  directory: OpfsDirectoryHandle,
): WebLocalFileAdapter {
  return new WebLocalFileAdapter(directory);
}

export async function createBrowserOpfsAdapter(): Promise<Result<WebLocalFileAdapter, ReaderError>> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<OpfsDirectoryHandle>;
  };
  if (typeof storage.getDirectory !== "function") {
    return {
      ok: false,
      error: failure("not-supported", "This browser does not provide persistent local file storage."),
    };
  }

  try {
    return { ok: true, value: new WebLocalFileAdapter(await storage.getDirectory()) };
  } catch {
    return {
      ok: false,
      error: failure("not-supported", "Shelf could not open browser local file storage."),
    };
  }
}

/** Platform-specific picker helper; returned File objects are ephemeral locators. */
export function pickLocalPdfFile(): Promise<Result<File, ReaderError>> {
  if (typeof document === "undefined") {
    return Promise.resolve({
      ok: false,
      error: failure("not-supported", "The local file picker is only available in a browser."),
    });
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,application/pdf";
    input.hidden = true;
    const finish = (result: Result<File, ReaderError>): void => {
      input.remove();
      resolve(result);
    };

    input.addEventListener("change", () => {
      const file = input.files?.item(0) ?? null;
      if (file === null) {
        finish({ ok: false, error: failure("cancelled", "No PDF file was selected.") });
        return;
      }
      finish({ ok: true, value: file });
    }, { once: true });

    input.addEventListener("cancel", () => {
      finish({ ok: false, error: failure("cancelled", "PDF selection was cancelled.") });
    }, { once: true });

    document.body.append(input);
    input.click();
  });
}
