import {
  findTextMatches,
  resolveTextAnchor,
  resolveTextSelectionOffsets,
  toPageIndex,
} from "@shelf/reader-core";
import type {
  Annotation,
  ExtractedPageText,
  PageRect,
  ReaderAnnotationUseCases,
  ReadingMode,
  ReadingProgress,
  ReadingProgressRepositoryPort,
  TextSearchMatch,
  TextSelection,
} from "@shelf/reader-core";
import { mountReaderAnnotationsFeature } from "./features/annotations/index.js";
import type { ReaderAnnotationsController } from "./features/annotations/index.js";
import type {
  PdfDocumentSession,
  PdfOutlineItem,
  PdfPageHandle,
  PdfPageRenderer,
  PdfPageLayers,
} from "@shelf/pdf-engine";
import { createPdfPageLayers } from "@shelf/pdf-engine";

interface ReaderWorkspaceOptions {
  readonly root: HTMLElement;
  readonly session: PdfDocumentSession;
  readonly renderer: PdfPageRenderer;
  readonly progressRepository: ReadingProgressRepositoryPort;
  readonly annotationUseCases: ReaderAnnotationUseCases;
  readonly initialProgress: ReadingProgress | null;
  readonly onStatus: (message: string, isError?: boolean) => void;
  readonly onSelection?: (selection: TextSelection | null) => void;
  readonly onClose: () => void;
}

export interface ReaderWorkspaceController {
  persist(): Promise<void>;
  getSelection(): TextSelection | null;
  dispose(): void;
}

