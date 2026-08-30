import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, status, type AppState } from "./sessionController.testSupport";

type RunCommand = typeof defaultApi.runCommand;

/**
 * A goal command issued while a reply streams is forwarded as a prompt queued
 * behind it: the {type:"done"} the route returns means ACCEPTED, not executed.
 * The action-acknowledgment spec forbids dressing acceptance as completion, so
 * the ledger row must say it is waiting — and must keep the plain "done" only
 * for commands that truly finished.
 */
function harness(runCommand: RunCommand, streaming: boolean) {
  const sessionStatus = { ...status(oldSession.id), isStreaming: streaming };
  let state: AppState = { ...initialAppState(), status: sessionStatus, selectedSession: oldSession, sessions: [oldSession] };
  const controller = new SessionController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    () => undefined,
    undefined,
    { socket: new FakeSocket(), api: { ...defaultApi, runCommand } },
  );
  return { controller, state: () => state };
}

describe("a command accepted while a reply streams", () => {
  it("settles its ledger row as accepted-and-waiting, not done", async () => {
    const runCommand = vi.fn<RunCommand>(() => Promise.resolve({ type: "done" as const }));
    const { controller, state } = harness(runCommand, true);

    await controller.runCommand("/goal-resume", "goal-panel");

    const row = state().commandLedger[state().commandLedger.length - 1];
    expect(row?.source).toBe("goal-panel");
    expect(row?.state).toBe("ok");
    expect(row?.resultText).toBe("accepted — waits for the running reply to finish");
  });

  it("keeps the plain done for a command that finished without a stream", async () => {
    const runCommand = vi.fn<RunCommand>(() => Promise.resolve({ type: "done" as const }));
    const { controller, state } = harness(runCommand, false);

    await controller.runCommand("/goal-resume", "goal-panel");

    const row = state().commandLedger[state().commandLedger.length - 1];
    expect(row?.state).toBe("ok");
    expect(row?.resultText).toBeUndefined();
  });
});
