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
import { createPdfPageLayers } from "@shelf/pdf-engine";

interface ReaderWorkspaceOptions {
  readonly root: HTMLElement;
  readonly session: PdfDocumentSession;
  readonly renderer: PdfPageRenderer;
  readonly progressRepository: ReadingProgressRepositoryPort;
  readonly initialProgress: ReadingProgress | null;
  readonly onStatus: (message: string, isError?: boolean) => void;
  readonly onClose: () => void;
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
  stage.append(spacer);
  body.append(outline, stage);

  root.replaceChildren(documentHeading, toolbar, body);
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
    if (page.loading || disposed) return;
    page.loading = true;
    const handle = page.handle ?? await getPageHandle(index);
    page.loading = false;
    if (disposed || pages.get(index) !== page || handle === null) return;
    page.handle = handle;

    const changed = updateMeasuredSize(index, handle);
    const width = handle.geometry.width * zoom;
    const height = handle.geometry.height * zoom;
    const top = mode === "continuous" ? virtualizer.getPageTop(toPageIndex(index), zoom) : 0;
    positionPage(page, top, width);
    page.root.style.height = String(height) + "px";
    if (mode === "single-page") spacer.style.height = String(Math.max(stage.clientHeight, height + 32)) + "px";
    if (changed) scheduleRender();

    if (page.renderedScale === zoom) return;
    page.renderedScale = zoom;
    const result = await renderer.render(page.handle, page.layers, [], {
      scale: zoom,
      devicePixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
    });
    if (!result.ok && result.error.code !== "cancelled" && !disposed && pages.get(index) === page) {
      const message = element(owner, "p", "reader-page-error", result.error.message);
      page.root.append(message);
      onStatus(result.error.message, true);
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
      if (page.handle === null || page.renderedScale !== zoom) void renderMountedPage(index, page);
    }

    const firstVisible = window.firstVisibleIndex as number;
    if (firstVisible >= 0 && firstVisible < session.info.pageCount) currentPage = firstVisible;
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
    if (page.handle === null || page.renderedScale !== zoom) void renderMountedPage(currentPage, page);
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

  async function jumpTo(index: number): Promise<void> {
    if (!Number.isSafeInteger(index) || index < 0 || index >= session.info.pageCount) {
      onStatus("Enter a page number between 1 and " + session.info.pageCount + ".", true);
      syncControls();
      return;
    }
    currentPage = index;
    const handle = await ensurePageGeometry(index);
    if (handle === null) return;
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

  async function changeMode(nextMode: ReadingMode): Promise<void> {
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

  async function changeZoom(nextZoom: number): Promise<void> {
    const next = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(next - zoom) < 0.001) return;
    const position = readPosition();
    zoom = next;
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
    await changeZoom(clamp(available / handle.geometry.width, MIN_ZOOM, MAX_ZOOM));
  }

  async function fitPage(): Promise<void> {
    const handle = await ensurePageGeometry(currentPage);
    if (handle === null) return;
    const availableWidth = Math.max(1, stage.clientWidth - 48);
    const availableHeight = Math.max(1, stage.clientHeight - 48);
    const fit = Math.min(availableWidth / handle.geometry.width, availableHeight / handle.geometry.height);
    await changeZoom(clamp(fit, MIN_ZOOM, MAX_ZOOM));
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

  async function loadOutline(): Promise<void> {
    const result = await session.getOutline();
    if (disposed) return;
    outlineContent.replaceChildren();
    if (!result.ok) {
      outlineContent.append(element(owner, "p", "reader-outline-empty", "The document contents could not be loaded."));
    } else if (result.value.length === 0) {
      outlineContent.append(element(owner, "p", "reader-outline-empty", "This PDF does not contain a table of contents."));
    } else {
      appendOutlineItems(outlineContent, result.value);
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
  });
  closeButton.addEventListener("click", onClose);
  stage.addEventListener("scroll", onScroll, { passive: true });
  stage.addEventListener("keydown", onKeyDown);

  async function initialize(): Promise<void> {
    syncControls();
    const first = await ensurePageGeometry(currentPage);
    if (disposed) return;
    if (first !== null && mode === "continuous") {
      const size = virtualizer.getPageSize(toPageIndex(currentPage));
      stage.scrollTop = virtualizer.getPageTop(toPageIndex(currentPage), zoom) +
        initialOffset * size.height * zoom;
      lastScrollPosition = stage.scrollTop;
    }
    draw();
    await loadOutline();
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
      stage.removeEventListener("scroll", onScroll);
      stage.removeEventListener("keydown", onKeyDown);
      clearPagesExcept(new Set());
      pageHandleCache.clear();
    },
  };
}
