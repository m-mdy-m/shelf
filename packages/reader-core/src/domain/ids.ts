import type { ReaderError } from "./errors.js";
import type { Result } from "./result.js";

/** A nominal string ID; each entity kind is intentionally non-interchangeable. */
export type OpaqueId<Kind extends string> = string & {
  readonly __opaqueId: Kind;
};

export type DocumentId = OpaqueId<"DocumentId">;
export type BookmarkId = OpaqueId<"BookmarkId">;
export type AnnotationId = OpaqueId<"AnnotationId">;
export type QuoteId = OpaqueId<"QuoteId">;
export type ReaderSessionId = OpaqueId<"ReaderSessionId">;
export type SourceHandleId = OpaqueId<"SourceHandleId">;
export type NotificationId = OpaqueId<"NotificationId">;
export type CredentialKey = OpaqueId<"CredentialKey">;
export type DocumentFingerprint = OpaqueId<"DocumentFingerprint">;

/** Parse IDs received from untrusted platform or persistence boundaries. */
export function parseOpaqueId<Kind extends string>(
  value: string,
): Result<OpaqueId<Kind>, ReaderError> {
  if (value.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "Identifier must not be empty.",
        retryable: false,
      },
    };
  }

  return { ok: true, value: value as OpaqueId<Kind> };
}

/**
 * Trusted-input convenience constructor. Throws TypeError for empty values;
 * use parseOpaqueId when handling untrusted input inside Result-based flows.
 */
export function toOpaqueId<Kind extends string>(value: string): OpaqueId<Kind> {
  const parsed = parseOpaqueId<Kind>(value);
  if (!parsed.ok) throw new TypeError(parsed.error.message);
  return parsed.value;
}
