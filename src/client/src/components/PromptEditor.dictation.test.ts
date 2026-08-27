// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { PromptEditor } from "./PromptEditor";

afterEach(() => { document.body.replaceChildren(); });

/**
 * Dictation used to need a button of its own, sitting in the composer whether
 * or not anyone was speaking. Holding the composer is the gesture now, so an
 * idle composer carries no dictation control at all.
 *
 * While recording there has to be a way to stop, and something has to say that
 * recording is happening - so the control appears for exactly as long as it is
 * needed.
 */
describe("the dictation control", () => {
  it("is absent while nobody is speaking", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1" });

    expect(dictateButton(editor)).toBeNull();
  });

  it("appears while recording, so there is a way to stop", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1" });

    Reflect.set(editor, "voiceState", { kind: "listening" });
    editor.requestUpdate();
    await editor.updateComplete;

    expect(dictateButton(editor)).not.toBeNull();
  });

  it("is absent when nothing is configured, so no microphone can be reached", async () => {
    const editor = await mount(undefined);

    Reflect.set(editor, "voiceState", { kind: "listening" });
    editor.requestUpdate();
    await editor.updateComplete;

    expect(dictateButton(editor)).toBeNull();
  });

  it("says the composer is what starts it", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1" });
    const field = editor.shadowRoot?.querySelector(".markdown-editor");

    expect(field?.getAttribute("aria-label") ?? "").toMatch(/hold/iu);
  });
});

function dictateButton(editor: PromptEditor): HTMLButtonElement | null {
  return editor.shadowRoot?.querySelector<HTMLButtonElement>(".editor-dictate") ?? null;
}

async function mount(speechToText: PromptEditor["speechToText"]): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "s";
  editor.machineId = "local";
  if (speechToText !== undefined) editor.speechToText = speechToText;
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}
