import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, EmitSocket, emptyPage, oldSession, sessionLookupId, status, workspace, type AppState } from "./sessionController.testSupport";

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
