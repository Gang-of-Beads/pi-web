// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { machineSessionKey } from "../machineKeys";
import { promptHistoryKey } from "../promptHistory";
import { PromptEditor } from "./PromptEditor";

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); });

/**
 * Prompt history answered only to Ctrl/Cmd+R. A phone has no keyboard, so the
 * sentences it had already typed were unreachable on the device where typing
 * is hardest.
 */
describe("the composer's history entrance", () => {
  it("appears in the controls row once this session has prompts behind it", async () => {
    seedHistory("typed on the train earlier");
    const editor = await mount();
    const button = historyButton(editor);

    expect(button).not.toBeNull();
    expect(editor.shadowRoot?.querySelector(".actions")?.contains(button)).toBe(true);
  });

  it("opens the searchable history sheet the shortcut opens", async () => {
    seedHistory("typed on the train earlier");
    const editor = await mount();

    historyButton(editor)?.click();
    await editor.updateComplete;

    const panel = editor.shadowRoot?.querySelector("prompt-history-panel");
    expect(panel).not.toBeNull();
    expect(entryTexts(panel)).toContain("typed on the train earlier");
  });

  it("is absent when the session has no history yet", async () => {
    const editor = await mount();

    expect(historyButton(editor)).toBeNull();
  });
});

function seedHistory(entry: string): void {
  localStorage.setItem(promptHistoryKey(machineSessionKey("local", "s")), JSON.stringify([entry]));
}

function historyButton(editor: PromptEditor): HTMLButtonElement | null {
  return editor.shadowRoot?.querySelector<HTMLButtonElement>(".editor-history") ?? null;
}

function entryTexts(panel: Element | null | undefined): string[] {
  return [...panel?.shadowRoot?.querySelectorAll<HTMLButtonElement>("button.entry") ?? []]
    .map((entry) => entry.textContent.trim());
}

async function mount(): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "s";
  editor.machineId = "local";
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

describe("the entrance on a browser that never typed here", () => {
  /**
   * The gate read only this browser's localStorage, so a fresh device showed
   * no door in front of a session holding fifteen thousand messages. The
   * session's own user prompts are history too.
   */
  it("opens when the session itself carries prompts", async () => {
    const editor = await mount();
    editor.sessionPrompts = ["prompt that reached the server"];
    await editor.updateComplete;

    expect(historyButton(editor)).not.toBeNull();
  });

  it("lists the session's prompts in the sheet", async () => {
    const editor = await mount();
    editor.sessionPrompts = ["prompt that reached the server"];
    await editor.updateComplete;

    historyButton(editor)?.click();
    await editor.updateComplete;

    const panel = editor.shadowRoot?.querySelector("prompt-history-panel");
    expect(panel).not.toBeNull();
    expect(entryTexts(panel)).toContain("prompt that reached the server");
  });
});
