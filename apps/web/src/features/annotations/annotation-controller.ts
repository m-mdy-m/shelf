import type {
  Annotation,
  Bookmark,
  DocumentId,
  PageIndex,
  Quote,
  ReaderAnnotationUseCases,
  TextAnchor,
  TextSelection,
} from "@shelf/reader-core";
import { createSelectionActions } from "./components/selection-actions.js";
import { createSavedItemsPanel } from "./components/saved-items-panel.js";

export interface ReaderAnnotationsFeatureOptions {
  readonly owner: Document;
  readonly toolbar: HTMLElement;
  readonly selectionPanel: HTMLElement;
  readonly readerPanels: HTMLElement;
  readonly documentId: DocumentId;
  readonly useCases: ReaderAnnotationUseCases;
  readonly getCurrentPage: () => PageIndex;
  readonly getSelection: () => TextSelection | null;
  readonly jumpToPage: (pageIndex: PageIndex) => void;
  readonly onPageChanged: (pageIndex: PageIndex) => void;
  readonly onStatus: (message: string, isError?: boolean) => void;
}

export interface ReaderAnnotationsController {
  refresh(): Promise<void>;
  setSelection(selection: TextSelection | null): void;
  getAnnotations(pageIndex: PageIndex): readonly Annotation[];
  setAnchorState(annotationId: string, state: string): void;
  dispose(): void;
}

function toTextAnchor(selection: TextSelection): TextAnchor {
  return {
    selectedText: selection.selectedText,
    normalizedText: selection.normalizedText,
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
    documentFingerprint: selection.documentFingerprint,
    anchorVersion: selection.anchorVersion,
  };
}

function createButton(owner: Document, label: string): HTMLButtonElement {
  const button = owner.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = [
    "inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300",
    "bg-white px-3 py-2 text-sm font-medium text-stone-800 shadow-sm",
    "hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2",
    "focus-visible:outline-emerald-700",
  ].join(" ");
  return button;
}

