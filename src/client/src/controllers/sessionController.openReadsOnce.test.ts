import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import type { PendingExtensionDialog } from "../api";
import { SessionController } from "./sessionController";
import { HttpError } from "../api/http";
import { defaultApi, deferred, EmitSocket, emptyPage, oldSession, runPendingAnimationFrames, status, workspace, type AppState, type SessionStatus } from "./sessionController.testSupport";

/**
 * A cold open reads the session once (live-surfaces, P3 slice c).
 *
 * Measured on 8505: a cold open of a session whose extension raises a startup dialog read the
 * status 5 times and the stream 5 times. The selection's status read opens the runtime and takes
 * seconds; the dialog the runtime raises reaches the socket before that read answers, the dialog
 * scope is not fresh yet, and it resynced, twice, through the refresh's trailing request.
 */

const startupDialog: PendingExtensionDialog = { dialogId: "startup-1", kind: "select", title: "Pick one", options: ["A", "B"], askedAt: "2026-10-01T00:00:00.000Z", runScoped: false };

function openingSession(laterReads: (call: number) => Promise<SessionStatus> = () => Promise.resolve(withDialog(13))) {
  const statusRead = deferred<SessionStatus>();
  const counts = { status: 0, sync: 0, tail: 0, messages: 0 };
  const opening = { tailStream: { seq: 48, partial: null, epoch: "e1" }, tailFails: false };
  const api: typeof defaultApi = {
    ...defaultApi,
    messages: () => { counts.messages += 1; return Promise.resolve(emptyPage); },
    streamSnapshot: () => Promise.resolve({ seq: 48, partial: null, epoch: "e1" }),
    streamSync: (_session, sinceSeq) => { counts.sync += 1; return Promise.resolve({ kind: "replay", sinceSeq, frames: [] }); },
    transcriptTail: () => { counts.tail += 1; return opening.tailFails ? Promise.reject(new HttpError("Internal error", 500, "local")) : Promise.resolve({ kind: "answered", value: { page: emptyPage, stream: opening.tailStream } }); },
    status: () => { counts.status += 1; return counts.status === 1 ? statusRead.promise : laterReads(counts.status); },
    thinkingLevels: () => Promise.resolve({ levels: [] }),
  };
  const socket = new EmitSocket();
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
  const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket });
  return Object.assign(opening, { controller, socket, statusRead, counts, state: () => state });
}

function withDialog(revision: number): SessionStatus {
  return { ...status(oldSession.id), pendingDialogs: [startupDialog], pendingDialogsRevision: revision, daemonInstanceId: "d1", streamPosition: { seq: 50, epoch: "e1" } };
}

