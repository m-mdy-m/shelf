export type ReaderErrorCode =
  | "document-not-found"
  | "document-unavailable"
  | "unsupported-document"
  | "invalid-document"
  | "password-required"
  | "permission-required"
  | "permission-denied"
  | "permission-expired"
  | "read-failed"
  | "write-failed"
  | "invalid-range"
  | "conflict"
  | "cancelled"
  | "not-supported"
  | "invalid-input";

export interface ReaderError {
  readonly code: ReaderErrorCode;
  /** Safe, user-presentable message. Do not place paths, tokens, or document text here. */
  readonly message: string;
  readonly retryable: boolean;
  /** Optional non-sensitive diagnostic values; never put raw provider/OS errors here. */
  readonly context?: Readonly<Record<string, string | number | boolean>>;
}
