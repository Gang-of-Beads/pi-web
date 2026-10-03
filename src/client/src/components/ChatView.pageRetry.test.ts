// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./ChatView";
import type { ChatView } from "./ChatView";

/**
 * Scrolling keeps loading pages after a failed read and after a reopen (state-diagram D4, review
 * ca45d6ed; `probe-failed-page.mjs`). The host flips `loadingMore` on for a page read and off when it
 * ends; a read that ends without new messages failed. The scroller clamps `scrollTop` and fires a
 * scroll event on the next frame when it moves, as a browser does, programmatic writes included;
 * a test scroll is the reader's, so it wheels first.
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
  const setTop = (value: number) => {
    const next = Math.min(Math.max(0, value), 3200);
    if (next === top) return;
    top = next;
    requestAnimationFrame(() => { chat.dispatchEvent(new Event("scroll")); });
  };
  Object.defineProperty(chat, "scrollTop", { get: () => top, set: setTop, configurable: true });
  const scrollTo = async (to: number) => {
    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: to - top }));
    chat.scrollTop = to;
    await vi.advanceTimersByTimeAsync(40);
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

describe("a jump whose read failed (review 754821b2)", () => {
  /** The failed jump left the reader "following" an older window's end, and the next frame claimed a read nobody sent. */
  it("leaves the reader reading at the older window's end, and asks for the newer page once the hold is over", async () => {
    const { view, scrollTo } = await mount();
    let asks = 0;
    view.onLoadNewer = () => { asks += 1; };
    view.messageEnd = 300;
    view.messageTotal = 700;
    view.hasNewer = true;
    await view.updateComplete;
    await vi.advanceTimersByTimeAsync(100);
    Reflect.set(view, "pinnedToBottom", false);
    await scrollTo(1000);
    const far = view.renderRoot.querySelector(".chat")?.scrollTop;
    const jump: unknown = Reflect.get(view, "jumpToNewest");
    if (typeof jump !== "function") throw new Error("the jump is missing, so this test proves nothing");
    Reflect.apply(jump, view, []);
    await view.updateComplete;
    const asked = asks;
    await readFails(view);
    const afterFailure: unknown = Reflect.get(view, "viewportState");
    view.messages = [];
    await view.updateComplete;
    await vi.advanceTimersByTimeAsync(20);
    await view.updateComplete;
    const afterFrame: unknown = Reflect.get(view, "viewportState");
    await wait(view, 1000);

    expect({ far, asked, afterFailure, afterFrame, afterHold: asks }).toEqual({ far: 1000, asked: 1, afterFailure: { kind: "holding" }, afterFrame: { kind: "holding" }, afterHold: 2 });
  });
});

describe("the back-to-newest key (D4)", () => {
  async function pressTheKey(view: ChatView): Promise<void> {
    const jump: unknown = Reflect.get(view, "jumpToNewest");
    if (typeof jump !== "function") throw new Error("the jump is missing, so this test proves nothing");
    Reflect.apply(jump, view, []);
    await view.updateComplete;
  }

  async function newestLands(view: ChatView, end: number, total: number): Promise<void> {
    view.loadingMore = true;
    await view.updateComplete;
    view.messages = [];
    view.messageEnd = end;
    view.messageTotal = total;
    view.hasNewer = end < total;
    view.loadingMore = false;
    await view.updateComplete;
    await vi.advanceTimersByTimeAsync(40);
    await view.updateComplete;
  }

  /**
   * Pressed mid-window in an older window, the key asked nothing and moved nothing: the newest read
   * waited for the reader to be near the end. A newest page that lands short of the newest asks
   * again wherever the reader is; the walk lived behind a follow flag an older window's end clears.
   */
  it("asks for the newest page wherever the reader is, walks on while the newest is not reached, and lands them there", async () => {
    const { view, scrollTo } = await mount();
    view.messageEnd = 300;
    view.messageTotal = 300;
    await view.updateComplete;
    await vi.advanceTimersByTimeAsync(100);
    Reflect.set(view, "pinnedToBottom", false);
    await scrollTo(400);
    let asks = 0;
    view.onLoadNewer = () => { asks += 1; };
    view.messageTotal = 900;
    view.hasNewer = true;
    await view.updateComplete;
    const stateBefore: unknown = Reflect.get(view, "viewportState");
    const before = { asks, top: view.renderRoot.querySelector(".chat")?.scrollTop, state: stateBefore };
    await pressTheKey(view);
    const asked = asks;
    Reflect.set(view, "pinnedToBottom", false);
    await newestLands(view, 600, 900);
    const walked = asks;
    await newestLands(view, 900, 900);
    const top = view.renderRoot.querySelector(".chat")?.scrollTop;

    expect({ before, asked, walked, top }).toEqual({ before: { asks: 0, top: 400, state: { kind: "holding" } }, asked: 1, walked: 2, top: 3200 });
  });
});

