import type {
  Annotation,
  Bookmark,
  Document,
  DocumentId,
  PageIndex,
  Quote,
  ReadingProgress,
  ReaderError,
  Result,
  TextAnchor,
  LibraryEntry,
  LibraryFilters,
  LibraryReadingStatus,
  SavedLibraryView,
} from "@shelf/reader-core";

export const READER_DATA_BUNDLE_FORMAT = "shelf-reader-data" as const;
export const READER_DATA_BUNDLE_VERSION = 2 as const;

export interface ReaderDataBundle {
  readonly format: typeof READER_DATA_BUNDLE_FORMAT;
  readonly version: typeof READER_DATA_BUNDLE_VERSION;
  readonly sourceSchemaVersion: number;
  readonly exportedAt: number;
  readonly documents: readonly Document[];
  readonly readingProgress: readonly ReadingProgress[];
  readonly bookmarks: readonly Bookmark[];
  readonly annotations: readonly Annotation[];
  readonly quotes: readonly Quote[];
  readonly libraryEntries: readonly LibraryEntry[];
  readonly savedLibraryViews: readonly SavedLibraryView[];
}

export interface ReaderDataSnapshot {
  readonly documents: readonly Document[];
  readonly readingProgress: readonly ReadingProgress[];
  readonly bookmarks: readonly Bookmark[];
  readonly annotations: readonly Annotation[];
  readonly quotes: readonly Quote[];
  readonly libraryEntries: readonly LibraryEntry[];
  readonly savedLibraryViews: readonly SavedLibraryView[];
}

