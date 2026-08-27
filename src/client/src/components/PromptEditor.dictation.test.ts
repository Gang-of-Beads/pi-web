// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { PromptEditor } from "./PromptEditor";

afterEach(() => { document.body.replaceChildren(); });

/**
 * Dictation is a control in the row with the others.
 *
 * It was briefly two other things: a button floating over the corner of the
 * text, where it covered what was being typed; and a hold on the composer
 * itself, which fought the phone's own press-and-hold for selecting text. A
 * gesture that a text field already owns cannot be borrowed.
 */
describe("the dictation control", () => {
  it("is offered whenever dictation is configured", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1" });

    expect(dictateButton(editor)).not.toBeNull();
  });

  it("does not float over the text it dictates into", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1" });
    const row = editor.shadowRoot?.querySelector(".actions");

    expect(row?.contains(dictateButton(editor))).toBe(true);
  });

  it("is absent when nothing is configured, so no microphone can be reached", async () => {
    const editor = await mount(undefined);

    expect(dictateButton(editor)).toBeNull();
  });

  /**
   * The composer must not claim a gesture it does not have.
   */
  it("does not tell the reader to hold the composer", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1" });
    const field = editor.shadowRoot?.querySelector(".markdown-editor");

    expect(field?.getAttribute("aria-label") ?? "").not.toMatch(/hold/iu);
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

describe("what dictation tells you while it runs", () => {
  /**
   * Every voice state - listening, transcribing, a microphone that could not be
   * opened, a permission that was refused, a transcription that failed - was
   * written only into the button's title and aria-label. A phone has no
   * tooltips, so pressing the button, speaking, and getting nothing back was
   * indistinguishable from the feature not existing.
   */
  it("says on screen that it is listening", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1" });

    Reflect.set(editor, "voiceState", { kind: "listening" });
    editor.requestUpdate();
    await editor.updateComplete;

    expect(editor.shadowRoot?.querySelector(".mode-hint")?.textContent ?? "").toMatch(/listening/iu);
  });

  it("shows the reason when the microphone could not be opened", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1" });

    Reflect.set(editor, "voiceState", { kind: "error", message: "Microphone unavailable: NotFoundError" });
    editor.requestUpdate();
    await editor.updateComplete;

    expect(editor.shadowRoot?.querySelector(".mode-hint")?.textContent ?? "").toMatch(/microphone unavailable/iu);
  });

  it("stays quiet when nobody is dictating", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1" });

    expect(editor.shadowRoot?.querySelector(".mode-hint")).toBeNull();
  });
});
