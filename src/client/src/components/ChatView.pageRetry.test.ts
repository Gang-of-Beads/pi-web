// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./ChatView";
import type { ChatView } from "./ChatView";

/**
 * Scrolling keeps loading pages after a failed read and after a reopen (state-diagram D4, review
 * ca45d6ed; `probe-failed-page.mjs`). The host flips `loadingMore` on for a page read and off when it
 * ends; a read that ends without new messages failed.
 */
async function mount(): Promise<{ view: ChatView; scrollTo: (top: number) => Promise<void> }> {
  document.body.innerHTML = "<chat-view></chat-view>";
  const view = document.body.querySelector<ChatView>("chat-view");
  if (view === null) throw new Error("chat view did not mount");
  view.messages = [];
  await view.updateComplete;
  const chat = view.renderRoot.querySelector(".chat");
  if (chat === null) throw new Error("the transcript scroller is missing, so this test proves nothing");
  Object.defineProperty(chat, "scrollHeight", { value: 4000, configurable: true });
  Object.defineProperty(chat, "clientHeight", { value: 800, configurable: true });
  let top = 0;
  Object.defineProperty(chat, "scrollTop", { get: () => top, set: (value: number) => { top = Math.min(Math.max(0, value), 3200); }, configurable: true });
  const scrollTo = async (top: number) => {
    chat.scrollTop = top;
    chat.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(20);
    await view.updateComplete;
  };
  return { view, scrollTo };
}

async function readFails(view: ChatView): Promise<void> {
  view.loadingMore = true;
  await view.updateComplete;
  view.loadingMore = false;
  await view.updateComplete;
  await vi.advanceTimersByTimeAsync(20);
  await view.updateComplete;
}

async function wait(view: ChatView, ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await view.updateComplete;
  await vi.advanceTimersByTimeAsync(20);
  await view.updateComplete;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("a failed page read", () => {
  it("leaves the newer end askable, and asks again from the end once its hold is over", async () => {
    const { view, scrollTo } = await mount();
    let asks = 0;
    view.onLoadNewer = () => { asks += 1; };
    view.messageEnd = 300;
    view.messageTotal = 700;
    view.hasNewer = true;
    await view.updateComplete;
    await scrollTo(3200);
    const asked = asks;
    await readFails(view);
    await scrollTo(3150);
    await scrollTo(3200);
    const whileHeld = asks;
    await wait(view, 1000);

    expect({ asked, whileHeld, afterHold: asks }).toEqual({ asked: 1, whileHeld: 1, afterHold: 2 });
  });

  it("does not ask a failing older page again at once, and backs off while it keeps failing", async () => {
    const { view, scrollTo } = await mount();
    let asks = 0;
    view.onLoadMore = () => { asks += 1; };
    view.hasMore = true;
    await view.updateComplete;
    await scrollTo(3000);
    await scrollTo(0);
    const asked = asks;
    await readFails(view);
    const afterFailure = asks;
    await wait(view, 1000);
    const afterOneSecond = asks;
    await readFails(view);
    await wait(view, 1500);
    const secondHold = asks;
    await wait(view, 500);

    expect({ asked, afterFailure, afterOneSecond, secondHold, afterTwoSeconds: asks }).toEqual({ asked: 1, afterFailure: 1, afterOneSecond: 2, secondHold: 2, afterTwoSeconds: 3 });
  });

  it("starts the ladder again after a page lands", async () => {
    const { view, scrollTo } = await mount();
    let asks = 0;
    view.onLoadMore = () => { asks += 1; };
    view.hasMore = true;
    await view.updateComplete;
    await scrollTo(3000);
    await scrollTo(0);
    await readFails(view);
    await wait(view, 1000);
    view.loadingMore = true;
    await view.updateComplete;
    view.messages = [];
    view.loadingMore = false;
    await view.updateComplete;
    await scrollTo(400);
    await scrollTo(0);
    const askedAfterLanding = asks;
    await readFails(view);
    await wait(view, 1000);

    expect({ askedAfterLanding, afterOneSecond: asks }).toEqual({ askedAfterLanding: 3, afterOneSecond: 4 });
  });
});

describe("a reopen at a remembered spot", () => {
  it("leaves restoring once the spot is restored, so reaching the top loads older history", async () => {
    const { view, scrollTo } = await mount();
    let asks = 0;
    view.onLoadMore = () => { asks += 1; };
    view.hasMore = true;
    await view.updateComplete;
    Reflect.set(view, "viewportState", { kind: "restoring" });
    const settle: unknown = Reflect.get(view, "handleScrollRestoreResult");
    if (typeof settle !== "function") throw new Error("the restore result handler is missing, so this test proves nothing");
    Reflect.apply(settle, view, [view.sessionId, { status: "restored" }]);
    const state: unknown = Reflect.get(view, "viewportState");
    await scrollTo(3000);
    await scrollTo(0);

    expect({ state, asks }).toEqual({ state: { kind: "holding" }, asks: 1 });
  });
});
