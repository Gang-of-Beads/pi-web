// @vitest-environment happy-dom

import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { CodeViewer } from "./codeViewerElement";

afterEach(() => {
  document.body.replaceChildren();
});

const lines = (count: number, word: string): string => Array.from({ length: count }, (_, index) => `${word} ${String(index + 1)}`).join("\n");

async function shownViewer(path: string, content: string): Promise<CodeViewer> {
  const viewer = new CodeViewer();
  viewer.path = path;
  viewer.content = content;
  viewer.language = "markdown";
  document.body.append(viewer);
  await viewer.updateComplete;
  return viewer;
}

function editorOf(viewer: CodeViewer): { dom: Element; view: EditorView } {
  const dom = viewer.shadowRoot?.querySelector(".cm-editor");
  const view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null;
  if (dom === null || dom === undefined || view === null) throw new Error("the viewer drew no editor");
  return { dom, view };
}

/**
 * Files re-reads the open file while it is on screen (state-diagram D5), so new bytes of the same
 * file arrive while someone reads it. Rebuilding the editor for them put the reader back at line 1.
 */
describe("the code viewer keeps the reader's place", () => {
  it("shows new bytes of the same file in the same editor, keeping the selection", async () => {
    const viewer = await shownViewer("notes.md", lines(40, "old"));
    const before = editorOf(viewer);
    before.view.dispatch({ selection: { anchor: 20, head: 40 } });

    viewer.content = lines(41, "new");
    await viewer.updateComplete;
    const after = editorOf(viewer);

    expect({ sameEditor: after.dom === before.dom, text: after.view.state.doc.line(1).text, selection: [after.view.state.selection.main.anchor, after.view.state.selection.main.head] })
      .toEqual({ sameEditor: true, text: "new 1", selection: [20, 40] });
  });

  it("opens another file in a new editor", async () => {
    const viewer = await shownViewer("notes.md", lines(5, "old"));
    const before = editorOf(viewer);

    viewer.path = "other.md";
    viewer.content = lines(5, "other");
    await viewer.updateComplete;

    expect(editorOf(viewer).dom === before.dom).toBe(false);
  });

  it("keeps a selection inside a file that got shorter", async () => {
    const viewer = await shownViewer("notes.md", lines(40, "old"));
    editorOf(viewer).view.dispatch({ selection: { anchor: 100, head: 200 } });

    viewer.content = "short";
    await viewer.updateComplete;
    const selection = editorOf(viewer).view.state.selection.main;

    expect([selection.anchor, selection.head]).toEqual([5, 5]);
  });
});
