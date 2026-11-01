import {
  MAX_DOCUMENT_READ_BYTES,
  parseByteRange,
} from "@shelf/reader-core";
import type {
  DocumentId,
  DocumentLocator,
  DocumentLocatorStorePort,
  DocumentSourcePort,
  OpenDocumentHandle,
  PageIndex,
  ReaderError,
  Result,
} from "@shelf/reader-core";
import type {
  PdfJsDocumentProxy,
  PdfJsLoadingTask,
  PdfJsPageProxy,
  PdfJsRangeTransport,
  PdfJsRuntime,
  PdfJsWorker,
} from "./pdfjs-runtime.js";
import type { PageVirtualizerOptions } from "../virtualization/page-virtualizer.js";
import { PageVirtualizer } from "../virtualization/page-virtualizer.js";

let nextPdfWorkerInstanceId = 0;

export type PdfPasswordReason = "needed" | "incorrect";

export interface PdfPasswordRequest {
  readonly documentId: DocumentId;
  readonly reason: PdfPasswordReason;
  readonly attempt: number;
}

export type PdfPasswordPrompt = (
  request: PdfPasswordRequest,
) => Promise<string | null>;

export interface PdfDocumentAdapterOptions {
  readonly rangeChunkSize?: number;
  readonly passwordPrompt?: PdfPasswordPrompt;
  readonly maxPasswordAttempts?: number;
  readonly cMapUrl?: string;
  readonly iccUrl?: string;
  readonly standardFontDataUrl?: string;
  readonly wasmUrl?: string;
}

export interface PdfDocumentInfo {
  readonly documentId: DocumentId;
  readonly title: string | null;
  readonly author: string | null;
  readonly subject: string | null;
  readonly pageCount: number;
  readonly fingerprint: string | null;
  readonly displayName: string | null;
  readonly sizeBytes: number;
}

export interface PdfPageGeometry {
  readonly index: PageIndex;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

/** A Shelf-owned handle; no PDF.js object crosses this public boundary. */
export interface PdfPageHandle {
  readonly geometry: PdfPageGeometry;
}

export interface PdfDocumentSession {
  readonly info: PdfDocumentInfo;
  getPage(index: PageIndex): Promise<Result<PdfPageHandle, ReaderError>>;
  createVirtualizer(options?: PageVirtualizerOptions): PageVirtualizer;
  close(): Promise<Result<void, ReaderError>>;
}

const pageProxyByHandle = new WeakMap<PdfPageHandle, PdfJsPageProxy>();

/** Internal bridge used by the renderer; deliberately not re-exported from the package root. */
export function getPdfJsPageProxy(handle: PdfPageHandle): PdfJsPageProxy | null {
  return pageProxyByHandle.get(handle) ?? null;
}

function errorResult(code: ReaderError["code"], message: string, retryable = false): ReaderError {
  return { code, message, retryable };
}

function isReaderError(value: unknown): value is ReaderError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate["code"] === "string" &&
    typeof candidate["message"] === "string" &&
    typeof candidate["retryable"] === "boolean";
}

function safeMetadataString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return normalized.length > 0 ? normalized.slice(0, 512) : null;
}

function mapPdfJsFailure(
  error: unknown,
  rangeFailure: ReaderError | null,
  passwordFailure: "password-required" | "cancelled" | null,
): ReaderError {
  if (rangeFailure !== null) return rangeFailure;
  if (passwordFailure !== null) {
    return errorResult(
      passwordFailure,
      passwordFailure === "cancelled" ? "Password entry was cancelled." : "This PDF requires a password.",
    );
  }
  if (isReaderError(error)) return error;

  const name = typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
  if (name === "PasswordException") {
    return errorResult("password-required", "This PDF requires a password.");
  }
  if (name === "InvalidPDFException" || name === "FormatError") {
    return errorResult("invalid-document", "The selected file is not a valid or supported PDF.");
  }
  if (name === "MissingPDFException" || name === "ResponseException") {
    return errorResult("document-unavailable", "The PDF data is unavailable.");
  }
  if (name === "AbortException") {
    return errorResult("cancelled", "The PDF operation was cancelled.");
  }
  return errorResult("read-failed", "Shelf could not read the PDF document.", true);
}

