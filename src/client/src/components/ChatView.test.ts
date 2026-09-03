import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { QueuedSessionMessage, SessionStatus } from "../api";
import { splitTranscriptAndPending } from "../messageDelivery";
import {
  notificationTargetKey,
  notificationTrayIsCollapsed,
  type SelectedSessionNotificationView,
} from "../sessionNotifications";
import type { ChatLine } from "./shared";
import {
  ChatView,
  chatEventAnchorKey,
  chatGroupAnchorKey,
  chatGroupScrollMarkerId,
  chatMessageGroupClassName,
  chatMessageGroupLabel,
  chatMessageMetadataLabel,
  chatDeliveryPresentation,
} from "./ChatView";
import { templateEventHandlerAfterMarker, templateEventHandlerNearMarker, templateText } from "../templateInspection.testSupport";

type RenderActivityPanel = (this: ChatView, activity: unknown) => TemplateResult;

function isRenderActivityPanel(value: unknown): value is RenderActivityPanel {
  return typeof value === "function";
}

describe("chatDeliveryPresentation", () => {
  it("reads as one mark for received and two for taken into the turn", () => {
    expect(chatDeliveryPresentation({ clientMessageId: "cm-1", state: "received" })).toMatchObject({ glyph: "✓", text: "Sent", tone: "received" });
    expect(chatDeliveryPresentation({ clientMessageId: "cm-1", state: "delivered" })).toMatchObject({ glyph: "✓✓", text: "Read", tone: "delivered" });
  });

  it("names the lane a queued message waits in", () => {
    expect(chatDeliveryPresentation({ clientMessageId: "cm-1", state: "queued", kind: "steer" }).text).toBe("Queued to steer");
    expect(chatDeliveryPresentation({ clientMessageId: "cm-1", state: "queued", kind: "followUp" }).text).toBe("Queued");
  });

  it("says plainly when a message never reached the server", () => {
    const failed = chatDeliveryPresentation({ clientMessageId: "cm-1", state: "failed" });
    expect(failed).toMatchObject({ text: "Not sent", tone: "failed" });
    expect(failed.label).toContain("never received");
  });

  it("shows work in flight while the request is unconfirmed", () => {
    expect(chatDeliveryPresentation({ clientMessageId: "cm-1", state: "sending" })).toMatchObject({ text: "Sending", tone: "pending" });
  });
});

describe("clear-queue action visibility", () => {
  // The decision to offer the clear-queue action is the same seam that used to
  // sit on the queued panel; the transcript carries it now.
  it("shows the strip only while the server queue holds something", () => {
    // The strip used to carry a count as well, which was the queue listed a
    // second time in a second visual language - the cards above it are already
    // the count. Only the action it exists to host is left, so that action is
    // what the visibility is asserted through.
    const empty = new ChatView();
    empty.status = queuedStatus([]);
    empty.onClearServerQueue = () => undefined;
    expect(templateText(renderQueuedMessages(empty))).not.toContain("Clear queue");

    const held = new ChatView();
    held.status = queuedStatus([{ kind: "steer", text: "server queued" }]);
    held.onClearServerQueue = () => undefined;
    expect(templateText(renderQueuedMessages(held))).toContain("Clear queue");
  });
});
describe("ChatView queued-message clear wiring", () => {
  // Escape hatch: this case verifies the Clear queue button's Lit event wiring,
  // whose only observable effect is invoking the injected callback. Vitest runs
  // with no DOM environment here, so a shadow-DOM click harness would add
  // disproportionate setup; handler extraction anchored to the user-facing
  // "Clear queue" button text is proportionate.
  it("invokes onClearServerQueue when the server-queue action is activated", () => {
    const view = new ChatView();
    const onClearServerQueue = vi.fn();
    view.status = queuedStatus([{ kind: "steer", text: "server queued" }]);
    view.onClearServerQueue = onClearServerQueue;

    templateEventHandlerNearMarker(renderQueuedMessages(view), "Clear queue")(new Event("click"));

    expect(onClearServerQueue).toHaveBeenCalledOnce();
  });
});