/** Web-only composition of the platform-independent Reader annotation use cases. */
export function mountReaderAnnotationsFeature(
  options: ReaderAnnotationsFeatureOptions,
): ReaderAnnotationsController {
  const {
    owner,
    toolbar,
    selectionPanel,
    readerPanels,
    documentId,
    useCases,
    getCurrentPage,
    getSelection,
    jumpToPage,
    onPageChanged,
    onStatus,
  } = options;

  let bookmarks: readonly Bookmark[] = [];
  let annotations: readonly Annotation[] = [];
  let quotes: readonly Quote[] = [];
  let selection: TextSelection | null = null;
  let disposed = false;
  const anchorStates = new Map<string, string>();

  const toolbarGroup = owner.createElement("div");
  toolbarGroup.className = "flex flex-wrap items-center gap-2";
  const bookmarkButton = createButton(owner, "Bookmark page");
  const savedToggle = createButton(owner, "Saved items");
  savedToggle.setAttribute("aria-expanded", "false");
  toolbarGroup.append(bookmarkButton, savedToggle);
  toolbar.append(toolbarGroup);

  const actions = createSelectionActions(owner, {
    onHighlight: () => void saveHighlight(),
    onNote: () => void saveNote(),
    onQuote: () => void saveQuote(),
  });
  selectionPanel.append(actions.element);

  const savedPanel = createSavedItemsPanel(owner, {
    onOpenBookmark: (bookmark) => jumpToPage(bookmark.pageIndex),
    onEditBookmark: (bookmark) => void editBookmark(bookmark),
    onDeleteBookmark: (bookmark) => void deleteBookmark(bookmark),
    onOpenAnnotation: (annotation) => jumpToPage(annotation.pageIndex),
    onEditAnnotation: (annotation) => void editAnnotation(annotation),
    onDeleteAnnotation: (annotation) => void deleteAnnotation(annotation),
    onOpenQuote: (quote) => jumpToPage(quote.pageIndex),
    onDeleteQuote: (quote) => void deleteQuote(quote),
  });
  savedToggle.setAttribute("aria-controls", savedPanel.element.id);
  readerPanels.append(savedPanel.element);

  function renderSavedItems(): void {
    savedPanel.render({ bookmarks, annotations, quotes, anchorStates });
  }

  let savedItemsRenderQueued = false;
  function scheduleSavedItemsRender(): void {
    if (savedItemsRenderQueued || savedPanel.element.hidden) return;
    savedItemsRenderQueued = true;
    void Promise.resolve().then(() => {
      savedItemsRenderQueued = false;
      if (!disposed && !savedPanel.element.hidden) renderSavedItems();
    });
  }

  function setSelection(next: TextSelection | null): void {
    selection = next;
    actions.setEnabled(next !== null);
  }

  async function saveBookmark(): Promise<void> {
    const pageIndex = getCurrentPage();
    const selected = getSelection();
    const selectedAnchor = selected !== null && selected.pageIndex === pageIndex
      ? toTextAnchor(selected)
      : null;
    const result = await useCases.addBookmark({
      documentId,
      pageIndex,
      label: null,
      anchor: selectedAnchor,
    });
    if (disposed) return;
    if (!result.ok) {
      onStatus(result.error.message, true);
      return;
    }
    bookmarks = [...bookmarks, result.value];
    renderSavedItems();
    onStatus("Bookmark saved for page " + String(pageIndex + 1) + ".");
  }

  async function saveHighlight(): Promise<void> {
    const selected = selection;
    if (selected === null) return;
    const result = await useCases.saveAnnotation({
      documentId,
      pageIndex: selected.pageIndex,
      kind: "highlight",
      color: "yellow",
      anchor: toTextAnchor(selected),
      rectangles: selected.rectangles,
    });
    if (disposed) return;
    if (!result.ok) {
      onStatus(result.error.message, true);
      return;
    }
    annotations = [...annotations, result.value];
    renderSavedItems();
    onPageChanged(selected.pageIndex);
    onStatus("Highlight saved.");
  }

  async function saveNote(): Promise<void> {
    const selected = selection;
    if (selected === null) return;
    const content = owner.defaultView?.prompt("Write a note about this passage", "") ?? null;
    if (content === null) return;
    const result = await useCases.saveAnnotation({
      documentId,
      pageIndex: selected.pageIndex,
      kind: "note",
      content,
      anchor: toTextAnchor(selected),
      rectangles: selected.rectangles,
    });
    if (disposed) return;
    if (!result.ok) {
      onStatus(result.error.message, true);
      return;
    }
    annotations = [...annotations, result.value];
    renderSavedItems();
    onPageChanged(selected.pageIndex);
    onStatus("Passage note saved.");
  }

  async function saveQuote(): Promise<void> {
    const selected = selection;
    if (selected === null) return;
    const result = await useCases.addQuote({
      documentId,
      pageIndex: selected.pageIndex,
      text: selected.selectedText,
      attribution: null,
      annotationId: null,
      anchor: toTextAnchor(selected),
      tags: [],
    });
    if (disposed) return;
    if (!result.ok) {
      onStatus(result.error.message, true);
      return;
    }
    quotes = [...quotes, result.value];
    renderSavedItems();
    onStatus("Quote saved.");
  }

  async function editBookmark(bookmark: Bookmark): Promise<void> {
    const label = owner.defaultView?.prompt("Bookmark label", bookmark.label ?? "") ?? null;
    if (label === null) return;
    const result = await useCases.updateBookmark({ ...bookmark, label: label.trim() || null });
    if (disposed) return;
    if (!result.ok) {
      onStatus(result.error.message, true);
      return;
    }
    bookmarks = bookmarks.map((item) => item.id === bookmark.id ? result.value : item);
    renderSavedItems();
    onStatus("Bookmark updated.");
  }

  async function deleteBookmark(bookmark: Bookmark): Promise<void> {
    if (!(owner.defaultView?.confirm("Delete this bookmark?") ?? false)) return;
    const result = await useCases.deleteBookmark(bookmark.id);
    if (disposed) return;
    if (!result.ok) {
      onStatus(result.error.message, true);
      return;
    }
    bookmarks = bookmarks.filter((item) => item.id !== bookmark.id);
    renderSavedItems();
    onStatus("Bookmark deleted.");
  }

  async function editAnnotation(annotation: Annotation): Promise<void> {
    let updated: Annotation;
    if (annotation.kind === "highlight") {
      const color = owner.defaultView?.prompt(
        "Highlight color: yellow, green, blue, pink, or purple",
        annotation.color,
      ) ?? null;
      if (color === null) return;
      const normalizedColor = color.trim().toLowerCase();
      const supportedColors: readonly string[] = ["yellow", "green", "blue", "pink", "purple"];
      if (!supportedColors.includes(normalizedColor)) {
        onStatus("Choose one of: yellow, green, blue, pink, purple.", true);
        return;
      }
      updated = { ...annotation, color: normalizedColor as typeof annotation.color };
    } else {
      const content = owner.defaultView?.prompt("Edit passage note", annotation.content) ?? null;
      if (content === null) return;
      updated = { ...annotation, content };
    }
    const result = await useCases.updateAnnotation(updated);
    if (disposed) return;
    if (!result.ok) {
      onStatus(result.error.message, true);
      return;
    }
    annotations = annotations.map((item) => item.id === annotation.id ? result.value : item);
    renderSavedItems();
    onPageChanged(annotation.pageIndex);
    onStatus("Annotation updated.");
  }

  async function deleteAnnotation(annotation: Annotation): Promise<void> {
    if (!(owner.defaultView?.confirm("Delete this annotation?") ?? false)) return;
    const result = await useCases.deleteAnnotation(annotation.id);
    if (disposed) return;
    if (!result.ok) {
      onStatus(result.error.message, true);
      return;
    }
    annotations = annotations.filter((item) => item.id !== annotation.id);
    anchorStates.delete(annotation.id);
    renderSavedItems();
    onPageChanged(annotation.pageIndex);
    onStatus("Annotation deleted.");
  }

  async function deleteQuote(quote: Quote): Promise<void> {
    if (!(owner.defaultView?.confirm("Delete this saved quote?") ?? false)) return;
    const result = await useCases.deleteQuote(quote.id);
    if (disposed) return;
    if (!result.ok) {
      onStatus(result.error.message, true);
      return;
    }
    quotes = quotes.filter((item) => item.id !== quote.id);
    renderSavedItems();
    onStatus("Quote deleted.");
  }

  bookmarkButton.addEventListener("click", () => void saveBookmark());
  savedToggle.addEventListener("click", () => {
    savedPanel.element.hidden = !savedPanel.element.hidden;
    savedToggle.setAttribute("aria-expanded", String(!savedPanel.element.hidden));
    if (!savedPanel.element.hidden) renderSavedItems();
  });

  return {
    async refresh(): Promise<void> {
      const [bookmarkResult, annotationResult, quoteResult] = await Promise.all([
        useCases.listBookmarks(documentId),
        useCases.listAnnotations(documentId),
        useCases.listQuotes(documentId),
      ]);
      if (disposed) return;
      bookmarks = bookmarkResult.ok ? bookmarkResult.value : [];
      annotations = annotationResult.ok ? annotationResult.value : [];
      quotes = quoteResult.ok ? quoteResult.value : [];
      if (!bookmarkResult.ok || !annotationResult.ok || !quoteResult.ok) {
        onStatus("Some saved Reader items could not be restored. Other available items remain accessible.", true);
      }
      renderSavedItems();
      for (const pageIndex of new Set(annotations.map((annotation) => annotation.pageIndex))) {
        onPageChanged(pageIndex);
      }
    },
    setSelection,
    getAnnotations(pageIndex) {
      return annotations.filter((annotation) => annotation.pageIndex === pageIndex);
    },
    setAnchorState(annotationId, state) {
      if (disposed || anchorStates.get(annotationId) === state) return;
      anchorStates.set(annotationId, state);
      scheduleSavedItemsRender();
    },
    dispose() {
      disposed = true;
      selection = null;
      toolbarGroup.remove();
      actions.element.remove();
      savedPanel.element.remove();
    },
  };
}
