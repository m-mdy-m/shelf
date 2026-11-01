import type {
  DocumentFingerprint,
  DocumentId,
} from "./ids.js";

export type DocumentSourceKind =
  | "local-file"
  | "imported-copy"
  | "external-reference"
  | "provider";

export interface DocumentSource {
  /** Source category only; access locators are stored separately by adapters. */
  readonly kind: DocumentSourceKind;
  readonly displayName: string | null;
  readonly mediaType: string;
  readonly sizeBytes: number | null;
  readonly modifiedAt: number | null;
}

export interface DocumentMetadata {
  readonly title: string;
  readonly authors: readonly string[];
  readonly language: string | null;
  readonly pageCount: number | null;
  readonly pdfTitle: string | null;
  readonly pdfSubject: string | null;
}

export interface Document {
  /** Stable Shelf-owned identity. Never derive this from a path or URI. */
  readonly id: DocumentId;
  readonly metadata: DocumentMetadata;
  /** Export-safe source metadata. The opaque access locator is not part of this record. */
  readonly source: DocumentSource;
  /** Optional content fingerprint for matching/relinking, not a primary ID. */
  readonly fingerprint: DocumentFingerprint | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface DocumentSourceMetadata {
  readonly mediaType: string;
  readonly sizeBytes: number | null;
  readonly modifiedAt: number | null;
  readonly displayName: string | null;
}

export interface OpenDocumentHandle {
  readonly id: import("./ids.js").SourceHandleId;
  readonly metadata: DocumentSourceMetadata;
}
