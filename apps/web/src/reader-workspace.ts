import { toPageIndex } from "@shelf/reader-core";
import type {
  ReadingMode,
  ReadingProgress,
  ReadingProgressRepositoryPort,
} from "@shelf/reader-core";
import type {
  PdfDocumentSession,
  PdfOutlineItem,
  PdfPageHandle,
  PdfPageRenderer,
  PdfPageLayers,
} from "@shelf/pdf-engine";
import {
  createPdfPageLayers,
  mapPdfSelectionRange,
  searchPdfDocument,
} from "@shelf/pdf-engine";
import type {
  PdfTextSearchMatch,
  PdfTextSelection,
} from "@shelf/pdf-engine";

interface ReaderWorkspaceOptions {
  readonly root: HTMLElement;
  readonly session: PdfDocumentSession;
  readonly renderer: PdfPageRenderer;
  readonly progressRepository: ReadingProgressRepositoryPort;
  readonly initialProgress: ReadingProgress | null;
  readonly onStatus: (message: string, isError?: boolean) => void;
  readonly onClose: () => void;
  readonly onSelection?: (selections: readonly PdfTextSelection[]) => void;
}

export interface ReaderWorkspaceController {
  persist(): Promise<void>;
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
  let disposed = false;
  let renderFrame: number | null = null;
  let saveTimer: number | null = null;
  let currentPage = 0;
  let zoom = validZoom(options.initialProgress?.zoom ?? 1) ? options.initialProgress?.zoom ?? 1 : 1;
  let mode: ReadingMode = options.initialProgress?.readingMode === "single-page" ? "single-page" : "continuous";
  let lastScrollPosition = 0;
  let searchController: AbortController | null = null;
  let searchGeneration = 0;
  let selectionFrame: number | null = null;
  let activeSearchMatch: PdfTextSearchMatch | null = null;

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

  const trailingControls = element(owner, "div", "reader-control-group reader-trailing-controls");
  const outlineButton = createButton(owner, "Contents", "button button-small reader-touch-button");
  outlineButton.setAttribute("aria-expanded", "false");
  outlineButton.setAttribute("aria-controls", "reader-outline");
  const closeButton = createButton(owner, "Close", "button button-small");
  trailingControls.append(outlineButton, closeButton);
  toolbar.append(navigation, modeControls, zoomControls, trailingControls);

  const searchPanel = element(owner, "section", "reader-search-panel");
  const searchForm = element(owner, "form", "reader-search-form") as HTMLFormElement;
  const searchInput = element(owner, "input", "reader-search-input") as HTMLInputElement;
  searchInput.type = "search";
  searchInput.maxLength = 256;
  searchInput.placeholder = "Search this PDF";
  searchInput.setAttribute("aria-label", "Search PDF text");
  const searchButton = createButton(owner, "Search");
  searchButton.type = "submit";
  const cancelSearchButton = createButton(owner, "Cancel", "button button-small");
  cancelSearchButton.disabled = true;
  cancelSearchButton.setAttribute("aria-label", "Cancel text search");
  searchForm.append(searchInput, searchButton, cancelSearchButton);
  const searchStatus = element(owner, "p", "reader-search-status", "Search stays on this device.");
  searchStatus.setAttribute("role", "status");
  searchStatus.setAttribute("aria-live", "polite");
  const searchResults = element(owner, "ol", "reader-search-results") as HTMLOListElement;
  const selectionStatus = element(owner, "p", "reader-selection-status");
  selectionStatus.setAttribute("role", "status");
  selectionStatus.setAttribute("aria-live", "polite");
  searchPanel.append(searchForm, searchStatus, searchResults, selectionStatus);

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
  documentHeading.append(documentTitle, documentMeta);

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
  const spacer = element(owner, "div", "reader-scroll-spacer");
  const loadingMessage = element(owner, "p", "reader-loading", "Loading PDF page…");
  loadingMessage.setAttribute("role", "status");
  loadingMessage.hidden = true;
  stage.setAttribute("aria-busy", "false");
  stage.append(spacer, loadingMessage);
  body.append(outline, stage);

  root.replaceChildren(documentHeading, toolbar, searchPanel, body);
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

      const result = await renderer.render(page.handle, page.layers, [], {
        scale: renderScale,
        devicePixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
      });
      if (disposed || pages.get(index) !== page) return;
      page.loading = false;

