// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { PromptEditor } from "./PromptEditor";
import type { SessionStatus } from "../api";

afterEach(() => {
  document.body.replaceChildren();
});

function status(provider: string, id: string): SessionStatus {
  return {
    sessionId: "session-model",
    model: { provider, id },
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

async function mount(provider: string, id: string): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = "session-model";
  editor.status = status(provider, id);
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function modelButton(editor: PromptEditor): HTMLButtonElement {
  const button = editor.shadowRoot?.querySelector<HTMLButtonElement>("button.select-model");
  if (button === null || button === undefined) throw new Error("expected the model button");
  return button;
}

describe("the model button", () => {
  // The button is a flex box, so the ellipsis declared on it never applied to
  // its text: the name wrapped and the fixed height cut the second line off.
  // Splitting the name lets the provider prefix give way while the model id,
  // which is what names the choice, keeps its room.
  it("keeps the provider and the model in separate boxes so shrinking can be aimed", async () => {
    const editor = await mount("anthropic-merchant", "claude-opus-5");
    const button = modelButton(editor);

    expect(button.querySelector(".select-model-provider")?.textContent).toBe("anthropic-merchant/");
    expect(button.querySelector(".select-model-id")?.textContent).toBe("claude-opus-5");
    expect(button.textContent).toBe("anthropic-merchant/claude-opus-5");
  });

  // Truncation hides characters, so the whole name stays reachable on hover.
  it("carries the full name in its tooltip", async () => {
    const editor = await mount("anthropic-merchant", "claude-opus-5");

    expect(modelButton(editor).title).toBe("Select model: anthropic-merchant/claude-opus-5");
  });

  it("shows only the model when there is no provider to name", async () => {
    const editor = await mount("", "claude-opus-5");
    const button = modelButton(editor);

    expect(button.querySelector(".select-model-provider")).toBeNull();
    expect(button.querySelector(".select-model-id")?.textContent).toBe("claude-opus-5");
  });
});