describe("ChatView queued messages stay in place", () => {
  // Three shipped attempts, three ways to lose the message. 1.202608.5 hid
  // queued messages from the transcript based on the bubble's own delivery
  // state, which goes stale, so a message the queue had released was in
  // neither place until a reload. 1.202608.6 keyed the same hiding on the
  // server's queue, which was correct but still moved the message into a panel
  // pinned above the composer - and on a phone that panel covered the
  // conversation. So the message is drawn where it was sent, marked, and the
  // panel lists only what has no bubble here.
  const queuedLine = (clientMessageId: string): ChatLine => ({
    role: "user",
    parts: [{ type: "text", text: "hello" }],
    meta: { delivery: { clientMessageId, state: "queued", kind: "steer" } },
  });

  /**
   * A message the agent has not started is drawn below whatever it is working
   * on, so it is kept out of the settled transcript rather than appended to it.
   * Appended, it sat above the reply being written, and a message the model had
   * not been given yet looked as though it had already been answered.
   */
  it("keeps a queued message out of the settled transcript", () => {
    const view = new ChatView();
    view.messages = [queuedLine("cm-1")];
    view.status = queuedStatus([{ kind: "steer", text: "hello", clientMessageId: "cm-1" }]);

    expect(transcriptMessagesOf(view)).toHaveLength(0);
  });

  it("marks a bubble the server still holds, and unmarks it once taken", () => {
    // Colour and affordance say the same thing: waiting, and recallable. Both
    // are keyed to the server's queue rather than the bubble's own delivery
    // state, which can go stale and would otherwise leave a message looking
    // pending forever.
    const view = new ChatView();
    view.messages = [queuedLine("cm-1")];
    view.status = queuedStatus([{ kind: "steer", text: "hello", clientMessageId: "cm-1" }]);
    expect(isQueuedLineOf(view, queuedLine("cm-1"))).toBe(true);

    view.status = queuedStatus([]);
    expect(isQueuedLineOf(view, queuedLine("cm-1"))).toBe(false);
  });

  it("marks a synthesized row for a queue entry with no sender id", () => {
    // A message queued by another client or a non-browser caller carries no
    // clientMessageId, so the synthesized transcript row falls back to the
    // `queued:kind:text` id. The server's recall matches such entries by
    // kind+text, so the row must still be recognised as queued - gold mark
    // and recall affordance included - rather than read as an ordinary user
    // message that happens to float in the transcript.
    const view = new ChatView();
    view.messages = [queuedLine("queued:steer:hello")];
    view.status = queuedStatus([{ kind: "steer", text: "hello" }]);
    expect(isQueuedLineOf(view, queuedLine("queued:steer:hello"))).toBe(true);

    view.status = queuedStatus([]);
    expect(isQueuedLineOf(view, queuedLine("queued:steer:hello"))).toBe(false);
  });

  it("does not list a message that already has a bubble", () => {
    // The double render: one send appearing as a bubble and as a queue row.
    const view = new ChatView();
    view.messages = [queuedLine("cm-1")];
    view.status = queuedStatus([{ kind: "steer", text: "hello", clientMessageId: "cm-1" }]);
    view.onClearServerQueue = vi.fn();

    expect(templateText(renderQueuedMessages(view))).not.toContain("hello");
  });

  it("draws a queued message from somewhere else in the transcript, not twice", () => {
    // Another device, or an injected command: no bubble here, so one is drawn
    // for it in the transcript, in queue order. The strip carries the clear
    // action and never repeats the text or counts the cards a second time.
    const view = new ChatView();
    view.messages = [];
    view.status = queuedStatus([{ kind: "steer", text: "from my phone" }]);
    view.onClearServerQueue = vi.fn();

    const strip = templateText(renderQueuedMessages(view));
    expect(strip).not.toContain("from my phone");
    expect(strip).toContain("Clear queue");
    expect([...splitTranscriptAndPending(view.messages, view.status.queuedMessages).settled, ...splitTranscriptAndPending(view.messages, view.status.queuedMessages).pending]).toHaveLength(1);
  });
});

