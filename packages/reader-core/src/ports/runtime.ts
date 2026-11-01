import type {
  CredentialKey,
  NotificationId,
  OpaqueId,
} from "../domain/ids.js";
import type { ReaderError } from "../domain/errors.js";
import type { Result } from "../domain/result.js";

declare const secretValueBrand: unique symbol;

/** In-memory only. Concrete secure stores must never serialize or log this value. */
export type SecretValue = string & { readonly [secretValueBrand]: true };

export interface ClockPort {
  now(): number;
}

export interface IdGeneratorPort {
  next<Kind extends string>(kind: Kind): OpaqueId<Kind>;
}

/** Cryptographic hashing supplied by a platform adapter; input is already bounded. */
export interface Sha256DigestPort {
  digest(data: Uint8Array): Promise<Result<Uint8Array, ReaderError>>;
}

export interface SecureCredentialStorePort {
  /** Secret material is transient and must never be logged or included in exports. */
  get(key: CredentialKey): Promise<Result<SecretValue | null, ReaderError>>;
  set(key: CredentialKey, value: SecretValue): Promise<Result<void, ReaderError>>;
  delete(key: CredentialKey): Promise<Result<void, ReaderError>>;
}

export interface LocalNotificationRequest {
  readonly title: string;
  readonly body: string;
  readonly scheduledAt: number;
  readonly deepLink: string | null;
}

export interface LocalNotificationPort {
  schedule(request: LocalNotificationRequest): Promise<Result<NotificationId, ReaderError>>;
  cancel(id: NotificationId): Promise<Result<void, ReaderError>>;
}

export type ApplicationLifecycleState = "active" | "inactive" | "background";

export interface ApplicationLifecyclePort {
  currentState(): ApplicationLifecycleState;
  subscribe(listener: (state: ApplicationLifecycleState) => void): () => void;
}
