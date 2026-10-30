import { describe, expect, it, vi } from "vitest";
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

  it("parks transcript events on the newer chip while the tail is trimmed, counting the messages they commit", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    const daemon = { total: 500 };
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
      { api, socket },
    );
    await controller.selectSession(oldSession, { updateUrl: false });
    for (let index = 0; index < 4; index += 1) await controller.loadEarlierMessages();
    expect(state.messagePageEnd).toBe(400);
    expect(state.messagePageTotal).toBe(500);

    const rowsBefore = state.messages.length;
    socket.emit({ type: "message.append", message: { role: "user", content: "live one" }, echo: true, seq: 502 });
    socket.emit({ type: "assistant.delta", text: "live two", seq: 503 });
    socket.emit({ type: "message.end", message: { role: "assistant", content: "live two" }, seq: 504 });
    controller.flushPendingUpdates();

    expect(state.newerPendingCount).toBe(1);
    expect(state.messages.length).toBe(rowsBefore);

    daemon.total = 501;
    await controller.loadNewerMessages();
    expect([state.messagePageStart, state.messagePageEnd, state.messagePageTotal, state.newerPendingCount]).toEqual([100, 500, 501, 0]);

    daemon.total = 560;
    await controller.refreshSelectedSession();
    expect([state.messagePageStart, state.messagePageEnd, state.messagePageTotal, state.newerPendingCount]).toEqual([100, 500, 560, 0]);

    daemon.total = 500;
    await controller.loadNewerMessages();
    expect([state.messagePageStart, state.messagePageEnd, state.messagePageTotal]).toEqual([100, 500, 500]);

    await controller.loadEarlierMessages();
    daemon.total = 300;
    await controller.refreshSelectedSession();
    expect([state.messagePageStart, state.messagePageEnd, state.messagePageTotal]).toEqual([200, 300, 300]);
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
    const machines: (string | undefined)[] = [];
    const holding: { on: boolean; replies: (() => void)[] } = { on: false, replies: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: (_session, query, machineId) => {
        asked.push(query?.before);
        machines.push(machineId);
        const upto = query?.before ?? total;
        const reply = page(upto - 100, 100, total);
        if (!holding.on) return Promise.resolve(reply);
        return new Promise((resolve) => { holding.replies.push(() => { resolve(reply); }); });
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
    const patch = (next: Partial<AppState>) => { state = { ...state, ...next }; };
    return { controller, stateRef: () => state, patch, asked, machines, holding, socket };
  }

  it("reads the page after the window when the reader scrolls forward, and replaces it with the live tail only when they jump", async () => {
    const { controller, stateRef, patch, asked, machines, holding, socket } = newerHarness(900);
    await controller.selectSession(oldSession, { updateUrl: false });
    for (let index = 0; index < 5; index += 1) await controller.loadEarlierMessages();
    const state = stateRef();
    expect(state.messagePageStart).toBe(300);
    expect(state.messagePageEnd).toBe(700);
    expect(state.messagePageTotal).toBe(900);

    asked.length = 0;
    machines.length = 0;
    holding.on = true;
    const movedRead = controller.loadNewerMessages();
    expect(asked).toEqual([800]);
    patch({ messagePageEnd: 600 });
    holding.replies.shift()?.();
    await vi.waitFor(() => { expect(asked).toEqual([800, 700]); });
    expect(machines).toEqual(["local", "local"]);
    patch({ messagePageEnd: 500 });
    holding.replies.shift()?.();
    await movedRead;
    const dropped = stateRef();
    expect(asked).toEqual([800, 700]);
    expect(dropped.messages).toBe(state.messages);
    expect([dropped.messagePageStart, dropped.messagePageEnd, dropped.pageReadEnd]).toEqual([300, 500, undefined]);

    patch({ messagePageEnd: 700 });
    asked.length = 0;
    const switchedRead = controller.loadNewerMessages();
    patch({ selectedMachine: { id: "remote", name: "remote", kind: "remote", createdAt: "2026-07-27T10:00:00.000Z", updatedAt: "2026-07-27T10:00:00.000Z" } });
    holding.replies.shift()?.();
    await switchedRead;
    expect(asked).toEqual([800]);
    expect(stateRef().messages).toBe(state.messages);
    expect(stateRef().pageReadEnd).toBeUndefined();
    holding.on = false;
    patch({ selectedMachine: undefined });

    asked.length = 0;
    await controller.loadNewerMessages();

    expect(asked).toEqual([800]);
    const after = stateRef();
    expect(after.messagePageStart).toBe(400);
    expect(after.messagePageEnd).toBe(800);
    expect(after.messagePageTotal).toBe(900);
    expect(after.newerPendingCount).toBe(0);
    expect(after.pageReadEnd).toBeUndefined();

    await controller.loadEarlierMessages();
    expect([stateRef().messagePageStart, stateRef().messagePageEnd]).toEqual([300, 700]);
    socket.emit({ type: "message.end", message: { role: "assistant", content: "live" }, seq: 502 });
    controller.flushPendingUpdates();
    expect(stateRef().newerPendingCount).toBe(1);

    asked.length = 0;
    await controller.jumpToNewestMessages();

    expect(asked).toEqual([undefined]);
    const jumped = stateRef();
    expect(jumped.messagePageStart).toBe(800);
    expect(jumped.messagePageEnd).toBe(900);
    expect(jumped.messages.length).toBe(100);
    expect(jumped.newerPendingCount).toBe(0);
    expect(jumped.pageReadEnd).toBeUndefined();

    for (let index = 0; index < 5; index += 1) await controller.loadEarlierMessages();
    const walkedBack = stateRef().messagePageEnd;
    expect(walkedBack).toBeLessThan(900);
    await controller.selectSession(oldSession, { updateUrl: false });
    expect(stateRef().messagePageEnd).toBe(walkedBack);
    controller.deselectSession({ updateUrl: false });
    await controller.selectSession(oldSession, { updateUrl: false });
    expect(stateRef().messagePageEnd).toBe(900);
  });
});
