import type { Annotation } from "../domain/annotation.js";
import type { Bookmark } from "../domain/bookmark.js";
import type { Document } from "../domain/document.js";
import type { DocumentLocator } from "../domain/document-locator.js";
import type { ReaderError } from "../domain/errors.js";
import type {
  AnnotationId,
  BookmarkId,
  DocumentId,
  QuoteId,
  ReaderSessionId,
} from "../domain/ids.js";
import type { PageIndex } from "../domain/page-index.js";
import type { ReadingProgress, ReaderSession } from "../domain/reading-progress.js";
import type { Quote } from "../domain/quote.js";
import type { Result } from "../domain/result.js";

type WithoutGeneratedFields<Value> = Value extends unknown
  ? Omit<Value, "id" | "createdAt" | "updatedAt">
  : never;

export type NewBookmark = Omit<Bookmark, "id" | "createdAt">;
export type NewAnnotation = WithoutGeneratedFields<Annotation>;
export type NewQuote = Omit<Quote, "id" | "createdAt" | "updatedAt">;

export interface SaveReadingProgressInput {
  readonly documentId: DocumentId;
  readonly pageIndex: PageIndex;
  readonly scrollOffset: number;
  readonly zoom: number;
  readonly readingMode: ReadingProgress["readingMode"];
}

export interface ReaderUseCases {
  importDocument(locator: DocumentLocator): Promise<Result<Document, ReaderError>>;
  getDocument(id: DocumentId): Promise<Result<Document | null, ReaderError>>;
  listDocuments(): Promise<Result<readonly Document[], ReaderError>>;
  openDocument(id: DocumentId): Promise<Result<ReaderSession, ReaderError>>;
  closeDocument(sessionId: ReaderSessionId): Promise<Result<void, ReaderError>>;

  getReadingProgress(id: DocumentId): Promise<Result<ReadingProgress | null, ReaderError>>;
  saveReadingProgress(input: SaveReadingProgressInput): Promise<Result<ReadingProgress, ReaderError>>;

  listBookmarks(id: DocumentId): Promise<Result<readonly Bookmark[], ReaderError>>;
  addBookmark(input: NewBookmark): Promise<Result<Bookmark, ReaderError>>;
  deleteBookmark(id: BookmarkId): Promise<Result<void, ReaderError>>;

  listAnnotations(id: DocumentId): Promise<Result<readonly Annotation[], ReaderError>>;
  saveAnnotation(input: NewAnnotation): Promise<Result<Annotation, ReaderError>>;
  deleteAnnotation(id: AnnotationId): Promise<Result<void, ReaderError>>;

  listQuotes(id: DocumentId): Promise<Result<readonly Quote[], ReaderError>>;
  addQuote(input: NewQuote): Promise<Result<Quote, ReaderError>>;
  deleteQuote(id: QuoteId): Promise<Result<void, ReaderError>>;
}