describe("deleted warning cards stay deleted", () => {
  // Warnings file in the notification drawer now; the transcript-top cards,
  // their collapse chevron and their status-bar counter are gone. The render
  // seam assertion pins the deletion so a revival cannot land silently.
  it("no longer exposes a warning-card render seam", () => {
    expect(Reflect.get(new ChatView(), "renderWarnings")).toBeUndefined();
  });
});

describe("ChatView session drawer wiring", () => {
  // Escape hatch: these cases verify only the tray buttons' Lit callback wiring.
  // Content and identity decisions use pure seams, and stable semantic class
  // markers keep handler extraction narrow. A minimal render-root fake verifies
  // the resulting focus move. Per-row wiring is not testable this way - the rows
  // are a keyed list, whose directive holds its raw inputs rather than rendered
  // templates - so that case renders for real in ChatView.notifications.test.ts.

  it("wires clear-all and recovers header focus while the emptied tray is retained", () => {
    const view = withNotificationInbox(new ChatView());
    const onDismissAllNotifications = vi.fn();
    const headerFocus = installNotificationFocusRoot(view);
    view.onDismissAllNotifications = onDismissAllNotifications;

    const rendered = renderTopDrawer(view);
    if (rendered === null) throw new Error("expected a session drawer");
    templateEventHandlerAfterMarker(rendered, "notification-clear")(new Event("click"));
    view.notificationInbox = emptyNotificationInbox(requireNotificationInbox(view));

    expect(renderTopDrawer(view)).not.toBeNull();
    focusPendingNotificationTarget(view);
    expect(onDismissAllNotifications).toHaveBeenCalledOnce();
    expect(headerFocus).toHaveBeenCalledOnce();
  });

  it("does not move pending dismissal focus into another exact chat", () => {
    const view = withNotificationInbox(new ChatView());
    const headerFocus = installNotificationFocusRoot(view);
    view.onDismissAllNotifications = vi.fn();

    const rendered = renderTopDrawer(view);
    if (rendered === null) throw new Error("expected a session drawer");
    templateEventHandlerAfterMarker(rendered, "notification-clear")(new Event("click"));
    view.notificationInbox = { ...requireNotificationInbox(view), machineId: "remote" };
    focusPendingNotificationTarget(view);

    expect(headerFocus).not.toHaveBeenCalled();
  });

  it("keeps a collapsed tray closed for new arrivals and isolates matching session ids by exact chat", () => {
    const view = withNotificationInbox(new ChatView());
    const inbox = requireNotificationInbox(view);
    const rendered = renderTopDrawer(view);
    if (rendered === null) throw new Error("expected a session drawer");

    // The drawer starts folded now, so the first click opens it; the second is
    // the one that records a deliberate collapse.
    templateEventHandlerAfterMarker(rendered, "notification-toggle")(new Event("click"));
    templateEventHandlerAfterMarker(renderTopDrawer(view) ?? rendered, "notification-toggle")(new Event("click"));

    const collapsedTargetKeys: unknown = Reflect.get(view, "collapsedTopDrawerKeys");
    if (!(collapsedTargetKeys instanceof Set)) throw new Error("Expected collapsed notification target keys");
    const firstNotification = inbox.notifications[0];
    if (firstNotification === undefined) throw new Error("expected a retained notification");
    const newArrival = {
      ...inbox,
      notifications: [{ ...firstNotification, id: "daemon-a:2", order: 2 }, ...inbox.notifications],
      retainedCount: 2,
    };
    expect(notificationTrayIsCollapsed(collapsedTargetKeys, newArrival)).toBe(true);
    expect(notificationTrayIsCollapsed(collapsedTargetKeys, { ...newArrival, cwd: "/other" })).toBe(false);
    expect(notificationTrayIsCollapsed(collapsedTargetKeys, { ...newArrival, machineId: "remote" })).toBe(false);
    expect(collapsedTargetKeys.has(notificationTargetKey(inbox))).toBe(true);
  });
});

