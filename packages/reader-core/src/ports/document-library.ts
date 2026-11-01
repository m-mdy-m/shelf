import type { DocumentSourceMetadata } from "../domain/document.js";
import type { DocumentLocator } from "../domain/document-locator.js";
import type { SourceHandleId } from "../domain/ids.js";
import type { Result } from "../domain/result.js";
import type { ReaderError } from "../domain/errors.js";
import type { DocumentSourcePort } from "./document-source.js";

/**
 * Stores a Shelf-owned imported copy by streaming from an already opened source.
 * Implementations must use bounded DocumentSourcePort reads (at most 1 MiB),
 * return a reopenable locator, and clean partial output on failure.
 */
export interface DocumentCopyStorePort {
  copyFromSource(
    source: DocumentSourcePort,
    sourceHandleId: SourceHandleId,
    metadata: DocumentSourceMetadata,
  ): Promise<Result<DocumentLocator, ReaderError>>;
  deleteCopy(locator: DocumentLocator): Promise<Result<void, ReaderError>>;
}
