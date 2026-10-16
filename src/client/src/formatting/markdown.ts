import { marked } from "marked";
import { describeMarkdownStreamTail, type MarkdownStreamTail } from "./markdownStreamTail";

const renderer = new marked.Renderer();
renderer.html = ({ text }) => escapeHtml(text);

const MAX_MARKDOWN_CACHE_ENTRIES = 300;
interface MarkdownSnapshot {
  html: string;
  tail: MarkdownStreamTail;
}

const markdownHtmlCache = new Map<string, MarkdownSnapshot>();

function markdownSnapshot(text: string): MarkdownSnapshot {
  const cached = markdownHtmlCache.get(text);
  if (cached !== undefined) return cached;
  const tokens = marked.lexer(text, { breaks: true, gfm: true });
  const html = marked.parser(tokens, { breaks: true, gfm: true, renderer });
  const snapshot = { html: sanitizeHtml(html), tail: describeMarkdownStreamTail(tokens, text) };
  markdownHtmlCache.set(text, snapshot);
  if (markdownHtmlCache.size > MAX_MARKDOWN_CACHE_ENTRIES) {
    const oldest = markdownHtmlCache.keys().next().value;
    if (oldest !== undefined) markdownHtmlCache.delete(oldest);
  }
  return snapshot;
}

export function toSafeMarkdownHtml(text: string): string {
  return markdownSnapshot(text).html;
}

export function markdownStreamTail(text: string): MarkdownStreamTail {
  return markdownSnapshot(text).tail;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const TABLE_SCROLL_CLASS = "table-scroll";

function sanitizeHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script, style, iframe, object, embed").forEach((node) => { node.remove(); });
  template.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if ((name === "href" || name === "src") && !isSafeUrl(attribute.value)) element.removeAttribute(attribute.name);
    }
    if (element.tagName === "A") {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noreferrer noopener");
    }
  });
  wrapTablesInScrollRegions(template.content);
  return template.innerHTML;
}

// Markdown tables stay at their natural width and scroll horizontally instead of
// being squeezed into the chat column, which is unreadable on narrow screens.
function wrapTablesInScrollRegions(root: DocumentFragment): void {
  root.querySelectorAll("table").forEach((table) => {
    if (table.parentElement?.classList.contains(TABLE_SCROLL_CLASS) === true) return;
    const wrapper = document.createElement("div");
    wrapper.className = TABLE_SCROLL_CLASS;
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Table");
    wrapper.setAttribute("tabindex", "0");
    table.before(wrapper);
    wrapper.append(table);
  });
}

function isSafeUrl(url: string): boolean {
  if (url.startsWith("#") || url.startsWith("/")) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
