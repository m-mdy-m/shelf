import type { DocumentPermissionPort, DocumentSourcePort } from "../src/ports/index.js";
import type {
  AnnotationId,
  BookmarkId,
  DocumentId,
  DocumentLocator,
  PageIndex,
  QuoteId,
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

const metadata = {
  mediaType: "application/pdf",
  sizeBytes: 0,
  modifiedAt: null,
  displayName: "fixture.pdf",
};

const fakeDocumentSource: DocumentSourcePort = {
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

// @ts-expect-error A bookmark ID is not a document ID.
const invalidDocument: DocumentId = bookmarkId;
// @ts-expect-error A quote ID is not an annotation ID.
const invalidAnnotation: AnnotationId = quoteId;
// @ts-expect-error A plain number is not a validated PageIndex.
const invalidPage: PageIndex = 1;
// @ts-expect-error A locator is not a stable document identity.
const invalidLocator: DocumentId = locator;

void [
  sameDocument,
  validBookmark,
  validQuote,
  validAnnotation,
  firstPage,
  highlightDraft,
  noteDraft,
  fakeDocumentSource,
  fakePermissions,
  invalidDocument,
  invalidAnnotation,
  invalidPage,
  invalidLocator,
];
