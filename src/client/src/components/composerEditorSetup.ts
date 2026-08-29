import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewlineAndIndent } from "@codemirror/commands";
import { markdown, deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Compartment, type SelectionRange } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";

/**
 * Everything that costs CodeMirror bytes lives here, behind a dynamic import.
 *
 * The composer's editor weighed 649KB of vendor chunks and rode the critical
 * path: index.html modulepreloaded it, so the first paint of a page waited on
 * an editor nobody had focused yet. The component keeps type-only imports;
 * this module is fetched when the composer actually mounts.
 */
export interface ComposerEditorCallbacks {
  parent: HTMLElement;
  doc: string;
  disabled: boolean;
  placeholderText: string | HTMLElement;
  contentAttributesFor(leadingText: string): Record<string, string>;
  onDocChanged(text: string): void;
  onKeyUp(event: KeyboardEvent): boolean;
  onBlur(): void;
  onKeyDown(event: KeyboardEvent, view: EditorView): boolean;
  onArrow(view: EditorView, direction: "newer" | "older"): boolean;
  onEscape(): boolean;
  onTab(view: EditorView): boolean;
}

export interface ComposerEditorHandle {
  view: EditorView;
  setDisabled(disabled: boolean): void;
}

export function createComposerEditor(options: ComposerEditorCallbacks): ComposerEditorHandle {
  const editable = new Compartment();
  const readOnly = new Compartment();
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        history(),
        markdown(),
        indentOnInput(),
        indentUnit.of("  "),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        drawSelection(),
        EditorView.contentAttributes.of((current) => options.contentAttributesFor(current.state.sliceDoc(0, current.state.selection.main.head))),
        EditorView.domEventHandlers({
          keyup: (event) => options.onKeyUp(event),
          blur: () => { options.onBlur(); },
        }),
        placeholder(options.placeholderText),
        editable.of(EditorView.editable.of(!options.disabled)),
        readOnly.of(EditorState.readOnly.of(options.disabled)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onDocChanged(update.state.doc.toString());
        }),
        keymap.of([
          { any: (keyView, event) => options.onKeyDown(event, keyView) },
          { key: "ArrowDown", run: (keyView) => options.onArrow(keyView, "newer") },
          { key: "ArrowUp", run: (keyView) => options.onArrow(keyView, "older") },
          { key: "Escape", run: () => options.onEscape() },
          { key: "Tab", run: (keyView) => options.onTab(keyView) },
          { key: "Shift-Tab", run: (keyView) => indentWithTab.shift?.(keyView) ?? false },
          { key: "Backspace", run: (keyView) => deleteMarkupBackward(keyView) },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
      ],
    }),
  });
  return {
    view,
    setDisabled(disabled: boolean): void {
      view.dispatch({
        effects: [
          editable.reconfigure(EditorView.editable.of(!disabled)),
          readOnly.reconfigure(EditorState.readOnly.of(disabled)),
        ],
      });
    },
  };
}

/** A collapsed selection at `position`, for dispatch sites outside this module. */
export function cursorAt(position: number): SelectionRange {
  return EditorSelection.cursor(position);
}

/** The composer's Enter: continue markdown structure, else a plain indent-aware newline. */
export function composerNewline(view: EditorView): boolean {
  return insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view);
}

/** The composer's Tab fallback when no completion is open. */
export function composerIndent(view: EditorView): boolean {
  return indentWithTab.run?.(view) ?? false;
}