function invalid(message: string): Result<never, ReaderError> {
  return {
    ok: false,
    error: { code: "invalid-input", message, retryable: false },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value["every"](isString);
}

function sanitizeLibraryEntry(value: unknown): LibraryEntry | null {
  if (!isRecord(value) || !isString(value["documentId"]) || value["documentId"].trim() === "" ||
      !(value["titleOverride"] === null || (isString(value["titleOverride"]) && value["titleOverride"].length <= 500)) ||
      !(value["authorsOverride"] === null || strings(value["authorsOverride"])) ||
      !(value["summaryOverride"] === null || (isString(value["summaryOverride"]) && value["summaryOverride"].length <= 20_000)) ||
      !strings(value["tags"]) || value["tags"].length > 50 ||
      value["tags"].some((tag) => tag.trim() === "" || tag.length > 80) ||
      !["not-started", "reading", "on-hold", "completed", "reference"].includes(String(value["readingStatus"])) ||
      !isString(value["readmeMarkdown"]) || value["readmeMarkdown"].length > 262_144 ||
      !(value["lastOpenedAt"] === null || isFiniteNumber(value["lastOpenedAt"])) ||
      !isFiniteNumber(value["createdAt"]) || !isFiniteNumber(value["updatedAt"])) return null;
  if (Array.isArray(value["authorsOverride"]) && value["authorsOverride"].length > 100) return null;
  return {
    documentId: value["documentId"] as LibraryEntry["documentId"],
    titleOverride: value["titleOverride"],
    authorsOverride: value["authorsOverride"] === null ? null : [...value["authorsOverride"] as string[]],
    summaryOverride: value["summaryOverride"],
    tags: [...value["tags"]],
    readingStatus: value["readingStatus"] as LibraryReadingStatus,
    readmeMarkdown: value["readmeMarkdown"],
    lastOpenedAt: value["lastOpenedAt"],
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
  };
}

function sanitizeLibraryFilters(value: unknown): LibraryFilters | null {
  const statuses = ["all", "not-started", "reading", "on-hold", "completed", "reference"];
  const progress = ["all", "not-started", "in-progress", "completed"];
  const formats = ["all", "pdf", "readme", "complete"];
  const sorts = ["recent", "title", "author", "progress", "last-opened"];
  if (!isRecord(value) ||
      !isString(value["query"]) || value["query"].length > 256 ||
      !isString(value["author"]) || value["author"].length > 200 ||
      !isString(value["tag"]) || value["tag"].length > 80 ||
      !statuses.includes(String(value["status"])) ||
      !progress.includes(String(value["progress"])) ||
      !formats.includes(String(value["format"])) ||
      !sorts.includes(String(value["sort"]))) return null;
  return {
    query: value["query"],
    status: value["status"] as LibraryFilters["status"],
    author: value["author"],
    tag: value["tag"],
    progress: value["progress"] as LibraryFilters["progress"],
    format: value["format"] as LibraryFilters["format"],
    sort: value["sort"] as LibraryFilters["sort"],
  };
}

function sanitizeSavedLibraryView(value: unknown): SavedLibraryView | null {
  if (!isRecord(value) || !isString(value["id"]) || value["id"].trim() === "" ||
      !isString(value["name"]) || value["name"].trim() === "" || value["name"].length > 100 ||
      !isFiniteNumber(value["createdAt"]) || !isFiniteNumber(value["updatedAt"])) return null;
  const filters = sanitizeLibraryFilters(value["filters"]);
  if (filters === null) return null;
  return {
    id: value["id"],
    name: value["name"].trim(),
    filters,
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
  };
}

function sanitizeDocument(value: unknown): Document | null {
  if (!isRecord(value) || !isString(value["id"]) || value["id"].trim() === "" ||
      !isRecord(value["metadata"]) || !isRecord(value["source"])) return null;

  const metadata = value["metadata"];
  const source = value["source"];
  const sourceKinds = ["local-file", "imported-copy", "external-reference", "provider"];
  if (!isString(metadata["title"]) || !strings(metadata["authors"]) ||
      !isNullableString(metadata["language"]) ||
      !(metadata["pageCount"] === null || isSafeNonNegativeInteger(metadata["pageCount"])) ||
      !isNullableString(metadata["pdfTitle"]) || !isNullableString(metadata["pdfSubject"]) ||
      !isString(source["kind"]) || !sourceKinds.includes(source["kind"]) ||
      !isNullableString(source["displayName"]) || !isString(source["mediaType"]) ||
      !(source["sizeBytes"] === null || isSafeNonNegativeInteger(source["sizeBytes"])) ||
      !(source["modifiedAt"] === null || isFiniteNumber(source["modifiedAt"])) ||
      !isFiniteNumber(value["createdAt"]) || !isFiniteNumber(value["updatedAt"]) ||
      !(value["fingerprint"] === null || (isString(value["fingerprint"]) && value["fingerprint"].length > 0))) {
    return null;
  }

  return {
    id: value["id"] as DocumentId,
    metadata: {
      title: metadata["title"],
      authors: [...metadata["authors"]],
      language: metadata["language"],
      pageCount: metadata["pageCount"],
      pdfTitle: metadata["pdfTitle"],
      pdfSubject: metadata["pdfSubject"],
    },
    source: {
      kind: source["kind"] as Document["source"]["kind"],
      displayName: source["displayName"],
      mediaType: source["mediaType"],
      sizeBytes: source["sizeBytes"],
      modifiedAt: source["modifiedAt"],
    },
    fingerprint: value["fingerprint"] as Document["fingerprint"],
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
  };
}

function sanitizeAnchor(value: unknown): TextAnchor | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isString(value["selectedText"]) ||
      !isString(value["normalizedText"]) ||
      !isSafeNonNegativeInteger(value["startOffset"]) ||
      !isSafeNonNegativeInteger(value["endOffset"]) ||
      value["endOffset"] <= value["startOffset"] ||
      !(value["documentFingerprint"] === null || isString(value["documentFingerprint"])) ||
      !isSafeNonNegativeInteger(value["anchorVersion"]) || value["anchorVersion"] < 1) {
    return undefined;
  }
  return {
    selectedText: value["selectedText"],
    normalizedText: value["normalizedText"],
    startOffset: value["startOffset"],
    endOffset: value["endOffset"],
    documentFingerprint: value["documentFingerprint"] as TextAnchor["documentFingerprint"],
    anchorVersion: value["anchorVersion"],
  };
}

function sanitizeProgress(value: unknown): ReadingProgress | null {
  if (!isRecord(value) || !isString(value["documentId"]) ||
      !isSafeNonNegativeInteger(value["pageIndex"]) ||
      !isFiniteNumber(value["scrollOffset"]) || value["scrollOffset"] < 0 || value["scrollOffset"] > 1 ||
      !isFiniteNumber(value["zoom"]) || value["zoom"] < 0.25 || value["zoom"] > 4 ||
      (value["readingMode"] !== "continuous" && value["readingMode"] !== "single-page") ||
      !isFiniteNumber(value["updatedAt"])) return null;
  return {
    documentId: value["documentId"] as DocumentId,
    pageIndex: value["pageIndex"] as PageIndex,
    scrollOffset: value["scrollOffset"],
    zoom: value["zoom"],
    readingMode: value["readingMode"],
    updatedAt: value["updatedAt"],
  };
}

