import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import type { ExtensionDialogCloseResponse, ExtensionDialogKind, PendingExtensionDialog } from "../api";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, EmitSocket, emptyPage, FakeSocket, oldSession, replacementSession, status, workspace, type AppState, type SessionStatus } from "./sessionController.testSupport";

function dialog(dialogId: string, kind: ExtensionDialogKind = "confirm"): PendingExtensionDialog {
  return {
    dialogId,
    kind,
    title: `Dialog ${dialogId}`,
    ...(kind === "confirm" ? { message: "Are you sure?" } : {}),
    ...(kind === "select" ? { options: ["Postgres", "SQLite"] } : {}),
    ...(kind === "input" ? { placeholder: "type here" } : {}),
    askedAt: "2026-07-20T00:00:00.000Z",
    runScoped: true,
  };
}

function statusWithDialogs(sessionId: string, pendingDialogs: PendingExtensionDialog[]): SessionStatus {
  return { ...status(sessionId), pendingDialogs };
}

function closeResponse(sessionStatus: SessionStatus, dialogId = "dialog-1"): ExtensionDialogCloseResponse {
  return {
    result: "closed",
    outcome: {
      dialogId,
      reason: "answered",
      answer: true,
      askedAt: "2026-07-20T00:00:00.000Z",
      closedAt: "2026-07-20T00:01:00.000Z",
    },
    sessionStatus,
  };
}

