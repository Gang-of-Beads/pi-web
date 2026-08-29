// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import { TOUCH_SETTLE_MS } from "../scrollFollowGate";
import type { SelectedSessionNotificationView } from "../sessionNotifications";

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
describe("ChatView holding an opened card's alignment for a press", () => {
  it("does not align a newly opened dialog while a finger is down, and aligns it on release", async () => {
    const view = await mountView();
    const chat = scroller(view);
    pinToBottom(view);
    stubAlignmentGeometry(view, 300);

    chat.dispatchEvent(pointerEvent("pointerdown"));
    view.pendingDialogs = [openDialog()];
    await settleFrames(view);

    expect(chat.scrollTop).toBe(500);

    chat.dispatchEvent(pointerEvent("pointerup"));
    await settleCatchUp(view);

    expect(chat.scrollTop).toBe(800);
  });

  it("does not align a newly opened ask while a finger is down, and aligns it on release", async () => {
    const view = await mountView();
    const chat = scroller(view);
    pinToBottom(view);
    stubAlignmentGeometry(view, 250);

    chat.dispatchEvent(pointerEvent("pointerdown"));
    view.pendingAsk = openAsk();
    await settleFrames(view);

    expect(chat.scrollTop).toBe(500);

    chat.dispatchEvent(pointerEvent("pointerup"));
    await settleCatchUp(view);

    expect(chat.scrollTop).toBe(750);
  });

  it("aligns immediately when no finger is down", async () => {
    const view = await mountView();
    const chat = scroller(view);
    pinToBottom(view);
    stubAlignmentGeometry(view, 300);

    view.pendingDialogs = [openDialog()];
    await settleFrames(view);

    expect(chat.scrollTop).toBe(800);
  });

  it("falls back to the bottom when the deferred dialog was answered before the release", async () => {
    const view = await mountView();
    const chat = scroller(view);
    pinToBottom(view);
    stubAlignmentGeometry(view, 300);

    chat.dispatchEvent(pointerEvent("pointerdown"));
    view.pendingDialogs = [openDialog()];
    await settleFrames(view);
    // Answered elsewhere while the finger is still down: the card is gone.
    view.pendingDialogs = [];
    await settleFrames(view);

    chat.dispatchEvent(pointerEvent("pointerup"));
    await settleCatchUp(view);

    expect(chat.scrollTop).toBe(1000);
  });

  it("replays an alignment refused by a later press instead of leaving it stale", async () => {
    const view = await mountView();
    const chat = scroller(view);
    pinToBottom(view);
    stubAlignmentGeometry(view, 300);

    // First press defers the dialog's alignment; the reader scrolled away, so
    // the release replays nothing - and the deferral must not outlive the press.
    chat.dispatchEvent(pointerEvent("pointerdown"));
    view.pendingDialogs = [openDialog()];
    await settleFrames(view);
    chat.scrollTop = 10;
    chat.dispatchEvent(new Event("scroll"));
    chat.dispatchEvent(pointerEvent("pointerup"));
    await settleCatchUp(view);
    expect(chat.scrollTop).toBe(10);

    // A later press with no dialog open must catch up to the bottom, not to a
    // stale alignment.
    pinToBottom(view);
    chat.dispatchEvent(pointerEvent("pointerdown"));
    window.dispatchEvent(new Event("resize"));
    await settleFrames(view);
    chat.dispatchEvent(pointerEvent("pointerup"));
    await settleCatchUp(view);

    expect(chat.scrollTop).toBe(1000);
  });
});

/**
 * The notifications drawer is its own scroller, and a notification arriving
 * while the reader rests on it prepends a row above every settled card. The
 * drawer therefore holds live tray updates while a pointer is down and applies
 * them once the press ends - the same gate discipline the transcript follows.
 */
