import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, status, type AppState } from "./sessionController.testSupport";

/**
 * A command that answers with a select dialog has not finished: the dialog is
 * the daemon asking. Its row stays live until the answer settles the command
 * or the reader closes the dialog unanswered, so a bubble never freezes at
 * Running and never claims Read for a question nobody answered.
 */
function harness(runCommand: typeof defaultApi.runCommand, respondToCommand: typeof defaultApi.respondToCommand) {
  let state: AppState = { ...initialAppState(), status: status(oldSession.id), selectedSession: oldSession, sessions: [oldSession] };
  const controller = new SessionController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    () => undefined,
    undefined,
    { socket: new FakeSocket(), api: { ...defaultApi, runCommand, respondToCommand } },
  );
  return { controller, state: () => state };
}

const select = { type: "select" as const, requestId: "r1", title: "Pick a model", options: [{ value: "a", label: "A" }] };

describe("a command that opens a dialog", () => {
  it("stays live while the dialog is open and reads Read once the answer settles it", async () => {
    const runCommand = vi.fn(() => Promise.resolve(select));
    const respondToCommand = vi.fn(() => Promise.resolve({ type: "done" as const, message: "Model set to A" }));
    const { controller, state } = harness(runCommand, respondToCommand);

    await controller.runCommand("/model");
    expect(state().commandDialog).toEqual(select);
    expect(state().commandLedger.at(-1)).toMatchObject({ text: "/model", state: "pending" });

    await controller.respondToCommand("r1", "a");

    expect(state().commandDialog).toBeUndefined();
    expect(state().commandLedger.at(-1)).toMatchObject({ state: "ok", resultText: "Model set to A" });
  });

  it("reads Not sent when the reader closes the dialog without answering", async () => {
    const runCommand = vi.fn(() => Promise.resolve(select));
    const { controller, state } = harness(runCommand, defaultApi.respondToCommand);

    await controller.runCommand("/model");
    controller.cancelCommand();

    expect(state().commandLedger.at(-1)).toMatchObject({ state: "failed", resultText: "Cancelled without an answer." });
  });
});
