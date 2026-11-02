import type { Annotation } from "@shelf/reader-core";
import type { Bookmark } from "@shelf/reader-core";
import type { Quote } from "@shelf/reader-core";

export interface SavedItemsSnapshot {
  readonly bookmarks: readonly Bookmark[];
  readonly annotations: readonly Annotation[];
  readonly quotes: readonly Quote[];
  readonly anchorStates: ReadonlyMap<string, string>;
}

export interface SavedItemsHandlers {
  readonly onOpenBookmark: (bookmark: Bookmark) => void;
  readonly onEditBookmark: (bookmark: Bookmark) => void;
  readonly onDeleteBookmark: (bookmark: Bookmark) => void;
  readonly onOpenAnnotation: (annotation: Annotation) => void;
  readonly onEditAnnotation: (annotation: Annotation) => void;
  readonly onDeleteAnnotation: (annotation: Annotation) => void;
  readonly onOpenQuote: (quote: Quote) => void;
  readonly onDeleteQuote: (quote: Quote) => void;
}

export interface SavedItemsPanelView {
  readonly element: HTMLElement;
  render(snapshot: SavedItemsSnapshot): void;
}

let nextSavedItemsPanelId = 0;

const actionClassName = [
  "inline-flex min-h-8 items-center justify-center rounded-md border border-stone-300",
  "bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700",
  "hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2",
  "focus-visible:outline-emerald-700",
].join(" ");

function makeButton(owner: Document, label: string, action: () => void): HTMLButtonElement {
  const button = owner.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = actionClassName;
  button.addEventListener("click", action);
  return button;
}

function appendRecord(
  owner: Document,
  list: HTMLElement,
  title: string,
  detail: string,
  state: string | undefined,
  actions: readonly { readonly label: string; readonly run: () => void }[],
): void {
  const card = owner.createElement("article");
  card.className = [
    "flex min-w-0 flex-col gap-3 rounded-lg border border-stone-200",
    "bg-white p-3 sm:flex-row sm:items-center sm:justify-between",
  ].join(" ");

  const copy = owner.createElement("div");
  copy.className = "min-w-0";
  const heading = owner.createElement("h4");
  heading.className = "m-0 break-words text-sm font-semibold text-stone-800";
  heading.textContent = title;
  const description = owner.createElement("p");
  description.className = "mt-1 break-words text-xs leading-5 text-stone-500";
  description.textContent = detail + (state ? " · " + state : "");
  copy.append(heading, description);

  const controls = owner.createElement("div");
  controls.className = "flex shrink-0 flex-wrap gap-1.5";
  for (const action of actions) controls.append(makeButton(owner, action.label, action.run));
  card.append(copy, controls);
  list.append(card);
}

/** Presentational saved-items panel. It owns no persistence or application state. */
export function createSavedItemsPanel(
  owner: Document,
  handlers: SavedItemsHandlers,
): SavedItemsPanelView {
  const panel = owner.createElement("section");
  panel.id = "reader-saved-items-" + String(++nextSavedItemsPanelId);
  panel.hidden = true;
  panel.setAttribute("aria-label", "Saved reader items");
  panel.className = "rounded-xl border border-stone-200 bg-stone-50 p-3";

  const heading = owner.createElement("h3");
  heading.className = "m-0 text-sm font-semibold text-stone-800";
  heading.textContent = "Saved items";
  const list = owner.createElement("div");
  list.className = "mt-3 grid max-h-80 gap-2 overflow-auto";
  panel.append(heading, list);

  return {
    element: panel,
    render(snapshot) {
      list.replaceChildren();
      const count = snapshot.bookmarks.length + snapshot.annotations.length + snapshot.quotes.length;
      if (count === 0) {
        const empty = owner.createElement("p");
        empty.className = "m-0 rounded-lg border border-dashed border-stone-300 p-4 text-sm text-stone-500";
        empty.textContent = "No saved bookmarks, highlights, notes, or quotes yet.";
        list.append(empty);
        return;
      }

      for (const bookmark of snapshot.bookmarks) {
        appendRecord(
          owner,
          list,
          bookmark.label || "Bookmark",
          "Page " + String(bookmark.pageIndex + 1) + " · Reading location",
          undefined,
          [
            { label: "Go to page", run: () => handlers.onOpenBookmark(bookmark) },
            { label: "Edit", run: () => handlers.onEditBookmark(bookmark) },
            { label: "Delete", run: () => handlers.onDeleteBookmark(bookmark) },
          ],
        );
      }

      for (const annotation of snapshot.annotations) {
        const detail = annotation.kind === "highlight"
          ? "Page " + String(annotation.pageIndex + 1) + " · " +
            (annotation.anchor?.selectedText.slice(0, 100) || "Highlight")
          : "Page " + String(annotation.pageIndex + 1) + " · " + annotation.content.slice(0, 100);
        appendRecord(
          owner,
          list,
          annotation.kind === "highlight" ? "Highlight" : "Passage note",
          detail,
          snapshot.anchorStates.get(annotation.id),
          [
            { label: "Go to page", run: () => handlers.onOpenAnnotation(annotation) },
            { label: "Edit", run: () => handlers.onEditAnnotation(annotation) },
            { label: "Delete", run: () => handlers.onDeleteAnnotation(annotation) },
          ],
        );
      }

      for (const quote of snapshot.quotes) {
        appendRecord(
          owner,
          list,
          "Quote",
          "Page " + String(quote.pageIndex + 1) + " · " + quote.text.slice(0, 120),
          undefined,
          [
            { label: "Go to page", run: () => handlers.onOpenQuote(quote) },
            { label: "Delete", run: () => handlers.onDeleteQuote(quote) },
          ],
        );
      }
    },
  };
}
