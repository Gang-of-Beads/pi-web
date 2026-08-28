// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import { TOUCH_SETTLE_MS } from "../scrollFollowGate";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

/**
 * A phone keyboard opening mid-press grows the transcript's scrollable range.
 * Suppressing the follow keeps the control under the finger, but the request was
 * dropped rather than deferred: measured at 393x850, a reader pinned at 27612 of
 * 27612 was left at 27612 of 27948 once the press ended - still 336px short of
 * the bottom they were pinned to, with no further event to correct it.
 *
 * happy-dom has no layout, so these drive the release paths and assert the
 * scroll the component performs, not geometry.
 */
describe("ChatView catching up after a press that suppressed following", () => {
  it("returns a pinned reader to the bottom once the press ends", async () => {
    const view = await mountView();
    const chat = scroller(view);

    holdThroughViewportGrowth(view, chat);

    expect(chat.scrollTop).toBe(0);

    chat.dispatchEvent(pointerEvent("pointerup"));
    await settle();

    expect(chat.scrollTop).toBe(chat.scrollHeight);
  });

  it("returns to the bottom when a phone cancels the press instead of ending it", async () => {
    const view = await mountView();
    const chat = scroller(view);

    holdThroughViewportGrowth(view, chat);
    chat.dispatchEvent(pointerEvent("pointercancel"));
    await settle();

    expect(chat.scrollTop).toBe(chat.scrollHeight);
  });

  it("leaves a reader who scrolled away during the press where they are", async () => {
    const view = await mountView();
    const chat = scroller(view);

    holdThroughViewportGrowth(view, chat);
    // Scrolling up during the press unpins, which is the reader taking over.
    chat.scrollTop = 10;
    chat.dispatchEvent(new Event("scroll"));
    chat.dispatchEvent(pointerEvent("pointerup"));
    await settle();

    expect(chat.scrollTop).toBe(10);
  });

  it("does not scroll when the press suppressed nothing", async () => {
    const view = await mountView();
    const chat = scroller(view);

    chat.dispatchEvent(pointerEvent("pointerdown"));
    chat.dispatchEvent(pointerEvent("pointerup"));
    await settle();

    expect(chat.scrollTop).toBe(0);
  });
});

function holdThroughViewportGrowth(view: ChatView, chat: HTMLElement): void {
  chat.dispatchEvent(pointerEvent("pointerdown"));
  // The viewport resize the keyboard causes, driven at the listener the
  // component registered on window.
  window.dispatchEvent(new Event("resize"));
  flushFrames(view);
}

/** The component defers its scroll to rAF; happy-dom needs it driven. */
function flushFrames(view: ChatView): void {
  void view;
  vi.advanceTimersByTime(32);
}

async function settle(): Promise<void> {
  vi.advanceTimersByTime(TOUCH_SETTLE_MS + 32);
  await Promise.resolve();
}

function pointerEvent(type: string): Event {
  return new Event(type, { bubbles: true, composed: true });
}

function scroller(view: ChatView): HTMLElement {
  const chat = view.renderRoot.querySelector<HTMLElement>(".chat");
  if (chat === null) throw new Error("the transcript scroller was not rendered");
  return chat;
}

async function mountView(): Promise<ChatView> {
  vi.useFakeTimers();
  // The component schedules its scroll on a frame; fake timers drive it. Handles
  // are kept by number so cancelAnimationFrame stays honest without a cast.
  const frames = new Map<number, ReturnType<typeof setTimeout>>();
  let nextFrame = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const handle = nextFrame;
    nextFrame += 1;
    frames.set(handle, setTimeout(() => { frames.delete(handle); callback(0); }, 16));
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    const timer = frames.get(handle);
    if (timer !== undefined) clearTimeout(timer);
    frames.delete(handle);
  });
  // happy-dom reports zero for every box, so the scroller is given a range the
  // component can act on. These are installed on the prototype before the first
  // render so the component's cached height matches from the start: setting them
  // afterwards reads as a height change and triggers the separate catch-up in
  // updatePinnedToBottomFromScroll, which is not what these tests are pinning.
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return 1000; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 500; } });
  const view = new ChatView();
  view.sessionId = "s";
  view.messages = [];
  document.body.append(view);
  await view.updateComplete;
  // Opening a session restores its saved position, which legitimately jumps to
  // the bottom (ChatScrollController.scrollToBottom). Let that settle before the
  // press begins so it is not mistaken for the follow under test.
  vi.advanceTimersByTime(64);
  await view.updateComplete;
  scroller(view).scrollTop = 0;
  return view;
}
