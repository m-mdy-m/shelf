import {
  DEFAULT_LIBRARY_FILTERS,
  createDefaultLibraryEntry,
  deriveLibraryProgress,
  filterLibraryItems,
} from "@shelf/reader-core";
import type {
  Document,
  DocumentId,
  LibraryCatalogItem,
  LibraryEntry,
  LibraryFilters,
  LibraryReadingStatus,
  SavedLibraryView,
} from "@shelf/reader-core";
import type { IndexedDbShelfStore } from "@shelf/platform-adapters";
import { MAX_LIBRARY_README_CHARACTERS, renderSafeMarkdown } from "./safe-markdown.js";

export interface LibraryCatalogController {
  refresh(): Promise<void>;
  markOpened(documentId: DocumentId): Promise<void>;
}

interface LibraryCatalogOptions {
  readonly store: IndexedDbShelfStore;
  readonly onOpenDocument: (documentId: DocumentId) => void;
  readonly onStatus: (message: string, isError?: boolean) => void;
}

const STATUS_LABELS: Record<LibraryReadingStatus, string> = {
  "not-started": "Not started",
  reading: "Reading",
  "on-hold": "On hold",
  completed: "Completed",
  reference: "Reference",
};

const STATUS_ORDER: readonly LibraryReadingStatus[] = [
  "not-started", "reading", "on-hold", "completed", "reference",
];