      if (result.ok) {
        page.renderedScale = renderScale;
        paintSearchMatch(index, page);
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

  function paintSearchMatch(index: number, page: MountedPage): void {
    page.layers.annotations.querySelectorAll(".shelf-pdf-search-hit").forEach((node) => node.remove());
    if (activeSearchMatch === null || (activeSearchMatch.pageIndex as number) !== index) return;

    for (const rectangle of activeSearchMatch.rectangles) {
      const marker = element(owner, "span", "shelf-pdf-search-hit");
      marker.style.left = String(rectangle.x * 100) + "%";
      marker.style.top = String(rectangle.y * 100) + "%";
      marker.style.width = String(rectangle.width * 100) + "%";
      marker.style.height = String(rectangle.height * 100) + "%";
      page.layers.annotations.append(marker);
    }
  }

  function clearSearch(): void {
    searchController?.abort();
    searchController = null;
    searchGeneration += 1;
    activeSearchMatch = null;
    searchResults.replaceChildren();
    searchStatus.textContent = "Search stays on this device.";
    cancelSearchButton.disabled = true;
    searchButton.disabled = false;
    for (const page of pages.values()) {
      page.layers.annotations.querySelectorAll(".shelf-pdf-search-hit").forEach((node) => node.remove());
    }
  }

  async function runSearch(): Promise<void> {
    searchController?.abort();
    const controller = new AbortController();
    const generation = searchGeneration + 1;
    searchGeneration = generation;
    searchController = controller;
    activeSearchMatch = null;
    searchResults.replaceChildren();
    searchButton.disabled = true;
    cancelSearchButton.disabled = false;
    searchStatus.textContent = "Searching local PDF text…";

    try {
      const result = await searchPdfDocument(session, searchInput.value, {
        startPage: toPageIndex(currentPage),
        signal: controller.signal,
        maxPages: 5_000,
        maxMatches: 300,
        onProgress: ({ pagesScanned, totalPages, matchesFound }) => {
          if (disposed || generation !== searchGeneration) return;
          searchStatus.textContent =
            "Scanning " + String(pagesScanned) + " of " + String(totalPages) +
            " pages · " + String(matchesFound) + " matches";
        },
      });
      if (disposed || generation !== searchGeneration) return;

      if (!result.ok) {
        searchStatus.textContent = result.error.code === "cancelled"
          ? "Search cancelled."
          : result.error.message;
        return;
      }

      const summary = result.value;
      if (summary.matches.length === 0 && summary.pagesScanned > 0 &&
          summary.pagesWithoutText === summary.pagesScanned) {
        searchStatus.textContent =
          "No selectable text was found in the scanned pages. This PDF may be image-only; OCR is not available.";
      } else if (summary.matches.length === 0) {
        searchStatus.textContent =
          "No matches in " + String(summary.pagesScanned) + " scanned pages.";
      } else {
        searchStatus.textContent =
          String(summary.matches.length) + " matches in " +
          String(summary.pagesScanned) + " scanned pages" +
          (summary.truncated ? " · result limit reached; refine the query to scan more." : ".");
      }

      for (const match of summary.matches) {
        const item = element(owner, "li", "reader-search-result");
        const button = createButton(owner, "", "reader-search-result-button");
        button.textContent =
          "Page " + String((match.pageIndex as number) + 1) + " · " +
          match.contextBefore.slice(-48) + match.text + match.contextAfter.slice(0, 64);
        button.addEventListener("click", () => {
          activeSearchMatch = match;
          jumpTo(match.pageIndex as number);
          const page = pages.get(match.pageIndex as number);
          if (page !== undefined && page.renderedScale === zoom) {
            paintSearchMatch(match.pageIndex as number, page);
          }
        });
        item.append(button);
        searchResults.append(item);
      }
    } finally {
      if (generation === searchGeneration) {
        searchController = null;
        searchButton.disabled = false;
        cancelSearchButton.disabled = true;
      }
    }
  }

  function onSelectionChange(): void {
    if (disposed || selectionFrame !== null) return;
    selectionFrame = owner.defaultView?.requestAnimationFrame(() => {
      selectionFrame = null;
      if (disposed) return;
      const browserSelection = owner.getSelection();
      if (browserSelection === null || browserSelection.isCollapsed || browserSelection.rangeCount === 0) {
        selectionStatus.textContent = "";
        options.onSelection?.([]);
        return;
      }

      const range = browserSelection.getRangeAt(0);
      const fragments: PdfTextSelection[] = [];
      for (const [index, page] of pages) {
        try {
          const mapped = mapPdfSelectionRange(
            range,
            page.root,
            page.layers.text,
            toPageIndex(index),
          );
          if (mapped !== null) fragments.push(mapped);
        } catch {
          // A page can be unmounted while selectionchange is being delivered.
        }
      }

      if (fragments.length === 0) {
        selectionStatus.textContent = "";
        options.onSelection?.([]);
        return;
      }

      const selectedCharacters = fragments.reduce((total, fragment) => total + fragment.exactText.length, 0);
      const pagesSelected = fragments.map((fragment) => String((fragment.pageIndex as number) + 1)).join(", ");
      selectionStatus.textContent =
        String(selectedCharacters) + " characters selected · page " + pagesSelected;
      options.onSelection?.(fragments);
    }) ?? null;
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
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void runSearch();
  });
  cancelSearchButton.addEventListener("click", () => {
    searchController?.abort();
  });
  searchInput.addEventListener("input", () => {
    if (searchInput.value.trim().length === 0) clearSearch();
  });
  owner.addEventListener("selectionchange", onSelectionChange);
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
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (renderFrame !== null) owner.defaultView?.cancelAnimationFrame(renderFrame);
      if (saveTimer !== null) owner.defaultView?.clearTimeout(saveTimer);
      searchController?.abort();
      searchController = null;
      searchGeneration += 1;
      if (selectionFrame !== null) owner.defaultView?.cancelAnimationFrame(selectionFrame);
      owner.removeEventListener("selectionchange", onSelectionChange);
      stage.removeEventListener("scroll", onScroll);
      stage.removeEventListener("keydown", onKeyDown);
      clearPagesExcept(new Set());
      pageHandleCache.clear();
    },
  };
}