function sanitizeBookmark(value: unknown): Bookmark | null {
  if (!isRecord(value) || !isString(value["id"]) || value["id"].trim() === "" ||
      !isString(value["documentId"]) || !isSafeNonNegativeInteger(value["pageIndex"]) ||
      !isNullableString(value["label"]) || !isFiniteNumber(value["createdAt"])) return null;
  const anchor = sanitizeAnchor(value["anchor"]);
  if (anchor === undefined) return null;
  return {
    id: value["id"] as Bookmark["id"],
    documentId: value["documentId"] as DocumentId,
    pageIndex: value["pageIndex"] as PageIndex,
    label: value["label"],
    anchor,
    createdAt: value["createdAt"],
  };
}

function sanitizeRectangles(value: unknown): Annotation["rectangles"] | null {
  if (!Array.isArray(value) || value["length"] > 512) return null;
  const rectangles: Annotation["rectangles"][number][] = [];
  for (const item of value) {
    if (!isRecord(item) || !isFiniteNumber(item["x"]) || !isFiniteNumber(item["y"]) ||
        !isFiniteNumber(item["width"]) || !isFiniteNumber(item["height"]) ||
        item["x"] < 0 || item["y"] < 0 || item["width"] <= 0 || item["height"] <= 0 ||
        item["x"] + item["width"] > 1 || item["y"] + item["height"] > 1) return null;
    rectangles.push({ x: item["x"], y: item["y"], width: item["width"], height: item["height"] });
  }
  return rectangles;
}

function sanitizeAnnotation(value: unknown): Annotation | null {
  if (!isRecord(value) || !isString(value["id"]) || value["id"].trim() === "" ||
      !isString(value["documentId"]) || !isSafeNonNegativeInteger(value["pageIndex"]) ||
      !isFiniteNumber(value["createdAt"]) || !isFiniteNumber(value["updatedAt"])) return null;
  const anchor = sanitizeAnchor(value["anchor"]);
  const rectangles = sanitizeRectangles(value["rectangles"]);
  if (anchor === undefined || rectangles === null) return null;
  if (value["kind"] === "highlight") {
    if (!["yellow", "green", "blue", "pink", "purple"].includes(String(value["color"]))) return null;
    return {
      id: value["id"] as Annotation["id"],
      documentId: value["documentId"] as DocumentId,
      pageIndex: value["pageIndex"] as PageIndex,
      kind: "highlight",
      color: value["color"] as Extract<Annotation, { kind: "highlight" }>["color"],
      anchor,
      rectangles,
      createdAt: value["createdAt"],
      updatedAt: value["updatedAt"],
    };
  }
  if (value["kind"] === "note" && isString(value["content"]) && value["content"].trim() !== "") {
    return {
      id: value["id"] as Annotation["id"],
      documentId: value["documentId"] as DocumentId,
      pageIndex: value["pageIndex"] as PageIndex,
      kind: "note",
      content: value["content"],
      anchor,
      rectangles,
      createdAt: value["createdAt"],
      updatedAt: value["updatedAt"],
    };
  }
  return null;
}

function sanitizeQuote(value: unknown): Quote | null {
  if (!isRecord(value) || !isString(value["id"]) || value["id"].trim() === "" ||
      !isString(value["documentId"]) || !isSafeNonNegativeInteger(value["pageIndex"]) ||
      !isString(value["text"]) || value["text"].trim() === "" ||
      !isNullableString(value["attribution"]) ||
      !(value["annotationId"] === null || isString(value["annotationId"])) ||
      !strings(value["tags"]) || !isFiniteNumber(value["createdAt"]) ||
      !isFiniteNumber(value["updatedAt"])) return null;
  const anchor = sanitizeAnchor(value["anchor"]);
  if (anchor === undefined) return null;
  return {
    id: value["id"] as Quote["id"],
    documentId: value["documentId"] as DocumentId,
    pageIndex: value["pageIndex"] as PageIndex,
    text: value["text"],
    attribution: value["attribution"],
    annotationId: value["annotationId"] as Quote["annotationId"],
    anchor,
    tags: [...value["tags"]],
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
  };
}

function uniqueIds(items: readonly { readonly id: string }[]): boolean {
  return new Set(items.map((item) => item["id"])).size === items.length;
}

