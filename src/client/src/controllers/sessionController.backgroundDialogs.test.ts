import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import type { PendingExtensionDialog } from "../api";
import { SessionController } from "./sessionController";
import { defaultApi, EmitSocket, emptyPage, oldSession, status, workspace, type AppState, type SessionStatus } from "./sessionController.testSupport";

/**
 * Extensions that re-ask on a timer (an update notice, for one) open a dialog
 * the user is free to ignore. Recording every ignored cycle as an outcome card
 * fills the transcript with notices about notices, which on a phone is the
 * whole screen.
 */
describe("SessionController background dialog outcomes", () => {
  it("keeps no card when a background prompt times out unanswered", async () => {
    const harness = await liveSession();
    harness.socket.emit({ type: "dialog.opened", dialog: dialog({ runScoped: false }) });

    harness.socket.emit({ type: "dialog.closed", dialogId: "dlg-1", reason: "timeout" });

    expect(harness.state().closedDialogs).toEqual([]);
    // It must still leave the open list, or the card would linger as "open".
    expect(harness.state().pendingDialogs).toEqual([]);
  });

  it("records a background prompt the user dismissed", async () => {
    const harness = await liveSession();
    harness.socket.emit({ type: "dialog.opened", dialog: dialog({ runScoped: false }) });

    harness.socket.emit({ type: "dialog.closed", dialogId: "dlg-1", reason: "cancelled" });

    // Dismissing is a deliberate action, not an absence of one, so it is kept
    // even though the prompt was ambient.
    expect(harness.state().closedDialogs).toHaveLength(1);
    expect(harness.state().closedDialogs[0]).toMatchObject({ reason: "cancelled" });
  });

  it("records the decision when a background prompt is answered", async () => {
    const harness = await liveSession();
    harness.socket.emit({ type: "dialog.opened", dialog: dialog({ runScoped: false }) });

    harness.socket.emit({ type: "dialog.closed", dialogId: "dlg-1", reason: "answered", answer: "Skip" });

    // A choice the user made is worth keeping, even for a background prompt.
    expect(harness.state().closedDialogs).toHaveLength(1);
    expect(harness.state().closedDialogs[0]).toMatchObject({ reason: "answered", answer: "Skip" });
  });

  it("still records an aborted run-scoped dialog", async () => {
    const harness = await liveSession();
    harness.socket.emit({ type: "dialog.opened", dialog: dialog({ runScoped: true }) });

    harness.socket.emit({ type: "dialog.closed", dialogId: "dlg-1", reason: "aborted" });

    // This one belongs to work the user started, so its interruption is part
    // of the story rather than noise.
    expect(harness.state().closedDialogs).toHaveLength(1);
    expect(harness.state().closedDialogs[0]).toMatchObject({ reason: "aborted" });
  });

  it("still records a timed-out run-scoped dialog", async () => {
    const harness = await liveSession();
    harness.socket.emit({ type: "dialog.opened", dialog: dialog({ runScoped: true }) });

    harness.socket.emit({ type: "dialog.closed", dialogId: "dlg-1", reason: "timeout" });

    expect(harness.state().closedDialogs).toHaveLength(1);
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
