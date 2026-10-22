import { EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css as cssLang } from "@codemirror/lang-css";
import { html as htmlLang } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { LitElement, css, html } from "lit";
import { property, query } from "lit/decorators.js";
export class CodeViewer extends LitElement {
  @property() path: string | undefined;
  @property() content = "";
  @property() language: string | undefined;
  @query(".host") private editorHost?: HTMLDivElement;

  private view: EditorView | undefined;

  override updated(changed: Map<string, unknown>): void {
    if (this.view === undefined || changed.has("path") || changed.has("language")) this.recreateEditor();
    else if (changed.has("content")) this.replaceContent(this.view);
  }

  override disconnectedCallback(): void {
    this.view?.destroy();
    this.view = undefined;
    super.disconnectedCallback();
  }

  override render() {
    return html`<div class="host"></div>`;
  }

  /**
   * The reader's selection as 1-based line numbers, undefined while collapsed
   * or before the editor exists: what a line-range mention needs.
   */
  selectionLines(): { start: number; end: number; endCoords: { top: number; left: number } | undefined } | undefined {
    const view = this.view;
    if (view === undefined) return undefined;
    const range = view.state.selection.main;
    if (range.from === range.to) return undefined;
    const start = view.state.doc.lineAt(range.from).number;
    const end = view.state.doc.lineAt(range.to).number;
    const coords = view.coordsAtPos(range.to);
    if (coords === null) return undefined;
    return { start, end, endCoords: { top: coords.top, left: coords.left } };
  }

  /**
   * New bytes of the open file land in the view that shows it, with the
   * selection kept and the reader's place kept. Rebuilding the view put a
   * reader at line 300 back at line 1 whenever the agent wrote the file, which
   * Files now notices every few seconds (review of a9968cd2). The edit is the
   * span that differs, so CodeMirror's own scroll anchor keeps the top line and
   * only the editor's scroller moves: carrying the line with
   * `EditorView.scrollIntoView` also scrolled every scrollable parent to put it
   * at their top, the Files viewer and the page with it. The new bytes are
   * compared as CodeMirror splits them (`toText`), so a CRLF file differs only
   * where it changed. Another file still gets a new view.
   */
  private replaceContent(view: EditorView): void {
    const { anchor, head } = view.state.selection.main;
    const next = view.state.toText(this.content);
    const shownFrom = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
    const topLine = view.state.doc.lineAt(view.lineBlockAtHeight(shownFrom).from).number;
    view.dispatch({
      changes: changesKeepingLines(view.state.doc, next, [topLine, topLine + 1]),
      selection: { anchor: Math.min(anchor, next.length), head: Math.min(head, next.length) },
    });
  }

  private recreateEditor(): void {
    if (!this.editorHost) return;
    this.view?.destroy();
    this.view = new EditorView({
      parent: this.editorHost,
      state: EditorState.create({
        doc: this.content,
        extensions: [
          lineNumbers(),
          keymap.of(defaultKeymap),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          viewerTheme,
          ...bidiTextExtensions(this.language),
          ...languageExtensions(this.language),
        ],
      }),
    });
  }

  static override styles = css`
    :host { display: block; min-height: 0; height: 100%; }
    .host { height: 100%; min-height: 0; overflow: auto; }
  `;
}

interface SpanCut {
  readonly before: number;
  readonly after: number;
}

/**
 * The edit from `previous` to `next`: the one span that differs, cut at the start of each kept line
 * that falls inside it. CodeMirror keeps the line at the top of the view by mapping its start through
 * the edit, and a position inside a replaced span maps to the span's start - an edit above and one
 * below the reader's line in one write moved the reader to the first. Cut there, the line's start
 * maps to the start of the line with the same number in `next`. Two lines are kept because CodeMirror
 * anchors on the line 8 px below the top.
 */
function changesKeepingLines(previous: Text, next: Text, keptLines: readonly number[]): { from: number; to: number; insert: string }[] {
  const after = next.toString();
  const span = changedSpan(previous.toString(), after);
  const insertEnd = span.from + span.insert.length;
  const cuts = keptLines
    .filter((line) => line <= previous.lines)
    .map((line): SpanCut => ({ before: previous.line(line).from, after: Math.min(Math.max(next.line(Math.min(line, next.lines)).from, span.from), insertEnd) }))
    .filter((cut) => cut.before > span.from && cut.before < span.to);
  const changes: { from: number; to: number; insert: string }[] = [];
  let start: SpanCut = { before: span.from, after: span.from };
  for (const cut of [...cuts, { before: span.to, after: insertEnd }]) {
    changes.push({ from: start.before, to: cut.before, insert: after.slice(start.after, cut.after) });
    start = cut;
  }
  return changes;
}

/** The one span of `previous` that `next` replaces: everything between their common start and common end. */
function changedSpan(previous: string, next: string): { from: number; to: number; insert: string } {
  const shorter = Math.min(previous.length, next.length);
  let start = 0;
  while (start < shorter && previous.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  let end = 0;
  while (end < shorter - start && previous.charCodeAt(previous.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) end += 1;
  return { from: start, to: previous.length - end, insert: next.slice(start, next.length - end) };
}

const viewerTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--pi-text)",
    backgroundColor: "var(--pi-bg)",
    fontSize: "12px",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: "1.45",
  },
  ".cm-gutters": {
    backgroundColor: "var(--pi-bg)",
    color: "var(--pi-dim)",
    borderRight: "1px solid var(--pi-border-muted)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-content": {
    caretColor: "transparent",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

const bidiTextTheme = EditorView.theme({
  ".cm-content": {
    textAlign: "start",
  },
  ".cm-line": {
    unicodeBidi: "plaintext",
  },
});

function bidiTextExtensions(language: string | undefined): Extension[] {
  return language === "markdown" ? [EditorView.contentAttributes.of({ dir: "auto" }), bidiTextTheme] : [];
}

function languageExtensions(language: string | undefined): Extension[] {
  if (language === undefined) return [];
  switch (language) {
    case "typescript": return [javascript({ typescript: true })];
    case "javascript": return [javascript()];
    case "json": return [json()];
    case "markdown": return [markdown()];
    case "css": return [cssLang()];
    case "html": return [htmlLang()];
    case "python": return [python()];
    case "rust": return [rust()];
    case "go": return [go()];
    case "diff": return [StreamLanguage.define(diff)];
    default: return [];
  }
}

if (customElements.get("pi-code-viewer") === undefined) customElements.define("pi-code-viewer", CodeViewer);
