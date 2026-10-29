import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, EmitSocket, emptyPage, FakeSocket, oldSession, sessionLookupId, status, workspace, type AppState } from "./sessionController.testSupport";
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

function rawRows(start: number, count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({ role: "user", content: `m${String(start + index)}` }));
}

describe("SessionController trimmed-tail behavior", () => {
  function page(start: number, count: number, total = 500) {
    return { messages: rawRows(start, count), start, total };
  }

  function spanHarness() {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const olderCalls: number[] = [];
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: (_session, query) => {
        const before = query?.before;
        if (before === undefined) return Promise.resolve(page(400, 100));
        olderCalls.push(before);
        return Promise.resolve(page(before - 100, 100));
      },
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      streamSnapshot: () => Promise.resolve({ seq: 501, partial: null }),
      streamSync: () => Promise.resolve({ kind: "resync", sinceSeq: 501 }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );
    return { controller, olderCalls, stateRef: () => state };
  }

  it("walks history until the span caps, leaving the tail trimmed and honest", async () => {
    const { controller, olderCalls, stateRef } = spanHarness();
    await controller.selectSession(oldSession, { updateUrl: false });
    expect(stateRef().messagePageEnd).toBe(500);
    for (let index = 0; index < 4; index += 1) await controller.loadEarlierMessages();
    expect(olderCalls).toEqual([400, 300, 200, 100]);
    const walked = stateRef();
    expect(walked.messagePageStart).toBe(0);
    expect(walked.messagePageEnd).toBe(400);
    expect(walked.messagePageTotal).toBe(500);
    expect(walked.messages.length).toBe(400);
  });

  it("parks transcript events on the newer chip while the tail is trimmed", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: (_session, query) => {
        const before = query?.before;
        if (before === undefined) return Promise.resolve(page(400, 100));
        return Promise.resolve(page(before - 100, 100));
      },
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      streamSnapshot: () => Promise.resolve({ seq: 501, partial: null }),
      streamSync: () => Promise.resolve({ kind: "resync", sinceSeq: 501 }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );
    await controller.selectSession(oldSession, { updateUrl: false });
    for (let index = 0; index < 4; index += 1) await controller.loadEarlierMessages();
    expect(state.messagePageEnd).toBe(400);
    expect(state.messagePageTotal).toBe(500);

    const rowsBefore = state.messages.length;
    socket.emit({ type: "message.append", message: { role: "assistant", content: "live one" }, seq: 502 });
    socket.emit({ type: "assistant.delta", text: "live two", seq: 503 });
    controller.flushPendingUpdates();

    expect(state.newerPendingCount).toBe(2);
    expect(state.messages.length).toBe(rowsBefore);
  });

  it("streams live events straight onto the transcript while the span reaches the bottom", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(page(400, 100)),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      streamSnapshot: () => Promise.resolve({ seq: 501, partial: null }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );
    await controller.selectSession(oldSession, { updateUrl: false });
    expect(state.messagePageEnd).toBe(500);

    const rowsBefore = state.messages.length;
    socket.emit({ type: "assistant.delta", text: "live", seq: 502 });
    controller.flushPendingUpdates();

    expect(state.newerPendingCount).toBe(0);
    expect(state.messages.length).toBeGreaterThan(rowsBefore);
  });

  function newerHarness(total: number) {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    const asked: (number | undefined)[] = [];
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: (_session, query) => {
        asked.push(query?.before);
        const upto = query?.before ?? total;
        return Promise.resolve(page(upto - 100, 100, total));
      },
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      streamSnapshot: () => Promise.resolve({ seq: 501, partial: null }),
      streamSync: () => Promise.resolve({ kind: "resync", sinceSeq: 501 }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );
    return { controller, stateRef: () => state, asked, socket };
  }

  it("reads the page after the window when the reader scrolls forward, never replacing it with the live tail", async () => {
    const { controller, stateRef, asked } = newerHarness(900);
    await controller.selectSession(oldSession, { updateUrl: false });
    for (let index = 0; index < 5; index += 1) await controller.loadEarlierMessages();
    const state = stateRef();
    expect(state.messagePageStart).toBe(300);
    expect(state.messagePageEnd).toBe(700);
    expect(state.messagePageTotal).toBe(900);

    asked.length = 0;
    await controller.loadNewerMessages();

    expect(asked).toEqual([800]);
    const after = stateRef();
    expect(after.messagePageStart).toBe(400);
    expect(after.messagePageEnd).toBe(800);
    expect(after.messagePageTotal).toBe(900);
    expect(after.newerPendingCount).toBe(0);
    expect(after.pageReadEnd).toBeUndefined();
  });

  it("replaces the window with the live tail only when the reader asks for the newest", async () => {
    const { controller, stateRef, asked, socket } = newerHarness(900);
    await controller.selectSession(oldSession, { updateUrl: false });
    for (let index = 0; index < 5; index += 1) await controller.loadEarlierMessages();
    socket.emit({ type: "assistant.delta", text: "live", seq: 502 });
    controller.flushPendingUpdates();
    expect(stateRef().newerPendingCount).toBe(1);

    asked.length = 0;
    await controller.jumpToNewestMessages();

    expect(asked).toEqual([undefined]);
    const after = stateRef();
    expect(after.messagePageStart).toBe(800);
    expect(after.messagePageEnd).toBe(900);
    expect(after.messages.length).toBe(100);
    expect(after.newerPendingCount).toBe(0);
    expect(after.pageReadEnd).toBeUndefined();
  });
});


describe("SessionController refresh under a reader in history", () => {
  function page(start: number, count: number, total: number) {
    return { messages: rawRows(start, count), start, total };
  }

  function harness() {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const daemon = { total: 1000 };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: (_session, query) => {
        const before = query?.before;
        if (before === undefined) return Promise.resolve(page(daemon.total - 100, 100, daemon.total));
        return Promise.resolve(page(before - 100, 100, daemon.total));
      },
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      streamSnapshot: () => Promise.resolve({ seq: 501, partial: null }),
      streamSync: () => Promise.resolve({ kind: "resync", sinceSeq: 501 }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );
    return { controller, daemon, stateRef: () => state };
  }

  it("keeps a reader parked in history where they are when a resync lands", async () => {
    const { controller, daemon, stateRef } = harness();
    await controller.selectSession(oldSession, { updateUrl: false });
    expect(stateRef().messagePageEnd).toBe(1000);
    for (let index = 0; index < 4; index += 1) await controller.loadEarlierMessages();
    const parked = stateRef();
    expect(parked.messagePageStart).toBe(500);
    expect(parked.messagePageEnd).toBe(900);
    expect(parked.messages.length).toBe(400);

    daemon.total = 1100;
    await controller.refreshSelectedSession();

    const after = stateRef();
    expect(after.messagePageStart).toBe(500);
    expect(after.messagePageEnd).toBe(900);
    expect(after.messages.length).toBe(400);
    expect(after.messagePageTotal).toBe(1100);
    expect(after.newerPendingCount).toBe(0);
    expect(after.pageReadEnd).toBeUndefined();
  });

  it("still takes the newest page for a reader at the tail", async () => {
    const { controller, daemon, stateRef } = harness();
    await controller.selectSession(oldSession, { updateUrl: false });

    daemon.total = 1100;
    await controller.refreshSelectedSession();

    expect(stateRef().messagePageStart).toBe(900);
    expect(stateRef().messagePageEnd).toBe(1100);
    expect(stateRef().messagePageTotal).toBe(1100);
    expect(stateRef().messages.length).toBe(200);
  });
});
