import type {
  ByteRange,
  DocumentLocator,
  DocumentSourceMetadata,
  OpenDocumentHandle,
} from "../domain/document.js";
import type { ReaderError } from "../domain/errors.js";
import type { SourceHandleId } from "../domain/ids.js";
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
  read(
    handleId: SourceHandleId,
    range: ByteRange,
  ): Promise<Result<Uint8Array, ReaderError>>;
  close(handleId: SourceHandleId): Promise<Result<void, ReaderError>>;
}

/** File access permissions are separate from document identity and metadata. */
export interface DocumentPermissionPort {
  query(locator: DocumentLocator): Promise<Result<DocumentPermissionState, ReaderError>>;
  request(locator: DocumentLocator): Promise<Result<DocumentPermissionState, ReaderError>>;
  release(locator: DocumentLocator): Promise<Result<void, ReaderError>>;
}
