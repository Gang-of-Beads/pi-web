import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, status, workspace, type AppState } from "./sessionController.testSupport";
import { NetworkSendError, SendScopeChangedError } from "../pendingOutbox";
import { HttpError } from "../api/http";

/**
 * A send that fails leaves the message in exactly one place the user can act
 * on. It used to leave it in two: the optimistic bubble stayed in the
 * transcript reading "Not sent" while the same text was handed back to the
 * composer, and the outbox - the one mechanism that retries by itself - was
 * never reached, because the connectivity failure was reported rather than
 * thrown.
 */
function controllerWith(api: typeof defaultApi): { controller: SessionController; read: () => AppState } {  let state: AppState = {
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
  it("keeps the bubble marked not sent on a dropped connection, and says which id the outbox owns", async () => {
    const api: typeof defaultApi = { ...defaultApi, prompt: () => Promise.reject(new TypeError("Failed to fetch")) };
    const { controller, read } = controllerWith(api);

    let error: unknown;
    try {
      await controller.send("typed while offline");
      throw new Error("expected a connectivity failure");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NetworkSendError);
    if (!(error instanceof NetworkSendError)) throw new Error("expected a NetworkSendError");
    expect(typeof error.clientMessageId).toBe("string");
    expect(error.cause).toBeInstanceOf(TypeError);

    // The bubble stays where the user put it and says the link dropped before
    // an answer - not "Not sent", which would claim the daemon never got it.
    // The outbox owns the same identity, so a retry cannot make a second copy.
    const [bubble] = read().messages.filter((line) => line.role === "user");
    expect(bubble?.meta?.delivery?.state).toBe("unverifiable");
    expect(read().error).toMatch(/Failed to fetch/u);
  });

  it("revives the same bubble on an outbox retry and advances it once the server takes the message", async () => {
    const api: typeof defaultApi = { ...defaultApi, prompt: () => Promise.reject(new TypeError("Failed to fetch")) };
    const { controller, read } = controllerWith(api);

    let error: unknown;
    try { await controller.send("typed while offline"); } catch (caught) { error = caught; }
    const failedBubble = read().messages.find((line) => line.role === "user");
    const failedId = failedBubble?.meta?.delivery?.clientMessageId;
    expect(failedId).toBeDefined();

    const replayApi: typeof defaultApi = { ...defaultApi, prompt: () => Promise.resolve({ accepted: true }) };
    const replay = controllerWith(replayApi);
    // A live reloaded page starts from bubble-less server state; a bubble that
    // only this browser ever saw is rebuilt from the outbox entry, carrying
    // the id the failed attempt minted.
    const replayId = error instanceof NetworkSendError ? error.clientMessageId : undefined;
    if (replayId === undefined) throw new Error("the network error must carry the correlation id");
    replay.read().messages.push({ role: "user", parts: [{ type: "text", text: "typed while offline" }], meta: { delivery: { clientMessageId: replayId, state: "failed" } } });

    await expect(replay.controller.send("typed while offline", undefined, undefined, "inline", { clientMessageId: replayId })).resolves.toBe(true);

    const [bubble] = replay.read().messages.filter((line) => line.role === "user");
    expect(bubble?.meta?.delivery?.state).toBe("received");
  });

  it("withdraws the bubble on non-network failures, leaving the composer to restore the text", async () => {
    const api: typeof defaultApi = { ...defaultApi, prompt: () => Promise.reject(new Error("400 Bad Request")) };
    const { controller, read } = controllerWith(api);

    await expect(controller.send("rejected but not dropped")).resolves.toBe(false);

    // The composer restores this one, so the transcript must not also hold it.
    expect(read().messages.filter((line) => line.role === "user")).toHaveLength(0);
    expect(read().error).toMatch(/400 Bad Request/u);
  });

  it("calls a send the browser says never left Not sent, and a gateway's answer while offline still unverifiable", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    try {
      const offline = controllerWith({ ...defaultApi, prompt: () => Promise.reject(new TypeError("Failed to fetch")) });
      await expect(offline.controller.send("typed on a train")).rejects.toBeInstanceOf(NetworkSendError);
      const answered = controllerWith({ ...defaultApi, prompt: () => Promise.reject(new HttpError("Remote machine timeout", 504, "prod")) });
      await expect(answered.controller.send("maybe running already")).rejects.toBeInstanceOf(NetworkSendError);

      const delivery = (read: () => AppState) => read().messages.find((line) => line.role === "user")?.meta?.delivery;
      expect({ offline: delivery(offline.read), answered: delivery(answered.read)?.state })
        .toMatchObject({ offline: { state: "failed", cause: "not-sent" }, answered: "unverifiable" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the row unverifiable on a gateway's 5xx, which names no verdict", async () => {
    const api: typeof defaultApi = { ...defaultApi, prompt: () => Promise.reject(new HttpError("Remote machine timeout", 504, "prod")) };
    const { controller, read } = controllerWith(api);

    await expect(controller.send("maybe running already")).rejects.toBeInstanceOf(NetworkSendError);

    const [bubble] = read().messages.filter((line) => line.role === "user");
    expect(bubble?.meta?.delivery?.state).toBe("unverifiable");
  });

  it("keeps a row the acceptance frame proved, and reports the send accepted, when a refusal arrives after it", async () => {
    let markQueued = (): void => undefined;
    const api: typeof defaultApi = {
      ...defaultApi,
      prompt: () => {
        markQueued();
        return Promise.reject(new Error("400 Bad Request"));
      },
    };
    const { controller, read } = controllerWith(api);
    markQueued = () => {
      const bubble = read().messages.find((line) => line.role === "user");
      if (bubble?.meta?.delivery !== undefined) bubble.meta.delivery = { ...bubble.meta.delivery, state: "queued" };
    };

    await expect(controller.send("the daemon already owns this")).resolves.toBe(true);

    expect(read().messages.filter((line) => line.role === "user").map((line) => line.meta?.delivery?.state)).toEqual(["queued"]);
  });

  it("refuses a send written for another session, before any row or request", async () => {
    const posted: string[] = [];
    const api: typeof defaultApi = { ...defaultApi, prompt: (_session, text) => { posted.push(text); return Promise.resolve({ accepted: true }); } };
    const { controller, read } = controllerWith(api);

    await expect(controller.send("meant for another session", undefined, undefined, "inline", { clientMessageId: "cm-elsewhere", scope: { machineId: "local", sessionId: "another-session" } }))
      .rejects.toBeInstanceOf(SendScopeChangedError);
    await expect(controller.send("meant for this one", undefined, undefined, "inline", { clientMessageId: "cm-here", scope: { machineId: "local", sessionId: oldSession.id } }))
      .resolves.toBe(true);

    expect({ posted, rows: read().messages.filter((line) => line.role === "user").length }).toEqual({ posted: ["meant for this one"], rows: 1 });
  });

  it("keeps the optimistic bubble when the send succeeds", async () => {
    const api: typeof defaultApi = { ...defaultApi, prompt: () => Promise.resolve({ accepted: true }) };
    const { controller, read } = controllerWith(api);

    await expect(controller.send("this one goes out")).resolves.toBe(true);

    expect(read().messages.filter((line) => line.role === "user")).toHaveLength(1);
  });
});
