import type {
  DocumentLocatorStorePort,
  DocumentSourcePort,
} from "@shelf/reader-core";
import { PdfDocumentAdapter } from "./adapter/pdf-document-adapter.js";
import type { PdfDocumentAdapterOptions } from "./adapter/pdf-document-adapter.js";
import { createPdfJsRuntime, resolvePdfJsAssetUrls } from "./adapter/pdfjs-runtime.js";

/** Build the browser adapter using same-origin PDF.js worker and data assets. */
export function createPdfDocumentAdapter(
  source: DocumentSourcePort,
  locators: DocumentLocatorStorePort,
  baseUrl: string,
  options: PdfDocumentAdapterOptions = {},
): PdfDocumentAdapter {
  const assets = resolvePdfJsAssetUrls(baseUrl);
  return new PdfDocumentAdapter(
    createPdfJsRuntime(assets),
    source,
    locators,
    {
      ...options,
      cMapUrl: assets.cMapUrl,
      iccUrl: assets.iccUrl,
      standardFontDataUrl: assets.standardFontDataUrl,
      wasmUrl: assets.wasmUrl,
    },
  );
}
