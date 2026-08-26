// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { PromptEditor } from "./PromptEditor";

afterEach(() => { document.body.replaceChildren(); });

/**
 * Dictation transcribed only after the recording stopped, so a long thought
 * arrived as a wall of text minutes after it was spoken. With streaming
 * configured the words should appear while they are still being said.
 *
 * The two modes share one control: an install that configured only the batch
 * endpoint keeps the behaviour it had, and one that configured streaming gets
 * live text without a second button to learn.
 */
describe("the dictation control", () => {
  it("is offered when only the batch endpoint is configured", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1" });

    expect(dictateButton(editor)).not.toBeNull();
  });

  it("is offered when streaming is configured", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1", streaming: { protocol: "browser" } });

    expect(dictateButton(editor)).not.toBeNull();
  });

  it("is absent when nothing is configured, so no microphone can be reached", async () => {
    const editor = await mount(undefined);

    expect(dictateButton(editor)).toBeNull();
  });

  it("reports that it will stream when streaming is configured", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1", streaming: { protocol: "browser" } });

    // The label is the only thing that tells a user which mode they are in
    // before they speak into it.
    expect(dictateButton(editor)?.getAttribute("title") ?? "").toMatch(/live|stream/iu);
  });

  it("does not claim to stream when only the batch endpoint is configured", async () => {
    const editor = await mount({ endpoint: "https://stt.example/v1" });

    expect(dictateButton(editor)?.getAttribute("title") ?? "").not.toMatch(/live|stream/iu);
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
