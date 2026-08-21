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

  it("does not write state when the snapshot adds nothing", async () => {
    const { controller, setState } = harness({ statuses: [] });

    await controller.hydrateSessionStatuses("local");

    expect(setState).toHaveLength(0);
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
