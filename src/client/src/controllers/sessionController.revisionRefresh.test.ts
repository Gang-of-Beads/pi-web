import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, emptyPage, FakeSocket, oldSession, sessionLookupId, status, workspace, type AppState } from "./sessionController.testSupport";
import type { SessionInfo } from "../../../shared/apiTypes";

function listedSession(id: string): SessionInfo {
  return { ...oldSession, id, path: `/tmp/${id}.jsonl`, modified: "2026-06-25T00:00:00.000Z" };
}

function controllerHarness(api: Partial<typeof defaultApi>, initialState: Partial<AppState>) {
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, ...initialState };
  const controller = new SessionController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    () => undefined,
    undefined,
    { api: { ...defaultApi, ...api }, socket: new FakeSocket() },
  );
  return { controller, stateRef: () => state };
}

describe("SessionController background refresh revision", () => {
  it("skips state churn when the daemon verdict says the listing is unchanged", async () => {
    const listed = listedSession("session-1");
    let revisionCalls = 0;
    const onState: AppState[] = [];
    const { controller, stateRef } = controllerHarness({
      sessionsIfChanged: () => {
        revisionCalls += 1;
        return Promise.resolve(revisionCalls === 1
          ? { revision: "rev-a", sessions: [listed] }
          : { revision: "rev-a", unchanged: true });
      },
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    }, {});
    void onState;

    await controller.refreshCurrentWorkspaceSessions();
    const rowsAfterFirstLoad = stateRef().sessions;
    const selectedAfterFirstLoad = stateRef().selectedSession;
    expect(rowsAfterFirstLoad.map((session) => session.id)).toEqual([listed.id]);

    await controller.refreshCurrentWorkspaceSessions();
    expect(revisionCalls).toBe(2);
    expect(stateRef().sessions).toBe(rowsAfterFirstLoad);
    expect(stateRef().selectedSession).toBe(selectedAfterFirstLoad);
    expect(stateRef().sessionsLoad).toBe("loaded");
  });

  it("applies a changed listing and stores the fresh revision for the next echo", async () => {
    const first = listedSession("session-1");
    const second = listedSession("session-2");
    const revisions = ["rev-a", "rev-b"];
    let revisionCalls = 0;
    const { controller, stateRef } = controllerHarness({
      sessionsIfChanged: () => {
        const call = revisionCalls;
        revisionCalls += 1;
        return Promise.resolve({ revision: revisions[call] ?? "rev-x", sessions: call === 0 ? [first] : [first, second] });
      },
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    }, {});

    await controller.refreshCurrentWorkspaceSessions();
    expect(stateRef().sessions.map((session) => session.id)).toEqual([first.id]);

    await controller.refreshCurrentWorkspaceSessions();
    expect(stateRef().sessions.map((session) => session.id)).toEqual([first.id, second.id]);
    expect(stateRef().sessionsLoad).toBe("loaded");
  });

  it("keeps rows and the failure notice when unchanged arrives after a failed refresh", async () => {
    const listed = listedSession("session-1");
    let failNext = false;
    const { controller, stateRef } = controllerHarness({
      sessionsIfChanged: () => {
        if (failNext) return Promise.reject(new Error("network dropped"));
        return Promise.resolve({ revision: "rev-a", sessions: [listed] });
      },
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    }, {});

    await controller.refreshCurrentWorkspaceSessions();
    expect(stateRef().sessions).toEqual([listed]);

    failNext = true;
    await controller.refreshCurrentWorkspaceSessions();
    expect(stateRef().error).toContain("network dropped");
    expect(stateRef().sessions).toEqual([listed]);

    failNext = false;
    await controller.refreshCurrentWorkspaceSessions();
    expect(stateRef().sessions).toEqual([listed]);
    expect(stateRef().sessionsLoad).toBe("loaded");
  });
});
