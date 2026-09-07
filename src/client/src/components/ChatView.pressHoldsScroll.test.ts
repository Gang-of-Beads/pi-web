// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import { TOUCH_SETTLE_MS } from "../scrollFollowGate";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreGeometryStubs();
});

/**
 * A phone keyboard opening mid-press grows the transcript's scrollable range.
 * Suppressing the follow keeps the control under the finger, but dropping the
 * request would lose it: measured at 393x850, a reader pinned at 27612 of
 * 27612 was left 336px short of the bottom they were pinned to, with no later
 * event to correct it. The gate records the refusal and the release applies it.
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

  it("does not fire the previous press's catch-up into the next press", async () => {
    const view = await mountView();
    const chat = scroller(view);

    // Press 1 suppresses a follow; its release schedules the bottom catch-up.
    holdThroughViewportGrowth(view, chat);
    chat.dispatchEvent(pointerEvent("pointerup"));

    // Press 2 begins before that catch-up fires. The catch-up belongs to
    // press 1: firing now scrolls the transcript between the new press and
    // its click, and the click lands on whatever moved into the tap's place.
    chat.dispatchEvent(pointerEvent("pointerdown"));
    vi.advanceTimersByTime(TOUCH_SETTLE_MS + 32);
    await view.updateComplete;

    expect(chat.scrollTop).toBe(0);

    // Press 2 suppressed nothing, so its own release catches up to nothing.
    chat.dispatchEvent(pointerEvent("pointerup"));
    await settle();
    expect(chat.scrollTop).toBe(0);
  });
});

/**
 * Opening an ask or an extension dialog aligns the card to the top of the
 * transcript, which pulls every line above it upward. While a finger is down,
 * that is exactly the movement the reader is aiming through, so the alignment
 * must be refused like any other follow - and replayed once the press ends,
 * because the dialog is the reason they are here.
 *
 * happy-dom has no layout, so the card and the scroller get a stubbed geometry
 * (the card 300px below the scroller's top) and the assertions read the scroll
 * the component performs, not pixels.
 */
/*
 * The alignment this block guarded is gone: an opened card no longer lives in
 * the transcript, so there is no scroll to defer and nothing to replay on
 * release. The release-time replay was itself moving content between the
 * reader's touchend and the click it produced.
 */

/**
 * A settled outcome may not change the ground under a standing finger. The
 * dialog the finger is over may settle server-side mid-press; removing its row
 * at that instant retargets the imminent click to whatever slides underneath -
 * the same theft the waiting row was built to end, reintroduced at its exit.
 * The row leaves after the release settles, on the same grace the transcript's
 * own catch-up uses.
 */
describe("ChatView holding the waiting row for a press", () => {
  const dialog = { dialogId: "dlg-held", kind: "select" as const, title: "Pick", message: "", options: ["A", "B"], askedAt: "2026-08-30T00:00:00.000Z", runScoped: false };

  it("keeps the row while the finger is down and lets it go after the settle", async () => {
    const view = await mountView();
    view.pendingDialogs = [dialog];
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".waiting-slot")).not.toBeNull();

    scroller(view).dispatchEvent(pointerEvent("pointerdown"));
    view.pendingDialogs = [];
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".waiting-slot"), "settling mid-press must not remove the row").not.toBeNull();

    scroller(view).dispatchEvent(pointerEvent("pointerup"));
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".waiting-slot"), "the click's grace still owns the release instant").not.toBeNull();

    vi.advanceTimersByTime(TOUCH_SETTLE_MS + 1);
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".waiting-slot")).toBeNull();
  });

  it("lets a settled row go at once when no finger is down", async () => {
    const view = await mountView();
    view.pendingDialogs = [dialog];
    await view.updateComplete;
    view.pendingDialogs = [];
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".waiting-slot")).toBeNull();
  });
});

let scrollHeightDescriptor: PropertyDescriptor | undefined;
let clientHeightDescriptor: PropertyDescriptor | undefined;

function stubScrollMetrics(): void {
  scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return 1000; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 500; } });
}

function restoreGeometryStubs(): void {
  if (scrollHeightDescriptor !== undefined) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeightDescriptor);
  if (clientHeightDescriptor !== undefined) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeightDescriptor);
  scrollHeightDescriptor = undefined;
  clientHeightDescriptor = undefined;
}

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



/**
 * A settled outcome may not change the ground under a standing finger. The
 * dialog the finger is over may settle server-side mid-press; removing its row
 * at that instant retargets the imminent click to whatever slides underneath -
 * the same theft the waiting row was built to end, reintroduced at its exit.
 * The row leaves after the release settles, on the same grace the transcript's
 * own catch-up uses.
 */
describe("ChatView holding the waiting row for a press", () => {
  const dialog = { dialogId: "dlg-held", kind: "select" as const, title: "Pick", message: "", options: ["A", "B"], askedAt: "2026-08-30T00:00:00.000Z", runScoped: false };

  it("keeps the row while the finger is down and lets it go after the settle", async () => {
    const view = await mountView();
    view.pendingDialogs = [dialog];
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".waiting-slot")).not.toBeNull();

    scroller(view).dispatchEvent(pointerEvent("pointerdown"));
    view.pendingDialogs = [];
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".waiting-slot"), "settling mid-press must not remove the row").not.toBeNull();

    scroller(view).dispatchEvent(pointerEvent("pointerup"));
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".waiting-slot"), "the click's grace still owns the release instant").not.toBeNull();

    vi.advanceTimersByTime(TOUCH_SETTLE_MS + 1);
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".waiting-slot")).toBeNull();
  });

  it("lets a settled row go at once when no finger is down", async () => {
    const view = await mountView();
    view.pendingDialogs = [dialog];
    await view.updateComplete;
    view.pendingDialogs = [];
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".waiting-slot")).toBeNull();
  });
});

function pointerEvent(type: string): Event {
  return new Event(type, { bubbles: true, composed: true });
}

function scroller(view: ChatView): HTMLElement {
  const chat = view.renderRoot.querySelector<HTMLElement>(".chat");
  if (chat === null) throw new Error("the transcript scroller was not rendered");
  return chat;
}


/** A fifth notification arrives: newest first, so it prepends above the rest. */
/**
 * Every test here mounts the view with an inbox; the property is optional for
 * the component, not for these tests.
 */
async function mountView(): Promise<ChatView> {
  vi.useFakeTimers();
  stubScrollMetrics();
  // Handles are kept by number so cancelAnimationFrame stays honest without a cast.
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