interface MountedPage {
  readonly root: HTMLDivElement;
  readonly layers: PdfPageLayers;
  handle: PdfPageHandle | null;
  loading: boolean;
  renderedScale: number | null;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;
const SAVE_DEBOUNCE_MS = 450;
const MAX_CACHED_PAGE_HANDLES = 24;
const MAX_CACHED_TEXT_PAGES = 24;
const MAX_SEARCH_PAGES = 2_000;
const MAX_SEARCH_CHARACTERS = 2_000_000;
const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_MATCHES_PER_PAGE = 20;
const MAX_SEARCH_QUERY_CHARACTERS = 256;
const MAX_SELECTION_CHARACTERS = 20_000;
const MAX_SELECTION_RECTANGLES = 512;
const MAX_INTERACTION_MARKERS_PER_PAGE = 500;

function element<K extends keyof HTMLElementTagNameMap>(
  owner: Document,
  tag: K,
  className: string,
  label?: string,
): HTMLElementTagNameMap[K] {
  const value = owner.createElement(tag);
  value.className = className;
  if (label !== undefined) value.textContent = label;
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validZoom(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_ZOOM && value <= MAX_ZOOM;
}

function createButton(owner: Document, label: string, className = "button button-small"): HTMLButtonElement {
  const button = element(owner, "button", className, label);
  button.type = "button";
  return button;
}

function formatZoom(value: number): string {
  return String(Math.round(value * 100)) + "%";
}

function formatMetadata(author: string | null, subject: string | null): string {
  return [author, subject].filter((value) => value !== null && value.length > 0).join(" · ");
}

export function mountReaderWorkspace(options: ReaderWorkspaceOptions): ReaderWorkspaceController {
  const { root, session, renderer, progressRepository, onStatus, onClose } = options;
  const owner = root.ownerDocument;
  const virtualizer = session.createVirtualizer({ overscanPages: 2, maxMountedPages: 10 });
  const pages = new Map<number, MountedPage>();
  const pageHandleCache = new Map<number, PdfPageHandle>();
  const pageTextCache = new Map<number, ExtractedPageText>();
  let searchController: AbortController | null = null;
  let searchMatches: readonly TextSearchMatch[] = [];
  let activeSearchMatchIndex = -1;
  let activeSelection: TextSelection | null = null;
  let annotationsFeature: ReaderAnnotationsController | null = null;
  let selectionTimer: number | null = null;
  let selectionGeneration = 0;
  let disposed = false;
  let renderFrame: number | null = null;
  let saveTimer: number | null = null;
  let currentPage = 0;
  let zoom = validZoom(options.initialProgress?.zoom ?? 1) ? options.initialProgress?.zoom ?? 1 : 1;
  let mode: ReadingMode = options.initialProgress?.readingMode === "single-page" ? "single-page" : "continuous";
  let lastScrollPosition = 0;

  const toolbar = element(owner, "div", "reader-toolbar");
  const navigation = element(owner, "div", "reader-control-group reader-navigation");
  const previousButton = createButton(owner, "Previous", "button button-small reader-touch-button");
  previousButton.setAttribute("aria-label", "Previous page");
  const pageInput = element(owner, "input", "reader-page-input") as HTMLInputElement;
  pageInput.type = "number";
  pageInput.min = "1";
  pageInput.max = String(session.info.pageCount);
  pageInput.step = "1";
  pageInput.inputMode = "numeric";
  pageInput.setAttribute("aria-label", "Go to page");
  const pageCount = element(owner, "span", "reader-page-count", "of " + session.info.pageCount);
  const nextButton = createButton(owner, "Next", "button button-small reader-touch-button");
  nextButton.setAttribute("aria-label", "Next page");
  navigation.append(previousButton, pageInput, pageCount, nextButton);

  const modeControls = element(owner, "div", "reader-control-group reader-mode-controls");
  const continuousButton = createButton(owner, "Continuous", "button button-small reader-mode-button");
  const singleButton = createButton(owner, "Single page", "button button-small reader-mode-button");
  modeControls.append(continuousButton, singleButton);

  const zoomControls = element(owner, "div", "reader-control-group reader-zoom-controls");
  const zoomOutButton = createButton(owner, "−", "button button-small reader-touch-button");
  zoomOutButton.setAttribute("aria-label", "Zoom out");
  const zoomLabel = element(owner, "span", "reader-zoom-label", formatZoom(zoom));
  const zoomInButton = createButton(owner, "+", "button button-small reader-touch-button");
  zoomInButton.setAttribute("aria-label", "Zoom in");
  const fitWidthButton = createButton(owner, "Fit width");
  const fitPageButton = createButton(owner, "Fit page");
  zoomControls.append(zoomOutButton, zoomLabel, zoomInButton, fitWidthButton, fitPageButton);

  const searchControls = element(owner, "div", "reader-control-group reader-search-controls");
  const searchInput = element(owner, "input", "reader-search-input") as HTMLInputElement;
  searchInput.type = "search";
  searchInput.placeholder = "Search in document";
  searchInput.setAttribute("aria-label", "Search PDF text");
  searchInput.maxLength = MAX_SEARCH_QUERY_CHARACTERS;
  const searchButton = createButton(owner, "Search", "button button-small");
  const cancelSearchButton = createButton(owner, "Cancel", "button button-small");
  cancelSearchButton.hidden = true;
  searchControls.append(searchInput, searchButton, cancelSearchButton);

  const trailingControls = element(owner, "div", "reader-control-group reader-trailing-controls");
  const outlineButton = createButton(owner, "Contents", "button button-small reader-touch-button");
  outlineButton.setAttribute("aria-expanded", "false");
  outlineButton.setAttribute("aria-controls", "reader-outline");
  const closeButton = createButton(owner, "Close", "button button-small");
  trailingControls.append(outlineButton, closeButton);
  toolbar.append(navigation, modeControls, zoomControls, searchControls, trailingControls);

  const documentHeading = element(owner, "div", "reader-document-heading");
  const documentTitle = element(
    owner,
    "h2",
    "viewer-title",
    session.info.title ?? session.info.displayName ?? "Untitled PDF",
  );
  const metadataText = formatMetadata(session.info.author, session.info.subject);
  const sizeLabel = session.info.sizeBytes < 1024 * 1024
    ? (session.info.sizeBytes / 1024).toFixed(1) + " KB"
    : (session.info.sizeBytes / (1024 * 1024)).toFixed(1) + " MB";
  const documentMeta = element(
    owner,
    "p",
    "viewer-meta",
    String(session.info.pageCount) + " pages · " + sizeLabel +
      (metadataText.length > 0 ? " · " + metadataText : ""),
  );
  documentTitle.dir = "auto";
  documentMeta.dir = "auto";
  documentHeading.append(documentTitle, documentMeta);

  const readerPanels = element(owner, "div", "reader-panels");

  const searchPanel = element(owner, "section", "reader-search-panel");
  searchPanel.hidden = true;
  searchPanel.setAttribute("aria-label", "Search results");
  const searchSummary = element(owner, "p", "reader-search-summary", "Enter a phrase to search this PDF.");
  const searchResults = element(owner, "div", "reader-search-results");
  searchPanel.append(searchSummary, searchResults);

  const selectionPanel = element(owner, "section", "reader-selection-panel");
  selectionPanel.hidden = true;
  selectionPanel.setAttribute("aria-label", "Selected PDF text");
  const selectionHeading = element(owner, "h3", "reader-selection-heading", "Selection");
  const selectionText = element(owner, "blockquote", "reader-selection-text");
  selectionText.dir = "auto";
  const selectionMeta = element(owner, "p", "reader-selection-meta");
  selectionMeta.dir = "ltr";
  selectionPanel.append(selectionHeading, selectionText, selectionMeta);
  readerPanels.append(searchPanel, selectionPanel);

  const body = element(owner, "div", "reader-body");
  const outline = element(owner, "aside", "reader-outline");
  outline.id = "reader-outline";
  outline.hidden = true;
  outline.setAttribute("aria-label", "Document contents");
  const outlineHeading = element(owner, "h3", "reader-outline-heading", "Contents");
  const outlineContent = element(owner, "div", "reader-outline-content");
  outline.append(outlineHeading, outlineContent);

  const stage = element(owner, "div", "viewer-stage reader-stage");
  stage.tabIndex = 0;
  stage.setAttribute("role", "region");
  stage.setAttribute("aria-label", "PDF pages. Use arrow keys or Page Up and Page Down to navigate.");
  stage.setAttribute("aria-keyshortcuts", "ArrowDown ArrowUp PageDown PageUp");
  const spacer = element(owner, "div", "reader-scroll-spacer");
  const loadingMessage = element(owner, "p", "reader-loading", "Loading PDF page…");
  loadingMessage.setAttribute("role", "status");
  loadingMessage.hidden = true;
  stage.setAttribute("aria-busy", "false");
  stage.append(spacer, loadingMessage);
  body.append(outline, stage);

  root.replaceChildren(documentHeading, toolbar, readerPanels, body);
  root.hidden = false;

  const savedPage = options.initialProgress?.pageIndex as number | undefined;
  if (savedPage !== undefined && Number.isSafeInteger(savedPage) && savedPage >= 0 && savedPage < session.info.pageCount) {
    currentPage = savedPage;
  }
  const initialOffset = Number.isFinite(options.initialProgress?.scrollOffset)
    ? clamp(options.initialProgress?.scrollOffset ?? 0, 0, 1)
    : 0;

  function syncControls(): void {
    previousButton.disabled = currentPage <= 0;
    nextButton.disabled = currentPage >= session.info.pageCount - 1;
    zoomOutButton.disabled = zoom <= MIN_ZOOM;
    zoomInButton.disabled = zoom >= MAX_ZOOM;
    zoomLabel.textContent = formatZoom(zoom);
    continuousButton.setAttribute("aria-pressed", String(mode === "continuous"));
    singleButton.setAttribute("aria-pressed", String(mode === "single-page"));
    if (owner.activeElement !== pageInput) pageInput.value = String(currentPage + 1);
  }

  function setReaderBusy(busy: boolean, message = "Loading PDF page…"): void {
    loadingMessage.textContent = message;
    loadingMessage.hidden = !busy;
    stage.setAttribute("aria-busy", String(busy));
  }

  function rememberHandle(index: number, handle: PdfPageHandle): void {
    pageHandleCache.delete(index);
    pageHandleCache.set(index, handle);
    while (pageHandleCache.size > MAX_CACHED_PAGE_HANDLES) {
      const oldest = pageHandleCache.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      pageHandleCache.delete(oldest);
    }
  }

  async function getPageHandle(index: number): Promise<PdfPageHandle | null> {
    const cached = pageHandleCache.get(index);
    if (cached !== undefined) {
      rememberHandle(index, cached);
      return cached;
    }
    const result = await session.getPage(toPageIndex(index));
    if (!result.ok) {
      onStatus(result.error.message, true);
      return null;
    }
    rememberHandle(index, result.value);
    return result.value;
  }

  function updateMeasuredSize(index: number, handle: PdfPageHandle): boolean {
    const next = handle.geometry;
    const pageIndex = toPageIndex(index);
    const previous = virtualizer.getPageSize(pageIndex);
    if (previous.width === next.width && previous.height === next.height) return false;

    // Keep the currently visible page anchored when an earlier page's estimate
    // is replaced by its measured height. Without this correction, a long PDF
    // can visibly jump as pages enter and leave the virtual window.
    const anchorTopBefore = mode === "continuous"
      ? virtualizer.getPageTop(toPageIndex(currentPage), zoom)
      : 0;
    virtualizer.updatePageSize(pageIndex, { width: next.width, height: next.height });
    if (mode === "continuous" && index < currentPage) {
      const anchorTopAfter = virtualizer.getPageTop(toPageIndex(currentPage), zoom);
      const correction = anchorTopAfter - anchorTopBefore;
      stage.scrollTop = Math.max(0, stage.scrollTop + correction);
      lastScrollPosition = stage.scrollTop;
    }
    return true;
  }

  function createMountedPage(): MountedPage {
    const pageRoot = element(owner, "div", "reader-page-mount");
    const layers = createPdfPageLayers(pageRoot);
    return { root: pageRoot, layers, handle: null, loading: false, renderedScale: null };
  }

  function showPageError(index: number, page: MountedPage, message: string): void {
    page.root.querySelector(".reader-page-error")?.remove();
    const error = element(owner, "div", "reader-page-error");
    const description = element(owner, "p", "reader-page-error-message", message);
    const retry = createButton(owner, "Retry page");
    retry.addEventListener("click", () => {
      error.remove();
      page.renderedScale = null;
      void renderMountedPage(index, page);
    });
    error.append(description, retry);
    page.root.append(error);
    if (index === currentPage) setReaderBusy(false);
    onStatus(message, true);
  }

  function schedulePageRender(index: number, page: MountedPage): void {
    if (page.loading || page.root.querySelector(".reader-page-error") !== null) return;
    if (page.handle === null || page.renderedScale !== zoom) {
      if (index === currentPage) setReaderBusy(true, "Loading page " + String(index + 1) + "…");
      void renderMountedPage(index, page);
    }
  }

  async function getPageText(index: number, signal?: AbortSignal): Promise<ExtractedPageText | null> {
    const cached = pageTextCache.get(index);
    if (cached !== undefined) {
      pageTextCache.delete(index);
      pageTextCache.set(index, cached);
      return cached;
    }
    const result = await session.getPageText(toPageIndex(index), signal);
    if (!result.ok) {
      if (result.error.code !== "cancelled") onStatus(result.error.message, true);
      return null;
    }
    pageTextCache.set(index, result.value);
    while (pageTextCache.size > MAX_CACHED_TEXT_PAGES) {
      const oldest = pageTextCache.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      pageTextCache.delete(oldest);
    }
    return result.value;
  }

  function addOverlayRect(
    layer: HTMLElement,
    className: string,
    rectangle: PageRect,
  ): void {
    const marker = element(owner, "span", className);
    marker.style.left = String(rectangle.x * 100) + "%";
    marker.style.top = String(rectangle.y * 100) + "%";
    marker.style.width = String(rectangle.width * 100) + "%";
    marker.style.height = String(rectangle.height * 100) + "%";
    layer.append(marker);
  }

  function updateInteractionOverlay(index: number, page: MountedPage): void {
    const layer = page.layers.interaction;
    layer.replaceChildren();
    let markerCount = 0;
    const pageText = pageTextCache.get(index);
    const matches = searchMatches.filter((match) => match.pageIndex === index);
    if (pageText !== undefined) {
      for (const match of matches) {
        const active = searchMatches[activeSearchMatchIndex] === match;
        for (const run of pageText.runs) {
          if (run.startOffset >= match.endOffset || run.endOffset <= match.startOffset) continue;
          for (const rectangle of run.rectangles) {
            if (markerCount >= MAX_INTERACTION_MARKERS_PER_PAGE) break;
            markerCount += 1;
            addOverlayRect(
              layer,
              active ? "shelf-pdf-search-highlight shelf-pdf-search-highlight--active" : "shelf-pdf-search-highlight",
              rectangle,
            );
          }
          if (markerCount >= MAX_INTERACTION_MARKERS_PER_PAGE) break;
        }
      }
    }
    if (markerCount < MAX_INTERACTION_MARKERS_PER_PAGE &&
        activeSelection !== null && activeSelection.pageIndex === index) {
      for (const rectangle of activeSelection.rectangles) {
        if (markerCount >= MAX_INTERACTION_MARKERS_PER_PAGE) break;
        markerCount += 1;
        addOverlayRect(layer, "shelf-pdf-selection-highlight", rectangle);
      }
    }
  }

  function updateAllInteractionOverlays(): void {
    for (const [index, page] of pages) updateInteractionOverlay(index, page);
  }

  function updateSearchControls(isSearching: boolean): void {
    searchButton.disabled = isSearching;
    searchInput.disabled = isSearching;
    cancelSearchButton.hidden = !isSearching;
  }

  function yieldToBrowser(): Promise<void> {
    return new Promise((resolve) => {
      if (owner.defaultView === null) {
        resolve();
        return;
      }
      owner.defaultView.setTimeout(resolve, 0);
    });
  }

  function cancelSearch(): void {
    searchController?.abort();
    searchController = null;
    updateSearchControls(false);
  }

  async function runSearch(): Promise<void> {
    const query = searchInput.value;
    if (query.trim().length === 0) {
      cancelSearch();
      searchMatches = [];
      activeSearchMatchIndex = -1;
      searchPanel.hidden = true;
      updateAllInteractionOverlays();
      return;
    }
    if (query.length > MAX_SEARCH_QUERY_CHARACTERS) {
      searchPanel.hidden = false;
      searchSummary.textContent = "Search queries are limited to " + String(MAX_SEARCH_QUERY_CHARACTERS) + " characters.";
      return;
    }

    cancelSearch();
    const controller = new AbortController();
    searchController = controller;
    searchMatches = [];
    activeSearchMatchIndex = -1;
    searchPanel.hidden = false;
    searchResults.replaceChildren();
    searchSummary.textContent = "Searching locally…";
    updateSearchControls(true);
    updateAllInteractionOverlays();

    let scannedPages = 0;
    let indexedCharacters = 0;
    let pagesWithText = 0;
    let failedPages = 0;
    let extractionTruncatedPages = 0;
    let truncated = false;

    try {
      const pageLimit = Math.min(session.info.pageCount, MAX_SEARCH_PAGES);
      for (let index = 0; index < pageLimit; index += 1) {
        if (controller.signal.aborted || disposed || searchController !== controller) break;
        const pageText = await getPageText(index, controller.signal);
        if (controller.signal.aborted || disposed || searchController !== controller) break;
        scannedPages += 1;
        if (pageText === null) {
          failedPages += 1;
          continue;
        }
        if (pageText.hasSelectableText) pagesWithText += 1;
        if (pageText.truncated) extractionTruncatedPages += 1;

        const remainingCharacters = MAX_SEARCH_CHARACTERS - indexedCharacters;
        if (remainingCharacters <= 0) {
          truncated = true;
          break;
        }
        const boundedPage = pageText.text.length > remainingCharacters
          ? { ...pageText, text: pageText.text.slice(0, remainingCharacters) }
          : pageText;
        indexedCharacters += boundedPage.text.length;
        if (pageText.text.length > remainingCharacters) truncated = true;

        const remainingResults = MAX_SEARCH_RESULTS - searchMatches.length;
        const pageMatches = findTextMatches(
          boundedPage,
          query,
          Math.min(MAX_SEARCH_MATCHES_PER_PAGE, remainingResults),
        );
        if (pageMatches.length > 0) searchMatches = [...searchMatches, ...pageMatches];
        if (searchMatches.length >= MAX_SEARCH_RESULTS || truncated) {
          truncated = true;
          break;
        }
        if (index % 8 === 7) {
          searchSummary.textContent = "Searching… " + String(scannedPages) + " / " + String(pageLimit) + " pages";
          await yieldToBrowser();
        }
      }

      if (session.info.pageCount > MAX_SEARCH_PAGES && scannedPages >= MAX_SEARCH_PAGES) {
        truncated = true;
      }
      if (controller.signal.aborted || disposed || searchController !== controller) {
        return;
      } else if (pagesWithText === 0 && failedPages > 0) {
        searchSummary.textContent = "Text extraction failed on " + String(failedPages) + " pages. Check the source and retry.";
      } else if (pagesWithText === 0) {
        searchSummary.textContent = "No selectable text was found. This may be an image-only PDF; OCR has not been run.";
      } else if (searchMatches.length === 0) {
        searchSummary.textContent = "No matches in " + String(scannedPages) + " pages" +
          (truncated ? " · bounded search limit reached" : "") +
          (failedPages > 0 ? " · extraction failed on " + String(failedPages) + " pages" : "") +
          (extractionTruncatedPages > 0
            ? " · text capped on " + String(extractionTruncatedPages) + " pages"
            : "") +
          ".";
      } else {
        searchSummary.textContent = String(searchMatches.length) + " matches in " +
          String(scannedPages) + " pages" +
          (truncated ? " · bounded search limit reached" : "") +
          (failedPages > 0 ? " · extraction failed on " + String(failedPages) + " pages" : "") +
          (extractionTruncatedPages > 0
            ? " · text capped on " + String(extractionTruncatedPages) + " pages"
            : "");
        for (let matchIndex = 0; matchIndex < searchMatches.length; matchIndex += 1) {
          const match = searchMatches[matchIndex];
          if (match === undefined) continue;
          const resultButton = createButton(owner, "", "reader-search-result");
          const pageLabel = element(
            owner, "span", "reader-search-result-page",
            "Page " + String((match.pageIndex as number) + 1),
          );
          pageLabel.dir = "ltr";
          const snippet = element(owner, "bdi", "reader-search-result-snippet", match.snippet);
          snippet.dir = "auto";
          resultButton.append(pageLabel, snippet);
          resultButton.addEventListener("click", () => {
            void jumpToSearchMatch(match, matchIndex);
          });
          searchResults.append(resultButton);
        }
      }
      updateAllInteractionOverlays();
    } catch {
      if (!controller.signal.aborted && !disposed && searchController === controller) {
        searchSummary.textContent = "Shelf could not complete this local text search.";
      }
    } finally {
      if (searchController === controller) {
        searchController = null;
        updateSearchControls(false);
      }
    }
  }

  function textOffsetAt(
    rootLayer: HTMLElement,
    container: Node,
    offset: number,
  ): number | null {
    if (!rootLayer.contains(container)) return null;
    try {
      const range = owner.createRange();
      range.selectNodeContents(rootLayer);
      range.setEnd(container, offset);
      return range.toString().length;
    } catch {
      return null;
    }
  }

  async function captureTextSelection(): Promise<void> {
    const generation = ++selectionGeneration;
    const selected = owner.getSelection();
    if (selected === null || selected.rangeCount === 0) {
      activeSelection = null;
      selectionPanel.hidden = true;
      annotationsFeature?.setSelection(null);
      options.onSelection?.(null);
      updateAllInteractionOverlays();
      return;
    }

    const range = selected.getRangeAt(0);
    const pageEntry = [...pages.entries()].find(([, page]) =>
      page.layers.text.contains(range.startContainer) &&
      page.layers.text.contains(range.endContainer),
    );
    const selectedText = selected.toString();
    if (pageEntry === undefined || selectedText.trim().length === 0 ||
        selectedText.length > MAX_SELECTION_CHARACTERS) {
      activeSelection = null;
      selectionPanel.hidden = true;
      annotationsFeature?.setSelection(null);
      options.onSelection?.(null);
      updateAllInteractionOverlays();
      return;
    }

    const [pageIndex, page] = pageEntry;
    activeSelection = null;
    selectionPanel.hidden = true;
    updateAllInteractionOverlays();
    const approximateStart = textOffsetAt(page.layers.text, range.startContainer, range.startOffset) ?? 0;
    const pageText = await getPageText(pageIndex);
    if (disposed || generation !== selectionGeneration) return;
    if (pageText === null) {
      annotationsFeature?.setSelection(null);
      options.onSelection?.(null);
      return;
    }

    const offsets = resolveTextSelectionOffsets(pageText.text, selectedText, approximateStart);
    if (offsets === null) {
      activeSelection = null;
      selectionPanel.hidden = true;
      annotationsFeature?.setSelection(null);
      options.onSelection?.(null);
      updateAllInteractionOverlays();
      return;
    }

    const pageBounds = page.root.getBoundingClientRect();
    const rectangles: PageRect[] = Array.from(range.getClientRects())
      .slice(0, MAX_SELECTION_RECTANGLES)
      .map((rectangle) => {
        const x = clamp((rectangle.left - pageBounds.left) / Math.max(1, pageBounds.width), 0, 1);
        const y = clamp((rectangle.top - pageBounds.top) / Math.max(1, pageBounds.height), 0, 1);
        return {
          x,
          y,
          width: clamp(rectangle.width / Math.max(1, pageBounds.width), 0, 1 - x),
          height: clamp(rectangle.height / Math.max(1, pageBounds.height), 0, 1 - y),
        };
      })
      .filter((rectangle) => rectangle.width > 0 && rectangle.height > 0);

    if (rectangles.length === 0) {
      annotationsFeature?.setSelection(null);
      options.onSelection?.(null);
      return;
    }
    activeSelection = {
      documentId: session.info.documentId,
      pageIndex: toPageIndex(pageIndex),
      selectedText,
      normalizedText: selectedText.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase(),
      startOffset: offsets.startOffset,
      endOffset: offsets.endOffset,
      documentFingerprint: session.info.fingerprint as TextSelection["documentFingerprint"],
      anchorVersion: 1,
      rectangles,
      offsetConfidence: offsets.confidence,
    };
    selectionText.textContent = selectedText;
    selectionMeta.textContent = "Page " + String(pageIndex + 1) + " · offsets " +
      String(offsets.startOffset) + "–" + String(offsets.endOffset) + " · " +
      String(rectangles.length) + " geometry fragments · " + offsets.confidence + " offsets";
    selectionPanel.hidden = false;
    annotationsFeature?.setSelection(activeSelection);
    options.onSelection?.(activeSelection);
    updateInteractionOverlay(pageIndex, page);
    onStatus("Selected " + String(selectedText.length) + " characters on page " + String(pageIndex + 1) + ".");
  }

  function onSelectionChange(): void {
    if (selectionTimer !== null) owner.defaultView?.clearTimeout(selectionTimer);
    selectionTimer = owner.defaultView?.setTimeout(() => {
      selectionTimer = null;
      void captureTextSelection();
    }, 70) ?? null;
  }

  function clearPagesExcept(keep: ReadonlySet<number>): void {
    for (const [index, page] of pages) {
      if (keep.has(index)) continue;
      renderer.cancel(page.layers);
      page.root.remove();
      pages.delete(index);
    }
  }

  function positionPage(page: MountedPage, top: number, width: number): void {
    page.root.style.top = String(Math.max(0, top)) + "px";
    page.root.style.width = String(width) + "px";
    page.root.style.left = "max(0px, calc((100% - " + String(width) + "px) / 2))";
  }

  async function resolvePageAnnotations(index: number): Promise<readonly Annotation[]> {
    const pageIndex = toPageIndex(index);
    const items = annotationsFeature?.getAnnotations(pageIndex) ?? [];
    if (items.length === 0) return [];
    const hasAnchors = items.some((item) => item.anchor !== null);
    const pageText = hasAnchors ? await getPageText(index) : null;
    const fingerprint = session.info.fingerprint as TextSelection["documentFingerprint"];
    const visible: Annotation[] = [];

    for (const annotation of items) {
      const anchor = annotation.anchor;
      if (anchor === null) {
        visible.push(annotation);
        continue;
      }
      if (pageText !== null && pageText.hasSelectableText) {
        const resolution = resolveTextAnchor(pageText.text, anchor);
        if (resolution.status === "unresolved" && resolution.reason === "ambiguous") {
          annotationsFeature?.setAnchorState(annotation.id, "Unresolved: matching text is ambiguous");
          continue;
        }
        if (resolution.status === "resolved") {
          const rectangles = pageText.runs
            .filter((run) => run.startOffset < resolution.endOffset && run.endOffset > resolution.startOffset)
            .flatMap((run) => run.rectangles)
            .slice(0, MAX_SELECTION_RECTANGLES);
          if (rectangles.length > 0) {
            visible.push({ ...annotation, rectangles });
            annotationsFeature?.setAnchorState(
              annotation.id,
              resolution.confidence === "stored-offset" ? "Text anchor restored" : "Text anchor relocated",
            );
            continue;
          }
        }
      }
      if (fingerprint !== null && anchor.documentFingerprint === fingerprint && annotation.rectangles.length > 0) {
        visible.push(annotation);
        annotationsFeature?.setAnchorState(annotation.id, "Position restored from saved geometry");
      } else {
        annotationsFeature?.setAnchorState(
          annotation.id,
          pageText === null || !pageText.hasSelectableText
            ? "Unresolved: page text is unavailable"
            : "Unresolved: text could not be found",
        );
      }
    }
    return visible;
  }

  async function refreshPageAnnotations(index: number): Promise<void> {
    const page = pages.get(index);
    if (page === undefined || page.handle === null) return;
    const pageAnnotations = await resolvePageAnnotations(index);
    if (!disposed && pages.get(index) === page) {
      renderer.updateAnnotations(page.layers, toPageIndex(index), pageAnnotations);
    }
  }

  async function renderMountedPage(index: number, page: MountedPage): Promise<void> {
    if (page.loading || disposed || pages.get(index) !== page) return;
    page.loading = true;
    try {
      const handle = page.handle ?? await getPageHandle(index);
      if (disposed || pages.get(index) !== page) return;
      if (handle === null) {
        page.loading = false;
        showPageError(index, page, "This page could not be loaded. Check the source file and retry.");
        return;
      }
      page.handle = handle;

      const changed = updateMeasuredSize(index, handle);
      const renderScale = zoom;
      const width = handle.geometry.width * renderScale;
      const height = handle.geometry.height * renderScale;
      const top = mode === "continuous"
        ? virtualizer.getPageTop(toPageIndex(index), renderScale)
        : 0;
      positionPage(page, top, width);
      page.root.style.height = String(height) + "px";
      if (mode === "single-page") {
        spacer.style.height = String(Math.max(stage.clientHeight, height + 32)) + "px";
      }
      if (changed) scheduleRender();

      if (page.renderedScale === renderScale) {
        page.loading = false;
        return;
      }

      const pageAnnotations = await resolvePageAnnotations(index);
      if (disposed || pages.get(index) !== page) return;
      const result = await renderer.render(page.handle, page.layers, pageAnnotations, {
        scale: renderScale,
        devicePixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
      });
      if (disposed || pages.get(index) !== page) return;
      page.loading = false;

      if (result.ok) {
        page.renderedScale = renderScale;
        updateInteractionOverlay(index, page);
        if (
          searchMatches.some((match) => match.pageIndex === index) &&
          !pageTextCache.has(index)
        ) {
          void getPageText(index).then(() => {
            if (!disposed && pages.get(index) === page) updateInteractionOverlay(index, page);
          });
        }
        if (index === currentPage && renderScale === zoom) setReaderBusy(false);
        if (renderScale !== zoom) scheduleRender();
      } else if (result.error.code !== "cancelled") {
        page.renderedScale = null;
        showPageError(index, page, result.error.message);
      } else {
        page.renderedScale = null;
      }
    } catch {
      if (disposed || pages.get(index) !== page) return;
      page.loading = false;
      showPageError(index, page, "Shelf could not render this PDF page. Retry the page.");
    }
  }

  function drawContinuous(): void {
    stage.classList.remove("reader-stage--single");
    const viewportWidth = Math.max(1, stage.clientWidth - 32);
    const viewportHeight = Math.max(1, stage.clientHeight);
    const window = virtualizer.getWindow({
      scrollTop: stage.scrollTop,
      viewportWidth,
      viewportHeight,
      scale: zoom,
    });
    spacer.style.height = String(window.totalHeight + 24) + "px";
    spacer.style.width = "100%";
    const required = new Set(window.pages.map((item) => item.index as number));
    clearPagesExcept(required);

    for (const descriptor of window.pages) {
      const index = descriptor.index as number;
      let page = pages.get(index);
      if (page === undefined) {
        page = createMountedPage();
        pages.set(index, page);
        spacer.append(page.root);
      }
      positionPage(page, descriptor.top, descriptor.width);
      page.root.style.height = String(descriptor.height) + "px";
      schedulePageRender(index, page);
    }

    const firstVisible = window.firstVisibleIndex as number;
    if (firstVisible >= 0 && firstVisible < session.info.pageCount && firstVisible !== currentPage) {
      currentPage = firstVisible;
      setReaderBusy(true, "Loading page " + String(currentPage + 1) + "…");
    }
    const visiblePage = pages.get(currentPage);
    if (visiblePage?.handle !== null && visiblePage?.renderedScale === zoom) setReaderBusy(false);
    syncControls();
  }

  function drawSingle(): void {
    stage.classList.add("reader-stage--single");
    clearPagesExcept(new Set([currentPage]));
    let page = pages.get(currentPage);
    if (page === undefined) {
      page = createMountedPage();
      pages.set(currentPage, page);
      spacer.append(page.root);
    }
    if (page.handle !== null) {
      const width = page.handle.geometry.width * zoom;
      const height = page.handle.geometry.height * zoom;
      positionPage(page, 0, width);
      page.root.style.height = String(height) + "px";
      spacer.style.height = String(Math.max(stage.clientHeight, height + 32)) + "px";
    }
    spacer.style.width = "100%";
    schedulePageRender(currentPage, page);
    if (page.handle !== null && page.renderedScale === zoom) setReaderBusy(false);
    stage.scrollTop = 0;
    syncControls();
  }

  function draw(): void {
    if (disposed) return;
    if (mode === "single-page") drawSingle();
    else drawContinuous();
  }

  function scheduleRender(): void {
    if (disposed || renderFrame !== null) return;
    renderFrame = owner.defaultView?.requestAnimationFrame(() => {
      renderFrame = null;
      draw();
    }) ?? null;
    if (renderFrame === null) draw();
  }

  function readPosition(): { readonly pageIndex: number; readonly scrollOffset: number } {
    if (mode === "single-page") return { pageIndex: currentPage, scrollOffset: 0 };
    const size = virtualizer.getPageSize(toPageIndex(currentPage));
    const pageTop = virtualizer.getPageTop(toPageIndex(currentPage), zoom);
    const pageHeight = Math.max(1, size.height * zoom);
    return {
      pageIndex: currentPage,
      scrollOffset: clamp((stage.scrollTop - pageTop) / pageHeight, 0, 1),
    };
  }

  function schedulePersist(): void {
    if (disposed) return;
    if (saveTimer !== null) owner.defaultView?.clearTimeout(saveTimer);
    saveTimer = owner.defaultView?.setTimeout(() => {
      saveTimer = null;
      void persist();
    }, SAVE_DEBOUNCE_MS) ?? null;
  }

  async function persist(): Promise<void> {
    const position = readPosition();
    const progress: ReadingProgress = {
      documentId: session.info.documentId,
      pageIndex: toPageIndex(position.pageIndex),
      scrollOffset: position.scrollOffset,
      zoom,
      readingMode: mode,
      updatedAt: Date.now(),
    };
    const result = await progressRepository.save(progress);
    if (!result.ok) onStatus("Shelf could not save this reading position.", true);
  }

  async function ensurePageGeometry(index: number): Promise<PdfPageHandle | null> {
    const handle = await getPageHandle(index);
    if (handle === null) return null;
    updateMeasuredSize(index, handle);
    return handle;
  }

  function jumpTo(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= session.info.pageCount) {
      onStatus("Enter a page number between 1 and " + session.info.pageCount + ".", true);
      syncControls();
      return;
    }
    currentPage = index;
    setReaderBusy(true, "Loading page " + String(index + 1) + "…");
    if (mode === "continuous") {
      const offset = virtualizer.getPageTop(toPageIndex(index), zoom);
      stage.scrollTop = offset;
      lastScrollPosition = offset;
    } else {
      stage.scrollTop = 0;
    }
    draw();
    schedulePersist();
    onStatus("Page " + String(index + 1) + " of " + session.info.pageCount + ".");
  }

  function stepPage(delta: number): void {
    void jumpTo(clamp(currentPage + delta, 0, session.info.pageCount - 1));
  }

  async function jumpToSearchMatch(match: TextSearchMatch, matchIndex: number): Promise<void> {
    activeSearchMatchIndex = matchIndex;
    const index = match.pageIndex as number;
    jumpTo(index);
    const handle = await ensurePageGeometry(index);
    if (disposed || searchMatches[activeSearchMatchIndex] !== match || handle === null) return;
    const pageText = pageTextCache.get(index);
    const run = pageText?.runs.find((item) =>
      item.startOffset < match.endOffset && item.endOffset > match.startOffset,
    );
    const rectangle = run?.rectangles[0];
    if (rectangle !== undefined) {
      const pageTop = mode === "continuous"
        ? virtualizer.getPageTop(toPageIndex(index), zoom)
        : 0;
      const pageHeight = handle.geometry.height * zoom;
      stage.scrollTop = Math.max(
        0,
        pageTop + rectangle.y * pageHeight - stage.clientHeight * 0.35,
      );
      lastScrollPosition = stage.scrollTop;
      draw();
    }
    updateAllInteractionOverlays();
  }



  function changeMode(nextMode: ReadingMode): void {
    if (mode === nextMode) return;
    const position = readPosition();
    mode = nextMode;
    currentPage = position.pageIndex;
    if (mode === "continuous") {
      const size = virtualizer.getPageSize(toPageIndex(currentPage));
      stage.scrollTop = virtualizer.getPageTop(toPageIndex(currentPage), zoom) +
        position.scrollOffset * size.height * zoom;
    } else {
      stage.scrollTop = 0;
    }
    draw();
    schedulePersist();
  }

  function changeZoom(nextZoom: number): void {
    const next = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(next - zoom) < 0.001) return;
    const position = readPosition();
    zoom = next;
    setReaderBusy(true, "Rendering at " + formatZoom(zoom) + "…");
    if (mode === "continuous") {
      const size = virtualizer.getPageSize(toPageIndex(position.pageIndex));
      stage.scrollTop = virtualizer.getPageTop(toPageIndex(position.pageIndex), zoom) +
        position.scrollOffset * size.height * zoom;
    }
    for (const page of pages.values()) page.renderedScale = null;
    draw();
    schedulePersist();
  }

