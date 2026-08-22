import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, runPendingAnimationFrames, status, type AppState } from "./sessionController.testSupport";

/**
 * Re-reading goals when a turn ends.
 *
 * Goals are otherwise read on workspace selection and on the panel's refresh
 * button only, so a goal that changed inside a turn - /goal-tweak,
 * /goal-resume, a task the agent completed - left the panel showing a snapshot
 * from whenever the workspace was picked. Observed 2026-08-22: the panel read
 * "PAUSED 9/10" while the goal file on disk said active.
 *
 * The falling edge is deliberate. Refreshing on every status update would be a
 * poll wearing an event's clothes, and the file has not settled until the turn
 * that was writing it is over.
 */

function harness() {
  let state: AppState = { ...initialAppState(), selectedSession: oldSession, sessions: [oldSession] };
  const onSelectedSessionIdle = vi.fn<() => void>();
  const controller = new SessionController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    () => undefined,
    undefined,
    { socket: new FakeSocket(), api: { ...defaultApi }, onSelectedSessionIdle },
  );
  const publish = (isStreaming: boolean): void => {
    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming } });
    runPendingAnimationFrames();
  };
  return { controller, publish, onSelectedSessionIdle, state: () => state };
}

describe("SessionController goal refresh on idle", () => {
  it("fires once when the selected session stops working", () => {
    const { publish, onSelectedSessionIdle } = harness();

    publish(true);
    expect(onSelectedSessionIdle).not.toHaveBeenCalled();

    publish(false);
    expect(onSelectedSessionIdle).toHaveBeenCalledTimes(1);
  });

  it("does not fire while the session keeps working", () => {
    const { publish, onSelectedSessionIdle } = harness();

    publish(true);
    publish(true);

    expect(onSelectedSessionIdle).not.toHaveBeenCalled();
  });

  it("does not fire again on further idle updates", () => {
    // Every idle status would otherwise re-read the directory, which is the
    // poll this edge exists to avoid.
    const { publish, onSelectedSessionIdle } = harness();

    publish(true);
    publish(false);
    publish(false);

    expect(onSelectedSessionIdle).toHaveBeenCalledTimes(1);
  });

  it("ignores a session that is not the selected one", () => {
    const { controller, onSelectedSessionIdle } = harness();

    controller.applyGlobalEvent({ type: "status.update", status: { ...status("other-session"), isStreaming: true } });
    runPendingAnimationFrames();
    controller.applyGlobalEvent({ type: "status.update", status: { ...status("other-session"), isStreaming: false } });
    runPendingAnimationFrames();

    expect(onSelectedSessionIdle).not.toHaveBeenCalled();
  });
});
