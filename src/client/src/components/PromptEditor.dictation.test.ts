// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { PromptEditor } from "./PromptEditor";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

/**
 * Dictation is opt-in. Audio is sensitive enough that the control must not
 * exist at all until an endpoint is configured — offering a microphone that
 * cannot work would be worse than not offering one.
 */
describe("prompt-editor dictation control", () => {
  it("is absent when no transcription endpoint is configured", async () => {
    const editor = await mount(undefined);
    expect(shadow(editor).querySelector(".editor-dictate")).toBeNull();
  });

  it("is absent when the configured endpoint is blank", async () => {
    const editor = await mount({ endpoint: "   " });
    expect(shadow(editor).querySelector(".editor-dictate")).toBeNull();
  });

  it("appears once an endpoint is configured, labelled and not yet listening", async () => {
    const editor = await mount({ endpoint: "http://127.0.0.1:9000/transcribe" });
    const button = shadow(editor).querySelector(".editor-dictate");

    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Dictate");
    expect(button?.getAttribute("aria-pressed")).toBe("false");
  });

  it("appends dictated text to what is already typed rather than replacing it", async () => {
    const editor = await mount({ endpoint: "http://127.0.0.1:9000/transcribe" });
    editor.replaceText("already typed");

    // The path the controller's onTranscript callback drives.
    editor.insertDictatedText("and dictated");
    await editor.updateComplete;

    expect(draftText(editor)).toBe("already typed and dictated");
  });

  it("does not add a separator when the draft is empty", async () => {
    const editor = await mount({ endpoint: "http://127.0.0.1:9000/transcribe" });
    editor.insertDictatedText("first words");
    await editor.updateComplete;

    expect(draftText(editor)).toBe("first words");
  });
});

async function mount(speechToText: { endpoint: string } | undefined): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "dictation-probe";
  editor.cwd = "/tmp";
  if (speechToText !== undefined) editor.speechToText = speechToText;
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function shadow(editor: PromptEditor): ShadowRoot {
  const root = editor.shadowRoot;
  if (root === null) throw new Error("Expected prompt-editor shadow root");
  return root;
}


/** The editor's current text, read the way the send path reads it. */
function draftText(editor: PromptEditor): string {
  return editor.view?.state.doc.toString() ?? "";
}