describe("chatMessageMetadataLabel", () => {
  it("uses one full date and model label without a model prefix", () => {
    const timestamp = "2026-07-10T19:15:30.000Z";
    const formattedTimestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(timestamp));

    expect(chatMessageMetadataLabel({
      role: "assistant",
      parts: [],
      meta: { timestamp, model: { provider: "provider", id: "model" } },
    })).toBe(`${formattedTimestamp} · provider/model`);
  });

  it("appends the thinking level after the model when present", () => {
    const timestamp = "2026-07-10T19:15:30.000Z";
    const formattedTimestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(timestamp));

    expect(chatMessageMetadataLabel({
      role: "assistant",
      parts: [],
      meta: { timestamp, model: { provider: "provider", id: "model" }, thinkingLevel: "high" },
    })).toBe(`${formattedTimestamp} · provider/model · high`);
  });

  // A message just typed into this browser has no server metadata yet. That is
  // its normal state, not a fault worth reporting where the timestamp goes.
  it("says nothing at all when the message carries no metadata", () => {
    expect(chatMessageMetadataLabel({ role: "user", parts: [] })).toBe("");
    expect(chatMessageMetadataLabel({ role: "user", parts: [], meta: {} })).toBe("");
  });
});

describe("chat event-group content seams", () => {
  // Group scroll-anchor keys, marker ids, class list, and disclosure label are
  // content/structure derived from pure exported seams rather than scraped from
  // rendered markup.
  it("derives stable group and event scroll-anchor keys and marker ids", () => {
    expect(chatGroupAnchorKey(40)).toBe("g:40");
    expect(chatEventAnchorKey(40)).toBe("e:40");
    expect(chatEventAnchorKey(41)).toBe("e:41");
    expect(chatGroupScrollMarkerId(41)).toBe("g:41");
  });

  it("distinguishes the live tail group by class and disclosure label", () => {
    expect(chatMessageGroupClassName(true)).toBe("msg event-group live");
    expect(chatMessageGroupClassName(false)).toBe("msg event-group");
    expect(chatMessageGroupLabel(true)).toBe("live events");
    expect(chatMessageGroupLabel(false)).toBe("events");
  });
});

describe("ChatView event-group disclosure wiring", () => {
  const messages: ChatLine[] = [
    { role: "assistant", parts: [{ type: "toolCall", toolName: "read", summary: "inspect a file" }] },
    { role: "tool", parts: [{ type: "toolExecution", toolName: "read", summary: "inspect a file", status: "success", resultText: "large result" }] },
  ];

  it("defers a closed group body until it is opened", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);

    renderMessageGroup(view, messages, 40, 41, false);

    expect(bodyCalls).toEqual([]);
  });

  it("renders a live tail body by default", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);

    renderMessageGroup(view, messages, 40, 41, true);

    expect(bodyCalls).toEqual([{ messages, startIndex: 40 }]);
  });

  // Escape hatch: this case verifies the native `<details>` `@toggle` wiring,
  // whose observable effect is that a re-render renders (or defers) the group
  // body. No DOM environment is available for a real disclosure interaction, so
  // handler extraction anchored to the stable `@toggle=` attribute marker plus
  // an injected details-toggle event is proportionate.
  it("renders the body after a toggle-open and removes it when closed again", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    const bodyCalls = observeGroupBodyRenders(view);
    const initiallyClosed = renderMessageGroup(view, messages, 40, 41, false);

    dispatchDetailsToggle(templateEventHandlerAfterMarker(initiallyClosed, "@toggle="), true);
    renderMessageGroup(view, messages, 40, 41, false);

    expect(bodyCalls).toEqual([{ messages, startIndex: 40 }]);

    bodyCalls.length = 0;
    dispatchDetailsToggle(templateEventHandlerAfterMarker(initiallyClosed, "@toggle="), false);
    renderMessageGroup(view, messages, 40, 41, false);

    expect(bodyCalls).toEqual([]);
  });
});

