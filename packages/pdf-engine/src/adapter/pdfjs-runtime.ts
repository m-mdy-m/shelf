import {
  AnnotationMode,
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  PDFWorker,
  PasswordResponses,
  TextLayer,
  getDocument,
} from "pdfjs-dist";

export interface PdfJsViewport {
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly scale: number;
}

export interface PdfJsRenderTask {
  readonly promise: Promise<void>;
  cancel(): void;
}

export interface PdfJsTextLayer {
  render(): Promise<void>;
  cancel(): void;
}

export interface PdfJsPageProxy {
  readonly rotate: number;
  getViewport(options: { readonly scale: number }): PdfJsViewport;
  render(options: {
    readonly canvasContext: CanvasRenderingContext2D;
    readonly viewport: PdfJsViewport;
    readonly annotationMode: number;
    readonly transform?: readonly number[] | null;
  }): PdfJsRenderTask;
  streamTextContent(): ReadableStream<unknown>;
}

export interface PdfJsOutlineItem {
  readonly title: string;
  readonly dest: string | readonly unknown[] | null;
  readonly items: readonly PdfJsOutlineItem[];
}

export interface PdfJsDocumentProxy {
  readonly numPages: number;
  readonly fingerprints: readonly string[];
  getPage(pageNumber: number): Promise<PdfJsPageProxy>;
  getMetadata(): Promise<{ readonly info?: Readonly<Record<string, unknown>> }>;
  getOutline(): Promise<readonly PdfJsOutlineItem[] | null>;
  getDestination(name: string): Promise<readonly unknown[] | null>;
  getPageIndex(reference: unknown): Promise<number>;
}

export interface PdfJsWorker {
  readonly promise: Promise<void>;
  destroy(): void;
}

export interface PdfJsLoadingTask {
  readonly promise: Promise<PdfJsDocumentProxy>;
  onPassword: (
    updatePassword: (password: string | Error) => void,
    reason: number,
  ) => void;
  destroy(): Promise<void>;
}

export interface PdfJsRangeTransport {
  requestDataRange(begin: number, end: number): void;
  deliverRange(begin: number, chunk: Uint8Array): void;
  abort(): void;
}

export interface PdfJsDocumentInit {
  readonly range: PdfJsRangeTransport;
  readonly worker: PdfJsWorker;
  readonly rangeChunkSize: number;
  readonly cMapUrl?: string;
  readonly iccUrl?: string;
  readonly standardFontDataUrl?: string;
  readonly wasmUrl?: string;
}

export interface PdfJsTextLayerOptions {
  readonly textContentSource: ReadableStream<unknown>;
  readonly container: HTMLElement;
  readonly viewport: PdfJsViewport;
}

export interface PdfJsRuntime {
  readonly annotationModeDisable: number;
  readonly passwordResponses: {
    readonly NEED_PASSWORD: number;
    readonly INCORRECT_PASSWORD: number;
  };
  createWorker(name: string): PdfJsWorker;
  createRangeTransport(
    length: number,
    filename: string | null,
    requestRange: (begin: number, end: number) => void,
    onAbort: () => void,
  ): PdfJsRangeTransport;
  getDocument(options: PdfJsDocumentInit): PdfJsLoadingTask;
  createTextLayer(options: PdfJsTextLayerOptions): PdfJsTextLayer;
}

export interface PdfJsAssetUrls {
  readonly workerSrc: string;
  readonly cMapUrl: string;
  readonly iccUrl: string;
  readonly standardFontDataUrl: string;
  readonly wasmUrl: string;
}

/** Resolve same-origin assets copied by scripts/build-web.mjs. */
export function resolvePdfJsAssetUrls(baseUrl: string): PdfJsAssetUrls {
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  return {
    workerSrc: new URL("assets/pdfjs/build/pdf.worker.min.mjs", base).href,
    cMapUrl: new URL("assets/pdfjs/cmaps/", base).href,
    iccUrl: new URL("assets/pdfjs/iccs/", base).href,
    standardFontDataUrl: new URL("assets/pdfjs/standard_fonts/", base).href,
    wasmUrl: new URL("assets/pdfjs/wasm/", base).href,
  };
}

/** Construct the production runtime; PDF.js remains inside this adapter package. */
export function createPdfJsRuntime(assets: PdfJsAssetUrls): PdfJsRuntime {
  return {
    annotationModeDisable: AnnotationMode.DISABLE,
    passwordResponses: {
      NEED_PASSWORD: PasswordResponses.NEED_PASSWORD,
      INCORRECT_PASSWORD: PasswordResponses.INCORRECT_PASSWORD,
    },
    createWorker(name) {
      // PDF.js keeps workerSrc globally, so set it immediately before each
      // worker creation. Already-created workers retain their own Worker.
      GlobalWorkerOptions.workerSrc = assets.workerSrc;
      return PDFWorker.create({ name }) as unknown as PdfJsWorker;
    },
    createRangeTransport(length, filename, requestRange, onAbort) {
      class ShelfRangeTransport extends PDFDataRangeTransport {
        constructor() {
          super(length, null, false, filename ?? undefined);
        }

        override requestDataRange(begin: number, end: number): void {
          requestRange(begin, end);
        }

        override abort(): void {
          onAbort();
        }

        deliverRange(begin: number, chunk: Uint8Array): void {
          this.onDataRange(begin, chunk);
        }
      }

      return new ShelfRangeTransport();
    },
    getDocument(options) {
      return getDocument({
        range: options.range as unknown as PDFDataRangeTransport,
        worker: options.worker as PDFWorker,
        rangeChunkSize: options.rangeChunkSize,
        disableRange: false,
        disableStream: true,
        disableAutoFetch: true,
        ...(options.cMapUrl === undefined ? {} : { cMapUrl: options.cMapUrl }),
        cMapPacked: true,
        ...(options.iccUrl === undefined ? {} : { iccUrl: options.iccUrl }),
        ...(options.standardFontDataUrl === undefined
          ? {}
          : { standardFontDataUrl: options.standardFontDataUrl }),
        ...(options.wasmUrl === undefined ? {} : { wasmUrl: options.wasmUrl }),
      }) as unknown as PdfJsLoadingTask;
    },
    createTextLayer(options) {
      return new TextLayer(
        options as unknown as ConstructorParameters<typeof TextLayer>[0],
      ) as unknown as PdfJsTextLayer;
    },
  };
}
