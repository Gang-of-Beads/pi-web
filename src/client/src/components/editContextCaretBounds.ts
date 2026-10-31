import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

/**
 * Where Android is told the composer's caret is.
 *
 * On Chrome for Android, CodeMirror takes text input through EditContext and reports the
 * selection's box with `updateSelectionBounds`, measured from the DOM selection, after a
 * selection, size or focus change and on every scroll. A caret on an empty line, and in an empty
 * composer, sits in a line element with no text, and a collapsed range there measures as an empty
 * box at (0, 0), so Android was told the caret was in the screen's top-left corner. The owner saw
 * the caret jump to the top of the screen while selecting text in the composer (2026-10-31, r175);
 * on 8505 with Chromium's EditContext every caret on an empty line reported (0, 0), while a caret on
 * text and any selected range reported their real box. On the same triggers, after CodeMirror's
 * read-phase report, a collapsed selection reports the caret's own coordinates instead, the ones
 * its drawn cursor uses; a range keeps CodeMirror's report. Without EditContext the plugin does
 * nothing.
 */
export const editContextCaretBounds = ViewPlugin.fromClass(class {
  update(update: ViewUpdate): void {
    if (update.selectionSet || update.geometryChanged || update.focusChanged) reportCaretBox(update.view);
  }
}, {
  eventObservers: {
    scroll(_event: Event, view: EditorView): void {
      reportCaretBox(view);
    },
  },
});

interface SelectionBoundsSink {
  updateSelectionBounds(bounds: DOMRect): void;
}

const CARET_BOUNDS = {
  key: "editContextCaretBounds",
  read(view: EditorView): DOMRect | undefined {
    const main = view.state.selection.main;
    if (!main.empty) return undefined;
    const caret = view.coordsAtPos(main.head, main.assoc || 1);
    return caret === null ? undefined : new DOMRect(caret.left, caret.top, 0, caret.bottom - caret.top);
  },
  write(caret: DOMRect | undefined, view: EditorView): void {
    if (caret === undefined) return;
    selectionBoundsSink(view.contentDOM)?.updateSelectionBounds(caret);
  },
};

function reportCaretBox(view: EditorView): void {
  if (!view.state.selection.main.empty || selectionBoundsSink(view.contentDOM) === undefined) return;
  view.requestMeasure(CARET_BOUNDS);
}

function selectionBoundsSink(element: HTMLElement): SelectionBoundsSink | undefined {
  const context: unknown = Reflect.get(element, "editContext");
  return isSelectionBoundsSink(context) ? context : undefined;
}

function isSelectionBoundsSink(value: unknown): value is SelectionBoundsSink {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "updateSelectionBounds") === "function";
}