interface GroupBodyRenderCall {
  messages: ChatLine[];
  startIndex: number;
}

type RenderQueuedMessages = (this: ChatView) => TemplateResult;
type RenderMessageGroup = (this: ChatView, messages: ChatLine[], startIndex: number, endIndex: number, defaultOpen: boolean) => TemplateResult;
type RenderMessageGroupBody = (this: ChatView, messages: ChatLine[], startIndex: number) => TemplateResult;
type RenderTopDrawer = (this: ChatView) => TemplateResult | null;
type FocusPendingNotificationTarget = (this: ChatView) => void;
type TemplateEventHandler = (event: Event) => void;

/** The transcript half of the split, reached the same way as the dock half. */
type IsQueuedLine = (this: ChatView, line: ChatLine) => boolean;

function isIsQueuedLine(value: unknown): value is IsQueuedLine {
  return typeof value === "function";
}

function isQueuedLineOf(view: ChatView, line: ChatLine): boolean {
  const method: unknown = Reflect.get(view, "isQueuedLine");
  if (!isIsQueuedLine(method)) throw new Error("ChatView.isQueuedLine is not callable");
  return method.call(view, line);
}

function transcriptMessagesOf(view: ChatView): ChatLine[] {
  const method: unknown = Reflect.get(view, "transcriptMessages");
  if (!isTranscriptMessages(method)) throw new Error("ChatView.transcriptMessages is not callable");
  return method.call(view);
}

type TranscriptMessages = (this: ChatView) => ChatLine[];

function isTranscriptMessages(value: unknown): value is TranscriptMessages {
  return typeof value === "function";
}

function renderQueuedMessages(view: ChatView): TemplateResult {
  const method: unknown = Reflect.get(view, "renderQueuedMessages");
  if (!isRenderQueuedMessages(method)) throw new Error("ChatView.renderQueuedMessages is not callable");
  return method.call(view);
}

function renderMessageGroup(view: ChatView, messages: ChatLine[], startIndex: number, endIndex: number, defaultOpen: boolean): TemplateResult {
  const method: unknown = Reflect.get(view, "renderMessageGroup");
  if (!isRenderMessageGroup(method)) throw new Error("ChatView.renderMessageGroup is not callable");
  return method.call(view, messages, startIndex, endIndex, defaultOpen);
}

function renderTopDrawer(view: ChatView): TemplateResult | null {
  const method: unknown = Reflect.get(view, "renderTopDrawer");
  if (!isRenderTopDrawer(method)) throw new Error("ChatView.renderTopDrawer is not callable");
  return method.call(view);
}

function focusPendingNotificationTarget(view: ChatView): void {
  const method: unknown = Reflect.get(view, "focusPendingNotificationTarget");
  if (!isFocusPendingNotificationTarget(method)) throw new Error("ChatView.focusPendingNotificationTarget is not callable");
  method.call(view);
}

function observeGroupBodyRenders(view: ChatView): GroupBodyRenderCall[] {
  const method: unknown = Reflect.get(view, "renderMessageGroupBody");
  if (!isRenderMessageGroupBody(method)) throw new Error("ChatView.renderMessageGroupBody is not callable");
  const calls: GroupBodyRenderCall[] = [];
  const observed: RenderMessageGroupBody = function (messages, startIndex) {
    calls.push({ messages, startIndex });
    return method.call(this, messages, startIndex);
  };
  if (!Reflect.set(view, "renderMessageGroupBody", observed)) throw new Error("Could not observe ChatView.renderMessageGroupBody");
  return calls;
}

function isRenderQueuedMessages(value: unknown): value is RenderQueuedMessages {
  return typeof value === "function";
}

function isRenderMessageGroup(value: unknown): value is RenderMessageGroup {
  return typeof value === "function";
}

function isRenderMessageGroupBody(value: unknown): value is RenderMessageGroupBody {
  return typeof value === "function";
}

function isRenderTopDrawer(value: unknown): value is RenderTopDrawer {
  return typeof value === "function";
}

