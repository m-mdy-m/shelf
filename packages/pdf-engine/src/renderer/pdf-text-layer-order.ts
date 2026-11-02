import { groupPdfTextItemsByReadingOrder } from "../text/pdf-text-reading-order.js";

export function reorderPdfTextLayer(layer: HTMLElement, pageWidth: number): void {
  const children = Array.from(layer.children);
  const spans = children.filter((child) => child.tagName === "SPAN") as HTMLSpanElement[];
  if (spans.length < 2) return;

  const layerBounds = layer.getBoundingClientRect();
  const items = spans.map((element) => {
    const bounds = element.getBoundingClientRect();
    const computedDirection = layer.ownerDocument.defaultView?.getComputedStyle(element).direction;
    return {
      element,
      left: bounds.left - layerBounds.left,
      right: bounds.right - layerBounds.left,
      top: bounds.top - layerBounds.top,
      bottom: bounds.bottom - layerBounds.top,
      direction: element.getAttribute("dir") === "rtl" || computedDirection === "rtl" ? "rtl" as const : "ltr" as const,
    };
  }).filter((item) =>
    Number.isFinite(item.left) && Number.isFinite(item.right) &&
    Number.isFinite(item.top) && Number.isFinite(item.bottom) &&
    item.right > item.left && item.bottom > item.top,
  );
  if (items.length < 2) return;

  const ordered = groupPdfTextItemsByReadingOrder(items, pageWidth)
    .flatMap((line) => line.items.map((item) => item.element));
  const orderedSet = new Set<Element>(ordered);
  const remaining = children.filter((child) => !orderedSet.has(child));
  layer.replaceChildren(...ordered, ...remaining);
}
