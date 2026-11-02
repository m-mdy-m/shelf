import type { Annotation, HighlightAnnotation, NoteAnnotation, PageRect, TextAnchor } from "../domain/annotation.js";
import type { Bookmark } from "../domain/bookmark.js";
import type { ReaderError } from "../domain/errors.js";
import type { AnnotationId, BookmarkId, DocumentId, QuoteId } from "../domain/ids.js";
import type { ClockPort, IdGeneratorPort } from "../ports/runtime.js";
import type {
  AnnotationRepositoryPort,
  BookmarkRepositoryPort,
  QuoteRepositoryPort,
} from "../ports/repositories.js";
import type { PageIndex } from "../domain/page-index.js";
import type { Quote } from "../domain/quote.js";
import type { Result } from "../domain/result.js";
import type { NewAnnotation, NewBookmark, NewQuote, ReaderAnnotationUseCases } from "./reader-use-cases.js";

export interface ReaderAnnotationDependencies {
  readonly bookmarks: BookmarkRepositoryPort;
  readonly annotations: AnnotationRepositoryPort;
  readonly quotes: QuoteRepositoryPort;
  readonly ids: IdGeneratorPort;
  readonly clock: ClockPort;
}

function failure(message: string): Result<never, ReaderError> {
  return { ok: false, error: { code: "invalid-input", message, retryable: false } };
}

function invalidAnchor(anchor: TextAnchor | null): boolean {
  return anchor !== null && (
    anchor.selectedText.length === 0 ||
    anchor.selectedText.length > 20_000 ||
    anchor.normalizedText.length === 0 ||
    anchor.normalizedText.length > 20_000 ||
    !Number.isSafeInteger(anchor.startOffset) ||
    !Number.isSafeInteger(anchor.endOffset) ||
    anchor.startOffset < 0 ||
    anchor.endOffset <= anchor.startOffset ||
    !Number.isSafeInteger(anchor.anchorVersion) ||
    anchor.anchorVersion < 1
  );
}

function validRect(rectangle: PageRect): boolean {
  return [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite) &&
    rectangle.x >= 0 &&
    rectangle.y >= 0 &&
    rectangle.width > 0 &&
    rectangle.height > 0 &&
    rectangle.x + rectangle.width <= 1 &&
    rectangle.y + rectangle.height <= 1;
}

function validPage(pageIndex: PageIndex): boolean {
  return Number.isSafeInteger(pageIndex) && pageIndex >= 0;
}

function validateBookmark(bookmark: NewBookmark | Bookmark): string | null {
  if (bookmark.documentId.trim().length === 0) return "A document is required for a bookmark.";
  if (!validPage(bookmark.pageIndex)) return "Bookmark page index is invalid.";
  if (bookmark.label !== null && bookmark.label.length > 200) return "Bookmark labels must be 200 characters or fewer.";
  if (invalidAnchor(bookmark.anchor)) return "Bookmark text anchor is invalid.";
  return null;
}

function validateAnnotation(annotation: NewAnnotation | Annotation): string | null {
  if (annotation.documentId.trim().length === 0) return "A document is required for an annotation.";
  if (!validPage(annotation.pageIndex)) return "Annotation page index is invalid.";
  if (invalidAnchor(annotation.anchor)) return "Annotation text anchor is invalid.";
  if (annotation.rectangles.length > 512 || !annotation.rectangles.every(validRect)) {
    return "Annotation geometry contains an invalid or excessive rectangle.";
  }
  if (annotation.kind === "highlight") {
    if (!["yellow", "green", "blue", "pink", "purple"].includes(annotation.color)) {
      return "Choose a supported highlight color.";
    }
  } else if (annotation.content.trim().length === 0 || annotation.content.length > 20_000) {
    return "Passage notes must contain between 1 and 20,000 characters.";
  }
  return null;
}

function validateQuote(quote: NewQuote | Quote): string | null {
  if (quote.documentId.trim().length === 0) return "A document is required for a quote.";
  if (!validPage(quote.pageIndex)) return "Quote page index is invalid.";
  if (quote.text.trim().length === 0 || quote.text.length > 20_000) {
    return "Quotes must contain between 1 and 20,000 characters.";
  }
  if (quote.tags.length > 50 || quote.tags.some((tag) => tag.trim().length === 0 || tag.length > 80)) {
    return "A quote can have up to 50 non-empty tags of at most 80 characters.";
  }
  if (invalidAnchor(quote.anchor)) return "Quote text anchor is invalid.";
  return null;
}

async function safeCall<Value>(
  operation: () => Promise<Result<Value, ReaderError>>,
  message: string,
  code: ReaderError["code"] = "write-failed",
): Promise<Result<Value, ReaderError>> {
  try {
    return await operation();
  } catch {
    return { ok: false, error: { code, message, retryable: true } };
  }
}

/** Platform-independent annotation use cases; all persistence stays behind ports. */
export class ReaderAnnotationService implements ReaderAnnotationUseCases {
  readonly #dependencies: ReaderAnnotationDependencies;

