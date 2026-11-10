import type { Document, DocumentId } from "./document.js";
import type { ReadingProgress } from "./reading-progress.js";

export const LIBRARY_READING_STATUSES = [
  "not-started",
  "reading",
  "on-hold",
  "completed",
  "reference",
] as const;

export type LibraryReadingStatus = typeof LIBRARY_READING_STATUSES[number];
export type LibraryProgressFilter = "all" | "not-started" | "in-progress" | "completed";
export type LibraryFormatFilter = "all" | "pdf" | "readme" | "complete";
export type LibrarySortOrder = "recent" | "title" | "author" | "progress" | "last-opened";

export interface LibraryEntry {
  readonly documentId: DocumentId;
  /** Optional user override; null keeps the title extracted from the PDF. */
  readonly titleOverride: string | null;
  /** Optional user override; null keeps the authors extracted from the PDF. */
  readonly authorsOverride: readonly string[] | null;
  readonly summaryOverride: string | null;
  readonly tags: readonly string[];
  readonly readingStatus: LibraryReadingStatus;
  /** Portable Markdown content for this book's optional README.md. */
  readonly readmeMarkdown: string;
  readonly lastOpenedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface LibraryFilters {
  readonly query: string;
  readonly status: LibraryReadingStatus | "all";
  readonly author: string;
  readonly tag: string;
  readonly progress: LibraryProgressFilter;
  readonly format: LibraryFormatFilter;
  readonly sort: LibrarySortOrder;
}

export interface SavedLibraryView {
  readonly id: string;
  readonly name: string;
  readonly filters: LibraryFilters;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface LibraryCatalogItem {
  readonly document: Document;
  readonly entry: LibraryEntry;
  readonly progress: ReadingProgress | null;
}

export interface LibraryProgressSummary {
  readonly totalPages: number | null;
  readonly pagesRead: number;
  readonly pagesRemaining: number | null;
  readonly completionPercent: number | null;
  readonly currentPageNumber: number | null;
  readonly state: Exclude<LibraryProgressFilter, "all">;
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  query: "",
  status: "all",
  author: "",
  tag: "all",
  progress: "all",
  format: "all",
  sort: "recent",
};

export function isLibraryReadingStatus(value: unknown): value is LibraryReadingStatus {
  return typeof value === "string" &&
    (LIBRARY_READING_STATUSES as readonly string[]).includes(value);
}

export function createDefaultLibraryEntry(documentId: DocumentId, now = Date.now()): LibraryEntry {
  return {
    documentId,
    titleOverride: null,
    authorsOverride: null,
    summaryOverride: null,
    tags: [],
    readingStatus: "not-started",
    readmeMarkdown: "",
    lastOpenedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Derive an estimated completion position, not verified time-on-page or unique pages read. */
export function deriveLibraryProgress(
  document: Document,
  entry: LibraryEntry,
  progress: ReadingProgress | null,
): LibraryProgressSummary {
  const pageCount = document.metadata.pageCount;
  const totalPages = pageCount !== null && Number.isSafeInteger(pageCount) && pageCount > 0
    ? pageCount
    : null;
  const positionPage = progress === null
    ? null
    : totalPages === null
      ? Math.max(1, progress.pageIndex + 1)
      : Math.min(totalPages, Math.max(1, progress.pageIndex + 1));
  const currentPageNumber = positionPage;
  const pagesRead = entry.readingStatus === "completed" && totalPages !== null
    ? totalPages
    : positionPage ?? 0;
  const pagesRemaining = totalPages === null ? null : Math.max(0, totalPages - pagesRead);
  const completionPercent = totalPages === null
    ? null
    : pagesRead >= totalPages
      ? 100
      : Math.round((pagesRead / totalPages) * 100);
  const state: LibraryProgressSummary["state"] = entry.readingStatus === "completed" ||
    (totalPages !== null && pagesRead >= totalPages)
      ? "completed"
      : pagesRead === 0
        ? "not-started"
        : "in-progress";

  return {
    totalPages,
    pagesRead,
    pagesRemaining,
    completionPercent,
    currentPageNumber,
    state,
  };
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function effectiveTitle(item: LibraryCatalogItem): string {
  return item.entry.titleOverride?.trim() || item.document.metadata.title || item.document.source.displayName || "Untitled PDF";
}

function effectiveAuthors(item: LibraryCatalogItem): readonly string[] {
  return item.entry.authorsOverride ?? item.document.metadata.authors;
}

function matchesProgress(item: LibraryCatalogItem, filter: LibraryProgressFilter): boolean {
  if (filter === "all") return true;
  const summary = deriveLibraryProgress(item.document, item.entry, item.progress);
  if (filter === "completed") return summary.state === "completed";
  if (filter === "not-started") return summary.state === "not-started";
  return summary.state === "in-progress";
}

function matchesFormat(item: LibraryCatalogItem, filter: LibraryFormatFilter): boolean {
  if (filter === "all") return true;
  const hasPdf = item.document.source.mediaType.toLocaleLowerCase() === "application/pdf" ||
    (item.document.source.displayName ?? "").toLocaleLowerCase().endsWith(".pdf");
  const hasReadme = item.entry.readmeMarkdown.trim().length > 0;
  if (filter === "pdf") return hasPdf;
  if (filter === "readme") return hasReadme;
  return hasPdf && hasReadme;
}

export function filterLibraryItems(
  items: readonly LibraryCatalogItem[],
  filters: LibraryFilters,
): LibraryCatalogItem[] {
  const query = normalized(filters.query);
  const author = normalized(filters.author);
  const tag = normalized(filters.tag);
  const filtered = items.filter((item) => {
    const authors = effectiveAuthors(item);
    const tags = item.entry.tags;
    const matchesQuery = query.length === 0 || normalized([
      effectiveTitle(item),
      item.entry.summaryOverride ?? item.document.metadata.pdfSubject ?? "",
      authors.join(" "),
      tags.join(" "),
      item.document.source.displayName ?? "",
      item.entry.readmeMarkdown,
    ].join(" ")).includes(query);
    const matchesStatus = filters.status === "all" || item.entry.readingStatus === filters.status;
    const matchesAuthor = author.length === 0 ||
      authors.some((name) => normalized(name).includes(author));
    const matchesTag = tag.length === 0 || tag === "all" ||
      tags.some((value) => normalized(value) === tag);
    return matchesQuery && matchesStatus && matchesAuthor && matchesTag &&
      matchesProgress(item, filters.progress) && matchesFormat(item, filters.format);
  });

  const compareTitle = (left: LibraryCatalogItem, right: LibraryCatalogItem): number =>
    effectiveTitle(left).localeCompare(effectiveTitle(right), undefined, { sensitivity: "base" });
  return filtered.sort((left, right) => {
    if (filters.sort === "title") return compareTitle(left, right);
    if (filters.sort === "author") {
      const leftAuthor = effectiveAuthors(left)[0] ?? "";
      const rightAuthor = effectiveAuthors(right)[0] ?? "";
      return leftAuthor.localeCompare(rightAuthor, undefined, { sensitivity: "base" }) || compareTitle(left, right);
    }
    if (filters.sort === "progress") {
      const leftValue = deriveLibraryProgress(left.document, left.entry, left.progress).completionPercent ?? -1;
      const rightValue = deriveLibraryProgress(right.document, right.entry, right.progress).completionPercent ?? -1;
      return rightValue - leftValue || compareTitle(left, right);
    }
    if (filters.sort === "last-opened") {
      return (right.entry.lastOpenedAt ?? -1) - (left.entry.lastOpenedAt ?? -1) || compareTitle(left, right);
    }
    return right.document.updatedAt - left.document.updatedAt || compareTitle(left, right);
  });
}
