import type { DocumentLocator } from "@shelf/reader-core";

export interface BrowserStoredCopy {
  readonly blob: Blob;
  readonly displayName: string;
  readonly mediaType: string;
  readonly modifiedAt: number | null;
}

export type BrowserPermissionState = "granted" | "prompt" | "denied";

export interface BrowserFileHandleLike {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  queryPermission(options: { readonly mode: "read" }): Promise<BrowserPermissionState>;
  requestPermission(options: { readonly mode: "read" }): Promise<BrowserPermissionState>;
}

/** IndexedDB-backed source records; file handles stay separate from exportable documents. */
export interface BrowserDocumentStoragePort {
  saveCopy(key: string, copy: BrowserStoredCopy): Promise<void>;
  getCopy(key: string): Promise<BrowserStoredCopy | null>;
  deleteCopy(key: string): Promise<void>;

  saveReference(key: string, handle: BrowserFileHandleLike): Promise<void>;
  getReference(key: string): Promise<BrowserFileHandleLike | null>;
  deleteReference(key: string): Promise<void>;
}
