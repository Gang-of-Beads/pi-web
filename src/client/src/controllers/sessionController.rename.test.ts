import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { sessionLabel } from "../sessionLabels";
import { sessionMatchesSearch } from "../sessionSearch";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, type AppState } from "./sessionController.testSupport";

/**
 * Renaming goes through the daemon's existing `/name` command so persistence
 * and the `session.name` broadcast keep a single owner.
 */
describe("SessionController.renameSession", () => {
  it("runs /name and shows the alias immediately", async () => {
    const runCommand = vi.fn(async () => ({ type: "done" as const, message: "Session named: Mobile UX" }));
    const { controller, state } = harness(runCommand);

    await controller.renameSession(oldSession, "Mobile UX");

    expect(runCommand).toHaveBeenCalledWith({ id: oldSession.id, cwd: oldSession.cwd }, "/name Mobile UX", "local");
    expect(state().sessions[0]?.name).toBe("Mobile UX");
  });

  it("trims the alias so leading whitespace never reaches the command", async () => {
    const runCommand = vi.fn(async () => ({ type: "done" as const, message: "ok" }));
    const { controller, state } = harness(runCommand);

    await controller.renameSession(oldSession, "   Padded   ");

    expect(runCommand).toHaveBeenCalledWith(expect.anything(), "/name Padded", "local");
    expect(state().sessions[0]?.name).toBe("Padded");
  });

  it("ignores a blank alias instead of clearing the name", async () => {
    const runCommand = vi.fn(async () => ({ type: "done" as const, message: "ok" }));
    const { controller } = harness(runCommand);

    await controller.renameSession({ ...oldSession, name: "Keep me" }, "   ");

    expect(runCommand).not.toHaveBeenCalled();
  });

  it("rolls back to the previous name when the command fails", async () => {
    const runCommand = vi.fn(async () => { throw new Error("daemon down"); });
    const named = { ...oldSession, name: "Original" };
    const { controller, state } = harness(runCommand, named);

    await controller.renameSession(named, "Attempted");

    // A failed rename must not leave the list asserting a name the daemon
    // never accepted.
    expect(state().sessions[0]?.name).toBe("Original");
    expect(state().error).toContain("daemon down");
  });

  it("makes the alias the display label and a search hit", () => {
    const renamed = { ...oldSession, name: "Mobile UX sweep", firstMessage: "hello there" };

    expect(sessionLabel(renamed)).toBe("Mobile UX sweep");
    expect(sessionMatchesSearch(renamed, "mobile ux")).toBe(true);
    // The generated first message stays searchable alongside the alias.
    expect(sessionMatchesSearch(renamed, "hello")).toBe(true);
  });
});

function harness(runCommand: ReturnType<typeof vi.fn>, session = oldSession) {
  let state: AppState = { ...initialAppState(), selectedSession: session, sessions: [session] };
  const controller = new SessionController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    () => undefined,
    undefined,
    { socket: new FakeSocket(), api: { ...defaultApi, runCommand } },
  );
  return { controller, state: () => state };
}
