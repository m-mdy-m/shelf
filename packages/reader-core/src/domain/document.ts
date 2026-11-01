import type {
  DocumentFingerprint,
  DocumentId,
} from "./ids.js";

export type DocumentLocatorKind =
  | "filesystem"
  | "content-uri"
  | "security-scoped"
  | "browser-handle"
  | "provider"
  | "opaque";

/**
 * Opaque access information owned by an adapter.
 * `value` may encode a path, URI, or OS handle and must never be treated as
 * document identity, shown to users, logged, or exported by default.
 */
export interface DocumentLocator {
  readonly kind: DocumentLocatorKind;
  readonly providerId: string;
  readonly value: string;
  readonly persistence: "ephemeral" | "reopenable";
}

export interface DocumentSource {
  readonly locator: DocumentLocator;
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

export interface ByteRange {
  /** Zero-based byte offset into the source. */
  readonly offset: number;
  readonly length: number;
}