function asPageGeometry(index: PageIndex, page: PdfJsPageProxy): PdfPageGeometry {
  const viewport = page.getViewport({ scale: 1 });
  return {
    index,
    width: viewport.width,
    height: viewport.height,
    rotation: page.rotate,
  };
}

class PdfDocumentSessionImpl implements PdfDocumentSession {
  readonly #document: PdfJsDocumentProxy;
  readonly #destroyLoadingTask: () => Promise<void>;
  readonly #worker: PdfJsWorker;
  readonly #range: PdfJsRangeTransport;
  readonly #source: DocumentSourcePort;
  readonly #sourceHandle: OpenDocumentHandle;
  readonly #rangePending: Set<Promise<void>>;
  readonly #rangeFailureRef: { current: ReaderError | null };
  readonly #closedRef: { current: boolean };
  readonly #info: PdfDocumentInfo;

  constructor(args: {
    document: PdfJsDocumentProxy;
    destroyLoadingTask: () => Promise<void>;
    worker: PdfJsWorker;
    range: PdfJsRangeTransport;
    source: DocumentSourcePort;
    sourceHandle: OpenDocumentHandle;
    info: PdfDocumentInfo;
    rangePending: Set<Promise<void>>;
    rangeFailureRef: { current: ReaderError | null };
    closedRef: { current: boolean };
  }) {
    this.#document = args.document;
    this.#destroyLoadingTask = args.destroyLoadingTask;
    this.#worker = args.worker;
    this.#range = args.range;
    this.#source = args.source;
    this.#sourceHandle = args.sourceHandle;
    this.#info = args.info;
    this.#rangePending = args.rangePending;
    this.#rangeFailureRef = args.rangeFailureRef;
    this.#closedRef = args.closedRef;
  }

  get info(): PdfDocumentInfo {
    return this.#info;
  }

