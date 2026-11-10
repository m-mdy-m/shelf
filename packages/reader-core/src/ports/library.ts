import type { DocumentId } from "../domain/ids.js";
import type { LibraryEntry, SavedLibraryView } from "../domain/library.js";
import type { ReaderError } from "../domain/errors.js";
import type { Result } from "../domain/result.js";

export interface LibraryEntryRepositoryPort {
  getByDocumentId(id: DocumentId): Promise<Result<LibraryEntry | null, ReaderError>>;
  list(): Promise<Result<readonly LibraryEntry[], ReaderError>>;
  save(entry: LibraryEntry): Promise<Result<void, ReaderError>>;
  deleteByDocumentId(id: DocumentId): Promise<Result<void, ReaderError>>;
}

export interface SavedLibraryViewRepositoryPort {
  list(): Promise<Result<readonly SavedLibraryView[], ReaderError>>;
  save(view: SavedLibraryView): Promise<Result<void, ReaderError>>;
  delete(id: string): Promise<Result<void, ReaderError>>;
}
