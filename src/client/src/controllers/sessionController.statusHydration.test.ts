import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, runPendingAnimationFrames, status, type AppState, type SessionStatus } from "./sessionController.testSupport";

/**
 * Work indicators are driven by `sessionStatuses`, which is otherwise fed only
 * by live `status.update` broadcasts. A browser that loads — or reconnects —
 * while a session is already streaming receives no such broadcast until that
 * session next publishes, so without hydration the row shows no work dot even
 * though the session is busy.
 */
describe("SessionController.hydrateSessionStatuses", () => {
  it("fills statuses the browser has never seen", async () => {
    const busy: SessionStatus = { ...status("other-session"), isStreaming: true };
    const { controller, state } = harness({ statuses: [busy] });

    await controller.hydrateSessionStatuses("local");

    expect(state().sessionStatuses["other-session"]).toMatchObject({ sessionId: "other-session", isStreaming: true });
  });

  it("never overwrites a status already known from a live event", async () => {
    const { controller, state, setState } = harness({
      statuses: [{ ...status(oldSession.id), isStreaming: false, messageCount: 1 }],
    });
    // A live event is by definition newer than the snapshot that raced it.
    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 9 } });
    runPendingAnimationFrames();
    setState.length = 0;

    await controller.hydrateSessionStatuses("local");

    expect(state().sessionStatuses[oldSession.id]).toMatchObject({ isStreaming: true, messageCount: 9 });
  });

  it("replaces a known status after a reconnect", async () => {
    // The opposite case, and the one that made the UI look broken: while the
    // socket was down, the status.update saying a session had finished was
    // published to nobody. Filling only gaps leaves the browser showing that
    // session as working forever - until someone reloads the page, which is
    // exactly the complaint. A reconnect asks for the truth, not the gaps.
    const { controller, state } = harness({
      statuses: [{ ...status(oldSession.id), isStreaming: false, messageCount: 12 }],
    });
    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 9 } });
    runPendingAnimationFrames();

    await controller.hydrateSessionStatuses("local", { replaceKnown: true });

    expect(state().sessionStatuses[oldSession.id]).toMatchObject({ isStreaming: false, messageCount: 12 });
  });

  it("keeps a status frame applied while a replacing read was on its way: the frame is the later fact", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { controller, state } = harness({ statuses: [{ ...status("other-session"), isStreaming: true }], gate });
    const read = controller.hydrateSessionStatuses("local", { replaceKnown: true });
    controller.applyGlobalEvent({ type: "status.update", status: { ...status("other-session"), isStreaming: false, messageCount: 7 } });
    runPendingAnimationFrames();
    release();
    await read;

    expect(state().sessionStatuses["other-session"]).toMatchObject({ isStreaming: false, messageCount: 7 });
  });

  it("drops an activity a replacing read shows is over, so a lost activity frame cannot leave a session working", async () => {
    const { controller, state, setStateRaw } = harness({ statuses: [{ ...status("other-session"), isStreaming: false }] });
    setStateRaw({ sessionActivities: { "other-session": { sessionId: "other-session", phase: "active", label: "working", at: "2026-10-01T00:00:00.000Z" } } });

    await controller.hydrateSessionStatuses("local", { replaceKnown: true });

    expect(state().sessionActivities).toEqual({});
  });

  it("keeps an activity frame applied while a replacing read was on its way, though the read says idle", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { controller, state } = harness({ statuses: [{ ...status("other-session"), isStreaming: false }], gate });
    const read = controller.hydrateSessionStatuses("local", { replaceKnown: true });
    controller.applyGlobalEvent({ type: "activity.update", activity: { sessionId: "other-session", phase: "active", label: "running bash", at: "2026-10-01T00:00:00.000Z" } });
    runPendingAnimationFrames();
    release();
    await read;

    expect(state().sessionActivities["other-session"]?.label).toBe("running bash");
  });

  it("keeps the activity of a session this page is still starting, which no catalog can list yet", async () => {
    const { controller, state, setStateRaw } = harness({ statuses: [] });
    const starts: unknown = Reflect.get(controller, "pendingSessionStarts");
    if (!(starts instanceof Map)) throw new Error("no pending starts");
    starts.set("pending-session-1", {});
    setStateRaw({ sessionActivities: { "pending-session-1": { sessionId: "pending-session-1", phase: "active", label: "Creating session", at: "2026-10-01T00:00:00.000Z" } } });

    await controller.hydrateSessionStatuses("local", { replaceKnown: true });

    expect(state().sessionActivities["pending-session-1"]?.label).toBe("Creating session");
  });

  it("does not write state when the snapshot adds nothing", async () => {
    const { controller, setState } = harness({ statuses: [] });

    await controller.hydrateSessionStatuses("local");

    expect(setState).toHaveLength(0);
  });

  it("keeps the status of a session the snapshot does not mention", async () => {
    // A reconnect asks the catalog for the truth, but the catalog can be
    // transiently narrower than reality (a session mid-mutation, a listing
    // race). Its silence about a session is not evidence the session died:
    // erasing the known status killed the selected session's whole indicator
    // row (streaming dot, token stats) while the queue area kept its last
    // known shape. Absence is not negation; only the snapshot-covered ids
    // are replaced.
    const { controller, state } = harness({
      statuses: [{ ...status("other-session"), isStreaming: true }],
    });
    const live = { ...status(oldSession.id), isStreaming: true, queuedMessages: [{ kind: "steer" as const, text: "held" }] };
    controller.applyGlobalEvent({ type: "status.update", status: live });
    runPendingAnimationFrames();

    await controller.hydrateSessionStatuses("local", { replaceKnown: true });

    expect(state().sessionStatuses[oldSession.id]).toMatchObject({ isStreaming: true });
    expect(state().sessionStatuses["other-session"]).toMatchObject({ isStreaming: true });
  });

  it("stays silent when the snapshot request fails", async () => {
    const { controller, state, setState } = harness({ error: new Error("offline") });

    await expect(controller.hydrateSessionStatuses("local")).resolves.toBeUndefined();

    // Best-effort: a hydration failure must not surface as a session error,
    // which would replace the transcript with an error banner.
    expect(setState).toHaveLength(0);
    expect(state().error).toBe("");
  });

  it("discards a snapshot that arrives after the machine changed", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { controller, state, setStateRaw } = harness({
      statuses: [{ ...status("other-session"), isStreaming: true }],
      gate,
    });

    const hydration = controller.hydrateSessionStatuses("local");
    setStateRaw({ selectedMachine: { id: "remote", name: "remote", kind: "remote", createdAt: "2026-07-27T10:00:00.000Z", updatedAt: "2026-07-27T10:00:00.000Z" } });
    release();
    await hydration;

    expect(state().sessionStatuses["other-session"]).toBeUndefined();
  });
});

