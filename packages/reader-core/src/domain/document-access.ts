export type DocumentImportMode = "imported-copy" | "external-reference";

export type DocumentAccessState =
  | "available"
  | "missing"
  | "permission-required"
  | "permission-denied"
  | "permission-expired"
  | "changed";

/** Explicit duplicate policy; the default reuses the existing stable document. */
export type DuplicateDocumentPolicy = "reuse-existing" | "keep-both";
