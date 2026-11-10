export type SafeMarkdownInline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "emphasis"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly href: string };

export type SafeMarkdownBlock =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly children: readonly SafeMarkdownInline[] }
  | { readonly kind: "paragraph"; readonly children: readonly SafeMarkdownInline[] }
  | { readonly kind: "quote"; readonly children: readonly SafeMarkdownInline[] }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly (readonly SafeMarkdownInline[])[] }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "rule" };

export const MAX_LIBRARY_README_CHARACTERS = 262_144;

function safeLink(raw: string): string | null {
  if (!/^https?:\/\//iu.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.username !== "" || url.password !== "") return null;
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Parse a deliberately small Markdown subset. Raw HTML is always ordinary text. */
export function parseSafeMarkdown(source: string): readonly SafeMarkdownBlock[] {
  const bounded = source.slice(0, MAX_LIBRARY_README_CHARACTERS);
  const lines = bounded.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: SafeMarkdownBlock[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let code: string[] | null = null;
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", children: parseSafeInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushQuote = (): void => {
    if (quote.length === 0) return;
    blocks.push({ kind: "quote", children: parseSafeInline(quote.join(" ")) });
    quote = [];
  };
  const flushList = (): void => {
    if (list === null) return;
    blocks.push({
      kind: "list",
      ordered: list.ordered,
      items: list.items.map((item) => parseSafeInline(item)),
    });
    list = null;
  };
  const flushTextBlocks = (): void => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const line of lines) {
    if (code !== null) {
      if (/^\s*```\s*$/u.test(line)) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (/^\s*```/u.test(line)) {
      flushTextBlocks();
      code = [];
      continue;
    }
    if (line.trim() === "") {
      flushTextBlocks();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    if (heading !== null) {
      flushTextBlocks();
      const level = heading[1]?.length ?? 1;
      blocks.push({
        kind: "heading",
        level: level as 1 | 2 | 3,
        children: parseSafeInline(heading[2] ?? ""),
      });
      continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/u.test(line)) {
      flushTextBlocks();
      blocks.push({ kind: "rule" });
      continue;
    }
    const quoted = /^\s*>\s?(.*)$/u.exec(line);
    if (quoted !== null) {
      flushParagraph();
      flushList();
      quote.push(quoted[1] ?? "");
      continue;
    }
    const item = /^\s*((?:[-+*])|(?:\d+\.))\s+(.+)$/u.exec(line);
    if (item !== null) {
      flushParagraph();
      flushQuote();
      const ordered = /^\d/u.test(item[1] ?? "");
      if (list !== null && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(item[2] ?? "");
      continue;
    }
    flushQuote();
    flushList();
    paragraph.push(line.trim());
  }
  flushTextBlocks();
  if (code !== null) blocks.push({ kind: "code", text: code.join("\n") });
  return blocks;
}

function parseSafeInline(source: string): readonly SafeMarkdownInline[] {
  const token = /(\[([^\]]{1,200})\]\((https?:\/\/[^)\s]{1,2048})\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*]+)\*|_([^_]+)_)/gu;
  const nodes: SafeMarkdownInline[] = [];
  let cursor = 0;
  for (const match of source.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push({ kind: "text", text: source.slice(cursor, index) });
    const whole = match[0];
    if (match[2] !== undefined && match[3] !== undefined) {
      const href = safeLink(match[3]);
      nodes.push(href === null
        ? { kind: "text", text: match[2] }
        : { kind: "link", text: match[2], href });
    } else if (match[4] !== undefined || match[5] !== undefined) {
      nodes.push({ kind: "strong", text: match[4] ?? match[5] ?? "" });
    } else if (match[6] !== undefined) {
      nodes.push({ kind: "code", text: match[6] });
    } else {
      nodes.push({ kind: "emphasis", text: match[7] ?? match[8] ?? "" });
    }
    cursor = index + whole.length;
  }
  if (cursor < source.length) nodes.push({ kind: "text", text: source.slice(cursor) });
  return nodes;
}

function appendInline(parent: Node, nodes: readonly SafeMarkdownInline[], owner: Document): void {
  for (const node of nodes) {
    if (node.kind === "text") {
      parent.appendChild(owner.createTextNode(node.text));
      continue;
    }
    if (node.kind === "link") {
      const link = owner.createElement("a");
      link.href = node.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = node.text;
      parent.appendChild(link);
      continue;
    }
    const tag = node.kind === "strong" ? "strong" : node.kind === "emphasis" ? "em" : "code";
    const element = owner.createElement(tag);
    element.textContent = node.text;
    parent.appendChild(element);
  }
}

/** Render with DOM nodes and textContent only; no raw HTML parsing or script execution. */
export function renderSafeMarkdown(target: HTMLElement, source: string): void {
  const owner = target.ownerDocument;
  const fragment = owner.createDocumentFragment();
  for (const block of parseSafeMarkdown(source)) {
    if (block.kind === "rule") {
      fragment.appendChild(owner.createElement("hr"));
      continue;
    }
    if (block.kind === "code") {
      const pre = owner.createElement("pre");
      const code = owner.createElement("code");
      code.textContent = block.text;
      pre.appendChild(code);
      fragment.appendChild(pre);
      continue;
    }
    if (block.kind === "list") {
      const listElement = owner.createElement(block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const itemElement = owner.createElement("li");
        appendInline(itemElement, item, owner);
        listElement.appendChild(itemElement);
      }
      fragment.appendChild(listElement);
      continue;
    }
    const tag = block.kind === "heading" ? "h" + String(block.level) : block.kind === "quote" ? "blockquote" : "p";
    const element = owner.createElement(tag);
    appendInline(element, block.children, owner);
    fragment.appendChild(element);
  }
  target.replaceChildren(fragment);
}
