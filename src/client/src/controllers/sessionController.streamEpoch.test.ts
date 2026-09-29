import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, EmitSocket, emptyPage, oldSession, runPendingAnimationFrames, sessionLookupId, status, workspace, type AppState } from "./sessionController.testSupport";

describe("the stream watermark carries its epoch", () => {
  it("cites the snapshot's epoch with its seq when a refresh asks the daemon for the frames it missed", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const cited: { sinceSeq: number; epoch: string | undefined }[] = [];
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      streamSnapshot: () => Promise.resolve({ seq: 5, epoch: "daemon-a.1", partial: null }),
      streamSync: (_session, sinceSeq, _machineId, epoch) => {
        cited.push({ sinceSeq, epoch });
        return Promise.resolve({ kind: "replay", sinceSeq, frames: [] });
      },
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new EmitSocket() });

    await controller.selectSession(oldSession, { updateUrl: false });
    await controller.refreshSelectedSession();

    expect(cited).toEqual([{ sinceSeq: 5, epoch: "daemon-a.1" }]);
  });
});

describe("status facts in stream order", () => {
  it("does not let a status frame that lands late overwrite a status read computed after it", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: false, streamPosition: { seq: 12, epoch: "daemon-a.1" } }),
      streamSnapshot: () => Promise.resolve({ seq: 10, epoch: "daemon-a.1", partial: null }),
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket });

    await controller.selectSession(oldSession, { updateUrl: false });
    socket.emit({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true }, seq: 11, epoch: "daemon-a.1" });
    runPendingAnimationFrames();

    expect(state.status?.isStreaming).toBe(false);
  });
});
