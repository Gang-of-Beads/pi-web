// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { PromptEditor } from "./PromptEditor";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

/**
 * Taking a message back must restore the images too - re-picking them is the step that
 * makes people give up - and must never overwrite what the reader is already typing.
 */
describe("prompt-editor takeBack", () => {
  it("restores the text and the images as pending attachments", async () => {
    const editor = await mountEditor();

    editor.takeBack({
      text: "look at this",
      attachments: [
        { kind: "image", mimeType: "image/png", data: "AAAA", name: "shot.png" },
        { kind: "image", mimeType: "image/webp", data: "BBBB" },
      ],
    });
    await editor.updateComplete;

    const chips = [...shadow(editor).querySelectorAll(".attachment-chip")];
    expect(chips).toHaveLength(2);
    // The original filename is preserved for the preview's tooltip; an image
    // recovered without one still gets a stable placeholder name.
    expect(chips.map((chip) => chip.getAttribute("title"))).toEqual(["shot.png", "image-2"]);
  });

  it("keeps what the reader already has and adds the taken-back message after it", async () => {
    const editor = await mountEditor();

    editor.takeBack({ text: "first", attachments: [{ kind: "image", mimeType: "image/png", data: "AAAA" }] });
    await editor.updateComplete;
    editor.takeBack({ text: "second", attachments: [{ kind: "image", mimeType: "image/png", data: "CCCC" }] });
    await editor.updateComplete;

    expect(shadow(editor).querySelectorAll(".attachment-chip")).toHaveLength(2);
    expect(String(Reflect.get(editor, "draft"))).toBe("first\n\nsecond");
  });

  it("restores a text-only prompt without inventing an attachment", async () => {
    const editor = await mountEditor();

    editor.takeBack({ text: "no images here", attachments: [] });
    await editor.updateComplete;

    expect(shadow(editor).querySelectorAll(".attachment-chip")).toHaveLength(0);
  });

  it("ignores a file attachment, whose workspace reference already lives in the text", async () => {
    const editor = await mountEditor();

    editor.takeBack({
      text: "see @notes.txt",
      attachments: [{ kind: "file", mimeType: "text/plain", data: "AAAA", name: "notes.txt" }],
    });
    await editor.updateComplete;

    expect(shadow(editor).querySelectorAll(".attachment-chip")).toHaveLength(0);
  });
});

async function mountEditor(): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "session-1";
  editor.cwd = "/repo";
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function shadow(editor: PromptEditor): ShadowRoot {
  const root = editor.shadowRoot;
  if (root === null) throw new Error("Expected prompt-editor shadow root");
  return root;
}
