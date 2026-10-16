import morphdom from "morphdom";
import type { MarkdownStreamTail } from "../formatting/markdownStreamTail";
import { FormattedTextTail } from "./formattedTextTail";

export type MarkdownDomUpdate = "append" | "canonical" | "replace";

function updateText(current: Text, next: Text): void {
  if (current.data === next.data) return;
  if (next.data.startsWith(current.data)) {
    current.appendData(next.data.slice(current.length));
    return;
  }
  let start = 0;
  while (start < current.length && start < next.length && current.data[start] === next.data[start]) start += 1;
  let end = 0;
  while (end < current.length - start && end < next.length - start && current.data[current.length - end - 1] === next.data[next.length - end - 1]) end += 1;
  current.replaceData(start, current.length - start - end, next.data.slice(start, next.length - end));
}

function updateChildren(current: HTMLElement, next: HTMLElement): boolean {
  const before = current.firstChild;
  const after = next.firstChild;
  if (current.childNodes.length !== 1 || next.childNodes.length !== 1 || !(before instanceof Text) || !(after instanceof Text)) return true;
  updateText(before, after);
  return false;
}

function updateElement(current: HTMLElement, next: HTMLElement): boolean {
  if (current instanceof HTMLButtonElement && current.classList.contains("code-copy-button") && next.classList.contains("code-copy-button")) return false;
  return !current.isEqualNode(next);
}

/** Owns the rendered subtree; only canonical sanitized HTML may enter a DOM commit. */
export class FormattedTextDom {
  private readonly tail = new FormattedTextTail();
  private root: HTMLElement | undefined;
  private html = "";

  resetTail(): void {
    this.tail.reset();
  }

  append(root: HTMLElement, tail: MarkdownStreamTail, text: string): boolean {
    return this.tail.append(root, tail, text);
  }

  commit(root: HTMLElement, html: string, mode: MarkdownDomUpdate, prepare: (target: HTMLElement) => void): void {
    const sameRoot = root === this.root;
    if (sameRoot && mode !== "replace" && html === this.html && (mode === "append" || !this.tail.active)) return;
    const target = document.createElement("div");
    target.innerHTML = html;
    prepare(target);
    if (!sameRoot || mode === "replace") {
      this.tail.reset();
      root.replaceChildren(...target.childNodes);
    } else {
      this.tail.materialize(root);
      morphdom(root, target, { childrenOnly: true, onBeforeElUpdated: updateElement, onBeforeElChildrenUpdated: updateChildren });
    }
    this.root = root;
    this.html = html;
  }
}
