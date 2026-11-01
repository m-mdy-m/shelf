import {
  MAX_DOCUMENT_READ_BYTES,
  parseByteRange,
} from "@shelf/reader-core";
import type {
  DocumentFingerprint,
  DocumentSourcePort,
  OpenDocumentHandle,
  ReaderError,
  Result,
  Sha256DigestPort,
} from "@shelf/reader-core";

function failure(
  code: ReaderError["code"],
  message: string,
  retryable = false,
): Result<never, ReaderError> {
  return { ok: false, error: { code, message, retryable } };
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((size, part) => size + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function encodeOffset(offset: number): Uint8Array {
  const encoded = new Uint8Array(8);
  const view = new DataView(encoded.buffer);
  view.setBigUint64(0, BigInt(offset), false);
  return encoded;
}

function isPdfHeader(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 1024)));
  return prefix.includes("%PDF-");
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Computes a deterministic, streaming SHA-256 chain over the complete file.
 * Each source read remains bounded to MAX_DOCUMENT_READ_BYTES; the full PDF is
 * never materialized in memory. The version prefix makes this format explicit.
 */
export async function fingerprintPdf(
  source: DocumentSourcePort,
  handle: OpenDocumentHandle,
  digest: Sha256DigestPort,
): Promise<Result<DocumentFingerprint, ReaderError>> {
  const size = handle.metadata.sizeBytes;
  if (size === null || !Number.isSafeInteger(size) || size < 5) {
    return failure("invalid-document", "The PDF source does not report a valid file size.");
  }

  const seed = new TextEncoder().encode("shelf-document-fingerprint-v1:" + String(size));
  const initial = await digest.digest(seed);
  if (!initial.ok) return initial;
  if (initial.value.byteLength !== 32) {
    return failure("read-failed", "Shelf could not initialize the document fingerprint.", true);
  }

  let state = initial.value;
  let offset = 0;

  while (offset < size) {
    const length = Math.min(MAX_DOCUMENT_READ_BYTES, size - offset);
    const parsedRange = parseByteRange({ offset, length });
    if (!parsedRange.ok) return parsedRange;

    const read = await source.read(handle.id, parsedRange.value);
    if (!read.ok) return read;
    if (read.value.byteLength !== length) {
      return failure("read-failed", "The PDF source returned an incomplete byte range.", true);
    }
    if (offset === 0 && !isPdfHeader(read.value)) {
      return failure("unsupported-document", "The selected file does not contain a PDF header.");
    }

    const nextState = await digest.digest(concatenate([
      state,
      encodeOffset(offset),
      read.value,
    ]));
    if (!nextState.ok) return nextState;
    if (nextState.value.byteLength !== 32) {
      return failure("read-failed", "Shelf could not calculate the document fingerprint.", true);
    }

    state = nextState.value;
    offset += length;
  }

  return {
    ok: true,
    value: ("sha256-chain-v1:" + toHex(state)) as DocumentFingerprint,
  };
}
