import type { Annotation, PageIndex, ReaderError, Result } from "@shelf/reader-core";
import type { PdfJsPageProxy, PdfJsRuntime, PdfJsTextLayer } from "../adapter/pdfjs-runtime.js";
import type { PdfPageHandle } from "../adapter/pdf-document-adapter.js";
import { getPdfJsPageProxy } from "../adapter/pdf-document-adapter.js";
import { reorderPdfTextLayer } from "./pdf-text-layer-order.js";

export interface PdfPageLayers {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly text: HTMLElement;
  readonly interaction: HTMLElement;
  readonly annotations: HTMLElement;
}

export interface PdfPageRenderOptions {
  readonly scale: number;
  readonly devicePixelRatio?: number;
}

interface RenderState {
  task: ReturnType<PdfJsPageProxy["render"]> | null;
  textLayer: PdfJsTextLayer | null;
}

const renderStates = new WeakMap<HTMLElement, RenderState>();

/** Maximum annotation DOM markers materialized for one page render. */
const MAX_ANNOTATION_MARKERS_PER_PAGE = 200;

function failure(code: ReaderError["code"], message: string): Result<never, ReaderError> {
  return { ok: false, error: { code, message, retryable: false } };
}

function isValidRect(rectangle: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): boolean {
  return [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite) &&
    rectangle.x >= 0 && rectangle.y >= 0 &&
    rectangle.width > 0 && rectangle.height > 0 &&
    rectangle.x + rectangle.width <= 1 &&
    rectangle.y + rectangle.height <= 1;
}

/** Creates three independent DOM layers; Shelf annotations never paint into the PDF canvas. */
export function createPdfPageLayers(root: HTMLElement): PdfPageLayers {
  const document = root.ownerDocument;
  const canvas = document.createElement("canvas");
  const text = document.createElement("div");
  const interaction = document.createElement("div");
  const annotations = document.createElement("div");

  root.classList.add("shelf-pdf-page");
  canvas.className = "shelf-pdf-canvas";
  text.className = "textLayer shelf-pdf-text-layer";
  interaction.className = "shelf-pdf-interaction-layer";
  annotations.className = "shelf-pdf-annotation-layer";
  root.replaceChildren(canvas, text, interaction, annotations);
  return { root, canvas, text, interaction, annotations };
}

function renderShelfAnnotations(
  layer: HTMLElement,
  pageIndex: PageIndex,
  annotations: readonly Annotation[],
): void {
  layer.replaceChildren();

  let markerCount = 0;
  // The caller supplies annotations scoped to this page. Bound both the
  // record scan and rectangle materialization to defend against corrupt data.
  for (const annotation of annotations.slice(0, MAX_ANNOTATION_MARKERS_PER_PAGE)) {
    if (annotation.pageIndex !== pageIndex) continue;

    for (const rectangle of annotation.rectangles) {
      if (markerCount >= MAX_ANNOTATION_MARKERS_PER_PAGE) return;
      markerCount += 1;
      if (!isValidRect(rectangle)) continue;
      const marker = layer.ownerDocument.createElement("span");
      marker.classList.add("shelf-pdf-annotation", "shelf-pdf-annotation--" + annotation.kind);
      marker.dataset["annotationId"] = annotation.id;
      marker.style.left = rectangle.x * 100 + "%";
      marker.style.top = rectangle.y * 100 + "%";
      marker.style.width = rectangle.width * 100 + "%";
      marker.style.height = rectangle.height * 100 + "%";

      if (annotation.kind === "highlight") {
        marker.dataset["color"] = annotation.color;
        marker.setAttribute("aria-label", "Saved highlight");
      } else {
        marker.setAttribute("aria-label", "Saved note");
        marker.title = annotation.content.slice(0, 240);
      }

      layer.append(marker);
    }
  }
}


export class PdfPageRenderer {
  readonly #runtime: PdfJsRuntime;
  readonly #maxCanvasPixels: number;

  constructor(runtime: PdfJsRuntime, maxCanvasPixels = 16_777_216) {
    if (!Number.isSafeInteger(maxCanvasPixels) || maxCanvasPixels < 1) {
      throw new RangeError("Maximum canvas pixel budget must be a positive safe integer.");
    }
    this.#runtime = runtime;
    this.#maxCanvasPixels = maxCanvasPixels;
  }

