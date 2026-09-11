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

  it("loads the live tail when asked, replacing the trimmed window and clearing the parked count", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    let tailCalls = 0;
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: (_session, query) => {
        const before = query?.before;
        if (before === undefined) {
          tailCalls += 1;
          return Promise.resolve(tailCalls === 1 ? page(400, 100) : page(450, 50));
        }
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

    await controller.loadNewerMessages();

    expect(state.messagePageStart).toBe(450);
    expect(state.messagePageEnd).toBe(500);
    expect(state.messages.length).toBe(50);
    expect(state.newerPendingCount).toBe(0);
    expect(state.isLoadingEarlierMessages).toBe(false);
  });
});

describe("SessionController delta replay refresh", () => {
  function deltaHarness(sync: { kind: string; frames?: string[]; sinceSeq?: number }) {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    let messagesCalls = 0;
    const syncCalls: number[] = [];
    const socket = new EmitSocket();
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => {
        messagesCalls += 1;
        return Promise.resolve({ messages: rawRows(400, 100), start: 400, total: 500 });
      },
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      streamSnapshot: () => Promise.resolve({ seq: 501, partial: null }),
      streamSync: (_session, sinceSeq) => {
        syncCalls.push(sinceSeq);
        if (sync.kind === "replay" && sync.frames !== undefined) return Promise.resolve({ kind: "replay", sinceSeq: sync.sinceSeq ?? 501, frames: sync.frames });
        if (sync.kind === "snapshot") return Promise.resolve({ kind: "snapshot", seq: 501, partial: null });
        return Promise.resolve({ kind: "resync", sinceSeq: sync.sinceSeq ?? 501 });
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );
    return { controller, messagesCalls: () => messagesCalls, syncCalls: () => syncCalls, stateRef: () => state };
  }

  it("replays frames after the persisted watermark instead of re-fetching the page", async () => {
    const frames = [
      JSON.stringify({ type: "assistant.delta", text: "since watermark", seq: 502 }),
    ];
    const harness = deltaHarness({ kind: "replay", sinceSeq: 501, frames });
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    expect(harness.messagesCalls()).toBe(1);
    expect(harness.stateRef().messagePageEnd).toBe(500);

    await harness.controller.refreshSelectedSession();

    expect(harness.syncCalls()).toEqual([501]);
    expect(harness.messagesCalls()).toBe(1);
    const joined = harness.stateRef().messages.map((line) => line.parts.map((part) => ("text" in part ? part.text : ""))).flat().join(" ");
    expect(joined).toContain("since watermark");
  });

  it("falls back to the full fetch when the watermark is older than the ring", async () => {
    const harness = deltaHarness({ kind: "resync", sinceSeq: 501 });
    await harness.controller.selectSession(oldSession, { updateUrl: false });
    expect(harness.messagesCalls()).toBe(1);

    await harness.controller.refreshSelectedSession();

    expect(harness.syncCalls()).toEqual([501]);
    expect(harness.messagesCalls()).toBe(2);
    expect(harness.stateRef().messagePageEnd).toBe(500);
  });
});
