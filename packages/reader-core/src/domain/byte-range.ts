import type { ReaderError } from "./errors.js";
import type { Result } from "./result.js";

/** Maximum size of one document-source read. Larger files are read in chunks. */
export const MAX_DOCUMENT_READ_BYTES = 1_048_576;

export interface ByteRange {
  /** Zero-based byte offset into the source. */
  readonly offset: number;
  readonly length: number;
}

/** Validate ranges before crossing a platform adapter boundary. */
export function parseByteRange(range: ByteRange): Result<ByteRange, ReaderError> {
  const validOffset = Number.isSafeInteger(range.offset) && range.offset >= 0;
  const validLength =
    Number.isSafeInteger(range.length) &&
    range.length > 0 &&
    range.length <= MAX_DOCUMENT_READ_BYTES;
  const validEnd = validOffset && validLength && Number.isSafeInteger(range.offset + range.length);

  if (!validOffset || !validLength || !validEnd) {
    return {
      ok: false,
      error: {
        code: "invalid-range",
        message: `Read range must have a safe non-negative offset and a length from 1 to ${MAX_DOCUMENT_READ_BYTES} bytes.`,
        retryable: false,
      },
    };
  }

  return { ok: true, value: range };
}
