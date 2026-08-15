import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { FakeSocket, oldSession, runPendingAnimationFrames, status, type AppState } from "./sessionController.testSupport";

/**
 * Frame-batched stream updates must still land when the browser stops running
 * animation frames (background tab, heavy paint pressure on a phone). The
 * shared test support stubs `requestAnimationFrame` into a queue that only runs
 * when a test drains it, so simply not draining it reproduces that state.
 */
describe("SessionController pending flush deadline", () => {
  beforeEach(() => {
    // Only timers are faked: the shared test support owns the animation-frame
    // stub, and letting fake timers replace it too would hide the very race
    // these tests cover.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies buffered updates on the timer when no animation frame runs", () => {
    const { controller, getState } = createController();

    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 7 } });
    expect(getState().sessionStatuses[oldSession.id]).toBeUndefined();

    vi.advanceTimersByTime(100);

    expect(getState().sessionStatuses[oldSession.id]).toMatchObject({ messageCount: 7 });
  });

  it("keeps streaming while frames stay blocked", () => {
    const { controller, getState } = createController();

    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 1 } });
    vi.advanceTimersByTime(100);
    expect(getState().sessionStatuses[oldSession.id]).toMatchObject({ messageCount: 1 });

    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 2 } });
    vi.advanceTimersByTime(100);

    expect(getState().sessionStatuses[oldSession.id]).toMatchObject({ messageCount: 2 });
  });

  it("does not apply the same buffer twice when a frame runs before the deadline", () => {
    const { controller, getState, setStateCalls } = createController();

    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 3 } });
    runPendingAnimationFrames();
    const callsAfterFrame = setStateCalls.length;

    vi.advanceTimersByTime(500);

    expect(setStateCalls).toHaveLength(callsAfterFrame);
    expect(getState().sessionStatuses[oldSession.id]).toMatchObject({ messageCount: 3 });
  });

  it("cancels the deadline when the selection is cleared", () => {
    const { controller, setStateCalls } = createController();

    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, messageCount: 4 } });
    controller.clearActiveSession();
    const callsAfterClear = setStateCalls.length;

    vi.advanceTimersByTime(500);

    expect(setStateCalls).toHaveLength(callsAfterClear);
  });
});

function createController(): { controller: SessionController; getState: () => AppState; setStateCalls: Partial<AppState>[] } {
  const setStateCalls: Partial<AppState>[] = [];
  let state: AppState = { ...initialAppState(), selectedSession: oldSession, sessions: [oldSession] };
  const controller = new SessionController(
    () => state,
    (patch) => { setStateCalls.push(patch); state = { ...state, ...patch }; },
    () => undefined,
    undefined,
    { socket: new FakeSocket() },
  );
  return { controller, getState: () => state, setStateCalls };
}
