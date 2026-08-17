// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { PromptEditor } from "./PromptEditor";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

/**
 * Retrying a failed turn must restore the images too. Re-picking them is the
 * step that makes people give up, because a screenshot from a share sheet is
 * often no longer at hand.
 */
describe("prompt-editor restorePrompt", () => {
  it("restores the text and the images as pending attachments", async () => {
    const editor = await mountEditor();

    editor.restorePrompt({
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

  it("replaces earlier attachments instead of merging two prompts", async () => {
    const editor = await mountEditor();

    editor.restorePrompt({ text: "first", attachments: [{ kind: "image", mimeType: "image/png", data: "AAAA" }] });
    await editor.updateComplete;
    editor.restorePrompt({ text: "second", attachments: [{ kind: "image", mimeType: "image/png", data: "CCCC" }] });
    await editor.updateComplete;

    expect(shadow(editor).querySelectorAll(".attachment-chip")).toHaveLength(1);
  });

  it("restores a text-only prompt without inventing an attachment", async () => {
    const editor = await mountEditor();

    editor.restorePrompt({ text: "no images here", attachments: [] });
    await editor.updateComplete;

    expect(shadow(editor).querySelectorAll(".attachment-chip")).toHaveLength(0);
  });

  it("ignores a file attachment, whose workspace reference already lives in the text", async () => {
    const editor = await mountEditor();

    editor.restorePrompt({
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
