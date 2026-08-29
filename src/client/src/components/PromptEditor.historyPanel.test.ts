// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { machineSessionKey } from "../machineKeys";
import { loadDraft } from "../promptDraftStorage";
import { promptHistoryKey } from "../promptHistory";
import type { PromptHistoryPanel } from "./PromptHistoryPanel";
import { pressKey, requiredElement, settleRenderedDialog, surfaceBackdrop } from "./modalSurfaceTestSupport";
import { PromptEditor } from "./PromptEditor";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

/**
 * The composer's history surface shipped as a bare floating list: no search,
 * no visible way to close it on a phone, and it sat over the composer it
 * feeds. The original request was quick search of input history - search was
 * the whole point - and a surface that opens must always be closable.
 */
describe("the composer's history sheet", () => {
  it("shows every entry most recent first on an empty query", async () => {
    seedHistory(["newest prompt", "middle prompt", "oldest prompt"]);
    const editor = await mount();
    const panel = await openPanel(editor);

    expect(entryTexts(panel)).toEqual(["newest prompt", "middle prompt", "oldest prompt"]);
  });

  it("narrows the list as you type, ranking with the existing token rules", async () => {
    seedHistory(["run the mobile tests", "deploy the container", "unrelated entry"]);
    const editor = await mount();
    const panel = await openPanel(editor);

    typeQuery(panel, "deploy");
    await panel.updateComplete;
    expect(entryTexts(panel)).toEqual(["deploy the container"]);

    // "dct" matches by subsequence, not substring: this is searchPromptHistory's
    // ranking, the one the keyboard shortcut already used.
    typeQuery(panel, "dct");
    await panel.updateComplete;
    expect(entryTexts(panel)).toEqual(["deploy the container"]);

    typeQuery(panel, "");
    await panel.updateComplete;
    expect(entryTexts(panel)).toHaveLength(3);
  });

  it("fills the composer with a tapped entry and closes the sheet", async () => {
    seedHistory(["deploy the container", "run the mobile tests"]);
    const editor = await mount();
    const panel = await openPanel(editor);

    entryButton(panel, "deploy the container").click();
    await editor.updateComplete;

    expect(editor.shadowRoot?.querySelector("prompt-history-panel")).toBeNull();
    expect(loadDraft(machineSessionKey("local", "s"))).toBe("deploy the container");
  });

  it("closes from the close button", async () => {
    seedHistory(["deploy the container"]);
    const editor = await mount();
    const panel = await openPanel(editor);

    closeButton(panel).click();
    await editor.updateComplete;

    expect(editor.shadowRoot?.querySelector("prompt-history-panel")).toBeNull();
  });

  it("closes when the backdrop is tapped", async () => {
    seedHistory(["deploy the container"]);
    const editor = await mount();
    const panel = await openPanel(editor);

    surfaceBackdrop(panel).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
    await editor.updateComplete;

    expect(editor.shadowRoot?.querySelector("prompt-history-panel")).toBeNull();
  });

  it("closes on Escape", async () => {
    seedHistory(["deploy the container"]);
    const editor = await mount();
    const panel = await openPanel(editor);

    pressKey(searchInput(panel), "Escape");
    await editor.updateComplete;

    expect(editor.shadowRoot?.querySelector("prompt-history-panel")).toBeNull();
  });

  it("keeps the keyboard path working: arrows move and Enter reuses the selected entry", async () => {
    seedHistory(["deploy the container", "run the mobile tests"]);
    const editor = await mount();
    const panel = await openPanel(editor);

    pressKey(searchInput(panel), "ArrowDown");
    await panel.updateComplete;
    pressKey(searchInput(panel), "Enter");
    await editor.updateComplete;

    expect(editor.shadowRoot?.querySelector("prompt-history-panel")).toBeNull();
    expect(loadDraft(machineSessionKey("local", "s"))).toBe("run the mobile tests");
  });
});

function seedHistory(entries: string[]): void {
  localStorage.setItem(promptHistoryKey(machineSessionKey("local", "s")), JSON.stringify(entries));
}

async function mount(): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "s";
  editor.machineId = "local";
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

async function openPanel(editor: PromptEditor): Promise<PromptHistoryPanel> {
  const button = requiredElement(editor.shadowRoot?.querySelector<HTMLButtonElement>(".editor-history"), "history button");
  button.click();
  await editor.updateComplete;
  const panel = requiredElement(editor.shadowRoot?.querySelector<PromptHistoryPanel>("prompt-history-panel"), "prompt-history-panel");
  await settleRenderedDialog(panel);
  return panel;
}

function searchInput(panel: PromptHistoryPanel): HTMLInputElement {
  return requiredElement(panel.shadowRoot?.querySelector<HTMLInputElement>("input.history-search"), "history search input");
}

function closeButton(panel: PromptHistoryPanel): HTMLButtonElement {
  return requiredElement(panel.shadowRoot?.querySelector<HTMLButtonElement>("button.close"), "history close button");
}

function entryButton(panel: PromptHistoryPanel, text: string): HTMLButtonElement {
  const entry = [...panel.shadowRoot?.querySelectorAll<HTMLButtonElement>("button.entry") ?? []]
    .find((candidate) => candidate.textContent.trim() === text);
  return requiredElement(entry, `history entry “${text}”`);
}

function entryTexts(panel: PromptHistoryPanel): string[] {
  return [...panel.shadowRoot?.querySelectorAll<HTMLButtonElement>("button.entry") ?? []]
    .map((entry) => entry.textContent.trim());
}

function typeQuery(panel: PromptHistoryPanel, value: string): void {
  const input = searchInput(panel);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}
