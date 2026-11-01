import type { ReaderError, Result, Sha256DigestPort } from "@shelf/reader-core";

export class WebCryptoSha256Digest implements Sha256DigestPort {
  async digest(data: Uint8Array): Promise<Result<Uint8Array, ReaderError>> {
    try {
      if (globalThis.crypto?.subtle === undefined) {
        return {
          ok: false,
          error: {
            code: "not-supported",
            message: "This browser does not provide the required local hashing API.",
            retryable: false,
          },
        };
      }
      const input = new Uint8Array(data.byteLength);
      input.set(data);
      const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
      return { ok: true, value: new Uint8Array(digest) };
    } catch {
      return {
        ok: false,
        error: {
          code: "read-failed",
          message: "Shelf could not calculate a local document fingerprint.",
          retryable: true,
        },
      };
    }
  }
}