  constructor(dependencies: ReaderAnnotationDependencies) {
    this.#dependencies = dependencies;
  }

  listBookmarks(id: DocumentId): Promise<Result<readonly Bookmark[], ReaderError>> {
    return safeCall(
      () => this.#dependencies.bookmarks.listByDocumentId(id),
      "Shelf could not load bookmarks.",
      "read-failed",
    );
  }

  async addBookmark(input: NewBookmark): Promise<Result<Bookmark, ReaderError>> {
    const invalid = validateBookmark(input);
    if (invalid !== null) return failure(invalid);
    const bookmark: Bookmark = {
      ...input,
      label: input.label?.trim() || null,
      id: this.#dependencies.ids.next<"BookmarkId">("BookmarkId"),
      createdAt: this.#dependencies.clock.now(),
    };
    return safeCall(async () => {
      const result = await this.#dependencies.bookmarks.save(bookmark);
      return result.ok ? { ok: true as const, value: bookmark } : result;
    }, "Shelf could not save this bookmark.");
  }

  async updateBookmark(bookmark: Bookmark): Promise<Result<Bookmark, ReaderError>> {
    const invalid = validateBookmark(bookmark);
    if (invalid !== null) return failure(invalid);
    const updated = { ...bookmark, label: bookmark.label?.trim() || null };
    return safeCall(async () => {
      const result = await this.#dependencies.bookmarks.save(updated);
      return result.ok ? { ok: true as const, value: updated } : result;
    }, "Shelf could not update this bookmark.");
  }

  deleteBookmark(id: BookmarkId): Promise<Result<void, ReaderError>> {
    return safeCall(
      () => this.#dependencies.bookmarks.delete(id),
      "Shelf could not delete this bookmark.",
    );
  }

  listAnnotations(id: DocumentId): Promise<Result<readonly Annotation[], ReaderError>> {
    return safeCall(
      () => this.#dependencies.annotations.listByDocumentId(id),
      "Shelf could not load annotations.",
      "read-failed",
    );
  }

  async saveAnnotation(input: NewAnnotation): Promise<Result<Annotation, ReaderError>> {
    const invalid = validateAnnotation(input);
    if (invalid !== null) return failure(invalid);
    const now = this.#dependencies.clock.now();
    let annotation: Annotation;
    if (input.kind === "highlight") {
      annotation = {
        ...input,
        id: this.#dependencies.ids.next<"AnnotationId">("AnnotationId"),
        createdAt: now,
        updatedAt: now,
      } satisfies HighlightAnnotation;
    } else {
      annotation = {
        ...input,
        id: this.#dependencies.ids.next<"AnnotationId">("AnnotationId"),
        content: input.content.trim(),
        createdAt: now,
        updatedAt: now,
      } satisfies NoteAnnotation;
    }
    return safeCall(async () => {
      const result = await this.#dependencies.annotations.save(annotation);
      return result.ok ? { ok: true as const, value: annotation } : result;
    }, "Shelf could not save this annotation.");
  }

  async updateAnnotation(annotation: Annotation): Promise<Result<Annotation, ReaderError>> {
    const invalid = validateAnnotation(annotation);
    if (invalid !== null) return failure(invalid);
    const updated = annotation.kind === "note"
      ? { ...annotation, content: annotation.content.trim(), updatedAt: this.#dependencies.clock.now() }
      : { ...annotation, updatedAt: this.#dependencies.clock.now() };
    return safeCall(async () => {
      const result = await this.#dependencies.annotations.save(updated);
      return result.ok ? { ok: true as const, value: updated } : result;
    }, "Shelf could not update this annotation.");
  }

  deleteAnnotation(id: AnnotationId): Promise<Result<void, ReaderError>> {
    return safeCall(
      () => this.#dependencies.annotations.delete(id),
      "Shelf could not delete this annotation.",
    );
  }

  listQuotes(id: DocumentId): Promise<Result<readonly Quote[], ReaderError>> {
    return safeCall(
      () => this.#dependencies.quotes.listByDocumentId(id),
      "Shelf could not load quotes.",
      "read-failed",
    );
  }

  async addQuote(input: NewQuote): Promise<Result<Quote, ReaderError>> {
    const invalid = validateQuote(input);
    if (invalid !== null) return failure(invalid);
    const now = this.#dependencies.clock.now();
    const quote: Quote = {
      ...input,
      text: input.text.trim(),
      tags: [...input.tags],
      id: this.#dependencies.ids.next<"QuoteId">("QuoteId"),
      createdAt: now,
      updatedAt: now,
    };
    return safeCall(async () => {
      const result = await this.#dependencies.quotes.save(quote);
      return result.ok ? { ok: true as const, value: quote } : result;
    }, "Shelf could not save this quote.");
  }

  deleteQuote(id: QuoteId): Promise<Result<void, ReaderError>> {
    return safeCall(
      () => this.#dependencies.quotes.delete(id),
      "Shelf could not delete this quote.",
    );
  }
}
