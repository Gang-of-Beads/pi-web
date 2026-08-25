import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, status, workspace, type AppState } from "./sessionController.testSupport";

/**
 * A send that fails leaves the message in exactly one place the user can act
 * on. It used to leave it in two: the optimistic bubble stayed in the
 * transcript reading "Not sent" while the same text was handed back to the
 * composer, and the outbox - the one mechanism that retries by itself - was
 * never reached, because the connectivity failure was reported rather than
 * thrown.
 */
function controllerWith(api: typeof defaultApi): { controller: SessionController; read: () => AppState } {
  let state: AppState = {
    ...initialAppState(),
    selectedWorkspace: workspace,
    selectedSession: oldSession,
    sessions: [oldSession],
    status: status(oldSession.id),
    sessionStatuses: { [oldSession.id]: status(oldSession.id) },
  };
  const controller = new SessionController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    () => undefined,
    undefined,
    { api, socket: new FakeSocket() },
  );
  return { controller, read: () => state };
}

describe("SessionController send failure", () => {
  it("rethrows a dropped connection so the outbox can retry it, and withdraws the bubble", async () => {
    const api: typeof defaultApi = { ...defaultApi, prompt: () => Promise.reject(new TypeError("Failed to fetch")) };
    const { controller, read } = controllerWith(api);

    await expect(controller.send("typed while offline")).rejects.toThrow(/Failed to fetch/u);

    // Nothing is left claiming the message was not sent: the outbox owns it
    // now and will send it when the network returns, and a stale bubble would
    // then sit above the real one contradicting it.
    expect(read().messages.filter((line) => line.role === "user")).toHaveLength(0);
    expect(read().error).toMatch(/Failed to fetch/u);
  });

  it("reports other failures without keeping a second copy in the transcript", async () => {
    const api: typeof defaultApi = { ...defaultApi, prompt: () => Promise.reject(new Error("400 Bad Request")) };
    const { controller, read } = controllerWith(api);

    await expect(controller.send("rejected but not dropped")).resolves.toBe(false);

    // The composer restores this one, so the transcript must not also hold it.
    expect(read().messages.filter((line) => line.role === "user")).toHaveLength(0);
    expect(read().error).toMatch(/400 Bad Request/u);
  });

  it("keeps the optimistic bubble when the send succeeds", async () => {
    const api: typeof defaultApi = { ...defaultApi, prompt: () => Promise.resolve({ accepted: true }) };
    const { controller, read } = controllerWith(api);

    await expect(controller.send("this one goes out")).resolves.toBe(true);

    expect(read().messages.filter((line) => line.role === "user")).toHaveLength(1);
  });
});
