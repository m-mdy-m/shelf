import type {
  DocumentPermissionPort,
  DocumentLocatorStorePort,
  DocumentSourcePort,
} from "../src/ports/index.js";
import type {
  AnnotationId,
  BookmarkId,
  DocumentId,
  DocumentLocator,
  DocumentSource,
  PageIndex,
  QuoteId,
  ExtractedPageText,
  TextSelection,
} from "../src/index.js";
import type { NewAnnotation } from "../src/application/reader-use-cases.js";
import { toOpaqueId, toPageIndex } from "../src/index.js";

declare const documentId: DocumentId;
declare const bookmarkId: BookmarkId;
declare const quoteId: QuoteId;
declare const annotationId: AnnotationId;

const sameDocument: DocumentId = documentId;
const validBookmark: BookmarkId = bookmarkId;
const validQuote: QuoteId = quoteId;
const validAnnotation: AnnotationId = annotationId;
const firstPage: PageIndex = toPageIndex(0);
const extractedPage: ExtractedPageText = {
  pageIndex: firstPage,
  text: "page text",
  runs: [],
  hasSelectableText: true,
  truncated: false,
};
const selection: TextSelection = {
  documentId,
  pageIndex: firstPage,
  selectedText: "selected text",
  normalizedText: "selected text",
  startOffset: 0,
  endOffset: 13,
  documentFingerprint: null,
  anchorVersion: 1,
  rectangles: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
  offsetConfidence: "exact",
};

const highlightDraft: NewAnnotation = {
  kind: "highlight",
  documentId,
  pageIndex: firstPage,
  anchor: null,
  rectangles: [],
  color: "yellow",
};

const noteDraft: NewAnnotation = {
  kind: "note",
  documentId,
  pageIndex: firstPage,
  anchor: null,
  rectangles: [],
  content: "Reader-authored note",
};

const locator: DocumentLocator = {
  kind: "opaque",
  providerId: "test-fake",
  value: "fake-source-handle",
  persistence: "ephemeral",
};

const safeDocumentSource: DocumentSource = {
  kind: "local-file",
  displayName: "fixture.pdf",
  mediaType: "application/pdf",
  sizeBytes: 0,
  modifiedAt: null,
};

const metadata = {
  mediaType: "application/pdf",
  sizeBytes: 0,
  modifiedAt: null,
  displayName: "fixture.pdf",
};

const fakeDocumentSourcePort: DocumentSourcePort = {
  inspect: async () => ({ ok: true, value: metadata }),
  open: async () => ({
    ok: true,
    value: {
      id: toOpaqueId<"SourceHandleId">("fake-handle"),
      metadata,
    },
  }),
  read: async (_handleId, range) => ({
    ok: true,
    value: new Uint8Array(range.length),
  }),
  close: async () => ({ ok: true, value: undefined }),
};

const fakePermissions: DocumentPermissionPort = {
  query: async () => ({ ok: true, value: "granted" }),
  request: async () => ({ ok: true, value: "granted" }),
  release: async () => ({ ok: true, value: undefined }),
};

const fakeLocatorStore: DocumentLocatorStorePort = {
  getLocator: async () => ({ ok: true, value: locator }),
  saveLocator: async () => ({ ok: true, value: undefined }),
  deleteLocator: async () => ({ ok: true, value: undefined }),
};

// @ts-expect-error A bookmark ID is not a document ID.
const invalidDocument: DocumentId = bookmarkId;
// @ts-expect-error A quote ID is not an annotation ID.
const invalidAnnotation: AnnotationId = quoteId;
// @ts-expect-error A plain number is not a validated PageIndex.
const invalidPage: PageIndex = 1;
// @ts-expect-error A locator is not a stable document identity.
const invalidLocator: DocumentId = locator;
// @ts-expect-error Access locators are not part of exportable source metadata.
const invalidSource: DocumentSource = locator;

void [
  sameDocument,
  validBookmark,
  validQuote,
  validAnnotation,
  firstPage,
  extractedPage,
  selection,
  highlightDraft,
  noteDraft,
  safeDocumentSource,
  fakeDocumentSourcePort,
  fakePermissions,
  fakeLocatorStore,
  invalidDocument,
  invalidAnnotation,
  invalidPage,
  invalidLocator,
  invalidSource,
];