const turn = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe("a cold open reads the session once (P3 slice c)", () => {
  it("lets the status read on its way answer for a dialog the opening runtime raised, instead of reading again", async () => {
    const opening = openingSession();
    const selecting = opening.controller.selectSession(oldSession, { updateUrl: false });
    await turn();

    opening.socket.emit({ type: "dialog.opened", dialog: startupDialog, revision: 13, daemonInstanceId: "d1", seq: 49, epoch: "e1" });
    opening.socket.emit({ type: "status.update", status: withDialog(13), seq: 50, epoch: "e1" });
    await turn();
    opening.statusRead.resolve(withDialog(13));
    await selecting;
    for (let index = 0; index < 10; index += 1) await turn();

    expect({ counts: opening.counts, dialogs: opening.state().pendingDialogs.map((dialog) => dialog.dialogId) }).toEqual({ counts: { status: 1, sync: 0, tail: 1, messages: 0 }, dialogs: ["startup-1"] });
  });

  it("applies a dialog the read on its way was computed before, in order after that read, with no read again", async () => {
    const opening = openingSession();
    const selecting = opening.controller.selectSession(oldSession, { updateUrl: false });
    await turn();

    opening.socket.emit({ type: "dialog.opened", dialog: startupDialog, revision: 13, daemonInstanceId: "d1", seq: 49, epoch: "e1" });
    await turn();
    opening.statusRead.resolve({ ...status(oldSession.id), pendingDialogs: [], pendingDialogsRevision: 12, daemonInstanceId: "d1", streamPosition: { seq: 48, epoch: "e1" } });
    await selecting;
    for (let index = 0; index < 10; index += 1) await turn();

    expect({ statusReads: opening.counts.status, dialogs: opening.state().pendingDialogs.map((dialog) => dialog.dialogId) }).toEqual({ statusReads: 1, dialogs: ["startup-1"] });
  });

  it("applies a dialog the transcript snapshot already counts when the status read was computed before it", async () => {
    const opening = openingSession();
    opening.tailStream = { seq: 50, partial: null, epoch: "e1" };
    const selecting = opening.controller.selectSession(oldSession, { updateUrl: false });
    await turn();

    opening.socket.emit({ type: "dialog.opened", dialog: startupDialog, revision: 13, daemonInstanceId: "d1", seq: 49, epoch: "e1" });
    opening.statusRead.resolve({ ...status(oldSession.id), pendingDialogs: [], pendingDialogsRevision: 12, daemonInstanceId: "d1", streamPosition: { seq: 48, epoch: "e1" } });
    await selecting;
    for (let index = 0; index < 10; index += 1) await turn();

    expect({ statusReads: opening.counts.status, dialogs: opening.state().pendingDialogs.map((dialog) => dialog.dialogId) }).toEqual({ statusReads: 1, dialogs: ["startup-1"] });
  });

  it("applies the next dialog of a session it read as fresh, with no read at all", async () => {
    const opening = openingSession();
    const selecting = opening.controller.selectSession(oldSession, { updateUrl: false });
    await turn();
    opening.socket.emit({ type: "dialog.opened", dialog: startupDialog, revision: 13, daemonInstanceId: "d1", seq: 49, epoch: "e1" });
    opening.socket.emit({ type: "status.update", status: withDialog(13), seq: 50, epoch: "e1" });
    opening.statusRead.resolve(withDialog(13));
    await selecting;
    for (let index = 0; index < 10; index += 1) await turn();
    const before = { ...opening.counts };

    const second: PendingExtensionDialog = { ...startupDialog, dialogId: "startup-2" };
    opening.socket.emit({ type: "dialog.opened", dialog: second, revision: 14, daemonInstanceId: "d1", seq: 51, epoch: "e1" });
    for (let index = 0; index < 10; index += 1) await turn();

    expect({ reads: opening.counts.status - before.status, syncs: opening.counts.sync - before.sync, dialogs: opening.state().pendingDialogs.map((dialog) => dialog.dialogId) }).toEqual({ reads: 0, syncs: 0, dialogs: ["startup-1", "startup-2"] });
  });

  it("reads again when the status read on its way fails while a dialog waited for it", async () => {
    const opening = openingSession();
    const selecting = opening.controller.selectSession(oldSession, { updateUrl: false });
    await turn();

    opening.socket.emit({ type: "dialog.opened", dialog: startupDialog, revision: 13, daemonInstanceId: "d1", seq: 49, epoch: "e1" });
    await turn();
    opening.statusRead.reject(new Error("link dropped"));
    await selecting;
    for (let index = 0; index < 10; index += 1) await turn();

    expect({ statusReads: opening.counts.status, dialogs: opening.state().pendingDialogs.map((dialog) => dialog.dialogId) }).toEqual({ statusReads: 2, dialogs: ["startup-1"] });
  });

  it("still shows the dialogs the status read carries when the transcript read fails, and applies the next dialog with no read", async () => {
    const opening = openingSession();
    opening.tailFails = true;
    const selecting = opening.controller.selectSession(oldSession, { updateUrl: false });
    await turn();
    opening.statusRead.resolve(withDialog(13));
    await selecting;
    for (let index = 0; index < 10; index += 1) await turn();
    const afterOpen = { statusReads: opening.counts.status, failed: opening.state().transcriptFailed, dialogs: opening.state().pendingDialogs.map((dialog) => dialog.dialogId) };

    opening.socket.emit({ type: "dialog.opened", dialog: { ...startupDialog, dialogId: "startup-2" }, revision: 14, daemonInstanceId: "d1", seq: 51, epoch: "e1" });
    for (let index = 0; index < 10; index += 1) await turn();

    expect({ afterOpen, laterReads: opening.counts.status - afterOpen.statusReads, dialogs: opening.state().pendingDialogs.map((dialog) => dialog.dialogId) }).toEqual({
      afterOpen: { statusReads: 1, failed: "Internal error", dialogs: ["startup-1"] },
      laterReads: 0,
      dialogs: ["startup-1", "startup-2"],
    });
  });

  it("asks again for a dialog that comes after the status read lost the race to a newer status frame that said nothing about dialogs", async () => {
    const opening = openingSession();
    const selecting = opening.controller.selectSession(oldSession, { updateUrl: false });
    await turn();
    opening.controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), streamPosition: { seq: 52, epoch: "e1" } } });
    runPendingAnimationFrames();
    opening.statusRead.resolve({ ...withDialog(12), streamPosition: { seq: 48, epoch: "e1" } });
    await selecting;
    for (let index = 0; index < 10; index += 1) await turn();
    const afterOpen = opening.counts.status;

    opening.socket.emit({ type: "dialog.opened", dialog: startupDialog, revision: 13, daemonInstanceId: "d1", seq: 53, epoch: "e1" });
    for (let index = 0; index < 10; index += 1) await turn();

    expect({ afterOpen, laterReads: opening.counts.status - afterOpen }).toEqual({ afterOpen: 1, laterReads: 1 });
  });
});
