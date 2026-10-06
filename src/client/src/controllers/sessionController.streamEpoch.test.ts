import { describe, expect, it } from "vitest";
import { HttpError } from "../api/http";
import { initialAppState } from "../appState";
import { sessionStatusLine } from "../sessionStatusLine";
import { SessionController } from "./sessionController";
import { defaultApi, EmitSocket, emptyPage, oldSession, runPendingAnimationFrames, sessionLookupId, status, workspace, type AppState } from "./sessionController.testSupport";

describe("the stream watermark carries its epoch", () => {
  it("cites the snapshot's epoch with its seq when a catch-up asks the daemon for the frames it missed", async () => {
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
    await controller.catchUp();

    expect(cited).toEqual([{ sinceSeq: 5, epoch: "daemon-a.1" }]);
  });
});

describe("the selected session's own status read", () => {
  it("says it failed, so the bar can offer Retry instead of waiting forever", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    let reads = 0;
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: () => { reads += 1; return reads === 1 ? Promise.reject(new Error("daemon unreachable")) : new Promise(() => undefined); },
      streamSnapshot: () => Promise.resolve({ seq: 1, epoch: "daemon-a.1", partial: null }),
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new EmitSocket() });

    void controller.selectSession(oldSession, { updateUrl: false });
    for (let index = 0; index < 6; index += 1) await Promise.resolve();

    expect({ status: state.status, failed: state.statusReadFailed }).toEqual({ status: undefined, failed: "daemon unreachable" });
  });

  it("says it failed when the refusal carries no text, as a 503 over HTTP/2 does", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    let reads = 0;
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: () => { reads += 1; return reads === 1 ? Promise.reject(new HttpError("", 503)) : new Promise(() => undefined); },
      streamSnapshot: () => Promise.resolve({ seq: 1, epoch: "daemon-a.1", partial: null }),
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new EmitSocket() });

    void controller.selectSession(oldSession, { updateUrl: false });
    for (let index = 0; index < 6; index += 1) await Promise.resolve();

    expect(sessionStatusLine({ hasStatus: state.status !== undefined, failure: state.statusReadFailed }).kind).toBe("unavailable");
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

  it("keeps the newer of two status frames that land before one render", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true, streamPosition: { seq: 9, epoch: "daemon-a.1" } }),
      streamSnapshot: () => Promise.resolve({ seq: 10, epoch: "daemon-a.1", partial: null }),
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket });

    await controller.selectSession(oldSession, { updateUrl: false });
    socket.emit({ type: "status.update", status: { ...status(oldSession.id), isStreaming: false }, seq: 11, epoch: "daemon-a.1" });
    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, streamPosition: { seq: 10, epoch: "daemon-a.1" } } });
    runPendingAnimationFrames();

    expect(state.status?.isStreaming).toBe(false);
  });

  it("orders the machine-wide copy of a status frame by the position of its session frame", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: false, streamPosition: { seq: 12, epoch: "daemon-a.1" } }),
      streamSnapshot: () => Promise.resolve({ seq: 10, epoch: "daemon-a.1", partial: null }),
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new EmitSocket() });

    await controller.selectSession(oldSession, { updateUrl: false });
    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, streamPosition: { seq: 11, epoch: "daemon-a.1" } } });
    runPendingAnimationFrames();
    const late = state.status?.isStreaming;
    controller.applyGlobalEvent({ type: "status.update", status: { ...status(oldSession.id), isStreaming: true, streamPosition: { seq: 13, epoch: "daemon-a.1" } } });
    runPendingAnimationFrames();

    expect({ late, newer: state.status?.isStreaming }).toEqual({ late: false, newer: true });
  });
});
