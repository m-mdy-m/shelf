import type { DocumentId, ReaderSessionId } from "./ids.js";
import type { PageIndex } from "./page-index.js";

export type ReadingMode = "continuous" | "single-page";

export interface ReadingProgress {
  readonly documentId: DocumentId;
  readonly pageIndex: PageIndex;
  /** Fractional scroll position within the current page, constrained to [0, 1]. */
  readonly scrollOffset: number;
  /** User zoom multiplier; 1 represents the renderer's default scale. */
  readonly zoom: number;
  readonly readingMode: ReadingMode;
  readonly updatedAt: number;
}

export interface ReaderSession {
  readonly id: ReaderSessionId;
  readonly documentId: DocumentId;
  readonly openedAt: number;
}
