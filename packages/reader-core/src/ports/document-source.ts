import type {
  DocumentLocator,
  DocumentSourceMetadata,
  OpenDocumentHandle,
} from "../domain/document.js";
import type { ByteRange } from "../domain/byte-range.js";
import type { ReaderError } from "../domain/errors.js";
import type { DocumentId, SourceHandleId } from "../domain/ids.js";
import type { Result } from "../domain/result.js";

export type DocumentPermissionState =
  | "granted"
  | "prompt"
  | "denied"
  | "expired"
  | "unavailable";

/** Owns opening, bounded reads, and release of platform document handles. */
export interface DocumentSourcePort {
  inspect(locator: DocumentLocator): Promise<Result<DocumentSourceMetadata, ReaderError>>;
  open(locator: DocumentLocator): Promise<Result<OpenDocumentHandle, ReaderError>>;
  /**
   * Read at most MAX_DOCUMENT_READ_BYTES per call (1 MiB).
   * Implementations must validate ranges and return invalid-range for violations.
   * Use successive reads for larger documents.
   */
  read(
    handleId: SourceHandleId,
    range: ByteRange,
  ): Promise<Result<Uint8Array, ReaderError>>;
  close(handleId: SourceHandleId): Promise<Result<void, ReaderError>>;
}

/**
 * Adapter-owned access references are persisted separately from exportable
 * Document records. Implementations must protect locator values and never log
 * or export them as user document metadata.
 */
export interface DocumentLocatorStorePort {
  getLocator(documentId: DocumentId): Promise<Result<DocumentLocator | null, ReaderError>>;
  saveLocator(documentId: DocumentId, locator: DocumentLocator): Promise<Result<void, ReaderError>>;
  deleteLocator(documentId: DocumentId): Promise<Result<void, ReaderError>>;
}

/** File access permissions are separate from document identity and metadata. */
export interface DocumentPermissionPort {
  query(locator: DocumentLocator): Promise<Result<DocumentPermissionState, ReaderError>>;
  request(locator: DocumentLocator): Promise<Result<DocumentPermissionState, ReaderError>>;
  release(locator: DocumentLocator): Promise<Result<void, ReaderError>>;
}
