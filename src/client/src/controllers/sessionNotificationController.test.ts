import { describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import { selectedNotificationView } from "../sessionNotifications";
import type {
  Machine,
  SessionInfo,
  SessionNotification,
  SessionNotificationInboxEvent,
  SessionNotificationInboxSnapshot,
} from "../../../shared/apiTypes";
import { SessionNotificationController, type SessionNotificationApi } from "./sessionNotificationController";

const localMachine: Machine = {
  id: "local",
  name: "Local",
  kind: "local",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

const session: SessionInfo = {
  id: "session-1",
  cwd: "/repo",
  path: "/tmp/session-1.jsonl",
  created: "2026-07-18T00:00:00.000Z",
  modified: "2026-07-18T00:00:00.000Z",
  messageCount: 0,
  firstMessage: "",
};

function entry(order: number, severity: SessionNotification["severity"] = "info"): SessionNotification {
  return {
    id: `daemon-a:${String(order)}`,
    message: `notice ${String(order)}`,
    truncated: false,
    severity,
    receivedAt: `2026-07-18T00:00:${String(order).padStart(2, "0")}.000Z`,
    order,
  };
}

function inboxSnapshot(
  notifications: SessionNotification[] = [entry(1)],
  options: { inboxRevision?: number; catalogRevision?: number; discardedCount?: number; daemonInstanceId?: string } = {},
): SessionNotificationInboxSnapshot {
  const highestSeverity = notifications.some((notification) => notification.severity === "error")
    ? "error"
    : notifications.some((notification) => notification.severity === "warning") ? "warning" : notifications.length > 0 ? "info" : undefined;
  return {
    daemonInstanceId: options.daemonInstanceId ?? "daemon-a",
    catalogRevision: options.catalogRevision ?? options.inboxRevision ?? 1,
    summary: {
      sessionId: session.id,
      cwd: session.cwd,
      inboxRevision: options.inboxRevision ?? 1,
      retainedCount: notifications.length,
      discardedCount: options.discardedCount ?? 0,
      ...(highestSeverity === undefined ? {} : { highestSeverity }),
    },
    notifications,
    dismissThrough: { order: notifications[0]?.order ?? 0, overflowWatermark: options.discardedCount ?? 0 },
  };
}

function addedEvent(notification: SessionNotification, inboxRevision: number, retainedCount: number): SessionNotificationInboxEvent {
  return {
    type: "notifications.inbox",
    daemonInstanceId: "daemon-a",
    catalogRevision: inboxRevision,
    summary: {
      sessionId: session.id,
      cwd: session.cwd,
      inboxRevision,
      retainedCount,
      discardedCount: 0,
      highestSeverity: notification.severity,
    },
    dismissThrough: { order: notification.order, overflowWatermark: 0 },
    delta: { kind: "added", notification },
  };
}

function baseState(): AppState {
  return {
    ...initialAppState(),
    machines: [localMachine],
    selectedMachine: localMachine,
    selectedSession: session,
    sessions: [session],
  };
}

function createHarness(initialState = baseState(), overrides: Partial<SessionNotificationApi> = {}) {
  let state = initialState;
  const api: SessionNotificationApi = {
    notificationInbox: vi.fn(() => Promise.resolve(inboxSnapshot())),
    dismissNotification: vi.fn(() => Promise.resolve(inboxSnapshot([], { inboxRevision: 2, catalogRevision: 2 }))),
    dismissAllNotifications: vi.fn(() => Promise.resolve(inboxSnapshot([], { inboxRevision: 2, catalogRevision: 2 }))),
    ...overrides,
  };
  const controller = new SessionNotificationController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    { api, onBackgroundError: vi.fn() },
  );
  return {
    controller,
    api,
    get state() { return state; },
    replaceState(next: AppState) { state = next; },
  };
}

describe("SessionNotificationController selected inbox ownership", () => {
  it("joins selected live events that arrive while the selected snapshot is loading", async () => {
    const pendingInbox = deferred<SessionNotificationInboxSnapshot>();
    const harness = createHarness(baseState(), { notificationInbox: vi.fn(() => pendingInbox.promise) });

    harness.controller.prepareSelectedSession(session, "local");
    const refresh = harness.controller.refreshSelectedSession(session, "local");
    harness.controller.applyInboxEvent("local", addedEvent(entry(2, "warning"), 2, 2));
    pendingInbox.resolve(inboxSnapshot([entry(1)], { inboxRevision: 1, catalogRevision: 1 }));
    await refresh;

    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.notifications.map((notification) => notification.id)).toEqual([
      "daemon-a:2",
      "daemon-a:1",
    ]);
    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.announcements).toMatchObject([
      { severity: "warning", message: "notice 2" },
    ]);
  });

  it("ignores notification events for an unselected chat", async () => {
    const harness = createHarness();
    harness.controller.prepareSelectedSession(session, "local");
    await harness.controller.refreshSelectedSession(session, "local");
    const selectedBefore = harness.state.selectedNotificationInbox;

    harness.controller.applyInboxEvent("local", {
      ...addedEvent(entry(2), 2, 1),
      summary: { ...addedEvent(entry(2), 2, 1).summary, sessionId: "session-2" },
    });
    await Promise.resolve();

    expect(harness.api.notificationInbox).toHaveBeenCalledOnce();
    expect(harness.state.selectedNotificationInbox).toBe(selectedBefore);
  });

  /** The drawer's failure line keys off this status: a failed read must be
   * recorded as stale so the UI can tell it from a load still in flight. The
   * projection-to-view step drops everything non-fresh, so this status is the
   * only record that the failure happened. */
  it("records a failed selected read as stale, the signal the failure line keys off", async () => {
    const harness = createHarness(baseState(), { notificationInbox: vi.fn(() => Promise.reject(new Error("daemon down"))) });

    harness.controller.prepareSelectedSession(session, "local");
    await harness.controller.refreshSelectedSession(session, "local");

    expect(harness.state.selectedNotificationInbox?.status).toBe("stale");
  });

  it("recovers a selected inbox revision gap from its bounded snapshot", async () => {
    const first = inboxSnapshot([entry(1)], { inboxRevision: 1, catalogRevision: 1 });
    const recovered = inboxSnapshot([entry(3), entry(1)], { inboxRevision: 3, catalogRevision: 3 });
    const notificationInbox = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(recovered);
    const harness = createHarness(baseState(), { notificationInbox });
    harness.controller.prepareSelectedSession(session, "local");
    await harness.controller.refreshSelectedSession(session, "local");

    harness.controller.applyInboxEvent("local", addedEvent(entry(3), 3, 2));

    await vi.waitFor(() => { expect(notificationInbox).toHaveBeenCalledTimes(2); });
    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.notifications.map((notification) => notification.id)).toEqual([
      "daemon-a:3",
      "daemon-a:1",
    ]);
  });

  it("ignores an old selected-inbox response after selection changes", async () => {
    const oldInbox = deferred<SessionNotificationInboxSnapshot>();
    const harness = createHarness(baseState(), { notificationInbox: vi.fn(() => oldInbox.promise) });
    const otherSession = { ...session, id: "session-2", path: "/tmp/session-2.jsonl" };

    harness.controller.prepareSelectedSession(session, "local");
    const refresh = harness.controller.refreshSelectedSession(session, "local");
    harness.controller.prepareSelectedSession(otherSession, "local");
    oldInbox.resolve(inboxSnapshot());
    await refresh;

    expect(harness.state.selectedNotificationInbox).toMatchObject({ sessionId: "session-2", status: "loading", notifications: [] });
  });

  it("hides a selected remote inbox when the machine becomes unreachable and ignores an in-flight snapshot", async () => {
    const remoteMachine: Machine = { ...localMachine, id: "remote-a", name: "Remote", kind: "remote", baseUrl: "https://remote.example.test/" };
    const initial = {
      ...baseState(),
      machines: [remoteMachine],
      selectedMachine: remoteMachine,
    };
    const pendingInbox = deferred<SessionNotificationInboxSnapshot>();
    const notificationInbox = vi.fn()
      .mockResolvedValueOnce(inboxSnapshot())
      .mockImplementationOnce(() => pendingInbox.promise);
    const harness = createHarness(initial, { notificationInbox });

    harness.controller.prepareSelectedSession(session, remoteMachine.id);
    await harness.controller.refreshSelectedSession(session, remoteMachine.id);
    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.notifications).toHaveLength(1);

    const refresh = harness.controller.refreshSelectedSession(session, remoteMachine.id);
    const previous = harness.state;
    const offline: AppState = {
      ...previous,
      machineStatuses: {
        [remoteMachine.id]: {
          machineId: remoteMachine.id,
          ok: false,
          checkedAt: "2026-07-18T00:01:00.000Z",
          status: "offline",
        },
      },
    };
    harness.replaceState(offline);
    harness.controller.syncEnvironment(previous, offline);

    expect(harness.state.selectedNotificationInbox?.status).toBe("stale");
    expect(selectedNotificationView(harness.state.selectedNotificationInbox)).toBeUndefined();

    pendingInbox.resolve(inboxSnapshot([entry(2, "error")], { inboxRevision: 2, catalogRevision: 2 }));
    await refresh;
    expect(harness.state.selectedNotificationInbox?.status).toBe("stale");
    expect(selectedNotificationView(harness.state.selectedNotificationInbox)).toBeUndefined();
  });
});

