import { ReaderAnnotationService, toOpaqueId } from "@shelf/reader-core";
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
  PdfDocumentAdapter,
  PdfPageRenderer,
  resolvePdfJsAssetUrls,
} from "@shelf/pdf-engine";
import type { PdfDocumentSession } from "@shelf/pdf-engine";
import { mountReaderWorkspace } from "./reader-workspace.js";
import { mountLibraryCatalog } from "./features/library/library-catalog.js";
import { DocumentLibraryService } from "@shelf/library";
import {
  BrowserDocumentSource,
  BrowserPdfPicker,
  IndexedDbShelfStore,
  createIndexedDbReaderRepositories,
  WebCryptoSha256Digest,
} from "@shelf/platform-adapters";

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
  const readerRepositories = createIndexedDbReaderRepositories(store);
  const annotationUseCases = new ReaderAnnotationService({
    ...readerRepositories,
    ids,
    clock: { now: () => Date.now() },
  });
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
  let activeWorkspace: ReturnType<typeof mountReaderWorkspace> | null = null;
  let documentLoadAttempt = 0;

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
  const exportButton = createElement("button", "button button-secondary", "Export Reader data") as HTMLButtonElement;
  exportButton.type = "button";
  const restoreButton = createElement("button", "button button-secondary", "Restore backup") as HTMLButtonElement;
  restoreButton.type = "button";
  const restoreInput = createElement("input", "visually-hidden") as HTMLInputElement;
  restoreInput.type = "file";
  restoreInput.hidden = true;
  restoreInput.accept = "application/json,.json";
  restoreInput.setAttribute("aria-label", "Choose a Shelf Reader backup");
  actions.append(importButton, referenceButton, exportButton, restoreButton, restoreInput);
  header.append(brand, actions);

  const status = createElement("p", "shelf-status", "Your library is stored on this device.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const librarySection = createElement("section", "library-section");

  const viewer = createElement("section", "reader-viewer");
  viewer.hidden = true;
  viewer.setAttribute("aria-label", "PDF reader preview");

  main.append(header, status, librarySection, viewer);
  root.replaceChildren(main);

  function setStatus(message: string, isError = false): void {
    status.textContent = message;
    status.classList.toggle("shelf-status-error", isError);
  }

  async function closeActiveDocument(invalidatePendingOpen = true): Promise<void> {
    if (invalidatePendingOpen) documentLoadAttempt += 1;
    const workspace = activeWorkspace;
    const session = activeSession;
    activeWorkspace = null;
    activeSession = null;

    if (workspace !== null) {
      workspace.dispose();
      await workspace.persist();
    }
    if (session !== null) await session.close();
    main.classList.remove("reader-active");
    document.body.classList.remove("reader-active");
    viewer.replaceChildren();
    viewer.hidden = true;
  }

  async function openDocument(id: DocumentId): Promise<void> {
    const attempt = ++documentLoadAttempt;
    const isCurrentAttempt = (): boolean => attempt === documentLoadAttempt;
    await closeActiveDocument(false);
    if (!isCurrentAttempt()) return;
    setStatus("Opening the local PDF…");

    const access = await library.openDocument(id);
    if (!isCurrentAttempt()) {
      if (access.ok) await library.closeDocument(access.value.source);
      return;
    }
    if (!access.ok) {
      const record = await library.getDocument(id);
      if (!isCurrentAttempt()) return;
      const sourceKind = record.ok ? record.value?.source.kind : undefined;
      const explanation = sourceKind === "external-reference"
        ? "The linked original PDF is unavailable or its permission has expired. Relink the original file or import a local copy. "
        : sourceKind === "imported-copy"
          ? "Shelf could not read the imported local PDF copy. Re-import it if the source is damaged. "
          : "";
      setStatus(explanation + access.error.message, true);
      return;
    }

    const savedProgress = await store.getByDocumentId(id);
    if (!isCurrentAttempt()) {
      await library.closeDocument(access.value.source);
      return;
    }
    if (!savedProgress.ok) {
      await library.closeDocument(access.value.source);
      setStatus(savedProgress.error.message, true);
      return;
    }

    // Ownership of the permission-checked source handle transfers to the PDF
    // adapter. It releases the handle on every failed open and the session
    // releases it on close; do not close it a second time here.
    const opened = await pdf.open(id, access.value.source);
    if (!isCurrentAttempt()) {
      if (opened.ok) await opened.value.close();
      return;
    }
    if (!opened.ok) {
      setStatus(opened.error.message, true);
      return;
    }

    activeSession = opened.value;
    main.classList.add("reader-active");
    document.body.classList.add("reader-active");
    viewer.hidden = false;
    activeWorkspace = mountReaderWorkspace({
      root: viewer,
      session: opened.value,
      renderer,
      progressRepository: store,
      annotationUseCases,
      initialProgress: savedProgress.value,
      onStatus: (message, isError = false) => {
        if (isCurrentAttempt() && activeSession === opened.value) setStatus(message, isError);
      },
      onClose: () => {
        if (!isCurrentAttempt() || activeSession !== opened.value) return;
        void closeActiveDocument();
        setStatus("The PDF was closed. Your library remains available offline.");
      },
    });
    await libraryCatalog.markOpened(id);
    void syncDocumentPageCount(id, opened.value.info.pageCount);
  }

  const libraryCatalog = mountLibraryCatalog(librarySection, {
    store,
    onOpenDocument: (id) => { void openDocument(id); },
    onStatus: setStatus,
  });

  async function syncDocumentPageCount(documentId: DocumentId, pageCount: number): Promise<void> {
    if (!Number.isSafeInteger(pageCount) || pageCount <= 0) return;
    const current = await store.getById(documentId);
    if (!current.ok) {
      setStatus(current.error.message, true);
      return;
    }
    if (current.value === null || current.value.metadata.pageCount === pageCount) return;
    const updated: Document = {
      ...current.value,
      metadata: { ...current.value.metadata, pageCount },
      updatedAt: Date.now(),
    };
    const saved = await store.save(updated);
    if (!saved.ok) {
      setStatus(saved.error.message, true);
      return;
    }
    await libraryCatalog.refresh();
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
    await libraryCatalog.refresh();
  }

  importButton.addEventListener("click", () => {
    void importPickedFile("imported-copy");
  });
  referenceButton.addEventListener("click", () => {
    void importPickedFile("external-reference");
  });
  exportButton.addEventListener("click", () => {
    void (async () => {
      if (activeWorkspace !== null) await activeWorkspace.persist();
      const exported = await store.exportReaderData();
      if (!exported.ok) {
        setStatus(exported.error.message, true);
        return;
      }
      const blob = new Blob([JSON.stringify(exported.value, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const download = createElement("a", "") as HTMLAnchorElement;
      download.hidden = true;
      download.href = url;
      download.download = "shelf-reader-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      root.append(download);
      download.click();
      download.remove();
      URL.revokeObjectURL(url);
      setStatus("Reader data exported. PDF bytes, original file handles, and access locators are not included.");
    })();
  });
  restoreButton.addEventListener("click", () => restoreInput.click());
  restoreInput.addEventListener("change", () => {
    void (async () => {
      const file = restoreInput.files?.[0];
      restoreInput.value = "";
      if (file === undefined) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text()) as unknown;
      } catch {
        setStatus("The selected backup is not valid JSON.", true);
        return;
      }
      if (!window.confirm(
        "Restore this Shelf backup? It replaces the current Reader library and saved Reader data. PDF bytes and file permissions are not restored.",
      )) return;
      await closeActiveDocument();
      const restored = await store.restoreReaderData(parsed);
      if (!restored.ok) {
        setStatus(restored.error.message, true);
        return;
      }
      await refreshLibrary();
      setStatus(
        "Backup restored: " + String(restored.value.documents) + " documents, " +
        String(restored.value.bookmarks) + " bookmarks, " +
        String(restored.value.annotations) + " annotations, " +
        String(restored.value.quotes) + " quotes, " +
        String(restored.value.libraryEntries) + " book records, and " +
        String(restored.value.savedLibraryViews) + " saved views. Re-link local PDFs whose source is unavailable.",
      );
    })();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden" || activeWorkspace === null) return;
    void activeWorkspace.persist();
  });

  window.addEventListener("pagehide", () => {
    const workspace = activeWorkspace;
    const session = activeSession;
    activeWorkspace = null;
    activeSession = null;
    main.classList.remove("reader-active");
    document.body.classList.remove("reader-active");

    // pagehide is a last-chance signal: release UI/render resources
    // synchronously, then make a best-effort final IndexedDB write.
    if (workspace !== null) {
      workspace.dispose();
      void workspace.persist();
    }
    if (session !== null) void session.close();
  }, { once: true });

  void refreshLibrary();
}