describe("the hold's lifetime", () => {
  it("ends with the session: another session's ends are not held", async () => {
    const { view, scrollTo } = await mount();
    let asks = 0;
    view.onLoadMore = () => { asks += 1; };
    view.hasMore = true;
    await view.updateComplete;
    await scrollTo(3000);
    await scrollTo(0);
    await readFails(view);
    const held: unknown = Reflect.get(view, "pageRetry");
    view.sessionId = "another-session";
    await view.updateComplete;
    const retry: unknown = Reflect.get(view, "pageRetry");
    const timer: unknown = Reflect.get(view, "pageRetryTimer");

    expect({ asks, held, retry, timer }).toEqual({ asks: 1, held: { kind: "held", failures: 1, waitMs: 1000 }, retry: { kind: "open" }, timer: undefined });
  });

  it("asks nothing once the view is gone", async () => {
    const { view, scrollTo } = await mount();
    let asks = 0;
    view.onLoadMore = () => { asks += 1; };
    view.hasMore = true;
    await view.updateComplete;
    await scrollTo(3000);
    await scrollTo(0);
    await readFails(view);
    view.remove();
    await vi.advanceTimersByTimeAsync(2000);

    expect(asks).toBe(1);
  });
});

describe("a restore whose spot is in a page not loaded (review 754821b2)", () => {
  const position = { mode: "anchor" as const, anchorId: "a-row-far-above", offset: 0 };

  async function restoringFar(view: ChatView): Promise<void> {
    view.sessionId = "a-session";
    await view.updateComplete;
    await vi.advanceTimersByTimeAsync(20);
    await view.updateComplete;
    Reflect.set(view, "viewportState", { kind: "restoring" });
    const settle: unknown = Reflect.get(view, "handleScrollRestoreResult");
    if (typeof settle !== "function") throw new Error("the restore result handler is missing, so this test proves nothing");
    Reflect.apply(settle, view, [view.sessionId, { status: "missing", position }]);
    await view.updateComplete;
  }

  /** A failed read is unknown, not "the spot is gone": the restore waits out the hold and goes on. */
  it("waits out a failed read's hold and goes on restoring, instead of leaving the spot for the newest", async () => {
    const { view } = await mount();
    let asks = 0;
    view.onLoadMore = () => { asks += 1; };
    view.hasMore = true;
    await view.updateComplete;
    await restoringFar(view);
    const asked = asks;
    await readFails(view);
    const state: unknown = Reflect.get(view, "viewportState");
    const afterFailure = asks;
    await wait(view, 1000);

    expect({ asked, afterFailure, state, afterHold: asks }).toEqual({ asked: 1, afterFailure: 1, state: { kind: "restoring" }, afterHold: 2 });
  });

  /** Each further page went around the decision, so its failure was never held and the restore asked again every frame. */
  it("asks for each further page through the decision, so a failure there is held too", async () => {
    const { view } = await mount();
    let asks = 0;
    view.onLoadMore = () => { asks += 1; };
    view.hasMore = true;
    await view.updateComplete;
    await restoringFar(view);
    view.loadingMore = true;
    await view.updateComplete;
    view.messages = [];
    view.loadingMore = false;
    await view.updateComplete;
    await vi.advanceTimersByTimeAsync(20);
    await view.updateComplete;
    const afterFirstPage = asks;
    await readFails(view);
    await vi.advanceTimersByTimeAsync(300);
    await view.updateComplete;

    expect({ afterFirstPage, soonAfterSecondFailure: asks }).toEqual({ afterFirstPage: 2, soonAfterSecondFailure: 2 });
  });

  /** D4: restoring --> reading when the reader scrolls during the restore; the page on its way lands as theirs. */
  it("stops restoring once the reader wheels, so the page on its way does not move them", async () => {
    const { view } = await mount();
    let asks = 0;
    view.onLoadMore = () => { asks += 1; };
    view.hasMore = true;
    await view.updateComplete;
    await restoringFar(view);
    const chat = view.renderRoot.querySelector(".chat");
    if (chat === null) throw new Error("the transcript scroller is missing, so this test proves nothing");
    chat.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
    view.loadingMore = true;
    await view.updateComplete;
    view.messages = [];
    view.loadingMore = false;
    await view.updateComplete;
    await vi.advanceTimersByTimeAsync(20);
    await view.updateComplete;
    const state: unknown = Reflect.get(view, "viewportState");
    const spot: unknown = Reflect.get(view, "pendingScrollRestorePosition");

    expect({ asks, state, spot }).toEqual({ asks: 1, state: { kind: "holding" }, spot: undefined });
  });

  /** D4: the end of an older window is not the bottom, for the restore's flag too (B13's jump through another writer). */
  it("does not pin a reader the restore left near the end of an older window", async () => {
    const { view, scrollTo } = await mount();
    view.hasNewer = true;
    view.messageEnd = 300;
    view.messageTotal = 700;
    await view.updateComplete;
    await scrollTo(3190);
    Reflect.set(view, "viewportState", { kind: "restoring" });
    const settle: unknown = Reflect.get(view, "handleScrollRestoreResult");
    if (typeof settle !== "function") throw new Error("the restore result handler is missing, so this test proves nothing");
    Reflect.apply(settle, view, [view.sessionId, { status: "restored" }]);
    const pinned: unknown = Reflect.get(view, "pinnedToBottom");

    expect(pinned).toBe(false);
  });
});

describe("a reopen at a remembered spot", () => {
  it("leaves restoring once the spot is restored, so reaching the top loads older history", async () => {
    const { view, scrollTo } = await mount();
    let asks = 0;
    view.onLoadMore = () => { asks += 1; };
    view.hasMore = true;
    await view.updateComplete;
    await vi.advanceTimersByTimeAsync(100);
    const chat = view.renderRoot.querySelector(".chat");
    if (chat === null) throw new Error("the transcript scroller is missing, so this test proves nothing");
    chat.scrollTop = 1000;
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