/** Validate untrusted import JSON and copy only export-safe fields into the result. */
export function parseReaderDataBundle(input: unknown): Result<ReaderDataBundle, ReaderError> {
  if (!isRecord(input) || input["format"] !== READER_DATA_BUNDLE_FORMAT ||
      (input["version"] !== 1 && input["version"] !== READER_DATA_BUNDLE_VERSION) ||
      !isSafeNonNegativeInteger(input["sourceSchemaVersion"]) ||
      !isFiniteNumber(input["exportedAt"]) ||
      !Array.isArray(input["documents"]) || !Array.isArray(input["readingProgress"]) ||
      !Array.isArray(input["bookmarks"]) || !Array.isArray(input["annotations"]) ||
      !Array.isArray(input["quotes"]) ||
      (input["version"] === READER_DATA_BUNDLE_VERSION &&
        (!Array.isArray(input["libraryEntries"]) || !Array.isArray(input["savedLibraryViews"]))) ||
      (input["libraryEntries"] !== undefined && !Array.isArray(input["libraryEntries"])) ||
      (input["savedLibraryViews"] !== undefined && !Array.isArray(input["savedLibraryViews"]))) {
    return invalid("This file is not a supported Shelf Reader data bundle.");
  }

  const documents = input["documents"].map(sanitizeDocument);
  const readingProgress = input["readingProgress"].map(sanitizeProgress);
  const bookmarks = input["bookmarks"].map(sanitizeBookmark);
  const annotations = input["annotations"].map(sanitizeAnnotation);
  const quotes = input["quotes"].map(sanitizeQuote);
  const libraryEntries = ((input["libraryEntries"] as unknown[] | undefined) ?? []).map(sanitizeLibraryEntry);
  const savedLibraryViews = ((input["savedLibraryViews"] as unknown[] | undefined) ?? []).map(sanitizeSavedLibraryView);
  if ([...documents, ...readingProgress, ...bookmarks, ...annotations, ...quotes,
    ...libraryEntries, ...savedLibraryViews].some((item) => item === null)) {
    return invalid("The Shelf backup contains an invalid or unsupported Reader record.");
  }
  const safeDocuments = documents as Document[];
  const safeProgress = readingProgress as ReadingProgress[];
  const safeBookmarks = bookmarks as Bookmark[];
  const safeAnnotations = annotations as Annotation[];
  const safeQuotes = quotes as Quote[];
  const safeLibraryEntries = libraryEntries as LibraryEntry[];
  const safeSavedLibraryViews = savedLibraryViews as SavedLibraryView[];

  if (!uniqueIds(safeDocuments) || !uniqueIds(safeBookmarks) ||
      !uniqueIds(safeAnnotations) || !uniqueIds(safeQuotes) || !uniqueIds(safeSavedLibraryViews) ||
      new Set(safeProgress.map((item) => item["documentId"])).size !== safeProgress.length ||
      new Set(safeLibraryEntries.map((item) => String(item["documentId"]))).size !== safeLibraryEntries.length) {
    return invalid("The Shelf backup contains duplicate record identifiers.");
  }

  const documentIds = new Set(safeDocuments.map((item) => String(item["id"])));
  const allScopedRecords = [
    ...safeProgress, ...safeBookmarks, ...safeAnnotations, ...safeQuotes, ...safeLibraryEntries,
  ];
  if (allScopedRecords.some((item) => !documentIds.has(String(item["documentId"])))) {
    return invalid("The Shelf backup contains saved Reader data without its document record.");
  }

  return {
    ok: true,
    value: {
      format: READER_DATA_BUNDLE_FORMAT,
      version: READER_DATA_BUNDLE_VERSION,
      sourceSchemaVersion: input["sourceSchemaVersion"],
      exportedAt: input["exportedAt"],
      documents: safeDocuments,
      readingProgress: safeProgress,
      bookmarks: safeBookmarks,
      annotations: safeAnnotations,
      quotes: safeQuotes,
      libraryEntries: safeLibraryEntries,
      savedLibraryViews: safeSavedLibraryViews,
    },
  };
}

export function createReaderDataBundle(
  snapshot: ReaderDataSnapshot,
  sourceSchemaVersion: number,
  exportedAt = Date.now(),
): Result<ReaderDataBundle, ReaderError> {
  return parseReaderDataBundle({
    format: READER_DATA_BUNDLE_FORMAT,
    version: READER_DATA_BUNDLE_VERSION,
    sourceSchemaVersion,
    exportedAt,
    documents: snapshot.documents,
    readingProgress: snapshot.readingProgress,
    bookmarks: snapshot.bookmarks,
    annotations: snapshot.annotations,
    quotes: snapshot.quotes,
    libraryEntries: snapshot.libraryEntries ?? [],
    savedLibraryViews: snapshot.savedLibraryViews ?? [],
  });
}