  async function fitWidth(): Promise<void> {
    const handle = await ensurePageGeometry(currentPage);
    if (handle === null) return;
    const available = Math.max(1, stage.clientWidth - 48);
    changeZoom(clamp(available / handle.geometry.width, MIN_ZOOM, MAX_ZOOM));
  }

  async function fitPage(): Promise<void> {
    const handle = await ensurePageGeometry(currentPage);
    if (handle === null) return;
    const availableWidth = Math.max(1, stage.clientWidth - 48);
    const availableHeight = Math.max(1, stage.clientHeight - 48);
    const fit = Math.min(availableWidth / handle.geometry.width, availableHeight / handle.geometry.height);
    changeZoom(clamp(fit, MIN_ZOOM, MAX_ZOOM));
  }

  function appendOutlineItems(parent: HTMLElement, items: readonly PdfOutlineItem[]): void {
    const list = element(owner, "ul", "reader-outline-list");
    for (const item of items) {
      const entry = element(owner, "li", "reader-outline-item");
      const link = createButton(owner, item.title, "reader-outline-link");
      link.dir = "auto";
      link.disabled = item.pageIndex === null;
      if (item.pageIndex !== null) {
        link.addEventListener("click", () => {
          outline.hidden = true;
          outlineButton.setAttribute("aria-expanded", "false");
          void jumpTo(item.pageIndex as number);
        });
      }
      entry.append(link);
      if (item.children.length > 0) appendOutlineItems(entry, item.children);
      list.append(entry);
    }
    parent.append(list);
  }

