import { toPageIndex } from "@shelf/reader-core";
import type { PageIndex } from "@shelf/reader-core";

export interface PageSize {
  readonly width: number;
  readonly height: number;
}

export interface PageViewportPosition {
  readonly scrollTop: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly scale: number;
}

export interface VirtualPage {
  readonly index: PageIndex;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
}

export interface PageVirtualWindow {
  readonly firstVisibleIndex: PageIndex;
  readonly lastVisibleIndex: PageIndex;
  readonly totalPageCount: number;
  /** Scaled document height for a scroll spacer representing unmounted pages. */
  readonly totalHeight: number;
  readonly pages: readonly VirtualPage[];
}

const MAX_PAGE_DIMENSION = 100_000;

export interface PageVirtualizerOptions {
  readonly estimatedPageWidth?: number;
  readonly estimatedPageHeight?: number;
  readonly pageGap?: number;
  readonly overscanPages?: number;
  readonly maxMountedPages?: number;
}

class FenwickTree {
  readonly #tree: Float64Array;
  readonly #length: number;

  constructor(length: number, initialValue: number) {
    this.#length = length;
    this.#tree = new Float64Array(length + 1);
    for (let index = 1; index <= length; index += 1) {
      this.#tree[index] = initialValue * (index & -index);
    }
  }

  set(index: number, value: number, previousValue: number): void {
    const delta = value - previousValue;
    for (let cursor = index + 1; cursor <= this.#length; cursor += cursor & -cursor) {
      this.#tree[cursor] = (this.#tree[cursor] ?? 0) + delta;
    }
  }

  prefix(count: number): number {
    let total = 0;
    for (let cursor = count; cursor > 0; cursor -= cursor & -cursor) {
      total += this.#tree[cursor] ?? 0;
    }
    return total;
  }

