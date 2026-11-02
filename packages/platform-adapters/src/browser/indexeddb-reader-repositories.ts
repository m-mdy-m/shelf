import type {
  AnnotationRepositoryPort,
  BookmarkRepositoryPort,
  QuoteRepositoryPort,
} from "@shelf/reader-core";
import type { IndexedDbShelfStore } from "./indexeddb-store.js";

/** Repository ports remain independent even when they share one IndexedDB database. */
export interface IndexedDbReaderRepositories {
  readonly bookmarks: BookmarkRepositoryPort;
  readonly annotations: AnnotationRepositoryPort;
  readonly quotes: QuoteRepositoryPort;
}

export function createIndexedDbReaderRepositories(
  store: IndexedDbShelfStore,
): IndexedDbReaderRepositories {
  return {
    bookmarks: {
      listByDocumentId: (documentId) => store.listBookmarks(documentId),
      save: (bookmark) => store.saveBookmark(bookmark),
      delete: (bookmarkId) => store.deleteBookmark(bookmarkId),
    },
    annotations: {
      listByDocumentId: (documentId) => store.listAnnotations(documentId),
      save: (annotation) => store.saveAnnotation(annotation),
      delete: (annotationId) => store.deleteAnnotation(annotationId),
    },
    quotes: {
      listByDocumentId: (documentId) => store.listQuotes(documentId),
      save: (quote) => store.saveQuote(quote),
      delete: (quoteId) => store.deleteQuote(quoteId),
    },
  };
}