function selectedState(patch: Partial<AppState> = {}): AppState {
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
  let state = selectedState({ selectedSession: undefined, ...patch });
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

describe("SessionController prompt.accepted delivery transition", () => {
  /**
   * D7: the daemon's acceptance frame moves the optimistic bubble from
   * sending to queued-server — the proof that the handoff happened, delivered
   * as a sequenced frame the gap replay can recover.
   */
  it("flips a sending bubble to queued-server on prompt.accepted", async () => {
    const harness = await liveSession();
    const line = { role: "user" as const, parts: [{ type: "text" as const, text: "hello" }], meta: { delivery: { clientMessageId: "cmid-9", state: "sending" as const } } };
    harness.state().messages = [line];

    harness.socket.emit({ type: "prompt.accepted", clientMessageId: "cmid-9" });

    const delivery = harness.state().messages[0]?.meta?.delivery;
    expect(delivery?.state).toBe("queued");
  });

  it("leaves other chats' bubbles alone", async () => {
    const harness = await liveSession();
    const line = { role: "user" as const, parts: [{ type: "text" as const, text: "hello" }], meta: { delivery: { clientMessageId: "cmid-other", state: "sending" as const } } };
    harness.state().messages = [line];

    harness.socket.emit({ type: "prompt.accepted", clientMessageId: "cmid-9" });

    expect(harness.state().messages[0]?.meta?.delivery?.state).toBe("sending");
  });
});

describe("SessionController extension dialog state", () => {
  it("rehydrates open dialogs from the daemon-owned status on selection", async () => {
    const pending = [dialog("dialog-1"), dialog("dialog-2", "select")];

    const harness = await liveSession({}, statusWithDialogs(oldSession.id, pending));

    expect(harness.state().pendingDialogs).toEqual(pending);
    expect(harness.state().closedDialogs).toEqual([]);
  });

  it("repairs a lost dialog close from the authoritative status instead of keeping the stale card", async () => {
    // The daemon opened A (revision 1), closed it (revision 2, lost in transit),
    // then opened B (revision 3). Applying frames blind keeps the stale A card
    // beside B until an unrelated refetch - the owner's stuck-card report. The
    // revision gate must detect the skipped 2 and resync once.
    const repaired = { ...status(oldSession.id), pendingDialogs: [dialog("dialog-b")], pendingDialogsRevision: 3 };
    const statusReads = deferred<SessionStatus>();
    let statusCalls = 0;
    const api: typeof defaultApi = {
      ...selectableApi(status(oldSession.id)),
      status: () => {
        statusCalls += 1;
        // The first read is the selection's own join and must settle, or the
        // selection await never returns; the repair reads it gates are the ones
        // this test controls.
        if (statusCalls === 1) return Promise.resolve(status(oldSession.id));
        return statusReads.promise;
      },
    };
    const socket = new EmitSocket();
    let state = selectedState({ selectedSession: undefined });
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );
    await controller.selectSession(oldSession, { updateUrl: false });

    socket.emit({ type: "dialog.opened", dialog: dialog("dialog-a"), revision: 1 });
    socket.emit({ type: "dialog.opened", dialog: dialog("dialog-b"), revision: 3 });

    // Repair is deferred on purpose, so that a second gap seen in the same turn
    // joins the read the first one started instead of adding another. Let the
    // deferred chain run - scheduling, the resync callback, and the refresh it
    // starts - before counting.
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    // Call 1 was the selection's own join; exactly one repair read covers both
    // the skipped revision and any further gap while it runs.
    expect(statusCalls).toBe(2);
    statusReads.resolve(repaired);
    await statusReads.promise;
    // The repair reads messages, status and the stream snapshot together; the
    // status promise settling is not the read finishing.
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(state.pendingDialogs.map((pending) => pending.dialogId)).toEqual(["dialog-b"]);
  });

  it("opens and closes cards from live dialog events without superseding other dialogs", async () => {
    const harness = await liveSession();

    harness.socket.emit({ type: "dialog.opened", dialog: dialog("dialog-1") });
    harness.socket.emit({ type: "dialog.opened", dialog: dialog("dialog-2", "input") });
    expect(harness.state().pendingDialogs.map((pending) => pending.dialogId)).toEqual(["dialog-1", "dialog-2"]);

    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer: true });
    expect(harness.state().pendingDialogs.map((pending) => pending.dialogId)).toEqual(["dialog-2"]);
  });

  it("retracts a closed dialog from the session's status record, not just the card", async () => {
    // The card on screen is one reader of a dialog's state; the status map is
    // what the rows, the switcher and a reselection read. Clearing only the
    // card let the closed dialog ride the map back on the next selection -
    // the answered question stood open again.
    const harness = await liveSession({}, statusWithDialogs(oldSession.id, [dialog("dialog-1"), dialog("dialog-2")]));
    expect(harness.state().sessionStatuses[oldSession.id]?.pendingDialogs).toHaveLength(2);

    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer: true });

    expect(harness.state().sessionStatuses[oldSession.id]?.pendingDialogs?.map((pending) => pending.dialogId)).toEqual(["dialog-2"]);
  });

  it("writes the close's fresh status to the map even when the selection moved while it ran", async () => {
    // Answering a dialog is a statement about the session it was asked in,
    // not about wherever the user has navigated to meanwhile. Skipping the
    // whole status application let the answered dialog stay open on that
    // session's row and on the next selection.
    const gate = deferred<ExtensionDialogCloseResponse>();
    const freshStatus = status(oldSession.id);
    let state = selectedState({ status: statusWithDialogs(oldSession.id, [dialog("dialog-1")]), pendingDialogs: [dialog("dialog-1")] });
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(session.id === oldSession.id ? statusWithDialogs(oldSession.id, [dialog("dialog-1")]) : status(session.id)),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
      answerDialog: () => gate.promise,
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new EmitSocket() },
    );

    const closing = controller.answerDialog("dialog-1", true);
    await controller.selectSession(replacementSession, { updateUrl: false });
    gate.resolve(closeResponse(freshStatus));
    await closing;

    expect(state.sessionStatuses[oldSession.id]).toEqual(freshStatus);
    // The card on screen belongs to the session the user moved to; the moved
    // selection is exactly what must not be rewritten.
    expect(state.pendingDialogs).toEqual([]);
    expect(state.status?.sessionId).toBe(replacementSession.id);
  });

  it("lets an answered dialog leave instead of parking a row nobody can remove", async () => {
    const harness = await liveSession();

    harness.socket.emit({ type: "dialog.opened", dialog: dialog("dialog-1", "select") });
    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer: "SQLite" });

    // Outcome cards render after the transcript, so nothing ever pushes them
    // off screen: an answered dialog that stayed would sit above the composer
    // for the rest of the session. Its record is the drawer notification.
    expect(harness.state().closedDialogs).toEqual([]);
    expect(harness.state().pendingDialogs).toEqual([]);
    // Suppression cannot depend on the card: a status snapshot built before the
    // close must not re-open a question that was answered.
    expect(harness.state().dismissedDialogIds).toEqual(["dialog-1"]);
  });

  it("records a close without an answer for cancel-like reasons", async () => {
    const harness = await liveSession();

    harness.socket.emit({ type: "dialog.opened", dialog: dialog("dialog-1") });
    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "aborted" });

    expect(harness.state().closedDialogs).toEqual([{ dialog: dialog("dialog-1"), reason: "aborted" }]);
  });

  it("ignores a close for a dialog that is not on screen", async () => {
    const harness = await liveSession();

    harness.socket.emit({ type: "dialog.opened", dialog: dialog("dialog-2") });
    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "cancelled" });

    expect(harness.state().pendingDialogs.map((pending) => pending.dialogId)).toEqual(["dialog-2"]);
    expect(harness.state().closedDialogs).toEqual([]);
  });

  it("does not duplicate a card when the open frame is already reflected", async () => {
    const harness = await liveSession({}, statusWithDialogs(oldSession.id, [dialog("dialog-1")]));

    harness.socket.emit({ type: "dialog.opened", dialog: dialog("dialog-1") });

    expect(harness.state().pendingDialogs).toHaveLength(1);
  });

  it("applies a status that no longer carries a dialog as the authoritative close", async () => {
    const harness = await liveSession({}, statusWithDialogs(oldSession.id, [dialog("dialog-1")]));
    expect(harness.state().pendingDialogs).toHaveLength(1);

    harness.controller.applySessionStatus(status(oldSession.id));

    expect(harness.state().pendingDialogs).toEqual([]);
  });

  it("does not adopt another session's open dialogs", async () => {
    const harness = await liveSession();

    harness.controller.applySessionStatus(statusWithDialogs("other-session", [dialog("dialog-1")]));

    expect(harness.state().pendingDialogs).toEqual([]);
  });

  it("clears open and closed dialogs when the session is deselected", async () => {
    const harness = await liveSession({}, statusWithDialogs(oldSession.id, [dialog("dialog-1"), dialog("dialog-2")]));
    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "cancelled" });
    expect(harness.state().closedDialogs).toHaveLength(1);

    harness.controller.deselectSession({ updateUrl: false });

    expect(harness.state().pendingDialogs).toEqual([]);
    expect(harness.state().closedDialogs).toEqual([]);
  });

  it("drops a closed dialog's outcome card when it is dismissed", async () => {
    const harness = await liveSession({}, statusWithDialogs(oldSession.id, [dialog("dialog-1")]));
    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "timeout" });
    expect(harness.state().closedDialogs).toHaveLength(1);

    harness.controller.dismissClosedDialog("dialog-1");

    expect(harness.state().closedDialogs).toEqual([]);
  });

  it("keeps a dismissed card gone when a status snapshot from before the close arrives after it", async () => {
    const staleStatus = statusWithDialogs(oldSession.id, [dialog("dialog-1")]);
    const harness = await liveSession({}, staleStatus);
    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer: true });
    harness.controller.dismissClosedDialog("dialog-1");

    // The daemon built this snapshot before the close, so it still lists the
    // dialog as open; it is unordered against the socket frame that closed it.
    harness.controller.applySessionStatus(staleStatus);

    expect(harness.state().pendingDialogs).toEqual([]);
    expect(harness.state().closedDialogs).toEqual([]);
  });

  it("costs the reader only one tap when a stale status and its close both follow the dismissal", async () => {
    const staleStatus = statusWithDialogs(oldSession.id, [dialog("dialog-1")]);
    const harness = await liveSession({}, staleStatus);
    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer: true });
    harness.controller.dismissClosedDialog("dialog-1");

    harness.controller.applySessionStatus(staleStatus);
    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer: true });

    expect(harness.state().closedDialogs).toEqual([]);
  });

  it("still shows a card when an extension opens the same dialog id again after a dismissal", async () => {
    const harness = await liveSession();
    harness.socket.emit({ type: "dialog.opened", dialog: dialog("dialog-1") });
    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer: true });
    harness.controller.dismissClosedDialog("dialog-1");

    // A live open is news the projection cannot be stale about, so the reader's
    // earlier dismissal must not suppress a genuinely new ask.
    harness.socket.emit({ type: "dialog.opened", dialog: dialog("dialog-1") });

    expect(harness.state().pendingDialogs.map((pending) => pending.dialogId)).toEqual(["dialog-1"]);
  });

  it("keeps a genuinely re-opened dialog when the next status frame carries it", async () => {
    const harness = await liveSession();
    harness.socket.emit({ type: "dialog.opened", dialog: dialog("dialog-1") });
    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer: true });
    harness.controller.dismissClosedDialog("dialog-1");
    harness.socket.emit({ type: "dialog.opened", dialog: dialog("dialog-1") });
    expect(harness.state().pendingDialogs.map((pending) => pending.dialogId)).toEqual(["dialog-1"]);

    // The daemon is really asking again, so its next projection - stale or
    // fresh - agrees with the card on screen. Forgetting the dismissal is what
    // keeps the live open from being wiped by the very next status frame.
    harness.controller.applySessionStatus(statusWithDialogs(oldSession.id, [dialog("dialog-1")]));

    expect(harness.state().pendingDialogs.map((pending) => pending.dialogId)).toEqual(["dialog-1"]);
    expect(harness.state().dismissedDialogIds).toEqual([]);
  });

  it("forgets dismissals when the session is deselected so a later session starts clean", async () => {
    const harness = await liveSession({}, statusWithDialogs(oldSession.id, [dialog("dialog-1")]));
    harness.socket.emit({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer: true });
    harness.controller.dismissClosedDialog("dialog-1");
    expect(harness.state().dismissedDialogIds).toEqual(["dialog-1"]);

    harness.controller.deselectSession({ updateUrl: false });

    expect(harness.state().dismissedDialogIds).toEqual([]);
  });
});