  /** Return the largest count whose prefix is <= target (or < target). */
  findCount(target: number, inclusive: boolean): number {
    let index = 0;
    let total = 0;
    let bit = 1;
    while (bit * 2 <= this.#length) bit *= 2;

    for (; bit > 0; bit = Math.floor(bit / 2)) {
      const next = index + bit;
      if (next > this.#length) continue;
      const candidate = total + (this.#tree[next] ?? 0);
      if (inclusive ? candidate <= target : candidate < target) {
        index = next;
        total = candidate;
      }
    }

    return index;
  }
}

/**
 * Computes a bounded mount window for long documents.
 *
 * Page geometry is learned lazily. Unmeasured pages use the supplied estimate;
 * updating a measured page changes prefix offsets in O(log n), and viewport
 * queries use O(log n + mounted pages) work.
 */
export class PageVirtualizer {
  readonly pageCount: number;
  readonly #widths: Float64Array;
  readonly #heights: Float64Array;
  readonly #tree: FenwickTree;
  readonly #pageGap: number;
  readonly #overscan: number;
  readonly #maxMounted: number;

  constructor(pageCount: number, options: PageVirtualizerOptions = {}) {
    const estimatedWidth = options.estimatedPageWidth ?? 612;
    const estimatedHeight = options.estimatedPageHeight ?? 792;
    const pageGap = options.pageGap ?? 24;
    const overscan = options.overscanPages ?? 2;
    const maxMounted = options.maxMountedPages ?? 12;

    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 1_000_000) {
      throw new RangeError("PDF page count must be between 1 and 1,000,000.");
    }
    if (!Number.isFinite(estimatedWidth) || estimatedWidth <= 0 || estimatedWidth > MAX_PAGE_DIMENSION ||
        !Number.isFinite(estimatedHeight) || estimatedHeight <= 0 || estimatedHeight > MAX_PAGE_DIMENSION) {
      throw new RangeError("Estimated page dimensions must be finite and positive.");
    }
    if (!Number.isFinite(pageGap) || pageGap < 0 || pageGap > MAX_PAGE_DIMENSION ||
        !Number.isSafeInteger(overscan) || overscan < 0 ||
        !Number.isSafeInteger(maxMounted) || maxMounted < 1) {
      throw new RangeError("Virtualizer spacing and window options are invalid.");
    }

    this.pageCount = pageCount;
    this.#pageGap = pageGap;
    this.#overscan = overscan;
    this.#maxMounted = maxMounted;
    this.#widths = new Float64Array(pageCount).fill(estimatedWidth);
    this.#heights = new Float64Array(pageCount).fill(estimatedHeight);
    this.#tree = new FenwickTree(pageCount, estimatedHeight + pageGap);
  }

  updatePageSize(index: PageIndex, size: PageSize): void {
    const numericIndex = index as number;
    if (!Number.isSafeInteger(numericIndex) || numericIndex < 0 || numericIndex >= this.pageCount) {
      throw new RangeError("Page index is outside this document.");
    }
    if (!Number.isFinite(size.width) || size.width <= 0 || size.width > MAX_PAGE_DIMENSION ||
        !Number.isFinite(size.height) || size.height <= 0 || size.height > MAX_PAGE_DIMENSION) {
      throw new RangeError("Page dimensions must be finite and positive.");
    }

    const previousHeight = this.#heights[numericIndex] ?? 0;
    this.#widths[numericIndex] = size.width;
    this.#heights[numericIndex] = size.height;
    this.#tree.set(numericIndex, size.height + this.#pageGap, previousHeight + this.#pageGap);
  }

  getWindow(viewport: PageViewportPosition): PageVirtualWindow {
    const { scrollTop, viewportWidth, viewportHeight, scale } = viewport;
    if (!Number.isFinite(scrollTop) || scrollTop < 0 ||
        !Number.isFinite(viewportWidth) || viewportWidth <= 0 ||
        !Number.isFinite(viewportHeight) || viewportHeight <= 0 ||
        !Number.isFinite(scale) || scale <= 0 || scale > 8) {
      throw new RangeError("Viewport position and scale are invalid.");
    }

    const visibleBottom = scrollTop + viewportHeight;
    if (!Number.isFinite(visibleBottom)) {
      throw new RangeError("Viewport bottom must be finite.");
    }
    let first = Math.min(this.#tree.findCount(scrollTop / scale, true), this.pageCount - 1);
    if (this.#tree.prefix(first) * scale + (this.#heights[first] ?? 0) * scale <= scrollTop &&
        first < this.pageCount - 1) {
      first += 1;
    }

    let last = Math.min(this.#tree.findCount(visibleBottom / scale, false), this.pageCount - 1);
    while (
      last >= first &&
      this.#tree.prefix(last) * scale + (this.#heights[last] ?? 0) * scale <= scrollTop
    ) {
      last -= 1;
    }

    const hasVisiblePage = last >= first;
    const visibleEnd = hasVisiblePage ? last + 1 : Math.min(this.pageCount, first + 1);
    const targetCount = Math.max(this.#maxMounted, visibleEnd - first);
    let start = Math.max(0, first - this.#overscan);
    let end = Math.min(this.pageCount, visibleEnd + this.#overscan);

    while (end - start > targetCount) {
      const before = first - start;
      const after = end - visibleEnd;
      if (before >= after && before > 0) start += 1;
      else if (after > 0) end -= 1;
      else break;
    }

    const pages: VirtualPage[] = [];
    for (let index = start; index < end; index += 1) {
      const width = (this.#widths[index] ?? 612) * scale;
      const height = (this.#heights[index] ?? 792) * scale;
      const top = this.#tree.prefix(index) * scale;
      pages.push({
        index: toPageIndex(index),
        top,
        left: Math.max(0, (viewportWidth - width) / 2),
        width,
        height,
        visible: top < visibleBottom && top + height > scrollTop,
      });
    }

    return {
      firstVisibleIndex: toPageIndex(first),
      lastVisibleIndex: toPageIndex(Math.max(first, hasVisiblePage ? last : first)),
      totalPageCount: this.pageCount,
      totalHeight: Math.max(0, (this.#tree.prefix(this.pageCount) - this.#pageGap) * scale),
      pages,
    };
  }
}