describe("ChatView holding the notification drawer still under a finger", () => {
  it("does not show a notification that arrives during a press until the press ends", async () => {
    const view = await mountViewWithInbox();
    expandDrawer(view);

    notificationList(view).dispatchEvent(pointerEvent("pointerdown"));
    view.notificationInbox = inboxWithArrival(requiredInbox(view));
    await view.updateComplete;
    expect(renderedNotificationIds(view)).toEqual(["n0", "n1", "n2", "n3"]);

    notificationList(view).dispatchEvent(pointerEvent("pointerup"));
    await settleCatchUp(view);

    expect(renderedNotificationIds(view)).toEqual(["n-new", "n0", "n1", "n2", "n3"]);
  });

  it("applies an arriving notification immediately when no finger is down", async () => {
    const view = await mountViewWithInbox();
    expandDrawer(view);

    view.notificationInbox = inboxWithArrival(requiredInbox(view));
    await view.updateComplete;

    expect(renderedNotificationIds(view)).toEqual(["n-new", "n0", "n1", "n2", "n3"]);
  });

  it("applies a held notification on the next arrival once the press outlives the backstop", async () => {
    const view = await mountViewWithInbox();
    expandDrawer(view);

    notificationList(view).dispatchEvent(pointerEvent("pointerdown"));
    view.notificationInbox = inboxWithArrival(requiredInbox(view));
    await view.updateComplete;
    expect(renderedNotificationIds(view)).toEqual(["n0", "n1", "n2", "n3"]);

    // The gate's longest-real-touch backstop opens the hold for a pointer that
    // never comes back. Like the transcript's, it is consulted by the next
    // live update rather than by a timer of its own.
    await vi.advanceTimersByTimeAsync(11_000);
    view.notificationInbox = inboxWithArrival(requiredInbox(view));
    await view.updateComplete;

    expect(renderedNotificationIds(view)).toEqual(["n-new", "n0", "n1", "n2", "n3"]);
  });

  it("delays the post-dismiss focus handoff until the held update renders", async () => {
    const view = await mountViewWithInbox();
    expandDrawer(view);

    notificationList(view).dispatchEvent(pointerEvent("pointerdown"));
    view.onDismissNotification?.("n1");
    await view.updateComplete;
    // The tray the drawer renders is still the pre-dismissal one, so the row
    // the reader dismissed is still on screen under their finger.
    expect(renderedNotificationIds(view)).toEqual(["n0", "n1", "n2", "n3"]);

    notificationList(view).dispatchEvent(pointerEvent("pointerup"));
    await settleCatchUp(view);

    expect(renderedNotificationIds(view)).toEqual(["n0", "n2", "n3"]);
  });

  it("does not hold a tray that was not on screen: another chat's tray shows live mid-press", async () => {
    const view = await mountViewWithInbox();
    expandDrawer(view);

    notificationList(view).dispatchEvent(pointerEvent("pointerdown"));
    view.sessionId = "other-session";
    view.notificationInbox = { ...inboxWithArrival(requiredInbox(view)), sessionId: "other-session" };
    await view.updateComplete;

    // The old chat's held tray is not this chat's state to show, and there was
    // nothing under the finger to keep still, so the new chat's tray shows now.
    expect(renderedNotificationIds(view)).toEqual(["n-new", "n0", "n1", "n2", "n3"]);
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

/**
 * The alignment moves the card's top to the scroller's top. happy-dom reports
 * zero for every box, so the scroller reads top 0 and every open ask/dialog
 * card reads top `offset` - installed on the prototype so a card created after
 * the stub (the normal order: the press comes first, then the card opens) is
 * covered too. Everything else reads an all-zero box, which the component
 * treats as "no dock, no room", not as a scroll trigger.
 */
function stubAlignmentGeometry(view: ChatView, offset: number): void {
  const chat = scroller(view);
  const domRect = (top: number): DOMRect => ({ top, bottom: top + 200, left: 0, right: 393, width: 393, height: 200, x: 0, y: top, toJSON: () => ({}) });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this === chat) return domRect(0);
    if (this.classList.contains("open-dialog-card") || this.tagName === "ASK-USER-CARD") return domRect(offset);
    return domRect(0);
  });
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

/** Drive the frame the alignment was scheduled on and the post-release timers. */
async function settleFrames(view: ChatView): Promise<void> {
  // Lit renders (and updated() schedules the alignment frame) in a microtask;
  // flush the render first or the frame fires before the card exists.
  await view.updateComplete;
  flushFrames(view);
  await view.updateComplete;
}

async function settleCatchUp(view: ChatView): Promise<void> {
  vi.advanceTimersByTime(TOUCH_SETTLE_MS + 32);
  await view.updateComplete;
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

function notificationList(view: ChatView): HTMLElement {
  const list = view.renderRoot.querySelector<HTMLElement>(".notification-list");
  if (list === null) throw new Error("the notification list was not rendered");
  return list;
}

function expandDrawer(view: ChatView): void {
  const toggle = view.renderRoot.querySelector<HTMLButtonElement>(".drawer-toggle");
  if (toggle === null) throw new Error("the drawer toggle was not rendered");
  if (toggle.getAttribute("aria-expanded") === "false") toggle.click();
}

function renderedNotificationIds(view: ChatView): string[] {
  return [...view.renderRoot.querySelectorAll<HTMLElement>(".notification-list [data-notification-id]")]
    .map((row) => row.dataset["notificationId"] ?? "");
}

function inboxFixture(sessionId = "s"): SelectedSessionNotificationView {
  return {
    machineId: "local",
    sessionId,
    cwd: "/tmp/probe",
    daemonInstanceId: "daemon",
    notifications: [0, 1, 2, 3].map((i) => ({ id: `n${String(i)}`, message: `Settled notification ${String(i)}`, truncated: false, severity: "info" as const, receivedAt: "2026-08-29T10:00:00.000Z", order: 100 - i })),
    retainedCount: 4,
    discardedCount: 0,
    dismissThrough: { order: 0, overflowWatermark: 0 },
    pendingDismissedIds: new Set<string>(),
    dismissAllPending: false,
    announcements: [],
  };
}

/** A fifth notification arrives: newest first, so it prepends above the rest. */
/**
 * Every test here mounts the view with an inbox; the property is optional for
 * the component, not for these tests.
 */
function requiredInbox(view: ChatView): SelectedSessionNotificationView {
  const inbox = view.notificationInbox;
  if (inbox === undefined) throw new Error("the view was mounted without the inbox these tests arrange");
  return inbox;
}

function pinToBottom(view: ChatView): void {
  const chat = scroller(view);
  chat.scrollTop = 500;
  chat.dispatchEvent(new Event("scroll"));
}

function inboxWithArrival(previous: SelectedSessionNotificationView): SelectedSessionNotificationView {
  return {
    ...previous,
    notifications: [
      { id: "n-new", message: "A live event arrived mid-press", truncated: false, severity: "info" as const, receivedAt: "2026-08-29T10:05:00.000Z", order: 200 },
      ...previous.notifications.filter((notification) => notification.id !== "n-new" && notification.id !== "n-new-2"),
    ],
    retainedCount: previous.notifications.length + 1,
  };
}

function openDialog(): import("../../../shared/apiTypes").PendingExtensionDialog {
  return {
    dialogId: "dlg-press-1",
    kind: "select",
    title: "Deploy where?",
    askedAt: "2026-08-29T10:00:00.000Z",
    runScoped: false,
    options: ["Staging", "Production"],
  };
}

function openAsk(): import("../../../shared/apiTypes").PendingAskUser {
  return {
    askId: "ask-press-1",
    askedAt: "2026-08-29T10:00:00.000Z",
    questions: [{ id: "q1", question: "Proceed?", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }],
  };
}

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

async function mountViewWithInbox(): Promise<ChatView> {
  const view = await mountView();
  view.onDismissNotification = (notificationId: string) => {
    const inbox = view.notificationInbox;
    if (inbox === undefined) return;
    view.notificationInbox = {
      ...inbox,
      notifications: inbox.notifications.filter((notification) => notification.id !== notificationId),
      retainedCount: Math.max(0, inbox.retainedCount - 1),
    };
  };
  view.notificationInbox = inboxFixture();
  await view.updateComplete;
  return view;
}