describe("SessionController extension dialog answers", () => {
  it("answers a dialog, suppresses it, and applies the returned status", async () => {
    const answerCalls: { dialogId: string; value: unknown; machineId: string }[] = [];
    const closedStatus = status(oldSession.id);
    let state = selectedState({ status: statusWithDialogs(oldSession.id, [dialog("dialog-1")]), pendingDialogs: [dialog("dialog-1")] });
    const api: typeof defaultApi = {
      ...defaultApi,
      answerDialog: (_session, dialogId, value, machineId) => {
        answerCalls.push({ dialogId, value, machineId: machineId ?? "local" });
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

    await controller.answerDialog("dialog-1", true);

    expect(answerCalls).toEqual([{ dialogId: "dialog-1", value: true, machineId: "local" }]);
    expect(state.closedDialogs).toEqual([]);
    expect(state.dismissedDialogIds).toEqual(["dialog-1"]);
    expect(state.pendingDialogs).toEqual([]);
    expect(state.status).toEqual(closedStatus);
  });

  it("cancels a dialog through its own route", async () => {
    const cancelCalls: string[] = [];
    let state = selectedState({ pendingDialogs: [dialog("dialog-1")] });
    const api: typeof defaultApi = {
      ...defaultApi,
      cancelDialog: (_session, dialogId) => {
        cancelCalls.push(dialogId);
        return Promise.resolve({
          result: "closed" as const,
          outcome: { dialogId, reason: "cancelled" as const, askedAt: "2026-07-20T00:00:00.000Z", closedAt: "2026-07-20T00:01:00.000Z" },
          sessionStatus: status(oldSession.id),
        });
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.cancelDialog("dialog-1");

    expect(cancelCalls).toEqual(["dialog-1"]);
    expect(state.closedDialogs).toEqual([{ dialog: dialog("dialog-1"), reason: "cancelled" }]);
    expect(state.pendingDialogs).toEqual([]);
  });

  it("trusts the status of a stale close without an error or an outcome card", async () => {
    let state = selectedState({ pendingDialogs: [dialog("dialog-1")] });
    const api: typeof defaultApi = {
      ...defaultApi,
      answerDialog: () => Promise.resolve({ result: "stale", sessionStatus: statusWithDialogs(oldSession.id, [dialog("dialog-2")]) }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.answerDialog("dialog-1", true);

    expect(state.error).toBe("");
    expect(state.closedDialogs).toEqual([]);
    expect(state.pendingDialogs.map((pending) => pending.dialogId)).toEqual(["dialog-2"]);
  });

  it("keeps the dialog open and reports the failure when the answer request fails", async () => {
    let state = selectedState({ pendingDialogs: [dialog("dialog-1")] });
    const api: typeof defaultApi = { ...defaultApi, answerDialog: () => Promise.reject(new Error("answer failed")) };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.answerDialog("dialog-1", true);

    expect(state.error).toBe("answer failed");
    expect(state.pendingDialogs.map((pending) => pending.dialogId)).toEqual(["dialog-1"]);
    expect(state.closedDialogs).toEqual([]);
  });

  it("does not answer for an archived session", async () => {
    const archived = { ...oldSession, archived: true as const };
    let state = selectedState({ selectedSession: archived, sessions: [archived] });
    let answered = false;
    const api: typeof defaultApi = {
      ...defaultApi,
      answerDialog: () => {
        answered = true;
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

    await controller.answerDialog("dialog-1", true);

    expect(answered).toBe(false);
  });
});