  let outlineLoaded = false;
  let outlineLoading = false;

  async function loadOutline(): Promise<void> {
    if (disposed || outlineLoaded || outlineLoading) return;
    outlineLoading = true;
    outlineContent.replaceChildren(element(owner, "p", "reader-outline-empty", "Loading contents…"));
    try {
      const result = await session.getOutline();
      if (disposed) return;
      outlineLoading = false;
      if (!result.ok) {
        const error = element(owner, "p", "reader-outline-empty", "The document contents could not be loaded.");
        const retry = createButton(owner, "Retry contents");
        retry.addEventListener("click", () => void loadOutline());
        outlineContent.replaceChildren(error, retry);
        return;
      }
      outlineLoaded = true;
      outlineContent.replaceChildren();
      if (result.value.length === 0) {
        outlineContent.append(element(owner, "p", "reader-outline-empty", "This PDF does not contain a table of contents."));
      } else {
        appendOutlineItems(outlineContent, result.value);
      }
    } catch {
      if (disposed) return;
      outlineLoading = false;
      const error = element(owner, "p", "reader-outline-empty", "The document contents could not be loaded.");
      const retry = createButton(owner, "Retry contents");
      retry.addEventListener("click", () => void loadOutline());
      outlineContent.replaceChildren(error, retry);
    }
  }

