import { groupPdfTextItemsByReadingOrder } from "../text/pdf-text-reading-order.js";

const observers = new WeakMap<HTMLElement, ResizeObserver>();

export function reorderPdfTextLayer(layer: HTMLElement, pageWidth: number): void {
  const children = Array.from(layer.children);
  const spans = children.filter((child) => child.tagName === "SPAN") as HTMLSpanElement[];
  if (spans.length < 2) return;
  const layerBounds = layer.getBoundingClientRect();
  const layerDirection = layer.ownerDocument.defaultView?.getComputedStyle(layer).direction;
  const items = spans.map((element) => {
    const bounds = element.getBoundingClientRect();
    const direction = element.getAttribute("dir") ?? layer.getAttribute("dir");
    return {
      element,
      left: bounds.left - layerBounds.left,
      right: bounds.right - layerBounds.left,
      top: bounds.top - layerBounds.top,
      bottom: bounds.bottom - layerBounds.top,
      direction: direction === "rtl" || (direction === null && layerDirection === "rtl") ? "rtl" as const : "ltr" as const,
    };
  }).filter((item) => Number.isFinite(item.left) && Number.isFinite(item.right) &&
    Number.isFinite(item.top) && Number.isFinite(item.bottom) &&
    item.right > item.left && item.bottom > item.top);
  if (items.length < 2) {
    const Observer = layer.ownerDocument.defaultView?.ResizeObserver;
    if (Observer !== undefined && !observers.has(layer)) {
      const observer = new Observer(() => {
        if (!layer.isConnected) { observer.disconnect(); observers.delete(layer); return; }
        const rect = layer.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          observer.disconnect();
          observers.delete(layer);
          reorderPdfTextLayer(layer, pageWidth);
        }
      });
      observers.set(layer, observer);
      observer.observe(layer);
    }
    return;
  }
  const ordered = groupPdfTextItemsByReadingOrder(items, pageWidth)
    .flatMap((line) => line.items.map((item) => item.element));
  const orderedSet = new Set<Element>(ordered);
  const iterator = ordered[Symbol.iterator]();
  const fragment = layer.ownerDocument.createDocumentFragment();
  for (const child of children) {
    if (orderedSet.has(child)) {
      const next = iterator.next();
      if (!next.done) fragment.append(next.value);
    } else fragment.append(child);
  }
  layer.replaceChildren(fragment);
}
