// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./ChatView";
import type { ChatView } from "./ChatView";

let scrollHeight = 1000;
let scrollHeightDescriptor: PropertyDescriptor | undefined;
let clientHeightDescriptor: PropertyDescriptor | undefined;

function stubMetrics(): void {
  scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return scrollHeight; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 500; } });
}

function restoreMetrics(): void {
  if (scrollHeightDescriptor !== undefined) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
  if (clientHeightDescriptor !== undefined) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
}

function pointerEvent(type: string): Event {
  return new Event(type, { bubbles: true, composed: true });
}

async function mount(): Promise<{ view: ChatView; chat: HTMLElement }> {
  document.body.innerHTML = "<chat-view></chat-view>";
  const view = document.body.querySelector<ChatView>("chat-view");
  if (view === null) throw new Error("chat view did not mount");
  view.messages = [];
  await view.updateComplete;
  const chat = view.renderRoot.querySelector<HTMLElement>(".chat");
  if (chat === null) throw new Error("scroller not found");
  return { view, chat };
}

async function growContent(view: ChatView, by: number): Promise<void> {
  scrollHeight += by;
  view.requestUpdate();
  await view.updateComplete;
}

describe("the bottom edge is held without waiting a frame", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    scrollHeight = 1000;
    stubMetrics();
  });

  afterEach(() => {
    restoreMetrics();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("returns to the bottom in the same update that grew the content", async () => {
    const { view, chat } = await mount();
    chat.scrollTop = 500;
    await growContent(view, 200);
    expect(chat.scrollTop).toBe(scrollHeight);
  });

  // Contract change, stated openly: the old freeze let streamed growth slide
  // the bottom-pinned ask card down under the finger (probe: 347px). For a
  // pinned reader the ground is the bottom edge, so it is held through the
  // press; a reader who scrolled away is still left alone below.
  it("holds the bottom through a press for a pinned reader", async () => {
    const { view, chat } = await mount();
    chat.dispatchEvent(pointerEvent("pointerdown"));
    await growContent(view, 200);
    expect(chat.scrollTop).toBe(scrollHeight);
  });

  it("leaves a scrolled-away reader alone while a finger is down", async () => {
    const { view, chat } = await mount();
    await growContent(view, 40);
    chat.scrollTop = 0;
    chat.dispatchEvent(new Event("scroll"));
    chat.dispatchEvent(pointerEvent("pointerdown"));
    await growContent(view, 200);
    expect(chat.scrollTop).toBe(0);
  });

  it("does not move when the content did not grow", async () => {
    const { view, chat } = await mount();
    await growContent(view, 40);
    chat.scrollTop = 120;
    view.requestUpdate();
    await view.updateComplete;
    expect(chat.scrollTop).toBe(120);
  });
});
