import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, EmitSocket, emptyPage, FakeSocket, oldSession, sessionLookupId, status, workspace, type AppState } from "./sessionController.testSupport";
import type { SessionInfo } from "../../../shared/apiTypes";
import { TRANSCRIPT_SPAN_CAP } from "../chatTranscriptStore";

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
  const cap = TRANSCRIPT_SPAN_CAP;
  const total = cap + 100;

  function page(start: number, count: number, value = total) {
    return { messages: rawRows(start, count), start, total: value };
  }

  function spanHarness() {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const olderCalls: number[] = [];
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: (_session, query) => {
        const before = query?.before;
        if (before === undefined) return Promise.resolve(page(cap, 100));
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
    expect(stateRef().messagePageEnd).toBe(total);
    for (let index = 0; index < 10; index += 1) await controller.loadEarlierMessages();
    expect(olderCalls).toEqual([cap, cap - 100, cap - 200, cap - 300, cap - 400, cap - 500, cap - 600, cap - 700, cap - 800, cap - 900]);
    const walked = stateRef();
    expect(walked.messagePageStart).toBe(0);
    expect(walked.messagePageEnd).toBe(cap);
    expect(walked.messagePageTotal).toBe(total);
    expect(walked.messages.length).toBe(cap);
  });

  it("parks transcript events on the newer chip while the tail is trimmed, counting the messages they commit", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    const daemon = { total };
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
    for (let index = 0; index < 10; index += 1) await controller.loadEarlierMessages();
    expect(state.messagePageEnd).toBe(cap);
    expect(state.messagePageTotal).toBe(total);

    const rowsBefore = state.messages.length;
    socket.emit({ type: "message.append", message: { role: "user", content: "live one" }, echo: true, seq: 502 });
    socket.emit({ type: "assistant.delta", text: "live two", seq: 503 });
    socket.emit({ type: "message.end", message: { role: "assistant", content: "live two" }, seq: 504 });
    controller.flushPendingUpdates();

    expect(state.newerPendingCount).toBe(1);
    expect(state.messages.length).toBe(rowsBefore);

    daemon.total = total + 1;
    await controller.loadNewerMessages();
    expect([state.messagePageStart, state.messagePageEnd, state.messagePageTotal, state.newerPendingCount]).toEqual([100, total, total + 1, 0]);

    daemon.total = total + 60;
    await controller.refreshSelectedSession();
    expect([state.messagePageStart, state.messagePageEnd, state.messagePageTotal, state.newerPendingCount]).toEqual([100, total, total + 60, 0]);

    daemon.total = total;
    await controller.loadNewerMessages();
    expect([state.messagePageStart, state.messagePageEnd, state.messagePageTotal]).toEqual([100, total, total]);

    await controller.loadEarlierMessages();
    daemon.total = total - 200;
    await controller.refreshSelectedSession();
    expect([state.messagePageStart, state.messagePageEnd, state.messagePageTotal]).toEqual([total - 300, total - 200, total - 200]);
  });

  it("streams live events straight onto the transcript while the span reaches the bottom", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(page(cap, 100)),
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
    expect(state.messagePageEnd).toBe(total);

    const rowsBefore = state.messages.length;
    socket.emit({ type: "assistant.delta", text: "live", seq: 502 });
    controller.flushPendingUpdates();

    expect(state.newerPendingCount).toBe(0);
    expect(state.messages.length).toBeGreaterThan(rowsBefore);
  });

  function newerHarness(value: number) {
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
        const upto = query?.before ?? value;
        const reply = page(upto - 100, 100, value);
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
    const wide = cap + 500;
    const { controller, stateRef, patch, asked, machines, holding, socket } = newerHarness(wide);
    await controller.selectSession(oldSession, { updateUrl: false });
    for (let index = 0; index < 10; index += 1) await controller.loadEarlierMessages();
    const state = stateRef();
    expect(state.messagePageStart).toBe(cap - 600);
    expect(state.messagePageEnd).toBe(cap + 400);
    expect(state.messagePageTotal).toBe(wide);

    asked.length = 0;
    machines.length = 0;
    holding.on = true;
    const movedRead = controller.loadNewerMessages();
    expect(asked).toEqual([wide]);
    patch({ messagePageEnd: cap + 300 });
    holding.replies.shift()?.();
    await vi.waitFor(() => { expect(asked).toEqual([wide, cap + 400]); });
    expect(machines).toEqual(["local", "local"]);
    patch({ messagePageEnd: cap + 200 });
    holding.replies.shift()?.();
    await movedRead;
    const dropped = stateRef();
    expect(asked).toEqual([wide, cap + 400]);
    expect(dropped.messages).toBe(state.messages);
    expect([dropped.messagePageStart, dropped.messagePageEnd, dropped.pageReadEnd]).toEqual([cap - 600, cap + 200, undefined]);

    patch({ messagePageEnd: cap + 400 });
    asked.length = 0;
    const switchedRead = controller.loadNewerMessages();
    patch({ selectedMachine: { id: "remote", name: "remote", kind: "remote", createdAt: "2026-07-27T10:00:00.000Z", updatedAt: "2026-07-27T10:00:00.000Z" } });
    holding.replies.shift()?.();
    await switchedRead;
    expect(asked).toEqual([wide]);
    expect(stateRef().messages).toBe(state.messages);
    expect(stateRef().pageReadEnd).toBeUndefined();
    holding.on = false;
    patch({ selectedMachine: undefined });

    asked.length = 0;
    await controller.loadNewerMessages();

    expect(asked).toEqual([wide]);
    const after = stateRef();
    expect(after.messagePageStart).toBe(cap - 500);
    expect(after.messagePageEnd).toBe(wide);
    expect(after.messagePageTotal).toBe(wide);
    expect(after.newerPendingCount).toBe(0);
    expect(after.pageReadEnd).toBeUndefined();

    await controller.loadEarlierMessages();
    expect([stateRef().messagePageStart, stateRef().messagePageEnd]).toEqual([cap - 600, cap + 400]);
    socket.emit({ type: "message.end", message: { role: "assistant", content: "live" }, seq: 502 });
    controller.flushPendingUpdates();
    expect(stateRef().newerPendingCount).toBe(1);

    asked.length = 0;
    await controller.jumpToNewestMessages();

    expect(asked).toEqual([undefined]);
    const jumped = stateRef();
    expect(jumped.messagePageStart).toBe(cap / 2);
    expect(jumped.messagePageEnd).toBe(wide);
    expect(jumped.messages.length).toBe(cap);
    expect(jumped.newerPendingCount).toBe(0);
    expect(jumped.pageReadEnd).toBeUndefined();

    for (let index = 0; index < 5; index += 1) await controller.loadEarlierMessages();
    const walkedBack = stateRef().messagePageEnd;
    expect(walkedBack).toBeLessThan(wide);
    await controller.selectSession(oldSession, { updateUrl: false });
    expect(stateRef().messagePageEnd).toBe(walkedBack);
    controller.deselectSession({ updateUrl: false });
    await controller.selectSession(oldSession, { updateUrl: false });
    expect(stateRef().messagePageEnd).toBe(wide);
  });
});