function isFocusPendingNotificationTarget(value: unknown): value is FocusPendingNotificationTarget {
  return typeof value === "function";
}

function dispatchDetailsToggle(handler: TemplateEventHandler, open: boolean): void {
  const hadDetailsElement = Reflect.has(globalThis, "HTMLDetailsElement");
  const previousDetailsElement = Reflect.get(globalThis, "HTMLDetailsElement");
  class StubDetailsElement extends EventTarget {
    constructor(readonly open: boolean) {
      super();
    }
  }
  Reflect.set(globalThis, "HTMLDetailsElement", StubDetailsElement);
  try {
    const details = new StubDetailsElement(open);
    details.addEventListener("toggle", (event) => { handler(event); });
    details.dispatchEvent(new Event("toggle"));
  } finally {
    if (hadDetailsElement) Reflect.set(globalThis, "HTMLDetailsElement", previousDetailsElement);
    else Reflect.deleteProperty(globalThis, "HTMLDetailsElement");
  }
}


function withNotificationInbox(view: ChatView): ChatView {
  const notificationInbox: SelectedSessionNotificationView = {
    machineId: "local",
    sessionId: "session-1",
    cwd: "/repo",
    daemonInstanceId: "daemon-a",
    notifications: [{
      id: "daemon-a:1",
      message: "plain <strong>text</strong>\nsecond line",
      truncated: false,
      severity: "warning",
      receivedAt: "2026-07-18T00:00:00.000Z",
      order: 1,
    }],
    retainedCount: 1,
    discardedCount: 0,
    highestSeverity: "warning",
    dismissThrough: { order: 1, overflowWatermark: 0 },
    pendingDismissedIds: new Set(),
    dismissAllPending: false,
    announcements: [],
  };
  view.sessionId = notificationInbox.sessionId;
  view.notificationInbox = notificationInbox;
  return view;
}

function requireNotificationInbox(view: ChatView): SelectedSessionNotificationView {
  if (view.notificationInbox === undefined) throw new Error("expected a notification inbox");
  return view.notificationInbox;
}

function emptyNotificationInbox(inbox: SelectedSessionNotificationView): SelectedSessionNotificationView {
  const empty: SelectedSessionNotificationView = {
    ...inbox,
    notifications: [],
    retainedCount: 0,
    discardedCount: 0,
    pendingDismissedIds: new Set(),
    dismissAllPending: false,
  };
  delete empty.highestSeverity;
  return empty;
}

function installNotificationFocusRoot(view: ChatView): ReturnType<typeof vi.fn> {
  const headerFocus = vi.fn();
  const renderRoot = {
    querySelector: (selector: string) => selector === "[data-notification-focus='header']" ? { focus: headerFocus } : null,
    querySelectorAll: () => [],
  };
  if (!Reflect.set(view, "renderRoot", renderRoot)) throw new Error("Could not install notification focus root");
  return headerFocus;
}

function queuedStatus(queuedMessages: QueuedSessionMessage[]): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: queuedMessages.length,
    queuedMessages,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

describe("the activity panel under a failed read", () => {
  // Caught live: with the daemon down (99 failed fetches), the panel kept
  // rendering the present-tense "Nothing running right now." - a failing read
  // was wearing a completed read's sentence. The panel state was retained
  // (empty arrays from the last good read), so the failed branch - which only
  // guarded the never-read case - was unreachable. A failed read says so
  // whether or not older rows are retained.
  it("says the read failed instead of claiming present emptiness over retained rows", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    Reflect.set(view, "activityRowsSessionId", "session-1");
    view.activityFailed = true;
    const render: unknown = Reflect.get(view, "renderActivityPanel");
    if (!isRenderActivityPanel(render)) throw new Error("renderActivityPanel is not callable");
    const template = render.call(view, {
      rows: [],
      runRows: [],
      taskRows: [],
      summary: { working: false },
      total: 0,
      activeCount: 0,
    });
    const text = templateText(template);
    expect(text).toContain("Activity could not be loaded");
    expect(text).not.toContain("running right now");
  });

  it("keeps the present-tense empty only when the read succeeded and found nothing", () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    Reflect.set(view, "activityRowsSessionId", "session-1");
    view.activityFailed = false;
    const render: unknown = Reflect.get(view, "renderActivityPanel");
    if (!isRenderActivityPanel(render)) throw new Error("renderActivityPanel is not callable");
    const template = render.call(view, {
      rows: [],
      runRows: [],
      taskRows: [],
      summary: { working: false },
      total: 0,
      activeCount: 0,
    });
    expect(templateText(template)).toContain("No agent runs or tasks running right now");
  });
});

