import type { MarkdownStreamTail } from "../formatting/markdownStreamTail";

/** FormattedTextDom owns the canonical subtree; this owns only the uncommitted span. */
export class FormattedTextTail {
  private span: HTMLSpanElement | undefined;
  private boundTail: MarkdownStreamTail | undefined;

  get active(): boolean {
    return this.span !== undefined;
  }

  reset(): void {
    this.span?.remove();
    this.span = undefined;
    this.boundTail = undefined;
  }

  materialize(root: Element): void {
    const span = this.span;
    this.span = undefined;
    this.boundTail = undefined;
    if (span === undefined) return;
    if (!root.contains(span)) {
      span.remove();
      return;
    }
    const parent = span.parentNode;
    span.replaceWith(...span.childNodes);
    parent?.normalize();
  }

  append(root: Element, tail: MarkdownStreamTail, text: string): boolean {
    if (tail.kind === "none") return false;
    if (this.span !== undefined && this.boundTail === tail && root.contains(this.span)) {
      const current = this.span.firstChild;
      if (current instanceof Text && text.startsWith(current.data)) current.appendData(text.slice(current.length));
      else this.span.textContent = text;
      return true;
    }
    this.reset();
    const selector = tail.kind === "code" ? ".code-block-wrapper > pre > code" : tail.tag;
    const target = [...root.querySelectorAll(selector)].reverse().find((element) => element.closest(".code-fence-render") === null);
    if (!(target instanceof HTMLElement)) return false;
    if (tail.kind === "code" && target.closest(".code-fence-claimed") !== null) return false;
    const span = document.createElement("span");
    span.className = "stream-suffix";
    span.textContent = text;
    if (tail.kind === "code") {
      const last = target.lastChild;
      if (!(last instanceof Text) || !last.data.endsWith("\n")) return false;
      const newline = last.splitText(last.length - 1);
      target.insertBefore(span, newline);
    } else {
      target.append(span);
    }
    this.span = span;
    this.boundTail = tail;
    return true;
  }
}
