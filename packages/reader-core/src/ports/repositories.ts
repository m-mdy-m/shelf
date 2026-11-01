import type { Annotation } from "../domain/annotation.js";
import type { Bookmark } from "../domain/bookmark.js";
import type { Document } from "../domain/document.js";
import type { ReaderError } from "../domain/errors.js";
import type { AnnotationId, BookmarkId, DocumentId, QuoteId } from "../domain/ids.js";
import type { ReadingProgress } from "../domain/reading-progress.js";
import type { Quote } from "../domain/quote.js";
import type { Result } from "../domain/result.js";

/** Persistence interfaces deliberately expose domain records, not SQL details. */
export interface DocumentRepositoryPort {
  getById(id: DocumentId): Promise<Result<Document | null, ReaderError>>;
  list(): Promise<Result<readonly Document[], ReaderError>>;
  save(document: Document): Promise<Result<void, ReaderError>>;
  delete(id: DocumentId): Promise<Result<void, ReaderError>>;
}

export interface ReadingProgressRepositoryPort {
  getByDocumentId(id: DocumentId): Promise<Result<ReadingProgress | null, ReaderError>>;
  save(progress: ReadingProgress): Promise<Result<void, ReaderError>>;
  deleteByDocumentId(id: DocumentId): Promise<Result<void, ReaderError>>;
}

export interface BookmarkRepositoryPort {
  listByDocumentId(id: DocumentId): Promise<Result<readonly Bookmark[], ReaderError>>;
  save(bookmark: Bookmark): Promise<Result<void, ReaderError>>;
  delete(id: BookmarkId): Promise<Result<void, ReaderError>>;
}

export interface AnnotationRepositoryPort {
  listByDocumentId(id: DocumentId): Promise<Result<readonly Annotation[], ReaderError>>;
  save(annotation: Annotation): Promise<Result<void, ReaderError>>;
  delete(id: AnnotationId): Promise<Result<void, ReaderError>>;
}

export interface QuoteRepositoryPort {
  listByDocumentId(id: DocumentId): Promise<Result<readonly Quote[], ReaderError>>;
  save(quote: Quote): Promise<Result<void, ReaderError>>;
  delete(id: QuoteId): Promise<Result<void, ReaderError>>;
}