  async getPage(index: PageIndex): Promise<Result<PdfPageHandle, ReaderError>> {
    const numericIndex = index as number;
    if (this.#closedRef.current) {
      return { ok: false, error: errorResult("cancelled", "The PDF document is closed.") };
    }
    if (this.#rangeFailureRef.current !== null) {
      return { ok: false, error: this.#rangeFailureRef.current };
    }
    if (!Number.isSafeInteger(numericIndex) || numericIndex < 0 || numericIndex >= this.#info.pageCount) {
      return { ok: false, error: errorResult("invalid-input", "Page index is outside this PDF document.") };
    }

    try {
      const pageProxy = await this.#document.getPage(numericIndex + 1);
      const handle: PdfPageHandle = { geometry: asPageGeometry(index, pageProxy) };
      pageProxyByHandle.set(handle, pageProxy);
      return { ok: true, value: handle };
    } catch (error) {
      return {
        ok: false,
        error: mapPdfJsFailure(error, this.#rangeFailureRef.current, null),
      };
    }
  }

  createVirtualizer(options?: PageVirtualizerOptions): PageVirtualizer {
    return new PageVirtualizer(this.#info.pageCount, options);
  }

  async close(): Promise<Result<void, ReaderError>> {
    if (this.#closedRef.current) return { ok: true, value: undefined };
    this.#closedRef.current = true;
    this.#range.abort();
    let closeFailure: ReaderError | null = null;

    try {
      await this.#destroyLoadingTask();
    } catch {
      closeFailure = errorResult("read-failed", "The PDF worker could not be released cleanly.", true);
      this.#worker.destroy();
    }

    await Promise.allSettled([...this.#rangePending]);
    const sourceResult = await this.#source.close(this.#sourceHandle.id);
    if (!sourceResult.ok) return sourceResult;
    if (closeFailure !== null) return { ok: false, error: closeFailure };
    return { ok: true, value: undefined };
  }
}

export class PdfDocumentAdapter {
  readonly #runtime: PdfJsRuntime;
  readonly #source: DocumentSourcePort;
  readonly #locators: DocumentLocatorStorePort;
  readonly #options: PdfDocumentAdapterOptions;

  constructor(
    runtime: PdfJsRuntime,
    source: DocumentSourcePort,
    locators: DocumentLocatorStorePort,
    options: PdfDocumentAdapterOptions = {},
  ) {
    this.#runtime = runtime;
    this.#source = source;
    this.#locators = locators;
    this.#options = options;
  }

  async open(documentId: DocumentId): Promise<Result<PdfDocumentSession, ReaderError>> {
    const locatorResult = await this.#locators.getLocator(documentId);
    if (!locatorResult.ok) return locatorResult;
    const locator: DocumentLocator | null = locatorResult.value;
    if (locator === null) {
      return { ok: false, error: errorResult("document-not-found", "The source for this PDF could not be found.") };
    }

    const sourceResult = await this.#source.open(locator);
    if (!sourceResult.ok) return sourceResult;
    const sourceHandle = sourceResult.value;
    const fileSize = sourceHandle.metadata.sizeBytes;
    if (fileSize === null || !Number.isSafeInteger(fileSize) || fileSize <= 0) {
      await this.#source.close(sourceHandle.id);
      return {
        ok: false,
        error: errorResult("invalid-document", "The PDF source does not report a valid file size."),
      };
    }

    const rangeChunkSize = this.#options.rangeChunkSize ?? 65_536;
    if (!Number.isSafeInteger(rangeChunkSize) || rangeChunkSize < 1) {
      await this.#source.close(sourceHandle.id);
      return {
        ok: false,
        error: errorResult("invalid-input", "PDF range chunk size must be a positive safe integer."),
      };
    }
    const maxPasswordAttempts = this.#options.maxPasswordAttempts ?? 3;
    if (!Number.isSafeInteger(maxPasswordAttempts) || maxPasswordAttempts < 1 || maxPasswordAttempts > 10) {
      await this.#source.close(sourceHandle.id);
      return {
        ok: false,
        error: errorResult("invalid-input", "PDF password attempt limit must be between 1 and 10."),
      };
    }

    const boundedRangeChunkSize = Math.min(rangeChunkSize, MAX_DOCUMENT_READ_BYTES);
    const rangeFailureRef: { current: ReaderError | null } = { current: null };
    const closedRef: { current: boolean } = { current: false };
    const pending = new Set<Promise<void>>();
    let range: PdfJsRangeTransport | null = null;
    let worker: PdfJsWorker | null = null;
    let loadingTask: PdfJsLoadingTask | null = null;
    let loadingTaskDestroyPromise: Promise<void> | null = null;
    const destroyLoadingTask = (): Promise<void> => {
      if (loadingTask === null) return Promise.resolve();
      loadingTaskDestroyPromise ??= loadingTask.destroy();
      return loadingTaskDestroyPromise;
    };
    let passwordFailure: "password-required" | "cancelled" | null = null;
    let passwordAttempt = 0;
    let rangeAborted = false;

    const failRange = (failure: ReaderError): void => {
      // A failed range terminates this session; callers must reopen the document to retry.
      rangeFailureRef.current ??= { ...failure, retryable: false };
      // A failed source read must reject the active PDF.js operation, not send
      // an empty range which could leave its range reader waiting forever.
      void destroyLoadingTask().catch(() => {});
    };

    const requestRange = async (begin: number, end: number): Promise<void> => {
      if (rangeAborted || closedRef.current || rangeFailureRef.current !== null) return;
      if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) ||
          begin < 0 || end <= begin || end > fileSize ||
          end - begin > MAX_DOCUMENT_READ_BYTES) {
        failRange(errorResult("invalid-range", "PDF.js requested an invalid or oversized byte range."));
        return;
      }

      const parsedRange = parseByteRange({ offset: begin, length: end - begin });
      if (!parsedRange.ok) {
        failRange(parsedRange.error);
        return;
      }
      const readResult = await this.#source.read(sourceHandle.id, parsedRange.value);
      if (!readResult.ok) {
        failRange(readResult.error);
        return;
      }
      if (readResult.value.byteLength !== parsedRange.value.length) {
        failRange(errorResult("read-failed", "The PDF source returned an incomplete byte range.", true));
        return;
      }
      if (!rangeAborted && !closedRef.current) {
        range?.deliverRange(begin, readResult.value);
      }
    };

    const trackRangeRequest = (begin: number, end: number): void => {
      const request = requestRange(begin, end).catch(() => {
        failRange(errorResult("read-failed", "Shelf could not read a PDF byte range.", true));
      });
      pending.add(request);
      void request.finally(() => pending.delete(request));
    };

    try {
      range = this.#runtime.createRangeTransport(
        fileSize,
        sourceHandle.metadata.displayName,
        trackRangeRequest,
        () => {
          rangeAborted = true;
        },
      );
      nextPdfWorkerInstanceId += 1;
      if (!Number.isSafeInteger(nextPdfWorkerInstanceId)) {
        throw new Error("PDF worker instance identifier space is exhausted.");
      }
      worker = this.#runtime.createWorker(
        "shelf-" + String(documentId) + "-" + String(nextPdfWorkerInstanceId),
      );
      await worker.promise;
      loadingTask = this.#runtime.getDocument({
        range,
        worker,
        rangeChunkSize: boundedRangeChunkSize,
        ...(this.#options.cMapUrl === undefined ? {} : { cMapUrl: this.#options.cMapUrl }),
        ...(this.#options.iccUrl === undefined ? {} : { iccUrl: this.#options.iccUrl }),
        ...(this.#options.standardFontDataUrl === undefined
          ? {}
          : { standardFontDataUrl: this.#options.standardFontDataUrl }),
        ...(this.#options.wasmUrl === undefined ? {} : { wasmUrl: this.#options.wasmUrl }),
      });

      loadingTask.onPassword = (updatePassword, reason) => {
        passwordAttempt += 1;
        const isRequestCurrent = (): boolean =>
          !closedRef.current && !rangeAborted && loadingTaskDestroyPromise === null;
        const respond = (value: string | Error): void => {
          if (!isRequestCurrent()) return;
          try {
            updatePassword(value);
          } catch {
            passwordFailure = "cancelled";
          }
        };

        const prompt = this.#options.passwordPrompt;
        if (prompt === undefined || passwordAttempt > maxPasswordAttempts) {
          passwordFailure = "password-required";
          respond(new Error("Shelf requires a PDF password."));
          return;
        }

        const passwordReason: PdfPasswordReason =
          reason === this.#runtime.passwordResponses.INCORRECT_PASSWORD ? "incorrect" : "needed";
        let passwordRequest: Promise<string | null>;
        try {
          passwordRequest = Promise.resolve(
            prompt({ documentId, reason: passwordReason, attempt: passwordAttempt }),
          );
        } catch {
          passwordFailure = "cancelled";
          respond(new Error("Password prompt failed."));
          return;
        }

        void passwordRequest
          .then((password) => {
            if (!isRequestCurrent()) return;
            if (password === null) {
              passwordFailure = "cancelled";
              respond(new Error("Password prompt cancelled."));
            } else {
              respond(password);
            }
          })
          .catch(() => {
            if (!isRequestCurrent()) return;
            passwordFailure = "cancelled";
            respond(new Error("Password prompt failed."));
          });
      };

      const document = await loadingTask.promise;
      if (!Number.isSafeInteger(document.numPages) || document.numPages < 1) {
        throw new Error("PDF.js returned an invalid page count.");
      }

      let metadata: Readonly<Record<string, unknown>> = {};
      try {
        const metadataResult = await document.getMetadata();
        metadata = metadataResult.info ?? {};
      } catch {
        metadata = {};
      }

      const info: PdfDocumentInfo = {
        documentId,
        title: safeMetadataString(metadata["Title"]),
        author: safeMetadataString(metadata["Author"]),
        subject: safeMetadataString(metadata["Subject"]),
        pageCount: document.numPages,
        fingerprint: document.fingerprints[0] ?? null,
        displayName: sourceHandle.metadata.displayName,
        sizeBytes: fileSize,
      };

      return {
        ok: true,
        value: new PdfDocumentSessionImpl({
          document,
          destroyLoadingTask,
          worker,
          range,
          source: this.#source,
          sourceHandle,
          info,
          rangePending: pending,
          rangeFailureRef,
          closedRef,
        }),
      };
    } catch (error) {
      rangeAborted = true;
      range?.abort();
      if (loadingTask !== null) {
        try {
          await destroyLoadingTask();
        } catch {
          worker?.destroy();
        }
      } else {
        worker?.destroy();
      }
      await Promise.allSettled([...pending]);
      await this.#source.close(sourceHandle.id);
      return {
        ok: false,
        error: mapPdfJsFailure(error, rangeFailureRef.current, passwordFailure),
      };
    }
  }
}