function harness(options: { statuses?: SessionStatus[]; error?: Error; gate?: Promise<void> }) {
  const setState: Partial<AppState>[] = [];
  let state: AppState = { ...initialAppState(), selectedSession: oldSession, sessions: [oldSession] };
  const setStateRaw = (patch: Partial<AppState>): void => { state = { ...state, ...patch }; };
  const controller = new SessionController(
    () => state,
    (patch) => { setState.push(patch); setStateRaw(patch); },
    () => undefined,
    undefined,
    {
      socket: new FakeSocket(),
      api: {
        ...defaultApi,
        statusCatalog: vi.fn(async () => {
          await options.gate;
          if (options.error !== undefined) throw options.error;
          return { statuses: options.statuses ?? [], generatedAt: "2026-07-27T10:00:00.000Z" };
        }),
      },
    },
  );
  return { controller, state: () => state, setState, setStateRaw };
}

/**
 * Activity reached a page only as live frames, so a page that opened in the middle of a long step
 * (a 25 s bash) said nothing about it until the next step began (B25, probe-status-narrates).
 */
describe("the activity a status brings", () => {
  const running = { sessionId: "other-session", phase: "active" as const, label: "running tool", detail: "bash: sleep 25", at: "2026-10-02T10:00:00.000Z", step: { kind: "running" as const, tools: [{ id: "c1", name: "bash", target: "sleep 25" }] }, stepSince: "2026-10-02T10:00:00.000Z" };

  it("is taken when the page knows no activity for the session", () => {
    const { controller, state } = harness({ statuses: [] });

    controller.applyGlobalEvent({ type: "status.update", status: { ...status("other-session"), isStreaming: true, activity: running } });
    runPendingAnimationFrames();

    expect(state().sessionActivities["other-session"]?.step).toEqual(running.step);
  });

  it("never replaces an activity the page already has from a live frame", () => {
    const { controller, state } = harness({ statuses: [] });
    controller.applyGlobalEvent({ type: "activity.update", activity: { ...running, label: "thinking", step: { kind: "thinking" } } });
    runPendingAnimationFrames();

    controller.applyGlobalEvent({ type: "status.update", status: { ...status("other-session"), isStreaming: true, activity: running } });
    runPendingAnimationFrames();

    expect(state().sessionActivities["other-session"]?.step).toEqual({ kind: "thinking" });
  });

  it("replaces an activity the same status shows is over with the one it brings (review of ad83d24b)", () => {
    const { controller, state } = harness({ statuses: [] });
    controller.applyGlobalEvent({ type: "activity.update", activity: running });
    runPendingAnimationFrames();
    const stopped = { sessionId: "other-session", phase: "idle" as const, label: "stopped", at: "2026-10-02T10:00:09.000Z", step: { kind: "idle" as const }, stepSince: "2026-10-02T10:00:09.000Z" };

    controller.applyGlobalEvent({ type: "status.update", status: { ...status("other-session"), isStreaming: false, activity: stopped } });
    runPendingAnimationFrames();

    expect(state().sessionActivities["other-session"]?.label).toBe("stopped");
  });

  it("is not taken when the status itself says the work is over", () => {
    const { controller, state } = harness({ statuses: [] });

    controller.applyGlobalEvent({ type: "status.update", status: { ...status("other-session"), isStreaming: false, activity: running } });
    runPendingAnimationFrames();

    expect(state().sessionActivities["other-session"]).toBeUndefined();
  });
});