  function onScroll(): void {
    if (mode !== "continuous" || disposed) return;
    if (Math.abs(stage.scrollTop - lastScrollPosition) < 1) return;
    lastScrollPosition = stage.scrollTop;
    scheduleRender();
    schedulePersist();
  }

  function onKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("input, button, select, textarea, [contenteditable='true']") !== null) {
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case "ArrowDown":
      case "PageDown":
        event.preventDefault();
        stepPage(1);
        break;
      case "ArrowUp":
      case "PageUp":
        event.preventDefault();
        stepPage(-1);
        break;
      case "+":
      case "=":
        event.preventDefault();
        void changeZoom(zoom + ZOOM_STEP);
        break;
      case "-":
        event.preventDefault();
        void changeZoom(zoom - ZOOM_STEP);
        break;
      case "0":
        event.preventDefault();
        void fitWidth();
        break;
    }
  }

  annotationsFeature = mountReaderAnnotationsFeature({
    owner,
    toolbar,
    selectionPanel,
    readerPanels,
    documentId: session.info.documentId,
    useCases: options.annotationUseCases,
    getCurrentPage: () => toPageIndex(currentPage),
    getSelection: () => activeSelection,
    jumpToPage: (pageIndex) => jumpTo(pageIndex as number),
    onPageChanged: (pageIndex) => void refreshPageAnnotations(pageIndex as number),
    onStatus,
  });
  void annotationsFeature.refresh();

  searchButton.addEventListener("click", () => void runSearch());
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void runSearch();
    }
  });
  cancelSearchButton.addEventListener("click", () => {
    cancelSearch();
    searchSummary.textContent = "Search cancelled.";
  });
  owner.addEventListener("selectionchange", onSelectionChange);
  previousButton.addEventListener("click", () => stepPage(-1));
  nextButton.addEventListener("click", () => stepPage(1));
  pageInput.addEventListener("change", () => {
    const pageNumber = Number(pageInput.value);
    if (Number.isSafeInteger(pageNumber)) void jumpTo(pageNumber - 1);
    else syncControls();
  });
  continuousButton.addEventListener("click", () => void changeMode("continuous"));
  singleButton.addEventListener("click", () => void changeMode("single-page"));
  zoomOutButton.addEventListener("click", () => void changeZoom(zoom - ZOOM_STEP));
  zoomInButton.addEventListener("click", () => void changeZoom(zoom + ZOOM_STEP));
  fitWidthButton.addEventListener("click", () => void fitWidth());
  fitPageButton.addEventListener("click", () => void fitPage());
  outlineButton.addEventListener("click", () => {
    outline.hidden = !outline.hidden;
    outlineButton.setAttribute("aria-expanded", String(!outline.hidden));
    if (!outline.hidden) void loadOutline();
  });
  closeButton.addEventListener("click", onClose);
  stage.addEventListener("scroll", onScroll, { passive: true });
  stage.addEventListener("keydown", onKeyDown);

  async function initialize(): Promise<void> {
    syncControls();
    setReaderBusy(true, "Loading page " + String(currentPage + 1) + "…");
    const first = await ensurePageGeometry(currentPage);
    if (disposed) return;
    if (first !== null && mode === "continuous") {
      const size = virtualizer.getPageSize(toPageIndex(currentPage));
      stage.scrollTop = virtualizer.getPageTop(toPageIndex(currentPage), zoom) +
        initialOffset * size.height * zoom;
      lastScrollPosition = stage.scrollTop;
    }
    draw();
    if (!disposed) onStatus("Ready · " + session.info.pageCount + " pages.");
  }

  void initialize();

  return {
    persist,
    getSelection(): TextSelection | null {
      return activeSelection;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (renderFrame !== null) owner.defaultView?.cancelAnimationFrame(renderFrame);
      if (saveTimer !== null) owner.defaultView?.clearTimeout(saveTimer);
      stage.removeEventListener("scroll", onScroll);
      stage.removeEventListener("keydown", onKeyDown);
      owner.removeEventListener("selectionchange", onSelectionChange);
      if (selectionTimer !== null) owner.defaultView?.clearTimeout(selectionTimer);
      cancelSearch();
      selectionGeneration += 1;
      clearPagesExcept(new Set());
      pageHandleCache.clear();
      pageTextCache.clear();
      activeSelection = null;
      annotationsFeature?.dispose();
      annotationsFeature = null;
      options.onSelection?.(null);
    },
  };
}
