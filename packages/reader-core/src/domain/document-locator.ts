export type DocumentLocatorKind =
  | "filesystem"
  | "content-uri"
  | "security-scoped"
  | "browser-handle"
  | "provider"
  | "opaque";

/**
 * Opaque access information owned by an adapter.
 * `value` may encode a path, URI, or OS handle and must never be treated as
 * document identity, shown to users, logged, or exported by default.
 */
export interface DocumentLocator {
  readonly kind: DocumentLocatorKind;
  readonly providerId: string;
  readonly value: string;
  readonly persistence: "ephemeral" | "reopenable";
}