  updateAnnotations(
    layers: PdfPageLayers,
    pageIndex: PageIndex,
    annotations: readonly Annotation[],
  ): void {
    renderShelfAnnotations(layers.annotations, pageIndex, annotations);
  }

  async render(
    page: PdfPageHandle,
    layers: PdfPageLayers,
    annotations: readonly Annotation[],
    options: PdfPageRenderOptions,
  ): Promise<Result<{ readonly width: number; readonly height: number }, ReaderError>> {
    const pageProxy = getPdfJsPageProxy(page);
    if (pageProxy === null) return failure("invalid-input", "The page handle does not belong to this PDF engine.");
    const scale = options.scale;
    const pixelRatio = options.devicePixelRatio ?? 1;
    if (!Number.isFinite(scale) || scale <= 0 || scale > 8 ||
        !Number.isFinite(pixelRatio) || pixelRatio <= 0 || pixelRatio > 4) {
      return failure("invalid-input", "PDF page scale is outside the supported range.");
    }

    this.cancel(layers);
    const viewport = pageProxy.getViewport({ scale });
    const pixelWidth = Math.ceil(viewport.width * pixelRatio);
    const pixelHeight = Math.ceil(viewport.height * pixelRatio);
    if (!Number.isSafeInteger(pixelWidth) || !Number.isSafeInteger(pixelHeight) ||
        pixelWidth < 1 || pixelHeight < 1 || pixelWidth * pixelHeight > this.#maxCanvasPixels) {
      return failure("invalid-input", "This page exceeds the configured canvas memory budget.");
    }

    const context = layers.canvas.getContext("2d", { alpha: false });
    if (context === null) return failure("not-supported", "A 2D canvas context is not available.");

    layers.root.style.position = "relative";
    layers.root.style.width = viewport.width + "px";
    layers.root.style.height = viewport.height + "px";
    layers.root.style.setProperty("--total-scale-factor", String(scale));
    layers.canvas.width = pixelWidth;
    layers.canvas.height = pixelHeight;
    layers.canvas.style.width = viewport.width + "px";
    layers.canvas.style.height = viewport.height + "px";
    layers.text.style.width = viewport.width + "px";
    layers.text.style.height = viewport.height + "px";
    layers.interaction.style.width = viewport.width + "px";
    layers.interaction.style.height = viewport.height + "px";
    layers.annotations.style.width = viewport.width + "px";
    layers.annotations.style.height = viewport.height + "px";

    const state: RenderState = { task: null, textLayer: null };
    renderStates.set(layers.root, state);

    try {
      state.task = pageProxy.render({
        canvasContext: context,
        viewport,
        annotationMode: this.#runtime.annotationModeDisable,
        transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      await state.task.promise;
      if (renderStates.get(layers.root) !== state) {
        return failure("cancelled", "PDF page rendering was superseded.");
      }

      state.textLayer = this.#runtime.createTextLayer({
        textContentSource: pageProxy.streamTextContent(),
        container: layers.text,
        viewport,
      });
      await state.textLayer.render();
      if (renderStates.get(layers.root) !== state) {
        return failure("cancelled", "PDF text rendering was superseded.");
      }

      reorderPdfTextLayer(layers.text, viewport.width);
      this.updateAnnotations(layers, page.geometry.index, annotations);
      return { ok: true, value: { width: viewport.width, height: viewport.height } };
    } catch (error) {
      if (renderStates.get(layers.root) === state) {
        this.cancel(layers);
      } else {
        state.task?.cancel();
        state.textLayer?.cancel();
      }
      const name = typeof error === "object" && error !== null && "name" in error
        ? String((error as { name: unknown }).name)
        : "";
      if (name === "AbortException" || name === "RenderingCancelledException") {
        return failure("cancelled", "PDF page rendering was cancelled.");
      }
      return {
        ok: false,
        error: {
          code: "read-failed",
          message: "Shelf could not render this PDF page.",
          retryable: true,
        },
      };
    }
  }

  cancel(layers: PdfPageLayers): void {
    const state = renderStates.get(layers.root);
    if (state === undefined) return;
    renderStates.delete(layers.root);
    state.task?.cancel();
    state.textLayer?.cancel();
    layers.text.replaceChildren();
    layers.interaction.replaceChildren();
    layers.annotations.replaceChildren();
  }
}