describe("ChatView queue-follow scroll (queueGrew)", () => {
  // A message queued from elsewhere arrives via status.queuedMessages, not via
  // `messages`. Without a growth check the view would sit at the old bottom
  // while a new queued row appears below the fold; with an any-change check it
  // would chase every polling tick and drag the transcript down while the user
  // reads something above it.
  function queueGrewOf(view: ChatView, previous: unknown): boolean {
    const method: unknown = Reflect.get(view, "queueGrew");
    if (typeof method !== "function") throw new Error("ChatView.queueGrew is not callable");
    const result: unknown = method.call(view, previous);
    return result === true;
  }

  it("is true when the queue grew", () => {
    const view = new ChatView();
    view.status = queuedStatus([{ kind: "steer", text: "first" }, { kind: "followUp", text: "second" }]);

    expect(queueGrewOf(view, queuedStatus([{ kind: "steer", text: "first" }]))).toBe(true);
    expect(queueGrewOf(view, queuedStatus([]))).toBe(true);
  });

  it("is false when the queue is unchanged, smaller, or absent before", () => {
    const view = new ChatView();
    view.status = queuedStatus([{ kind: "steer", text: "first" }]);

    expect(queueGrewOf(view, queuedStatus([{ kind: "steer", text: "first" }]))).toBe(false);
    expect(queueGrewOf(view, queuedStatus([{ kind: "steer", text: "first" }, { kind: "followUp", text: "second" }]))).toBe(false);
    // First sight of a non-empty queue is growth from nothing: the rows below
    // the fold need the same pull as any later addition.
    expect(queueGrewOf(view, undefined)).toBe(true);
    expect(queueGrewOf(view, null)).toBe(true);
    expect(queueGrewOf(view, { notAStatus: true })).toBe(true);
  });
});

describe("the way back to the newest message", () => {
  /**
   * The button is worth nothing if it does not actually return the reader, and
   * it must not linger once they are back.
   */
  const isTemplate = (value: unknown): value is TemplateResult =>
    typeof value === "object" && value !== null && "strings" in value && "values" in value;

  const jumpTemplate = (view: ChatView): TemplateResult | null => {
    const render: unknown = Reflect.get(view, "renderJumpToBottom");
    if (typeof render !== "function") throw new Error("expected a jump-to-bottom renderer");
    const template: unknown = Reflect.apply(render, view, []);
    if (template === null) return null;
    if (!isTemplate(template)) throw new Error("expected a template");
    return template;
  };

  it("returns to the newest message and stops offering to", () => {
    const view = new ChatView();
    Reflect.set(view, "jumpToBottomVisible", true);
    Reflect.set(view, "pinnedToBottom", false);
    let scrolled = false;
    Reflect.set(view, "scrollToBottom", () => { scrolled = true; });

    const template = jumpTemplate(view);
    if (template === null) throw new Error("expected the button while the newest message is out of reach");
    templateEventHandlerNearMarker(template, "jump-to-bottom")(new Event("click"));

    expect(scrolled).toBe(true);
    expect(Reflect.get(view, "pinnedToBottom")).toBe(true);
    expect(Reflect.get(view, "jumpToBottomVisible")).toBe(false);
  });

  it("offers nothing while the newest message is within reach", () => {
    const view = new ChatView();
    Reflect.set(view, "jumpToBottomVisible", false);

    expect(jumpTemplate(view)).toBe(null);
  });
});
