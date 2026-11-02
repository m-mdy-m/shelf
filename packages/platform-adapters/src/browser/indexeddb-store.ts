import type {
  Annotation,
  Bookmark,
  Document,
  DocumentId,
  DocumentLocator,
  DocumentLocatorStorePort,
  DocumentRepositoryPort,
  ReadingProgress,
  ReadingProgressRepositoryPort,
  ReaderError,
  Quote,
  Result,
} from "@shelf/reader-core";
import type { ReaderDataBundle, ReaderDataSnapshot } from "./reader-data-bundle.js";
import { createReaderDataBundle, parseReaderDataBundle } from "./reader-data-bundle.js";
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

const DATABASE_VERSION = 4;

export interface ReaderDataRestoreSummary {
  readonly documents: number;
  readonly readingProgress: number;
  readonly bookmarks: number;
  readonly annotations: number;
  readonly quotes: number;
}

type StoreName =
  | "documents"
  | "locators"
  | "copies"
  | "references"
  | "readingProgress"
  | "bookmarks"
  | "annotations"
  | "quotes";

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
implements
  DocumentRepositoryPort,
  ReadingProgressRepositoryPort,
  DocumentLocatorStorePort,
  BrowserDocumentStoragePort {
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
      const request = factory.open(this.#databaseName, DATABASE_VERSION);
      let settled = false;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      request.onupgradeneeded = () => {
        const database = request.result;
        const transaction = request.transaction;
        const names = [
          "documents",
          "locators",
          "copies",
          "references",
          "readingProgress",
          "bookmarks",
          "annotations",
          "quotes",
        ] as const;
        for (const name of names) {
          const store = database.objectStoreNames.contains(name)
            ? transaction?.objectStore(name)
            : database.createObjectStore(name, {
              keyPath: name === "documents" || name === "bookmarks" ||
                name === "annotations" || name === "quotes"
                ? "id"
                : name === "locators" || name === "readingProgress" ? "documentId" : "key",
            });
          if (
            (name === "bookmarks" || name === "annotations" || name === "quotes") &&
            store !== undefined &&
            !store.indexNames.contains("documentId")
          ) {
            store.createIndex("documentId", "documentId", { unique: false });
          }
          if (
            (name === "documents" || name === "readingProgress") &&
            store !== undefined &&
            !store.indexNames.contains("updatedAt")
          ) {
            store.createIndex("updatedAt", "updatedAt", { unique: false });
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

  /** Export only portable Reader records. Locators, PDF bytes, file handles, and secrets are excluded. */
  async exportReaderData(): Promise<Result<ReaderDataBundle, ReaderError>> {
    try {
      const database = await this.#database();
      const snapshot = await new Promise<ReaderDataSnapshot>((resolve, reject) => {
        const names = ["documents", "readingProgress", "bookmarks", "annotations", "quotes"] as const;
        const transaction = database.transaction(names, "readonly");
        const values: {
          documents?: Document[];
          readingProgress?: ReadingProgress[];
          bookmarks?: Bookmark[];
          annotations?: Annotation[];
          quotes?: Quote[];
        } = {};
        const requests = [
          transaction.objectStore("documents").getAll(),
          transaction.objectStore("readingProgress").getAll(),
          transaction.objectStore("bookmarks").getAll(),
          transaction.objectStore("annotations").getAll(),
          transaction.objectStore("quotes").getAll(),
        ];
        requests[0].onsuccess = () => { values.documents = requests[0].result as Document[]; };
        requests[1].onsuccess = () => { values.readingProgress = requests[1].result as ReadingProgress[]; };
        requests[2].onsuccess = () => { values.bookmarks = requests[2].result as Bookmark[]; };
        requests[3].onsuccess = () => { values.annotations = requests[3].result as Annotation[]; };
        requests[4].onsuccess = () => { values.quotes = requests[4].result as Quote[]; };
        for (const request of requests) request.onerror = () => transaction.abort();
        transaction.oncomplete = () => resolve({
          documents: values.documents ?? [],
          readingProgress: values.readingProgress ?? [],
          bookmarks: values.bookmarks ?? [],
          annotations: values.annotations ?? [],
          quotes: values.quotes ?? [],
        });
        transaction.onerror = () => reject(transaction.error ?? new Error("Shelf could not read the Reader backup."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Shelf Reader backup was aborted."));
      });
      return createReaderDataBundle(snapshot, DATABASE_VERSION);
    } catch {
      return { ok: false, error: storageError("read-failed", "Shelf could not export the local Reader data.") };
    }
  }

  /**
   * Atomically replace portable Reader data. Existing local file locators and
   * source bytes are retained only for document IDs that remain in the bundle.
   */
  async restoreReaderData(input: unknown): Promise<Result<ReaderDataRestoreSummary, ReaderError>> {
    const parsed = parseReaderDataBundle(input);
    if (!parsed.ok) return parsed;

    try {
      const database = await this.#database();
      const bundle = parsed.value;
      await new Promise<void>((resolve, reject) => {
        const documentIds = new Set(bundle.documents.map((document) => String(document.id)));
        const names: StoreName[] = [
          "documents", "locators", "copies", "references", "readingProgress",
          "bookmarks", "annotations", "quotes",
        ];
        const transaction = database.transaction(names, "readwrite");
        for (const name of ["documents", "readingProgress", "bookmarks", "annotations", "quotes"] as const) {
          transaction.objectStore(name).clear();
        }
        for (const document of bundle.documents) transaction.objectStore("documents").put(document);
        for (const progress of bundle.readingProgress) transaction.objectStore("readingProgress").put(progress);
        for (const bookmark of bundle.bookmarks) transaction.objectStore("bookmarks").put(bookmark);
        for (const annotation of bundle.annotations) transaction.objectStore("annotations").put(annotation);
        for (const quote of bundle.quotes) transaction.objectStore("quotes").put(quote);

        // Keep same-device source access for restored documents; purge source data
        // only when its owning document was removed by the replacement bundle.
        const locatorStore = transaction.objectStore("locators");
        const cursorRequest = locatorStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (cursor === null) return;
          const stored = cursor.value as StoredLocator;
          if (!documentIds.has(String(cursor.key))) {
            cursor.delete();
            if (stored.locator.providerId === "shelf-browser-copy") {
              transaction.objectStore("copies").delete(stored.locator.value);
            } else if (stored.locator.providerId === "shelf-browser-reference") {
              transaction.objectStore("references").delete(stored.locator.value);
            }
          }
          cursor.continue();
        };
        cursorRequest.onerror = () => transaction.abort();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Shelf could not restore the Reader backup."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Shelf Reader restore was aborted."));
      });
      return {
        ok: true,
        value: {
          documents: bundle.documents.length,
          readingProgress: bundle.readingProgress.length,
          bookmarks: bundle.bookmarks.length,
          annotations: bundle.annotations.length,
          quotes: bundle.quotes.length,
        },
      };
    } catch {
      return { ok: false, error: storageError("write-failed", "Shelf could not restore the backup. No partial restore was committed.") };
    }
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
      await this.#deleteDocumentRecords(String(id));
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storageError("write-failed", "Shelf could not remove the document and its saved reading data.") };
    }
  }

  async #deleteDocumentRecords(id: string): Promise<void> {
    const database = await this.#database();
    await new Promise<void>((resolve, reject) => {
      const names: StoreName[] = [
        "documents", "locators", "readingProgress", "bookmarks", "annotations", "quotes",
      ];
      const transaction = database.transaction(names, "readwrite");
      transaction.objectStore("documents").delete(id);
      transaction.objectStore("locators").delete(id);
      transaction.objectStore("readingProgress").delete(id);

      for (const name of ["bookmarks", "annotations", "quotes"] as const) {
        const store = transaction.objectStore(name);
        const request = store.index("documentId").getAllKeys(id);
        request.onsuccess = () => {
          for (const key of request.result) store.delete(key);
        };
        request.onerror = () => transaction.abort();
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Shelf could not delete saved document data."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Shelf document deletion was aborted."));
    });
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

  async listBookmarks(id: DocumentId): Promise<Result<readonly Bookmark[], ReaderError>> {
    try {
      const value = await this.#run<Bookmark[]>(
        "bookmarks", "readonly", (store) => store.index("documentId").getAll(String(id)),
      );
      return { ok: true, value };
    } catch {
      return { ok: false, error: storageError("read-failed", "Shelf could not restore bookmarks.") };
    }
  }

  async saveBookmark(bookmark: Bookmark): Promise<Result<void, ReaderError>> {
    try {
      await this.#run("bookmarks", "readwrite", (store) => store.put(bookmark));
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storageError("write-failed", "Shelf could not save this bookmark.") };
    }
  }

  async deleteBookmark(id: Bookmark["id"]): Promise<Result<void, ReaderError>> {
    try {
      await this.#run("bookmarks", "readwrite", (store) => store.delete(String(id)));
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storageError("write-failed", "Shelf could not delete this bookmark.") };
    }
  }

  async listAnnotations(id: DocumentId): Promise<Result<readonly Annotation[], ReaderError>> {
    try {
      const value = await this.#run<Annotation[]>(
        "annotations", "readonly", (store) => store.index("documentId").getAll(String(id)),
      );
      return { ok: true, value };
    } catch {
      return { ok: false, error: storageError("read-failed", "Shelf could not restore annotations.") };
    }
  }

  async saveAnnotation(annotation: Annotation): Promise<Result<void, ReaderError>> {
    try {
      await this.#run("annotations", "readwrite", (store) => store.put(annotation));
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storageError("write-failed", "Shelf could not save this annotation.") };
    }
  }

  async deleteAnnotation(id: Annotation["id"]): Promise<Result<void, ReaderError>> {
    try {
      await this.#run("annotations", "readwrite", (store) => store.delete(String(id)));
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storageError("write-failed", "Shelf could not delete this annotation.") };
    }
  }

  async listQuotes(id: DocumentId): Promise<Result<readonly Quote[], ReaderError>> {
    try {
      const value = await this.#run<Quote[]>(
        "quotes", "readonly", (store) => store.index("documentId").getAll(String(id)),
      );
      return { ok: true, value };
    } catch {
      return { ok: false, error: storageError("read-failed", "Shelf could not restore quotes.") };
    }
  }

  async saveQuote(quote: Quote): Promise<Result<void, ReaderError>> {
    try {
      await this.#run("quotes", "readwrite", (store) => store.put(quote));
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storageError("write-failed", "Shelf could not save this quote.") };
    }
  }

  async deleteQuote(id: Quote["id"]): Promise<Result<void, ReaderError>> {
    try {
      await this.#run("quotes", "readwrite", (store) => store.delete(String(id)));
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, error: storageError("write-failed", "Shelf could not delete this quote.") };
    }
  }

}