function element<K extends keyof HTMLElementTagNameMap>(
  owner: HTMLElement["ownerDocument"],
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = owner.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(owner: HTMLElement["ownerDocument"], label: string, className = "button button-small"): HTMLButtonElement {
  const node = element(owner, "button", className, label);
  node.type = "button";
  return node;
}

function addOptions(
  select: HTMLSelectElement,
  items: readonly { readonly value: string; readonly label: string }[],
): void {
  select.replaceChildren();
  for (const item of items) {
    const option = select.ownerDocument.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.append(option);
  }
}

function parseCommaSeparated(value: string, maximum: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const item = part.trim().replace(/^#/, "").slice(0, 80);
    const key = item.normalize("NFKC").toLocaleLowerCase();
    if (item.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= maximum) break;
  }
  return result;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return "Size unavailable";
  if (bytes < 1024) return String(bytes) + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDate(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return "Not opened yet";
  return "Last opened " + new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function displayTitle(item: LibraryCatalogItem): string {
  return item.entry.titleOverride?.trim() ||
    item.document.metadata.title ||
    item.document.source.displayName ||
    "Untitled PDF";
}

function displayAuthors(item: LibraryCatalogItem): readonly string[] {
  return item.entry.authorsOverride ?? item.document.metadata.authors;
}

function statusOptionElements(owner: HTMLElement["ownerDocument"]): HTMLOptionElement[] {
  return STATUS_ORDER.map((status) => {
    const option = owner.createElement("option");
    option.value = status;
    option.textContent = STATUS_LABELS[status];
    return option;
  });
}

function makeReadmeTemplate(title: string): string {
  return [
    "# " + title.trim(),
    "",
    "## Overview",
    "",
    "Add a short description of this book and why it belongs in your library.",
    "",
    "## Reading goals",
    "",
    "- What do you want to learn?",
    "- Which ideas should you revisit?",
    "",
    "## Notes",
    "",
  ].join("\n");
}

function downloadReadme(owner: HTMLElement["ownerDocument"], root: HTMLElement, title: string, markdown: string): void {
  const safeName = (title.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "") || "book").slice(0, 80);
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const anchor = owner.createElement("a");
  anchor.hidden = true;
  anchor.href = url;
  anchor.download = safeName + "-README.md";
  root.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function field<K extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
  owner: HTMLElement["ownerDocument"],
  parent: HTMLElement,
  labelText: string,
  control: K,
  hint?: string,
): K {
  const wrapper = element(owner, "label", "library-detail-field");
  const label = element(owner, "span", "library-detail-label", labelText);
  wrapper.append(label, control);
  if (hint !== undefined) wrapper.append(element(owner, "span", "library-detail-hint", hint));
  parent.append(wrapper);
  return control;
}

export function mountLibraryCatalog(
  root: HTMLElement,
  options: LibraryCatalogOptions,
): LibraryCatalogController {
  const owner = root.ownerDocument;
  const { store, onOpenDocument, onStatus } = options;
  let items: LibraryCatalogItem[] = [];
  let savedViews: SavedLibraryView[] = [];
  let filters: LibraryFilters = { ...DEFAULT_LIBRARY_FILTERS };
  let layout: "grid" | "list" = "grid";
  let loading = false;

  root.classList.add("library-catalog");

  const heading = element(owner, "div", "library-catalog-heading");
  const headingCopy = element(owner, "div", "library-catalog-heading-copy");
  headingCopy.append(
    element(owner, "span", "library-eyebrow", "PERSONAL LIBRARY"),
    element(owner, "h2", "library-catalog-title", "Your books"),
    element(owner, "p", "library-catalog-hint", "A book-first view of your PDFs, notes and reading progress."),
  );
  const count = element(owner, "span", "library-result-count", "0 books");
  heading.append(headingCopy, count);

  const summary = element(owner, "div", "library-summary");
  const summaryMetrics = element(owner, "div", "library-summary-metrics");
  summary.append(summaryMetrics);

  const toolbar = element(owner, "div", "library-toolbar");
  const searchLabel = element(owner, "label", "library-search");
  searchLabel.append(element(owner, "span", "visually-hidden", "Search library"));
  const search = element(owner, "input", "library-search-input");
  search.type = "search";
  search.placeholder = "Search books, authors, tags or README";
  search.setAttribute("aria-label", "Search books, authors, tags or README");
  searchLabel.append(search);

  const statusFilter = element(owner, "select", "library-filter-select") as HTMLSelectElement;
  addOptions(statusFilter, [
    { value: "all", label: "All statuses" },
    ...STATUS_ORDER.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
  ]);
  statusFilter.setAttribute("aria-label", "Filter by reading status");

  const authorFilter = element(owner, "input", "library-filter-input") as HTMLInputElement;
  authorFilter.type = "search";
  authorFilter.placeholder = "Author";
  authorFilter.setAttribute("aria-label", "Filter by author");

  const tagFilter = element(owner, "select", "library-filter-select") as HTMLSelectElement;
  tagFilter.setAttribute("aria-label", "Filter by tag");
  addOptions(tagFilter, [{ value: "all", label: "All tags" }]);

  const progressFilter = element(owner, "select", "library-filter-select") as HTMLSelectElement;
  progressFilter.setAttribute("aria-label", "Filter by progress");
  addOptions(progressFilter, [
    { value: "all", label: "Any progress" },
    { value: "not-started", label: "Not started" },
    { value: "in-progress", label: "In progress" },
    { value: "completed", label: "Complete" },
  ]);

  const formatFilter = element(owner, "select", "library-filter-select") as HTMLSelectElement;
  formatFilter.setAttribute("aria-label", "Filter by book files");
  addOptions(formatFilter, [
    { value: "all", label: "All files" },
    { value: "pdf", label: "PDF" },
    { value: "readme", label: "README" },
    { value: "complete", label: "PDF + README" },
  ]);

  const sortFilter = element(owner, "select", "library-filter-select") as HTMLSelectElement;
  sortFilter.setAttribute("aria-label", "Sort library");
  addOptions(sortFilter, [
    { value: "recent", label: "Recently added" },
    { value: "last-opened", label: "Last opened" },
    { value: "title", label: "Title" },
    { value: "author", label: "Author" },
    { value: "progress", label: "Progress" },
  ]);

  const clearFiltersButton = button(owner, "Clear filters", "button button-secondary library-clear-filters");
  const gridButton = button(owner, "Grid", "button button-small library-layout-button is-active");
  const listButton = button(owner, "List", "button button-small library-layout-button");
  gridButton.setAttribute("aria-pressed", "true");
  listButton.setAttribute("aria-pressed", "false");
  const layoutToggle = element(owner, "div", "library-layout-toggle");
  layoutToggle.setAttribute("role", "group");
  layoutToggle.setAttribute("aria-label", "Library layout");
  layoutToggle.append(gridButton, listButton);

  const advancedFilters = element(owner, "details", "library-advanced-filters");
  const advancedFiltersSummary = element(owner, "summary", "library-advanced-filters-toggle", "More filters");
  const advancedFiltersContent = element(owner, "div", "library-advanced-filters-content");
  advancedFiltersContent.append(statusFilter, authorFilter, tagFilter, progressFilter, formatFilter);
  advancedFilters.append(advancedFiltersSummary, advancedFiltersContent);

  toolbar.append(searchLabel, sortFilter, clearFiltersButton, layoutToggle, advancedFilters);

  const quickFilters = element(owner, "div", "library-quick-filters");
  quickFilters.setAttribute("role", "group");
  quickFilters.setAttribute("aria-label", "Quick status filters");

  const viewsSection = element(owner, "section", "library-saved-views");
  const viewsHeader = element(owner, "div", "library-saved-views-header");
  viewsHeader.append(
    element(owner, "h3", "library-section-title", "Saved views"),
    element(owner, "p", "library-section-hint", "Save a filter combination and return to it later."),
  );
  const viewsBar = element(owner, "div", "library-saved-view-list");
  const saveViewForm = element(owner, "form", "library-save-view-form");
  const viewName = element(owner, "input", "library-view-name") as HTMLInputElement;
  viewName.type = "text";
  viewName.maxLength = 100;
  viewName.placeholder = "Name this view";
  viewName.setAttribute("aria-label", "Name this saved view");
  viewName.required = true;
  const saveViewButton = element(owner, "button", "button button-secondary", "Save current view");
  saveViewButton.type = "submit";
  saveViewForm.append(viewName, saveViewButton);
  viewsSection.append(viewsHeader, viewsBar, saveViewForm);

  const cards = element(owner, "div", "library-grid");
  cards.setAttribute("aria-live", "polite");
  const empty = element(owner, "div", "library-empty-state");
  const emptyTitle = element(owner, "h3", "library-empty-title", "Your bookshelf is empty");
  const emptyText = element(owner, "p", "library-empty-copy", "Import a PDF or link an original file to add your first book.");
  empty.append(emptyTitle, emptyText);

  root.replaceChildren(heading, summary, toolbar, quickFilters, viewsSection, cards, empty);

  function syncAdvancedFilterLabel(): void {
    const activeCount = [
      filters.status !== "all",
      filters.author.trim().length > 0,
      filters.tag !== "all",
      filters.progress !== "all",
      filters.format !== "all",
    ].filter(Boolean).length;
    advancedFiltersSummary.textContent = activeCount === 0
      ? "More filters"
      : "More filters · " + String(activeCount);
    advancedFilters.classList.toggle("has-active-filters", activeCount > 0);
    clearFiltersButton.hidden = activeCount === 0 &&
      filters.query.trim().length === 0 && filters.sort === "recent";
  }

  function syncFilters(): void {
    search.value = filters.query;
    statusFilter.value = filters.status;
    authorFilter.value = filters.author;
    tagFilter.value = filters.tag;
    progressFilter.value = filters.progress;
    formatFilter.value = filters.format;
    sortFilter.value = filters.sort;
    syncAdvancedFilterLabel();
  }

  function renderSummary(): void {
    const counts = new Map<LibraryReadingStatus, number>(STATUS_ORDER.map((status) => [status, 0]));
    for (const item of items) counts.set(item.entry.readingStatus, (counts.get(item.entry.readingStatus) ?? 0) + 1);
    const metrics = [
      { value: String(items.length), label: "Books" },
      { value: String(counts.get("reading") ?? 0), label: "Reading" },
      { value: String(counts.get("not-started") ?? 0), label: "To read" },
      { value: String(counts.get("completed") ?? 0), label: "Completed" },
    ];
    summaryMetrics.replaceChildren();
    for (const metric of metrics) {
      const item = element(owner, "div", "library-summary-metric");
      item.append(element(owner, "strong", "library-summary-value", metric.value));
      item.append(element(owner, "span", "library-summary-label", metric.label));
      summaryMetrics.append(item);
    }
  }

  function renderQuickFilters(): void {
    quickFilters.replaceChildren();
    const entries: Array<{ value: LibraryReadingStatus | "all"; label: string; count: number }> = [
      { value: "all", label: "All books", count: items.length },
      ...STATUS_ORDER.map((status) => ({
        value: status,
        label: STATUS_LABELS[status],
        count: items.filter((item) => item.entry.readingStatus === status).length,
      })),
    ];
    for (const item of entries) {
      const chip = button(owner, item.label + " " + String(item.count), "library-status-chip");
      chip.classList.toggle("is-active", filters.status === item.value);
      chip.setAttribute("aria-pressed", String(filters.status === item.value));
      chip.addEventListener("click", () => {
        filters = { ...filters, status: item.value };
        syncFilters();
        renderCards();
        renderQuickFilters();
      });
      quickFilters.append(chip);
    }
  }

  function renderSavedViews(): void {
    viewsBar.replaceChildren();
    if (savedViews.length === 0) {
      viewsBar.append(element(owner, "p", "library-saved-views-empty", "No saved views yet."));
    }
    for (const view of savedViews) {
      const group = element(owner, "div", "library-saved-view");
      const apply = button(owner, view.name, "library-saved-view-apply");
      apply.addEventListener("click", () => {
        filters = { ...view.filters };
        updateTagOptions();
        syncFilters();
        renderCards();
        renderQuickFilters();
        onStatus("Showing saved view: " + view.name + ".");
      });
      const remove = button(owner, "×", "library-saved-view-remove");
      remove.setAttribute("aria-label", "Delete saved view " + view.name);
      remove.addEventListener("click", () => {
        if (!window.confirm("Delete the saved view “" + view.name + "”?")) return;
        void (async () => {
          const result = await store.deleteSavedLibraryView(view.id);
          if (!result.ok) {
            onStatus(result.error.message, true);
            return;
          }
          savedViews = savedViews.filter((item) => item.id !== view.id);
          renderSavedViews();
          onStatus("Saved view deleted.");
        })();
      });
      group.append(apply, remove);
      viewsBar.append(group);
    }
  }

  function renderCard(item: LibraryCatalogItem): HTMLElement {
    const documentRecord = item.document;
    const entry = item.entry;
    const title = displayTitle(item);
    const authors = displayAuthors(item);
    const summaryText = entry.summaryOverride?.trim() ||
      documentRecord.metadata.pdfSubject?.trim() ||
      "Add a short description in the book details.";
    const progress = deriveLibraryProgress(documentRecord, entry, item.progress);

    const card = element(owner, "article", "library-card");
    const cover = element(owner, "div", "library-book-cover");
    let hash = 0;
    for (const character of String(documentRecord.id)) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
    cover.style.setProperty("--book-hue", String(Math.abs(hash) % 360));
    cover.append(element(owner, "span", "library-book-cover-spine"));
    cover.append(element(owner, "strong", "library-book-cover-title", title));
    cover.append(element(owner, "span", "library-book-cover-mark", "S"));
    cover.setAttribute("aria-hidden", "true");

    const body = element(owner, "div", "library-card-body");
    const top = element(owner, "div", "library-card-topline");
    const status = element(owner, "span", "library-status-badge library-status-badge--" + entry.readingStatus, STATUS_LABELS[entry.readingStatus]);
    top.append(status, element(owner, "span", "library-card-source", entry.readmeMarkdown.trim().length > 0 ? "PDF · README" : "PDF"));
    const heading = element(owner, "h3", "library-card-title", title);
    heading.dir = "auto";
    const authorLine = element(owner, "p", "library-card-authors", authors.length > 0 ? authors.join(", ") : "Author not listed");
    authorLine.dir = "auto";
    const description = element(owner, "p", "library-card-summary", summaryText);
    description.dir = "auto";

    const progressSection = element(owner, "div", "library-progress");
    const progressHeader = element(owner, "div", "library-progress-header");
    const percent = progress.completionPercent;
    const progressLabel = entry.readingStatus === "completed"
      ? "Completed"
      : progress.currentPageNumber === null
        ? (progress.totalPages === null ? "No saved position" : String(progress.totalPages) + " pages")
        : progress.totalPages === null
          ? "Position · page " + String(progress.currentPageNumber)
          : "Position · page " + String(progress.currentPageNumber) + " of " + String(progress.totalPages);
    progressHeader.append(
      element(owner, "span", "library-progress-position", progressLabel),
      element(owner, "strong", "library-progress-percent", percent === null ? "—" : "≈ " + String(percent) + "%"),
    );
    const progressTrack = element(owner, "div", "library-progress-track");
    progressTrack.setAttribute("role", "progressbar");
    progressTrack.setAttribute("aria-label", "Reading progress for " + title);
    progressTrack.setAttribute("aria-valuemin", "0");
    progressTrack.setAttribute("aria-valuemax", "100");
    progressTrack.setAttribute("aria-valuenow", String(percent ?? 0));
    const progressFill = element(owner, "span", "library-progress-fill");
    progressFill.style.width = String(percent ?? 0) + "%";
    progressTrack.append(progressFill);
    const remainingText = progress.pagesRemaining === null
      ? "Remaining pages unavailable"
      : String(progress.pagesRemaining) + " pages after position";
    const currentText = progress.currentPageNumber === null
      ? "Not opened"
      : "Last position: page " + String(progress.currentPageNumber);
    progressSection.append(progressHeader, progressTrack, element(owner, "p", "library-progress-meta", currentText + " · " + remainingText));

    const tags = element(owner, "div", "library-tag-list");
    for (const tag of entry.tags.slice(0, 8)) tags.append(element(owner, "span", "library-tag", "#" + tag));
    if (entry.tags.length > 8) tags.append(element(owner, "span", "library-tag library-tag--more", "+" + String(entry.tags.length - 8)));

    const footer = element(owner, "div", "library-card-footer");
    footer.append(element(owner, "span", "library-last-opened", formatDate(entry.lastOpenedAt)));
    const actions = element(owner, "div", "library-card-actions");
    const open = button(owner, "Open PDF", "button button-primary");
    open.addEventListener("click", () => onOpenDocument(documentRecord.id));
    actions.append(open);
    footer.append(actions);

    body.append(top, heading, authorLine, description, progressSection, tags, footer);
    card.append(cover, body, renderDetails(item));
    return card;
  }

  function renderDetails(item: LibraryCatalogItem): HTMLElement {
    const entry = item.entry;
    const detail = element(owner, "details", "library-card-details");
    const toggle = element(owner, "summary", "library-card-details-toggle", "Book details · README.md");
    detail.append(toggle);

    const form = element(owner, "form", "library-detail-form");
    const fields = element(owner, "div", "library-detail-fields");

    const titleInput = element(owner, "input", "library-detail-input") as HTMLInputElement;
    titleInput.type = "text";
    titleInput.maxLength = 500;
    titleInput.value = entry.titleOverride ?? item.document.metadata.title;
    field(owner, fields, "Title", titleInput);

    const authorsInput = element(owner, "input", "library-detail-input") as HTMLInputElement;
    authorsInput.type = "text";
    authorsInput.maxLength = 2_000;
    authorsInput.value = (entry.authorsOverride ?? item.document.metadata.authors).join(", ");
    field(owner, fields, "Authors", authorsInput, "Separate multiple authors with commas.");

    const statusInput = element(owner, "select", "library-detail-input") as HTMLSelectElement;
    statusInput.append(...statusOptionElements(owner));
    statusInput.value = entry.readingStatus;
    field(owner, fields, "Reading status", statusInput);

    const tagsInput = element(owner, "input", "library-detail-input") as HTMLInputElement;
    tagsInput.type = "text";
    tagsInput.maxLength = 4_000;
    tagsInput.value = entry.tags.join(", ");
    field(owner, fields, "Tags", tagsInput, "Separate tags with commas.");

    const summaryInput = element(owner, "textarea", "library-detail-textarea") as HTMLTextAreaElement;
    summaryInput.rows = 3;
    summaryInput.maxLength = 20_000;
    summaryInput.value = entry.summaryOverride ?? item.document.metadata.pdfSubject ?? "";
    field(owner, fields, "Summary", summaryInput);

    const readmeHeading = element(owner, "div", "library-readme-heading");
    readmeHeading.append(
      element(owner, "h4", "library-readme-title", "README.md"),
      element(owner, "span", "library-readme-mode", "Safe preview"),
    );
    const readmePreview = element(owner, "div", "library-readme-preview");
    if (entry.readmeMarkdown.trim().length > 0) {
      renderSafeMarkdown(readmePreview, entry.readmeMarkdown);
    } else {
      readmePreview.append(element(owner, "p", "library-readme-empty", "No README.md yet. Add reading context, goals or notes for this book."));
    }
    const readmeEditor = element(owner, "textarea", "library-readme-editor") as HTMLTextAreaElement;
    readmeEditor.rows = 12;
    readmeEditor.maxLength = MAX_LIBRARY_README_CHARACTERS;
    readmeEditor.value = entry.readmeMarkdown;
    readmeEditor.hidden = true;

    const readmeActions = element(owner, "div", "library-readme-actions");
    const editReadme = button(owner, "Edit README", "button button-secondary");
    const templateReadme = button(owner, "Use book template", "button button-secondary");
    const importReadme = button(owner, "Import README.md", "button button-secondary");
    const readmeFile = element(owner, "input", "visually-hidden") as HTMLInputElement;
    readmeFile.type = "file";
    readmeFile.accept = ".md,.markdown,text/markdown,text/plain";
    readmeFile.hidden = true;
    const download = button(owner, "Download README.md", "button button-secondary");
    download.disabled = entry.readmeMarkdown.trim().length === 0;
    editReadme.addEventListener("click", () => {
      readmePreview.hidden = true;
      readmeEditor.hidden = false;
      readmeHeading.querySelector(".library-readme-mode")!.textContent = "Editing";
      readmeEditor.focus();
    });
    templateReadme.addEventListener("click", () => {
      readmeEditor.value = makeReadmeTemplate(displayTitle(item));
      readmePreview.hidden = true;
      readmeEditor.hidden = false;
      readmeHeading.querySelector(".library-readme-mode")!.textContent = "Editing";
      readmeEditor.focus();
    });
    importReadme.addEventListener("click", () => readmeFile.click());
    readmeFile.addEventListener("change", () => {
      void (async () => {
        const file = readmeFile.files?.[0];
        readmeFile.value = "";
        if (file === undefined) return;
        if (file.size > MAX_LIBRARY_README_CHARACTERS) {
          onStatus("README.md exceeds the 256 KiB limit.", true);
          return;
        }
        const name = file.name.toLocaleLowerCase();
        if (!name.endsWith(".md") && !name.endsWith(".markdown")) {
          onStatus("Choose a Markdown file ending in .md or .markdown.", true);
          return;
        }
        try {
          readmeEditor.value = await file.text();
          readmePreview.hidden = true;
          readmeEditor.hidden = false;
          readmeHeading.querySelector(".library-readme-mode")!.textContent = "Editing · imported locally";
        } catch {
          onStatus("Shelf could not read this README.md file.", true);
        }
      })();
    });
    download.addEventListener("click", () => downloadReadme(owner, root, displayTitle(item), entry.readmeMarkdown));
    readmeActions.append(editReadme, templateReadme, importReadme, download, readmeFile);

    const formActions = element(owner, "div", "library-detail-actions");
    const save = element(owner, "button", "button button-primary", "Save book details");
    save.type = "submit";
    formActions.append(save);
    form.append(fields, readmeHeading, readmePreview, readmeEditor, readmeActions, formActions);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        if (readmeEditor.value.length > MAX_LIBRARY_README_CHARACTERS) {
          onStatus("README.md exceeds the 256 KiB limit.", true);
          return;
        }
        const next: LibraryEntry = {
          ...entry,
          titleOverride: titleInput.value.trim() === "" ? null : titleInput.value.trim(),
          authorsOverride: authorsInput.value.trim() === "" ? null : parseCommaSeparated(authorsInput.value, 100),
          summaryOverride: summaryInput.value.trim() === "" ? null : summaryInput.value.trim(),
          tags: parseCommaSeparated(tagsInput.value, 50),
          readingStatus: statusInput.value as LibraryReadingStatus,
          readmeMarkdown: readmeEditor.value,
          updatedAt: Date.now(),
        };
        const result = await store.saveLibraryEntry(next);
        if (!result.ok) {
          onStatus(result.error.message, true);
          return;
        }
        const index = items.findIndex((value) => value.document.id === item.document.id);
        if (index >= 0) items[index] = { ...items[index]!, entry: next };
        updateTagOptions();
        render();
        onStatus("Saved metadata for “" + (next.titleOverride ?? item.document.metadata.title) + "”.");
      })();
    });

    detail.append(form);
    return detail;
  }

  function renderCards(): void {
    const filtered = filterLibraryItems(items, filters);
    cards.classList.toggle("library-grid--list", layout === "list");
    cards.replaceChildren();
    count.textContent = String(filtered.length) + (filtered.length === 1 ? " book" : " books");
    empty.hidden = filtered.length > 0;
    cards.hidden = filtered.length === 0;
    if (items.length === 0) {
      emptyTitle.textContent = "Your bookshelf is empty";
      emptyText.textContent = "Import a PDF or link an original file to add your first book.";
    } else if (filtered.length === 0) {
      emptyTitle.textContent = "No books match these filters";
      emptyText.textContent = "Try another search or clear the active filters.";
    }
    for (const item of filtered) cards.append(renderCard(item));
  }

  function render(): void {
    renderSummary();
    renderQuickFilters();
    renderSavedViews();
    renderCards();
  }

  function updateFilters(next: Partial<LibraryFilters>): void {
    filters = { ...filters, ...next };
    syncAdvancedFilterLabel();
    renderCards();
    renderQuickFilters();
  }

  search.addEventListener("input", () => updateFilters({ query: search.value }));
  statusFilter.addEventListener("change", () => updateFilters({ status: statusFilter.value as LibraryFilters["status"] }));
  authorFilter.addEventListener("input", () => updateFilters({ author: authorFilter.value }));
  tagFilter.addEventListener("change", () => updateFilters({ tag: tagFilter.value }));
  progressFilter.addEventListener("change", () => updateFilters({ progress: progressFilter.value as LibraryFilters["progress"] }));
  formatFilter.addEventListener("change", () => updateFilters({ format: formatFilter.value as LibraryFilters["format"] }));
  sortFilter.addEventListener("change", () => updateFilters({ sort: sortFilter.value as LibraryFilters["sort"] }));
  clearFiltersButton.addEventListener("click", () => {
    filters = { ...DEFAULT_LIBRARY_FILTERS };
    syncFilters();
    render();
  });
  gridButton.addEventListener("click", () => {
    layout = "grid";
    gridButton.classList.add("is-active");
    listButton.classList.remove("is-active");
    gridButton.setAttribute("aria-pressed", "true");
    listButton.setAttribute("aria-pressed", "false");
    renderCards();
  });
  listButton.addEventListener("click", () => {
    layout = "list";
    listButton.classList.add("is-active");
    gridButton.classList.remove("is-active");
    listButton.setAttribute("aria-pressed", "true");
    gridButton.setAttribute("aria-pressed", "false");
    renderCards();
  });
  saveViewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = viewName.value.trim();
    if (name.length === 0) return;
    void (async () => {
      const now = Date.now();
      const view: SavedLibraryView = {
        id: "view-" + (owner.defaultView?.crypto.randomUUID() ?? String(now)),
        name,
        filters: { ...filters },
        createdAt: now,
        updatedAt: now,
      };
      const result = await store.saveSavedLibraryView(view);
      if (!result.ok) {
        onStatus(result.error.message, true);
        return;
      }
      savedViews = [view, ...savedViews.filter((item) => item.id !== view.id)];
      viewName.value = "";
      renderSavedViews();
      onStatus("Saved library view: " + name + ".");
    })();
  });

  function updateTagOptions(): void {
    const current = filters.tag;
    const tags = [...new Set(items.flatMap((item) => item.entry.tags))]
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
    addOptions(tagFilter, [
      { value: "all", label: "All tags" },
      ...tags.map((tag) => ({ value: tag, label: tag })),
    ]);
    tagFilter.value = tags.some((tag) => tag.toLocaleLowerCase() === current.toLocaleLowerCase())
      ? current
      : "all";
    filters = { ...filters, tag: tagFilter.value };
    syncFilters();
  }

  async function refresh(): Promise<void> {
    if (loading) return;
    loading = true;
    try {
      const [documentsResult, progressResult, entriesResult, viewsResult] = await Promise.all([
        store.list(),
        store.listReadingProgress(),
        store.listLibraryEntries(),
        store.listSavedLibraryViews(),
      ]);
      const failure = [documentsResult, progressResult, entriesResult, viewsResult].find((result) => !result.ok);
      if (failure !== undefined && !failure.ok) {
        onStatus(failure.error.message, true);
        return;
      }
      if (!documentsResult.ok || !progressResult.ok || !entriesResult.ok || !viewsResult.ok) return;

      const entryById = new Map(entriesResult.value.map((entry) => [String(entry.documentId), entry]));
      for (const documentRecord of documentsResult.value) {
        if (entryById.has(String(documentRecord.id))) continue;
        const entry = createDefaultLibraryEntry(documentRecord.id);
        const saved = await store.saveLibraryEntry(entry);
        if (!saved.ok) {
          onStatus(saved.error.message, true);
          continue;
        }
        entryById.set(String(documentRecord.id), entry);
      }
      const progressById = new Map(progressResult.value.map((progress) => [String(progress.documentId), progress]));
      items = documentsResult.value.flatMap((documentRecord: Document) => {
        const entry = entryById.get(String(documentRecord.id));
        if (entry === undefined) return [];
        return [{
          document: documentRecord,
          entry,
          progress: progressById.get(String(documentRecord.id)) ?? null,
        }];
      });
      savedViews = [...viewsResult.value];
      updateTagOptions();
      render();
    } catch {
      onStatus("Shelf could not refresh the local library.", true);
    } finally {
      loading = false;
    }
  }

  async function markOpened(documentId: DocumentId): Promise<void> {
    const current = items.find((item) => item.document.id === documentId);
    if (current === undefined) return;
    const now = Date.now();
    const next: LibraryEntry = {
      ...current.entry,
      readingStatus: current.entry.readingStatus === "not-started" ? "reading" : current.entry.readingStatus,
      lastOpenedAt: now,
      updatedAt: now,
    };
    const result = await store.saveLibraryEntry(next);
    if (!result.ok) {
      onStatus(result.error.message, true);
      return;
    }
    const index = items.findIndex((item) => item.document.id === documentId);
    if (index >= 0) items[index] = { ...items[index]!, entry: next };
    renderSummary();
    renderQuickFilters();
    renderCards();
  }

  syncFilters();
  render();
  return { refresh, markOpened };
}
