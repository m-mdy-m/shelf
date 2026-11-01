import type {
  AnnotationId,
  DocumentId,
  QuoteId,
} from "./ids.js";
import type { PageIndex } from "./page-index.js";
import type { TextAnchor } from "./annotation.js";

export interface Quote {
  readonly id: QuoteId;
  readonly documentId: DocumentId;
  readonly pageIndex: PageIndex;
  readonly text: string;
  readonly attribution: string | null;
  readonly annotationId: AnnotationId | null;
  readonly anchor: TextAnchor | null;
  readonly tags: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}
