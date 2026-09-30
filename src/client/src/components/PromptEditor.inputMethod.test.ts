// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptEditor } from "./PromptEditor";

/**
 * Enter that confirms an input-method candidate is the IME's key, not a send.
 *
 * User report (2026-09-30): typing Chinese on desktop, every Enter that picked a word
 * sent the message. Browsers mark that keydown `isComposing`, but some deliver it just
 * after `compositionend`, unmarked; it still carries `keyCode` 229, the code a browser
 * gives a key the IME consumed.
 */

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function composerWith(text: string, sends: unknown[][]): Promise<{ element: PromptEditor; content: HTMLElement }> {
  const element = new PromptEditor();
  element.sessionId = "session-1";
  element.machineId = "local";
  element.onSend = (...args: unknown[]) => {
    sends.push(args);
    return Promise.resolve(true);
  };
  document.body.append(element);
  await element.updateComplete;
  await vi.waitFor(() => {
    if (Reflect.get(element, "editor") === undefined) throw new Error("the composer's editor has not loaded");
  });
  element.replaceText(text);
  const content = element.shadowRoot?.querySelector<HTMLElement>(".cm-content");
  if (content === null || content === undefined) throw new Error("the composer has no editor content to type into");
  return { element, content };
}

function pressEnter(content: HTMLElement, init: { keyCode: number; isComposing: boolean }): void {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true, isComposing: init.isComposing });
  Object.defineProperty(event, "keyCode", { value: init.keyCode });
  content.dispatchEvent(event);
}

describe("Enter from an input method", () => {
  it("precondition: a plain Enter in this harness sends", async () => {
    const sends: unknown[][] = [];
    const { content } = await composerWith("hello", sends);
    pressEnter(content, { keyCode: 13, isComposing: false });
    await Promise.resolve();
    expect(sends).toHaveLength(1);
  });

  it("does not send when Enter picks a candidate after the composition ended", async () => {
    const sends: unknown[][] = [];
    const { content } = await composerWith("你好", sends);
    content.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    content.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "你好" }));
    pressEnter(content, { keyCode: 229, isComposing: false });
    await Promise.resolve();
    expect(sends).toHaveLength(0);
  });

  it("does not send an Enter the IME marks as composing", async () => {
    const sends: unknown[][] = [];
    const { content } = await composerWith("你好", sends);
    pressEnter(content, { keyCode: 229, isComposing: true });
    await Promise.resolve();
    expect(sends).toHaveLength(0);
  });
});
