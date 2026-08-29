import { beforeEach, describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { loadAskDraft, saveAskDraft } from "../askDrafts";
import type { AskUserCloseResponse, AskUserQuestion, PendingAskUser } from "../api";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, EmitSocket, emptyPage, FakeSocket, MemoryStorage, oldSession, replacementSession, sessionKey, status, workspace, type AppState, type SessionStatus } from "./sessionController.testSupport";

const databaseQuestion: AskUserQuestion = { id: "q1", question: "Which database?", options: [{ value: "pg", label: "Postgres" }] };
const extrasQuestion: AskUserQuestion = { id: "q2", question: "Which extras?", options: [{ value: "metrics", label: "Metrics" }], multiple: true };

function ask(askId: string): PendingAskUser {
  return { askId, askedAt: "2026-07-20T00:00:00.000Z", questions: [databaseQuestion, extrasQuestion] };
}

function statusWithAsk(sessionId: string, pendingAsk: PendingAskUser): SessionStatus {
  return { ...status(sessionId), pendingAsk };
}

function closeResponse(sessionStatus: SessionStatus, askId = "ask-1"): AskUserCloseResponse {
  return {
    result: "closed",
    outcome: {
      askId,
      reason: "submitted",
      askedAt: "2026-07-20T00:00:00.000Z",
      closedAt: "2026-07-20T00:01:00.000Z",
      questions: [
        { question: databaseQuestion, answered: true, values: ["pg"] },
        { question: extrasQuestion, answered: false, values: [] },
      ],
      answeredCount: 1,
      unansweredIds: ["q2"],
      summary: "Answered 1 of 2; unanswered: q2",
    },
    sessionStatus,
  };
}

function selectedSessionState(patch: Partial<AppState> = {}): AppState {
  return {
    ...initialAppState(),
    selectedWorkspace: workspace,
    selectedSession: oldSession,
    sessions: [oldSession],
    ...patch,
  };
}

function selectableApi(sessionStatus: SessionStatus): typeof defaultApi {
  return {
    ...defaultApi,
    messages: () => Promise.resolve(emptyPage),
    status: () => Promise.resolve(sessionStatus),
    streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
    thinkingLevels: () => Promise.resolve({ levels: [] }),
  };
}

interface LiveHarness {
  controller: SessionController;
  socket: EmitSocket;
  state: () => AppState;
}

async function liveSession(patch: Partial<AppState> = {}, sessionStatus = status(oldSession.id)): Promise<LiveHarness> {
  const socket = new EmitSocket();
  let state = selectedSessionState({ selectedSession: undefined, ...patch });
  const controller = new SessionController(
    () => state,
    (statePatch) => { state = { ...state, ...statePatch }; },
    () => undefined,
    undefined,
    { api: selectableApi(sessionStatus), socket },
  );
  await controller.selectSession(oldSession, { updateUrl: false });
  return { controller, socket, state: () => state };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

describe("SessionController open ask state", () => {
  it("rehydrates the open ask from the daemon-owned status on selection", async () => {
    const pending = ask("ask-1");

    const harness = await liveSession({}, statusWithAsk(oldSession.id, pending));

    expect(harness.state().pendingAsk).toEqual(pending);
  });

  it("opens and closes the card from live ask events", async () => {
    const harness = await liveSession();

    harness.socket.emit({ type: "ask.opened", ask: ask("ask-1") });
    expect(harness.state().pendingAsk?.askId).toBe("ask-1");

    harness.socket.emit({ type: "ask.closed", askId: "ask-1", reason: "submitted" });
    expect(harness.state().pendingAsk).toBeUndefined();
  });

  it("retracts a closed ask from the session's status record, not just the card", async () => {
    // The card on screen is one reader of an ask's state; the status map is
    // what the rows, the switcher and a reselection read. Clearing only the
    // card let the answered question ride the map back on the next selection
    // and kept the amber "asking" marker on the row.
    const harness = await liveSession({}, statusWithAsk(oldSession.id, ask("ask-1")));
    expect(harness.state().sessionStatuses[oldSession.id]?.pendingAsk?.askId).toBe("ask-1");

    harness.socket.emit({ type: "ask.closed", askId: "ask-1", reason: "submitted" });

    expect(harness.state().sessionStatuses[oldSession.id]?.pendingAsk).toBeUndefined();
  });

  it("keeps the newer ask when the supersede close for the old one arrives after it", async () => {
    const harness = await liveSession();

    harness.socket.emit({ type: "ask.opened", ask: ask("ask-1") });
    harness.socket.emit({ type: "ask.opened", ask: ask("ask-2") });
    harness.socket.emit({ type: "ask.closed", askId: "ask-1", reason: "superseded" });

    expect(harness.state().pendingAsk?.askId).toBe("ask-2");
  });

  it("applies a status that no longer carries an ask as the authoritative close", async () => {
    const harness = await liveSession({}, statusWithAsk(oldSession.id, ask("ask-1")));
    expect(harness.state().pendingAsk?.askId).toBe("ask-1");

    harness.controller.applySessionStatus(status(oldSession.id));

    expect(harness.state().pendingAsk).toBeUndefined();
  });

  it("does not adopt another session's open ask", async () => {
    const harness = await liveSession();

    harness.controller.applySessionStatus(statusWithAsk("other-session", ask("ask-1")));

    expect(harness.state().pendingAsk).toBeUndefined();
  });

  it("clears the card when the session is deselected", async () => {
    const harness = await liveSession({}, statusWithAsk(oldSession.id, ask("ask-1")));
    expect(harness.state().pendingAsk?.askId).toBe("ask-1");

    harness.controller.deselectSession({ updateUrl: false });

    expect(harness.state().pendingAsk).toBeUndefined();
  });

  it("writes the close's fresh status to the map even when the selection moved while it ran", async () => {
    // Submitting an answer is a statement about the session it was asked in,
    // not about wherever the user has navigated to meanwhile. Skipping the
    // whole status application let the answered question stay open on that
    // session's row and on the next selection.
    const gate = deferred<AskUserCloseResponse>();
    const closedStatus = status(oldSession.id);
    let state = selectedSessionState({ status: statusWithAsk(oldSession.id, ask("ask-1")), pendingAsk: ask("ask-1") });
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(session.id === oldSession.id ? statusWithAsk(oldSession.id, ask("ask-1")) : status(session.id)),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
      submitAsk: () => gate.promise,
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new EmitSocket() },
    );

    const closing = controller.submitAsk("ask-1", { answers: [{ id: "q1", values: ["pg"] }] });
    await controller.selectSession(replacementSession, { updateUrl: false });
    gate.resolve(closeResponse(closedStatus));
    await closing;

    expect(state.sessionStatuses[oldSession.id]?.pendingAsk).toBeUndefined();
    expect(state.sessionStatuses[oldSession.id]).toEqual(closedStatus);
    // The card on screen belongs to the session the user moved to; the moved
    // selection is exactly what must not be rewritten.
    expect(state.pendingAsk).toBeUndefined();
    expect(state.status?.sessionId).toBe(replacementSession.id);
  });
});

