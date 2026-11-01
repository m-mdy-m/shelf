import {
  toOpaqueId,
  toPageIndex,
} from "@shelf/reader-core";
import type {
  Document,
  DocumentId,
  DocumentLocator,
  IdGeneratorPort,
  OpaqueId,
  ReaderError,
  Result,
} from "@shelf/reader-core";
import {
  createPdfJsRuntime,
  createPdfPageLayers,
  PdfDocumentAdapter,
  PdfPageRenderer,
  resolvePdfJsAssetUrls,
} from "@shelf/pdf-engine";
import type {
  PdfDocumentSession,
  PdfPageLayers,
} from "@shelf/pdf-engine";
import { DocumentLibraryService } from "@shelf/library";
import {
  BrowserDocumentSource,
  BrowserPdfPicker,
  IndexedDbShelfStore,
  WebCryptoSha256Digest,
} from "@shelf/platform-adapters";

function formatSize(bytes: number | null): string {
  if (bytes === null) return "Unknown size";
  if (bytes < 1024) return String(bytes) + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function sourceLabel(document: Document): string {
  return document.source.kind === "imported-copy" ? "Imported copy" : "External reference";
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function mountShelf(root: HTMLElement): void {
  const store = new IndexedDbShelfStore();
  const source = new BrowserDocumentSource(store);
  const picker = new BrowserPdfPicker();
  const ids: IdGeneratorPort = {
    next<Kind extends string>(kind: Kind): OpaqueId<Kind> {
      return toOpaqueId<Kind>(kind.toLowerCase() + "-" + globalThis.crypto.randomUUID());
    },
  };
  const library = new DocumentLibraryService({
    documents: store,
    locators: store,
    source,
    permissions: source,
    ids,
    clock: { now: () => Date.now() },
    digest: new WebCryptoSha256Digest(),
    cleanup: source,
  });
  const runtime = createPdfJsRuntime(resolvePdfJsAssetUrls(document.baseURI));
  const pdf = new PdfDocumentAdapter(runtime, source, store, {
    passwordPrompt: async () => window.prompt("Enter the PDF password"),
  });
  const renderer = new PdfPageRenderer(runtime);

  let activeSession: PdfDocumentSession | null = null;
  let activeLayers: PdfPageLayers | null = null;

  const main = createElement("main", "shelf-shell");
  const header = createElement("header", "shelf-header");
  const brand = createElement("div", "shelf-brand");
  const mark = createElement("img", "shelf-mark") as HTMLImageElement;
  mark.src = "/brand/shelf-mark.svg";
  mark.alt = "";
  mark.width = 44;
  mark.height = 44;
  const headingGroup = createElement("div", "shelf-heading");
  const title = createElement("h1", "shelf-title", "Shelf");
  const description = createElement("p", "shelf-description", "A private, local-first home for your PDFs.");
  headingGroup.append(title, description);
  brand.append(mark, headingGroup);

  const actions = createElement("div", "shelf-actions");
  const importButton = createElement("button", "button button-primary", "Import a copy") as HTMLButtonElement;
  importButton.type = "button";
  const referenceButton = createElement("button", "button button-secondary", "Link original file") as HTMLButtonElement;
  referenceButton.type = "button";
  referenceButton.hidden = !picker.canPickReference;
  actions.append(importButton, referenceButton);
  header.append(brand, actions);

  const status = createElement("p", "shelf-status", "Your library is stored on this device.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const librarySection = createElement("section", "library-section");
  const libraryHeading = createElement("div", "section-heading");
  const libraryTitle = createElement("h2", "section-title", "Your library");
  const libraryHint = createElement("p", "section-hint", "PDF files remain on this device. No account or upload is required.");
  libraryHeading.append(libraryTitle, libraryHint);
  const list = createElement("div", "document-list");
  librarySection.append(libraryHeading, list);

  const viewer = createElement("section", "reader-viewer");
  viewer.hidden = true;
  viewer.setAttribute("aria-label", "PDF reader preview");

  main.append(header, status, librarySection, viewer);
  root.replaceChildren(main);

  function setStatus(message: string, isError = false): void {
    status.textContent = message;
    status.classList.toggle("shelf-status-error", isError);
  }

  async function closeActiveDocument(): Promise<void> {
    if (activeLayers !== null) renderer.cancel(activeLayers);
    if (activeSession !== null) await activeSession.close();
    activeLayers = null;
    activeSession = null;
    viewer.replaceChildren();
    viewer.hidden = true;
  }

  async function openDocument(id: DocumentId): Promise<void> {
    await closeActiveDocument();
    setStatus("Opening the local PDF…");

    const access = await library.openDocument(id);
    if (!access.ok) {
      setStatus(access.error.message, true);
      return;
    }
    const permissionClosed = await library.closeDocument(access.value.source);
    if (!permissionClosed.ok) {
      setStatus(permissionClosed.error.message, true);
      return;
    }

    const opened = await pdf.open(id);
    if (!opened.ok) {
      setStatus(opened.error.message, true);
      return;
    }
    activeSession = opened.value;

    const firstPage = await activeSession.getPage(toPageIndex(0));
    if (!firstPage.ok) {
      setStatus(firstPage.error.message, true);
      await closeActiveDocument();
      return;
    }

    viewer.replaceChildren();
    const viewerHeader = createElement("div", "viewer-header");
    const viewerInfo = createElement("div", "viewer-info");
    const viewerTitle = createElement("h2", "viewer-title", opened.value.info.title ?? opened.value.info.displayName ?? "Untitled PDF");
    const viewerMeta = createElement("p", "viewer-meta", String(opened.value.info.pageCount) + " pages · " + formatSize(opened.value.info.sizeBytes));
    viewerInfo.append(viewerTitle, viewerMeta);
    const closeButton = createElement("button", "button button-small", "Close document") as HTMLButtonElement;
    closeButton.type = "button";
    closeButton.addEventListener("click", () => {
      void closeActiveDocument();
      setStatus("The PDF was closed. Your library remains available offline.");
    });
    viewerHeader.append(viewerInfo, closeButton);

    const stage = createElement("div", "viewer-stage");
    const pageRoot = createElement("div", "viewer-page");
    stage.append(pageRoot);
    viewer.append(viewerHeader, stage);
    viewer.hidden = false;

    activeLayers = createPdfPageLayers(pageRoot);
    const rendered = await renderer.render(firstPage.value, activeLayers, [], {
      scale: 1,
      devicePixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
    });
    if (!rendered.ok) {
      setStatus(rendered.error.message, true);
      await closeActiveDocument();
      return;
    }
    setStatus("Opened locally. The first page is rendered; navigation controls are the next Reader step.");
  }

  async function importPickedFile(mode: "imported-copy" | "external-reference"): Promise<void> {
    importButton.disabled = true;
    referenceButton.disabled = true;
    setStatus(mode === "imported-copy" ? "Importing a local copy…" : "Registering the original file…");

    let locatorResult: Result<DocumentLocator, ReaderError>;
    if (mode === "imported-copy") {
      const picked = await picker.pickCopy();
      if (!picked.ok) {
        setStatus(picked.error.message, picked.error.code !== "cancelled");
        importButton.disabled = false;
        referenceButton.disabled = !picker.canPickReference;
        return;
      }
      locatorResult = await source.registerCopy(picked.value);
    } else {
      const picked = await picker.pickReference();
      if (!picked.ok) {
        setStatus(picked.error.message, picked.error.code !== "cancelled");
        importButton.disabled = false;
        referenceButton.disabled = !picker.canPickReference;
        return;
      }
      locatorResult = await source.registerReference(picked.value);
    }

    if (!locatorResult.ok) {
      setStatus(locatorResult.error.message, true);
    } else {
      const imported = await library.importDocument({
        locator: locatorResult.value,
        sourceKind: mode,
      });
      if (!imported.ok) {
        await source.discard(locatorResult.value);
        setStatus(imported.error.message, true);
      } else {
        setStatus(
          imported.value.duplicate
            ? "This PDF is already in your library. The existing entry was kept."
            : (mode === "imported-copy"
              ? "A local copy was imported successfully."
              : "The original file was linked successfully."),
        );
        await refreshLibrary();
      }
    }

    importButton.disabled = false;
    referenceButton.disabled = !picker.canPickReference;
  }

  async function refreshLibrary(): Promise<void> {
    const result = await library.listDocuments();
    if (!result.ok) {
      setStatus(result.error.message, true);
      return;
    }
    list.replaceChildren();
    if (result.value.length === 0) {
      const empty = createElement(
        "div",
        "library-empty",
        "No PDFs yet. Import a copy or link an original file to get started.",
      );
      list.append(empty);
      return;
    }
    for (const item of result.value) {
      const card = createElement("article", "document-card");
      const details = createElement("div", "document-details");
      const name = createElement("h3", "document-name", item.metadata.title);
      const metadata = createElement(
        "p",
        "document-metadata",
        sourceLabel(item) + " · " + formatSize(item.source.sizeBytes),
      );
      details.append(name, metadata);
      const open = createElement("button", "button button-small", "Open") as HTMLButtonElement;
      open.type = "button";
      open.addEventListener("click", () => {
        void openDocument(item.id);
      });
      card.append(details, open);
      list.append(card);
    }
  }

  importButton.addEventListener("click", () => {
    void importPickedFile("imported-copy");
  });
  referenceButton.addEventListener("click", () => {
    void importPickedFile("external-reference");
  });
  window.addEventListener("pagehide", () => {
    if (activeLayers !== null) renderer.cancel(activeLayers);
    if (activeSession !== null) void activeSession.close();
  }, { once: true });

  void refreshLibrary();
}
