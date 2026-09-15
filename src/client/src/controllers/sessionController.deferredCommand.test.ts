import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, status, type AppState } from "./sessionController.testSupport";

type RunCommand = typeof defaultApi.runCommand;

/**
 * A goal command issued while a reply streams is forwarded as a prompt queued
 * behind it, and the daemon marks that result deferred. The
 * action-acknowledgment spec forbids dressing acceptance as completion, so
 * the ledger row must say it is waiting - by the daemon's word, not by
 * whichever session's streaming flag the browser holds - and must settle
 * once the runtime goes idle.
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
  it("settles its ledger row as accepted when the daemon says the command is deferred", async () => {
    const runCommand = vi.fn<RunCommand>(() => Promise.resolve({ type: "done" as const, deferred: true as const }));
    const { controller, state } = harness(runCommand, true);

    await controller.runCommand("/goal-resume", "goal-panel");

    const row = state().commandLedger[state().commandLedger.length - 1];
    expect(row?.source).toBe("goal-panel");
    expect(row?.state).toBe("accepted");
    expect(row?.resultText).toBe("Runs after the current reply finishes.");
  });

  it("keeps the daemon's own note when a deferred result carries one", async () => {
    const runCommand = vi.fn<RunCommand>(() => Promise.resolve({ type: "done" as const, deferred: true as const, message: "Session is busy - reload queued." }));
    const { controller, state } = harness(runCommand, true);

    await controller.runCommand("/reload");

    expect(state().commandLedger.at(-1)).toMatchObject({ state: "accepted", resultText: "Session is busy - reload queued." });
  });

  it("trusts the daemon, not the selected session's streaming flag, for a plain done", async () => {
    const runCommand = vi.fn<RunCommand>(() => Promise.resolve({ type: "done" as const }));
    const { controller, state } = harness(runCommand, true);

    await controller.runCommand("/goal-resume", "goal-panel");

    expect(state().commandLedger.at(-1)).toMatchObject({ state: "ok" });
  });

  it("settles every accepted row of the session once its runtime is idle", async () => {
    const runCommand = vi.fn<RunCommand>(() => Promise.resolve({ type: "done" as const, deferred: true as const }));
    const { controller, state } = harness(runCommand, true);
    await controller.runCommand("/goal-resume", "goal-panel");
    expect(state().commandLedger.at(-1)?.state).toBe("accepted");

    controller.applySessionStatus({ ...status(oldSession.id), isStreaming: false });

    expect(state().commandLedger.at(-1)?.state).toBe("ok");
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
