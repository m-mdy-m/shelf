import type { DocumentId } from "../domain/ids.js";
import type { LibraryEntry, SavedLibraryView } from "../domain/library.js";
import type { ReaderError } from "../domain/errors.js";
import type { Result } from "../domain/result.js";

export interface LibraryEntryRepositoryPort {
  getLibraryEntry(id: DocumentId): Promise<Result<LibraryEntry | null, ReaderError>>;
  listLibraryEntries(): Promise<Result<readonly LibraryEntry[], ReaderError>>;
  saveLibraryEntry(entry: LibraryEntry): Promise<Result<void, ReaderError>>;
  deleteLibraryEntry(id: DocumentId): Promise<Result<void, ReaderError>>;
}

export interface SavedLibraryViewRepositoryPort {
  listSavedLibraryViews(): Promise<Result<readonly SavedLibraryView[], ReaderError>>;
  saveSavedLibraryView(view: SavedLibraryView): Promise<Result<void, ReaderError>>;
  deleteSavedLibraryView(id: string): Promise<Result<void, ReaderError>>;
}
