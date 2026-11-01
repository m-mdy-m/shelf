import type {
  AnnotationId,
  DocumentFingerprint,
  DocumentId,
} from "./ids.js";
import type { PageIndex } from "./page-index.js";

export interface TextAnchor {
  /** Exact text selected by the reader at the time the anchor was created. */
  readonly selectedText: string;
  /** Normalized text used only as a fallback when resolving a moved anchor. */
  readonly normalizedText: string;
  /** Offsets are relative to the extracted text representation of this page. */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly documentFingerprint: DocumentFingerprint | null;
  readonly anchorVersion: number;
}

/** Rectangle normalized to page width/height; all four values are in [0, 1]. */
export interface PageRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AnnotationBase {
  readonly id: AnnotationId;
  readonly documentId: DocumentId;
  readonly pageIndex: PageIndex;
  readonly anchor: TextAnchor | null;
  readonly rectangles: readonly PageRect[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface HighlightAnnotation extends AnnotationBase {
  readonly kind: "highlight";
  readonly color: "yellow" | "green" | "blue" | "pink" | "purple";
}

export interface NoteAnnotation extends AnnotationBase {
  readonly kind: "note";
  readonly content: string;
}

export type Annotation = HighlightAnnotation | NoteAnnotation;
