interface SelectionActionHandlers {
  readonly onHighlight: () => void;
  readonly onNote: () => void;
  readonly onQuote: () => void;
}

export interface SelectionActionsView {
  readonly element: HTMLDivElement;
  setEnabled(enabled: boolean): void;
}

/** Small accessible selection actions; all styling is expressed with Tailwind utilities. */
export function createSelectionActions(
  owner: Document,
  handlers: SelectionActionHandlers,
): SelectionActionsView {
  const root = owner.createElement("div");
  root.className = "mt-3 flex flex-wrap gap-2";

  const button = (label: string, action: () => void): HTMLButtonElement => {
    const element = owner.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.disabled = true;
    element.className = [
      "inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300",
      "bg-white px-3 py-2 text-sm font-medium text-stone-800 shadow-sm",
      "transition-colors hover:bg-stone-50 focus-visible:outline-2",
      "focus-visible:outline-offset-2 focus-visible:outline-emerald-700",
      "disabled:cursor-not-allowed disabled:opacity-45",
    ].join(" ");
    // Preserve the browser Selection when mouse users activate an action.
    // Without this, focus changes can collapse the text range before the
    // asynchronous save handler reads the cached selection.
    element.addEventListener("mousedown", (event) => event.preventDefault());
    element.addEventListener("click", action);
    root.append(element);
    return element;
  };

  const highlight = button("Save highlight", handlers.onHighlight);
  const note = button("Add note", handlers.onNote);
  const quote = button("Save quote", handlers.onQuote);

  return {
    element: root,
    setEnabled(enabled) {
      highlight.disabled = !enabled;
      note.disabled = !enabled;
      quote.disabled = !enabled;
    },
  };
}
