// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SentPrompt } from "../resendMessage";
import { PromptEditor } from "./PromptEditor";

/**
 * A composer that takes words back takes focus, and CodeMirror checks focus 10 ms after each
 * change. A check left pending into the next test throws in happy-dom once the focus is in another
 * composer's shadow root, so a test leaves its composer blurred and its checks done.
 */
async function settleComposerFocus(): Promise<void> {
  for (const editor of document.querySelectorAll("prompt-editor")) {
    const focused = editor.shadowRoot?.activeElement;
    if (focused instanceof HTMLElement) focused.blur();
  }
  await new Promise((resolve) => { setTimeout(resolve, 20); });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await settleComposerFocus();
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

  it("keeps what the reader already has and adds the taken-back message after it, its words at once and a referenced image when it arrives", async () => {
    const editor = await mountEditor();
    let answerImage: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { answerImage = resolve; })));
    const fromHistory: SentPrompt = { text: "third", images: [{ kind: "referenced", mimeType: "image/png", path: "api/sessions/s/entries/e3/images/0" }] };
    const chips = () => shadow(editor).querySelectorAll(".attachment-chip").length;

    editor.takeBack({ text: "first", attachments: [{ kind: "image", mimeType: "image/png", data: "AAAA" }] });
    await editor.updateComplete;
    editor.takeBack({ text: "second", attachments: [{ kind: "image", mimeType: "image/png", data: "CCCC" }] });
    await editor.updateComplete;
    editor.takeBackSent(fromHistory);
    editor.takeBackSent(fromHistory);
    await editor.updateComplete;
    const whileJoining = { chips: chips(), draft: String(Reflect.get(editor, "draft")) };
    answerImage(new Response(new Blob(["png"], { type: "image/png" })));
    await vi.waitFor(() => { expect(chips()).toBe(3); });

    expect({ whileJoining, draft: String(Reflect.get(editor, "draft")) }).toEqual({ whileJoining: { chips: 2, draft: "first\n\nsecond\n\nthird" }, draft: "first\n\nsecond\n\nthird" });
  });

  it("restores a text-only prompt without inventing an attachment", async () => {
    const editor = await mountEditor();

    editor.takeBack({ text: "no images here", attachments: [] });
    await editor.updateComplete;

    expect(shadow(editor).querySelectorAll(".attachment-chip")).toHaveLength(0);
  });

  it("restores a file attachment, which a message carries only until it is saved to the workspace", async () => {
    const editor = await mountEditor();

    editor.takeBack({
      text: "see the notes",
      attachments: [{ kind: "file", mimeType: "text/plain", data: "AAAA", name: "notes.txt" }],
    });
    await editor.updateComplete;

    expect([...shadow(editor).querySelectorAll(".attachment-chip")].map((chip) => chip.getAttribute("title"))).toEqual(["notes.txt"]);
  });
});

let mounted = 0;

/** A fresh session per test: a removed composer holds its images for its session, as the app wants. */
async function mountEditor(): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = `session-${String(++mounted)}`;
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