describe("SessionNotificationController optimistic mutations", () => {
  it("does not let a delayed refresh snapshot roll back a newer dismissal response", async () => {
    const initial = inboxSnapshot([entry(1)], { inboxRevision: 1, catalogRevision: 1 });
    const delayedRefresh = deferred<SessionNotificationInboxSnapshot>();
    const notificationInbox = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => delayedRefresh.promise);
    const dismissed = inboxSnapshot([], { inboxRevision: 2, catalogRevision: 2 });
    const harness = createHarness(baseState(), {
      notificationInbox,
      dismissNotification: vi.fn(() => Promise.resolve(dismissed)),
    });

    harness.controller.prepareSelectedSession(session, "local");
    await harness.controller.refreshSelectedSession(session, "local");
    const refresh = harness.controller.refreshSelectedSession(session, "local");
    await harness.controller.dismissNotification("daemon-a:1");

    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.notifications).toEqual([]);
    delayedRefresh.resolve(initial);
    await refresh;

    expect(harness.state.selectedNotificationInbox?.summary?.inboxRevision).toBe(2);
    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.notifications).toEqual([]);
  });

  it("optimistically dismisses one card, reconciles the response, and rolls back/refetches on failure", async () => {
    const dismiss = deferred<SessionNotificationInboxSnapshot>();
    const refreshAfterFailure = deferred<SessionNotificationInboxSnapshot>();
    const initialInbox = inboxSnapshot([entry(2, "warning"), entry(1)]);
    const notificationInbox = vi.fn()
      .mockResolvedValueOnce(initialInbox)
      .mockImplementationOnce(() => refreshAfterFailure.promise);
    const dismissNotification = vi.fn()
      .mockImplementationOnce(() => dismiss.promise)
      .mockRejectedValueOnce(new Error("offline"));
    const harness = createHarness(baseState(), { notificationInbox, dismissNotification });

    harness.controller.prepareSelectedSession(session, "local");
    await harness.controller.refreshSelectedSession(session, "local");
    const firstDismissal = harness.controller.dismissNotification("daemon-a:2");

    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.notifications.map((notification) => notification.id)).toEqual(["daemon-a:1"]);

    dismiss.resolve(inboxSnapshot([entry(1)], { inboxRevision: 2, catalogRevision: 2 }));
    await firstDismissal;
    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.notifications.map((notification) => notification.id)).toEqual(["daemon-a:1"]);

    const failedDismissal = harness.controller.dismissNotification("daemon-a:1");
    await vi.waitFor(() => { expect(harness.state.error).toContain("offline"); });
    refreshAfterFailure.resolve(inboxSnapshot([entry(1)], { inboxRevision: 2, catalogRevision: 2 }));
    await failedDismissal;

    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.notifications.map((notification) => notification.id)).toEqual(["daemon-a:1"]);
    expect(notificationInbox).toHaveBeenCalledTimes(2);
  });

  it("uses the server cutoff for dismiss-all and leaves a concurrently arriving newer card visible", async () => {
    const dismissAll = deferred<SessionNotificationInboxSnapshot>();
    const dismissAllNotifications = vi.fn(() => dismissAll.promise);
    const harness = createHarness(baseState(), {
      notificationInbox: vi.fn(() => Promise.resolve(inboxSnapshot([entry(2), entry(1)]))),
      dismissAllNotifications,
    });
    harness.controller.prepareSelectedSession(session, "local");
    await harness.controller.refreshSelectedSession(session, "local");

    const dismissal = harness.controller.dismissAll();
    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.notifications).toEqual([]);
    expect(dismissAllNotifications).toHaveBeenCalledWith({ id: session.id, cwd: session.cwd }, "daemon-a", { order: 2, overflowWatermark: 0 }, "local");

    harness.controller.applyInboxEvent("local", addedEvent(entry(3), 2, 3));
    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.notifications.map((notification) => notification.id)).toEqual(["daemon-a:3"]);

    dismissAll.resolve(inboxSnapshot([entry(3)], { inboxRevision: 3, catalogRevision: 3 }));
    await dismissal;
    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.notifications.map((notification) => notification.id)).toEqual(["daemon-a:3"]);
  });

  /**
   * A tab left open across a daemon restart holds the instance id it read
   * before the restart. Dismiss-all names an order range rather than an id, and
   * order restarts with the process, so the daemon refuses it - correctly, or a
   * stale range would clear notifications the reader has never seen.
   *
   * Before the refusal was named, that cost the reader a tap: the row came back
   * on the next poll with nothing to say why. The answer carries the current
   * instance and its range, so the request is reissued against those and the
   * one gesture clears the inbox.
   */
  it("reissues dismiss-all against the range a stale-instance refusal reports", async () => {
    const refusal = { ...inboxSnapshot([entry(1)], { daemonInstanceId: "daemon-b" }), outcome: "stale-instance" as const };
    const accepted = { ...inboxSnapshot([], { inboxRevision: 2, catalogRevision: 2, daemonInstanceId: "daemon-b" }), outcome: "dismissed" as const };
    const dismissAllNotifications = vi.fn()
      .mockResolvedValueOnce(refusal)
      .mockResolvedValueOnce(accepted);
    const harness = createHarness(baseState(), {
      notificationInbox: vi.fn(() => Promise.resolve(inboxSnapshot([entry(1)]))),
      dismissAllNotifications,
    });
    harness.controller.prepareSelectedSession(session, "local");
    await harness.controller.refreshSelectedSession(session, "local");

    await harness.controller.dismissAll();

    expect(dismissAllNotifications).toHaveBeenCalledTimes(2);
    expect(dismissAllNotifications.mock.calls[0]?.[1]).toBe("daemon-a");
    expect(dismissAllNotifications.mock.calls[1]?.[1]).toBe("daemon-b");
    expect(selectedNotificationView(harness.state.selectedNotificationInbox)?.notifications).toEqual([]);
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolveDeferred: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { resolveDeferred = resolve; });
  if (resolveDeferred === undefined) throw new Error("Deferred promise was not initialized");
  return { promise, resolve: resolveDeferred };
}
