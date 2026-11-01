import type { BookmarkId, DocumentId } from "./ids.js";
import type { PageIndex } from "./page-index.js";
import type { TextAnchor } from "./annotation.js";

export interface Bookmark {
  readonly id: BookmarkId;
  readonly documentId: DocumentId;
  readonly pageIndex: PageIndex;
  readonly label: string | null;
  readonly anchor: TextAnchor | null;
  readonly createdAt: number;
}
