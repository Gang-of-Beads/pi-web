// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { SessionActivity, SessionStatus } from "../../../shared/apiTypes";
import type { SelectedSessionNotificationView } from "../sessionNotifications";
import { ChatView } from "./ChatView";

function status(): SessionStatus {
  return {
    sessionId: "s",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function activity(): SessionActivity {
  return { sessionId: "s", phase: "idle", label: "Working", at: "2026-08-18T11:20:00.000Z" };
}

async function drawerWithEverything(): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "s";
  view.status = status();
  view.activity = activity();
  view.goalsLoad = { state: "loaded", key: "test-key", data: [{
    id: "g1",
    objective: "ship it",
    status: "active",
    path: "/repo/.pi/goals/g1.json",
    sisyphus: false,
    autoContinue: false,
    tasks: [],
    completedTaskCount: 0,
    totalTaskCount: 0,
  }] };
  const inbox: SelectedSessionNotificationView = {
    machineId: "local",
    sessionId: "s",
    cwd: "/repo",
    daemonInstanceId: "daemon-a",
    notifications: [{ id: "daemon-a:1", message: "hello", truncated: false, severity: "info", receivedAt: "2026-08-18T11:20:00.000Z", order: 1 }],
    retainedCount: 1,
    discardedCount: 0,
    dismissThrough: { order: 1, overflowWatermark: 0 },
    pendingDismissedIds: new Set(),
    dismissAllPending: false,
    announcements: [],
  };
  view.notificationInbox = inbox;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function sectionNames(view: ChatView): string[] {
  return [...view.renderRoot.querySelectorAll("[role='tab']")].map((tab) => tab.textContent.trim());
}

afterEach(() => { document.body.replaceChildren(); });

describe("the goals tab count", () => {
  /**
   * The owner reported the GOALS tab bare while every sibling tab carries its
   * count ("ACTIVITY · 1 RUNNING", "NOTIFICATIONS (2)"). Root cause: the
   * count's `known` flag was a property only tests ever set — production never
   * wired it, so the tab label read "Goals" forever. The count must derive
   * from the goals slot's own load state.
   */
  it("carries the goal count once the goals slot has loaded", async () => {
    const view = await drawerWithEverything();
    expect(sectionNames(view).find((name) => name.startsWith("Goals"))).toBe("Goals 1");
  });

  it("stays bare while the goals slot is unloaded — absence is not negation", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.status = status();
    view.activity = activity();
    view.subagents = [{ sessionId: "01a0child-0001-0000-000000000001", cwd: "/repo/.pi/sub", status: "working" }];
    view.goalsLoad = { state: "unloaded", key: "test-key", data: [] };
    document.body.append(view);
    await view.updateComplete;
    expect(sectionNames(view).find((name) => name.startsWith("Goals"))).toBe("Goals");
  });
});

describe("the sections of an expanded drawer", () => {
  /**
   * The drawer opened on whichever section you pressed and the reader could
   * not get to the others: reaching Goals from Notifications meant collapsing
   * the drawer first. The strip that names the sections has to survive the
   * drawer opening, or opening one section is a one-way door.
   */
  it("still names every section once the drawer is open", async () => {
    const view = await drawerWithEverything();
    const collapsed = sectionNames(view);

    const toggle = view.renderRoot.querySelector<HTMLButtonElement>("[aria-expanded]");
    toggle?.click();
    await view.updateComplete;

    expect(collapsed.length).toBeGreaterThan(1);
    expect(sectionNames(view)).toEqual(collapsed);
  });

  /**
   * Naming them is not enough: pressing one has to move there.
   */
  it("moves to another section without closing first", async () => {
    const view = await drawerWithEverything();
    const toggle = view.renderRoot.querySelector<HTMLButtonElement>("[aria-expanded]");
    toggle?.click();
    await view.updateComplete;

    const goals = view.renderRoot.querySelector<HTMLButtonElement>(".drawer-tab-goals");
    goals?.click();
    await view.updateComplete;

    expect(view.renderRoot.querySelector(".drawer-tab-goals")?.getAttribute("aria-selected")).toBe("true");
    expect(view.renderRoot.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(false);
    expect(view.renderRoot.querySelector("#session-goal-list")).not.toBeNull();
  });

  /**
   * The way out has to be the same control that opened it. Reaching for the
   * toggle and finding it gone is what made the drawer feel like a place you
   * had to escape rather than a panel you had opened.
   */
  it("closes by the same control that opened it", async () => {
    const view = await drawerWithEverything();
    const open = view.renderRoot.querySelector<HTMLButtonElement>("[aria-expanded]");
    open?.click();
    await view.updateComplete;
    expect(view.renderRoot.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(false);

    const close = view.renderRoot.querySelector<HTMLButtonElement>("[aria-expanded]");
    expect(close).not.toBeNull();
    close?.click();
    await view.updateComplete;

    expect(view.renderRoot.querySelector<HTMLElement>(".drawer-body")?.hidden).toBe(true);
  });
});

describe("the goals entrance while its list is in flight", () => {
  /**
   * The tab rendered only when goals were already loaded, so the slow first
   * fetch - or a failed one - removed the entrance entirely: a reader with a
   * goal in flight watched the tab vanish instead of waiting for it.
   */
  it("stays rendered while the goals list is loading", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.status = status();
    view.goalsLoad = { state: "loading", key: "test-key", data: [] };
    document.body.append(view);
    await view.updateComplete;

    expect(view.shadowRoot?.querySelector("#drawer-tab-goals")).not.toBeNull();
  });

  /**
   * A failed read keeps the entrance too: "the read failed" and "no goals"
   * are different answers, and only one of them should remove the tab.
   */
  it("stays rendered when the goals read failed", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.status = status();
    view.goalsLoad = { state: "failed", key: "test-key", data: [] };
    document.body.append(view);
    await view.updateComplete;

    expect(view.shadowRoot?.querySelector("#drawer-tab-goals")).not.toBeNull();
  });

  /**
   * Membership is fixed for the drawer's whole life: a strip whose tabs appear
   * and vanish with their data reflows under the reading finger, and the tap
   * meant for one tab lands on whatever took its place (the owner tapped a
   * dialog option and hit the tab that had slid beneath it). The strip must
   * name the same three sections when nothing is happening as when everything
   * is.
   */
  it("keeps the same three tabs across empty, populated, and emptied again", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.status = status();
    // A working subagent is what justifies the drawer before anything else
    // has arrived; activity, notifications and goals all start empty.
    view.subagents = [{ sessionId: "01a0child-0001-0000-000000000001", cwd: "/repo/.pi/sub", status: "working" }];
    view.goalsLoad = { state: "loaded", key: "test-key", data: [] };
    document.body.append(view);
    await view.updateComplete;

    const tabIds = (): string[] => [...view.renderRoot.querySelectorAll("[role='tab']")].map((tab) => tab.id);
    expect(tabIds()).toEqual(["drawer-tab-activity", "drawer-tab-notifications", "drawer-tab-goals"]);

    const inbox: SelectedSessionNotificationView = {
      machineId: "local",
      sessionId: "s",
      cwd: "/repo",
      daemonInstanceId: "daemon-a",
      notifications: [{ id: "daemon-a:1", message: "hello", truncated: false, severity: "info", receivedAt: "2026-08-18T11:20:00.000Z", order: 1 }],
      retainedCount: 1,
      discardedCount: 0,
      dismissThrough: { order: 1, overflowWatermark: 0 },
      pendingDismissedIds: new Set(),
      dismissAllPending: false,
      announcements: [],
    };
    view.notificationInbox = inbox;
    await view.updateComplete;
    expect(tabIds()).toEqual(["drawer-tab-activity", "drawer-tab-notifications", "drawer-tab-goals"]);

    // Drained: the count may fall to zero, the tab may not leave.
    view.notificationInbox = { ...inbox, notifications: [], retainedCount: 0 };
    await view.updateComplete;
    expect(tabIds()).toEqual(["drawer-tab-activity", "drawer-tab-notifications", "drawer-tab-goals"]);
  });

  /**
   * An emptied notifications panel has to say so: an empty tab that renders
   * blank reads as broken, not as empty.
   */
  it("reads an emptied notifications tab as empty, in words", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.status = status();
    view.subagents = [{ sessionId: "01a0child-0001-0000-000000000001", cwd: "/repo/.pi/sub", status: "working" }];
    view.goalsLoad = { state: "loaded", key: "test-key", data: [] };
    document.body.append(view);
    await view.updateComplete;

    view.renderRoot.querySelector<HTMLButtonElement>("#drawer-tab-notifications")?.click();
    await view.updateComplete;

    expect(view.renderRoot.querySelector("#session-notification-list")?.textContent).toContain("No notifications");
  });

  /**
   * A failed read is a third state. The projection collapses loading, stale and
   * never-loaded into one undefined, so without a carried flag the panel's only
   * words for a dead read were the two absence sentences - the owner's panels
   * have photographed that substitution three times.
   */
  it("says a failed notifications read failed instead of claiming absence", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.status = status();
    view.subagents = [{ sessionId: "01a0child-0001-0000-000000000001", cwd: "/repo/.pi/sub", status: "working" }];
    view.goalsLoad = { state: "loaded", key: "test-key", data: [] };
    view.notificationsFailed = true;
    document.body.append(view);
    await view.updateComplete;

    view.renderRoot.querySelector<HTMLButtonElement>("#drawer-tab-notifications")?.click();
    await view.updateComplete;

    const text = view.renderRoot.querySelector("#session-notification-list")?.textContent ?? "";
    expect(text).toContain("could not be loaded");
    expect(text).not.toContain("No notifications");
  });

  /** The drawer's gate counts sections with something to say; a failed read is
   * one, or the failure line would be drawn inside a drawer that never opens. */
  it("keeps the drawer up when the only thing it can say is that notifications failed", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.status = status();
    view.goalsLoad = { state: "loaded", key: "test-key", data: [] };
    view.notificationsFailed = true;
    document.body.append(view);
    await view.updateComplete;

    expect(view.renderRoot.querySelector("#drawer-tab-notifications")).not.toBeNull();
  });
});
