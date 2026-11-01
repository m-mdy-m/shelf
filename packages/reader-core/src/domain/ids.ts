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

/**
 * Branded constructors reject empty values at trust boundaries. ID generation
 * remains the responsibility of an IdGeneratorPort implementation.
 */
export function toOpaqueId<Kind extends string>(value: string): OpaqueId<Kind> {
  if (value.trim().length === 0) {
    throw new TypeError("An opaque identifier must not be empty.");
  }

  return value as OpaqueId<Kind>;
}
