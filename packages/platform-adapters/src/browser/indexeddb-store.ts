import type {
  Document,
  DocumentId,
  DocumentLocator,
  DocumentLocatorStorePort,
  DocumentRepositoryPort,
  ReadingProgress,
  ReadingProgressRepositoryPort,
  ReaderError,
  Result,
} from "@shelf/reader-core";
import type {
  BrowserDocumentStoragePort,
  BrowserFileHandleLike,
  BrowserStoredCopy,
} from "./storage-port.js";

interface StoredLocator {
  readonly documentId: string;
  readonly locator: DocumentLocator;
}

interface StoredCopy extends BrowserStoredCopy {
  readonly key: string;
}

interface StoredReference {
  readonly key: string;
  readonly handle: BrowserFileHandleLike;
}

type StoreName = "documents" | "locators" | "copies" | "references" | "readingProgress";

function storageError(
  code: ReaderError["code"],
  message: string,
): ReaderError {
  return { code, message, retryable: true };
}

function isReadingProgress(record: Document | ReadingProgress): record is ReadingProgress {
  return "pageIndex" in record &&
    "scrollOffset" in record &&
    "readingMode" in record &&
    "updatedAt" in record;
}

/** One local database stores safe records, opaque locators, and source bytes separately. */
export class IndexedDbShelfStore
implements DocumentRepositoryPort, ReadingProgressRepositoryPort, DocumentLocatorStorePort, BrowserDocumentStoragePort {
  readonly #factory: IDBFactory | null;
  readonly #databaseName: string;
  #databasePromise: Promise<IDBDatabase> | null = null;

  constructor(
    factory: IDBFactory | null = globalThis.indexedDB ?? null,
    databaseName = "shelf-local",
  ) {
    this.#factory = factory;
    this.#databaseName = databaseName;
  }

  async #database(): Promise<IDBDatabase> {
    const factory = this.#factory;
    if (factory === null) {
      throw new Error("IndexedDB is not available in this browser.");
    }
    this.#databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(this.#databaseName, 2);
      let settled = false;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const name of ["documents", "locators", "copies", "references", "readingProgress"] as const) {
          if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, {
              keyPath: name === "documents" ? "id" :
                name === "locators" || name === "readingProgress" ? "documentId" : "key",
            });
          }
        }
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => fail(request.error ?? new Error("IndexedDB open failed."));
      request.onblocked = () => fail(new Error("IndexedDB upgrade is blocked by another Shelf tab."));
    }).catch((error: unknown) => {
      this.#databasePromise = null;
      throw error;
    });
    return this.#databasePromise;
  }

  async #run<Value>(
    name: StoreName,
    mode: IDBTransactionMode,
    createRequest: (store: IDBObjectStore) => IDBRequest<Value>,
  ): Promise<Value> {
    const database = await this.#database();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(name, mode);
      const request = createRequest(transaction.objectStore(name));
      let value: Value | undefined;
      request.onsuccess = () => { value = request.result; };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
      transaction.oncomplete = () => resolve(value as Value);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
    });
  }

  async getById(id: DocumentId): Promise<Result<Document | null, ReaderError>> {
    try {
      const value = await this.#run<Document | undefined>(
        "documents", "readonly", (store) => store.get(String(id)),
      );
      return { ok: true, value: value ?? null };
    } catch {
      return { ok: false, error: storageError("read-failed", "Shelf could not read the local document library.") };
    }
  }

  async list(): Promise<Result<readonly Document[], ReaderError>> {
    try {
      const value = await this.listDocuments();
      return { ok: true, value: [...value].sort((left, right) => right.updatedAt - left.updatedAt) };
    } catch {
      return { ok: false, error: storageError("read-failed", "Shelf could not list the local document library.") };
    }
  }

  async save(document: Document): Promise<Result<void, ReaderError>>;
  async save(progress: ReadingProgress): Promise<Result<void, ReaderError>>;
  async save(record: Document | ReadingProgress): Promise<Result<void, ReaderError>> {
    try {
      if (isReadingProgress(record)) {
        await this.#run("readingProgress", "readwrite", (store) => store.put(record));
      } else {
        await this.saveDocument(record);
      }
      return { ok: true, value: undefined };
    } catch {
      const message = isReadingProgress(record)
        ? "Shelf could not save the reading position."
        : "Shelf could not save the document record.";
      return { ok: false, error: storageError("write-failed", message) };
    }
  }

  async getByDocumentId(id: DocumentId): Promise<Result<ReadingProgress | null, ReaderError>> {
    try {
      const value = await this.#run<ReadingProgress | undefined>(
        "readingProgress", "readonly", (store) => store.get(String(id)),
      );
      return { ok: true, value: value ?? null };
    } catch {
      return { ok: false, error: storageError("read-failed", "Shelf could not restore the reading position.") };
    }
  }

  async deleteByDocumentId(id: DocumentId): Promise<Result<void, ReaderError>> {
    try {
      await this.#run("readingProgress", "readwrite", (store) => store.delete(String(id)));
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storageError("write-failed", "Shelf could not remove the reading position.") };
    }
  }

  async delete(id: DocumentId): Promise<Result<void, ReaderError>> {
    try {
      await this.deleteDocument(String(id));
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storageError("write-failed", "Shelf could not remove the document record.") };
    }
  }

  async getLocator(documentId: DocumentId): Promise<Result<DocumentLocator | null, ReaderError>> {
    try {
      const value = await this.#run<StoredLocator | undefined>(
        "locators", "readonly", (store) => store.get(String(documentId)),
      );
      return { ok: true, value: value?.locator ?? null };
    } catch {
      return { ok: false, error: storageError("read-failed", "Shelf could not resolve the local file reference.") };
    }
  }

  async saveLocator(documentId: DocumentId, locator: DocumentLocator): Promise<Result<void, ReaderError>> {
    try {
      await this.#run("locators", "readwrite", (store) =>
        store.put({ documentId: String(documentId), locator } satisfies StoredLocator),
      );
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storageError("write-failed", "Shelf could not save the local file reference.") };
    }
  }

  async deleteLocator(documentId: DocumentId): Promise<Result<void, ReaderError>> {
    try {
      await this.#run("locators", "readwrite", (store) => store.delete(String(documentId)));
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storageError("write-failed", "Shelf could not remove the local file reference.") };
    }
  }

  async listDocuments(): Promise<readonly Document[]> {
    return this.#run<Document[]>("documents", "readonly", (store) => store.getAll());
  }

  async saveDocument(document: Document): Promise<void> {
    await this.#run("documents", "readwrite", (store) => store.put(document));
  }

  async deleteDocument(id: string): Promise<void> {
    await this.#run("documents", "readwrite", (store) => store.delete(id));
  }

  async saveCopy(key: string, copy: BrowserStoredCopy): Promise<void> {
    await this.#run("copies", "readwrite", (store) => store.put({ key, ...copy } satisfies StoredCopy));
  }

  async getCopy(key: string): Promise<BrowserStoredCopy | null> {
    const value = await this.#run<StoredCopy | undefined>("copies", "readonly", (store) => store.get(key));
    if (value === undefined) return null;
    return {
      blob: value.blob,
      displayName: value.displayName,
      mediaType: value.mediaType,
      modifiedAt: value.modifiedAt,
    };
  }

  async deleteCopy(key: string): Promise<void> {
    await this.#run("copies", "readwrite", (store) => store.delete(key));
  }

  async saveReference(key: string, handle: BrowserFileHandleLike): Promise<void> {
    await this.#run("references", "readwrite", (store) =>
      store.put({ key, handle } satisfies StoredReference),
    );
  }

  async getReference(key: string): Promise<BrowserFileHandleLike | null> {
    const value = await this.#run<StoredReference | undefined>(
      "references", "readonly", (store) => store.get(key),
    );
    return value?.handle ?? null;
  }

  async deleteReference(key: string): Promise<void> {
    await this.#run("references", "readwrite", (store) => store.delete(key));
  }
}
