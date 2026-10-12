import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import type { PendingExtensionDialog } from "../api";
import { SessionController } from "./sessionController";
import { defaultApi, EmitSocket, emptyPage, oldSession, status, workspace, type AppState, type SessionStatus } from "./sessionController.testSupport";

/**
 * A closed dialog leaves no card (state-diagram D2, owner 2026-10-12); it still
 * leaves the open list and is remembered as settled.
 */
describe("SessionController background dialog outcomes", () => {
  it("keeps no card when a background prompt times out unanswered", async () => {
    const harness = await liveSession();
    harness.socket.emit({ type: "dialog.opened", dialog: dialog({ runScoped: false }) });

    harness.socket.emit({ type: "dialog.closed", dialogId: "dlg-1", reason: "timeout" });

    // It must still leave the open list, or the card would linger as "open".
    expect(harness.state().pendingDialogs).toEqual([]);
  });

  it("suppresses a background prompt once it is answered, without parking a card", async () => {
    const harness = await liveSession();
    harness.socket.emit({ type: "dialog.opened", dialog: dialog({ runScoped: false }) });

    harness.socket.emit({ type: "dialog.closed", dialogId: "dlg-1", reason: "answered", answer: "Skip" });

    expect(harness.state().settledDialogIds).toEqual(["dlg-1"]);
  });

});

interface LiveHarness {
  socket: EmitSocket;
  state: () => AppState;
}

async function liveSession(): Promise<LiveHarness> {
  const socket = new EmitSocket();
  let state: AppState = {
    ...initialAppState(),
    selectedWorkspace: workspace,
    sessions: [oldSession],
    selectedSession: undefined,
  };
  const controller = new SessionController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    () => undefined,
    undefined,
    { api: selectableApi(status(oldSession.id)), socket },
  );
  await controller.selectSession(oldSession, { updateUrl: false });
  return { socket, state: () => state };
}

function selectableApi(sessionStatus: SessionStatus) {
  return {
    ...defaultApi,
    messages: () => Promise.resolve(emptyPage),
    status: () => Promise.resolve(sessionStatus),
    streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
    thinkingLevels: () => Promise.resolve({ levels: [], current: "medium" as const }),
  };
}

function dialog(overrides: Partial<PendingExtensionDialog>): PendingExtensionDialog {
  return {
    dialogId: "dlg-1",
    kind: "select",
    title: "Update 0.84.1 → 0.84.2",
    options: ["Update now", "Skip", "Ignore 0.84.2"],
    askedAt: "2026-08-15T19:02:52.504Z",
    runScoped: true,
    ...overrides,
  };
}
