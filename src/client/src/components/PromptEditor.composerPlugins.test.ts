// @vitest-environment happy-dom

import { html } from "lit";
import { describe, expect, it, vi } from "vitest";
import { PromptEditor } from "./PromptEditor";
import type { QualifiedComposerContribution } from "../plugins/types";

function contribution(patch: Partial<QualifiedComposerContribution> = {}): QualifiedComposerContribution {
  return {
    id: "voice:dictate",
    pluginId: "voice",
    localId: "dictate",
    slot: "trailing",
    title: "Dictate",
    run: vi.fn(),
    ...patch,
  };
}

async function editorWith(contributions: QualifiedComposerContribution[]): Promise<PromptEditor> {
  const element = new PromptEditor();
  element.composerContributions = contributions;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

function buttons(element: PromptEditor): HTMLButtonElement[] {
  return [...(element.shadowRoot?.querySelectorAll("button") ?? [])];
}

describe("composer plugin contributions", () => {
  it("renders a contributed action in the composer", async () => {
    const element = await editorWith([contribution()]);

    expect(buttons(element).some((button) => button.getAttribute("aria-label") === "Dictate")).toBe(true);
  });

  it("runs the contribution with the current draft", async () => {
    const run = vi.fn();
    const element = await editorWith([contribution({ run })]);

    buttons(element).find((button) => button.getAttribute("aria-label") === "Dictate")?.click();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatchObject({ machineId: "local" });
  });

  it("disables a contribution and shows why", async () => {
    const element = await editorWith([contribution({ enabled: () => false, disabledReason: () => "Microphone refused" })]);

    const button = buttons(element).find((candidate) => candidate.getAttribute("aria-label") === "Dictate");

    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("title")).toBe("Microphone refused");
  });

  it("renders a contributed status line inside the composer", async () => {
    const element = await editorWith([contribution({ status: () => ({ text: "Listening…", severity: "info" }) })]);

    const hints = [...(element.shadowRoot?.querySelectorAll(".mode-hint") ?? [])].map((node) => node.textContent);

    expect(hints).toContain("Listening…");
  });

  it("marks a problem status distinctly", async () => {
    const element = await editorWith([contribution({ status: () => ({ text: "Microphone refused", severity: "problem" }) })]);

    const problem = element.shadowRoot?.querySelector(".mode-hint-problem");

    expect(problem?.textContent).toBe("Microphone refused");
  });

  it("renders nothing extra when no plugin contributes", async () => {
    const element = await editorWith([]);

    expect(buttons(element).some((button) => button.getAttribute("aria-label") === "Dictate")).toBe(false);
  });

  it("keeps a leading contribution ahead of the send button", async () => {
    const element = await editorWith([contribution({ id: "voice:lead", localId: "lead", slot: "leading", title: "Lead" })]);

    const labels = buttons(element).map((button) => button.getAttribute("aria-label"));

    expect(labels.indexOf("Lead")).toBeLessThan(labels.indexOf("Send message"));
  });

  it("renders a contributed icon when one is supplied", async () => {
    const element = await editorWith([contribution({ icon: html`<span class="plugin-icon">M</span>` })]);

    expect(element.shadowRoot?.querySelector(".plugin-icon")?.textContent).toBe("M");
  });
});