describe("SessionController ask submission", () => {
  it("submits answers, clears the draft, and applies the returned status", async () => {
    const submitCalls: { askId: string; answers: unknown; machineId: string }[] = [];
    const closedStatus = status(oldSession.id);
    let state = selectedSessionState({ status: statusWithAsk(oldSession.id, ask("ask-1")), pendingAsk: ask("ask-1") });
    const api: typeof defaultApi = {
      ...defaultApi,
      submitAsk: (_session, askId, submission, machineId) => {
        submitCalls.push({ askId, answers: submission.answers, machineId: machineId ?? "local" });
        return Promise.resolve(closeResponse(closedStatus));
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );
    saveAskDraft(sessionKey(oldSession.id), "ask-1", { q1: { values: ["pg"] } });

    await controller.submitAsk("ask-1", { answers: [{ id: "q1", values: ["pg"] }] });

    expect(submitCalls).toEqual([{ askId: "ask-1", answers: [{ id: "q1", values: ["pg"] }], machineId: "local" }]);
    expect(loadAskDraft(sessionKey(oldSession.id), "ask-1")).toEqual({});
    expect(state.pendingAsk).toBeUndefined();
    expect(state.status).toEqual(closedStatus);
  });

  it("cancels an ask through its own route and clears the draft", async () => {
    const cancelCalls: string[] = [];
    let state = selectedSessionState({ pendingAsk: ask("ask-1") });
    const api: typeof defaultApi = {
      ...defaultApi,
      cancelAsk: (_session, askId) => {
        cancelCalls.push(askId);
        return Promise.resolve(closeResponse(status(oldSession.id)));
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );
    saveAskDraft(sessionKey(oldSession.id), "ask-1", { q1: { values: ["pg"] } });

    await controller.cancelAsk("ask-1");

    expect(cancelCalls).toEqual(["ask-1"]);
    expect(loadAskDraft(sessionKey(oldSession.id), "ask-1")).toEqual({});
    expect(state.pendingAsk).toBeUndefined();
  });

  it("trusts the status of a stale close and shows the superseding ask without an error", async () => {
    const supersedingAsk = ask("ask-2");
    let state = selectedSessionState({ pendingAsk: ask("ask-1") });
    const api: typeof defaultApi = {
      ...defaultApi,
      submitAsk: () => Promise.resolve({ result: "stale", sessionStatus: statusWithAsk(oldSession.id, supersedingAsk) }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.submitAsk("ask-1", { answers: [] });

    expect(state.error).toBe("");
    expect(state.pendingAsk).toEqual(supersedingAsk);
  });

  it("keeps the draft and reports the failure when the submit request fails", async () => {
    let state = selectedSessionState({ pendingAsk: ask("ask-1") });
    const api: typeof defaultApi = { ...defaultApi, submitAsk: () => Promise.reject(new Error("submit failed")) };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );
    saveAskDraft(sessionKey(oldSession.id), "ask-1", { q1: { values: ["pg"] } });

    await controller.submitAsk("ask-1", { answers: [{ id: "q1", values: ["pg"] }] });

    expect(state.error).toBe("submit failed");
    expect(loadAskDraft(sessionKey(oldSession.id), "ask-1")).toEqual({ q1: { values: ["pg"] } });
    expect(state.pendingAsk?.askId).toBe("ask-1");
  });

  it("does not submit for an archived session", async () => {
    const archived = { ...oldSession, archived: true as const };
    let state = selectedSessionState({ selectedSession: archived, sessions: [archived] });
    let submitted = false;
    const api: typeof defaultApi = {
      ...defaultApi,
      submitAsk: () => {
        submitted = true;
        return Promise.resolve(closeResponse(status(oldSession.id)));
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.submitAsk("ask-1", { answers: [] });

    expect(submitted).toBe(false);
  });
});
