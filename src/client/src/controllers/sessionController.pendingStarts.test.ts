import { describe, expect, it, vi } from "vitest";
import type { PiWebCapability } from "../../../shared/apiTypes";
import { HttpError } from "../api/http";
import { initialAppState } from "../appState";
import { isCachedNewSessionInfo, loadCachedNewSessions } from "../cachedNewSessions";
import { heldPendingStartsOn } from "../heldPendingStarts";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import { SessionController } from "./sessionController";
import { defaultApi, launchNewSession, deferred, emptyPage, FakeSocket, MemoryStorage, oldSession, sessionKey, sessionLookupId, status, workspace, type AppState, type SessionInfo } from "./sessionController.testSupport";

describe("SessionController pending starts", () => {
  it("does not carry the previous session's failed reads into the session being started", () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [], statusReadFailed: "daemon unreachable", transcriptFailed: "could not read" };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api: { ...defaultApi, startSession: () => new Promise<SessionInfo>(() => undefined) }, socket: new FakeSocket() },
    );

    void launchNewSession(controller);

    expect({ status: state.statusReadFailed, transcript: state.transcriptFailed }).toEqual({ status: undefined, transcript: undefined });
  });

  it("creates and selects a temporary editable session before backend start resolves, asking again under its token while unanswered", async () => {
    Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
    vi.useFakeTimers();
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const messageCalls: string[] = [];
    const statusCalls: string[] = [];
    const startTokens: (string | undefined)[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [], machineRuntimes: { local: { machineId: "local", ok: true, checkedAt: "2026-10-21T00:00:00.000Z", capabilities: ["sessions.create-joins"] } } };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: (_cwd, _machineId, startupToken) => {
        startTokens.push(startupToken);
        return startTokens.length <= 2 ? Promise.reject(new HttpError("Session daemon did not answer within 25s", 504)) : startRequest.promise;
      },
      messages: (session) => { messageCalls.push(sessionLookupId(session)); return Promise.resolve(emptyPage); },
      status: (session) => { statusCalls.push(sessionLookupId(session)); return Promise.resolve(status(sessionLookupId(session))); },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const start = launchNewSession(controller);
    const temporarySession = state.selectedSession;

    expect(temporarySession?.id).toMatch(/^pending-session-/);
    expect(temporarySession?.persisted).toBe(false);
    expect(state.sessions.map((session) => session.id)).toEqual([temporarySession?.id]);
    expect(state.activity).toMatchObject({ sessionId: temporarySession?.id, phase: "active", label: "Creating session" });
    expect(messageCalls).toEqual([]);
    expect(statusCalls).toEqual([]);

    await vi.advanceTimersByTimeAsync(3000);
    vi.useRealTimers();
    expect(startTokens).toEqual([temporarySession?.id, temporarySession?.id, temporarySession?.id]);
    expect(state.selectedSession?.id).toBe(temporarySession?.id);
    expect(state.activity).toMatchObject({ sessionId: temporarySession?.id, phase: "active", label: "Creating session" });
    expect(heldPendingStartsOn("local").map((held) => [held.token, held.cwd])).toEqual([[temporarySession?.id, workspace.path]]);

    startRequest.resolve(started);
    await start;

    expect(heldPendingStartsOn("local")).toEqual([]);
    expect(state.sessions.map((session) => session.id)).toEqual(["started-session"]);
    expect(state.selectedSession?.id).toBe("started-session");
    expect(messageCalls).toEqual(["started-session"]);
    // One read: the selection's refresh reads the status, which carries an
    // extension dialog a brand-new session opened before the page joined. The
    // selection no longer reads it a second time for itself (P3 slice c).
    expect(statusCalls).toEqual(["started-session"]);

    for (const stop of ["discard", "dispose"] as const) {
      vi.useFakeTimers();
      let stoppedCalls = 0;
      let stoppedState: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [], machineRuntimes: state.machineRuntimes };
      const stoppedController = new SessionController(
        () => stoppedState,
        (patch) => { stoppedState = { ...stoppedState, ...patch }; },
        () => undefined,
        undefined,
        { api: { ...defaultApi, startSession: () => { stoppedCalls += 1; return Promise.reject(new HttpError("Session daemon did not answer within 25s", 504)); } }, socket: new FakeSocket() },
      );

      const stoppedStart = launchNewSession(stoppedController);
      await vi.advanceTimersByTimeAsync(0);
      expect(stoppedCalls).toBe(1);
      if (stop === "discard") await stoppedController.deleteCachedNewSession(stoppedState.sessions[0]);
      else stoppedController.dispose();
      await vi.advanceTimersByTimeAsync(3000);
      await stoppedStart;
      vi.useRealTimers();

      expect({ stop, calls: stoppedCalls }).toEqual({ stop, calls: 1 });
    }
  });

  it("does not duplicate a started session when its session.created broadcast races the HTTP response", async () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const socket = new FakeSocket();
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => {
        // Simulate the broadcast arriving before the HTTP response resolves.
        controller.applyGlobalEvent({ type: "session.created", session: started });
        return startRequest.promise;
      },
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    const start = launchNewSession(controller);
    const temporaryId = state.selectedSession?.id;

    expect(state.sessions.map((session) => session.id)).toEqual([temporaryId]);

    startRequest.resolve(started);
    await start;

    expect(state.sessions.map((session) => session.id)).toEqual(["started-session"]);
    expect(isCachedNewSessionInfo(state.sessions[0])).toBe(true);
  });

  it("releases unrelated created-session broadcasts after pending starts settle", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const otherClientSession: SessionInfo = { ...oldSession, id: "other-client-session", path: "/tmp/other-client-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const start = launchNewSession(controller);
    const temporaryId = state.selectedSession?.id;
    controller.applyGlobalEvent({ type: "session.created", session: started });
    controller.applyGlobalEvent({ type: "session.created", session: otherClientSession });

    expect(state.sessions.map((session) => session.id)).toEqual([temporaryId]);

    startRequest.resolve(started);
    await start;

    const sessionIds = state.sessions.map((session) => session.id);
    expect(sessionIds).not.toContain(temporaryId);
    expect(sessionIds.filter((id) => id === started.id)).toHaveLength(1);
    expect(sessionIds.filter((id) => id === otherClientSession.id)).toHaveLength(1);
  });

  it("preserves temporary start rows across session-list refreshes before backend resolution", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
      sessions: () => Promise.resolve([oldSession]),
      sessionsIfChanged: () => Promise.resolve({ revision: "rev-1", sessions: [oldSession] }),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const start = launchNewSession(controller);
    const temporaryId = state.selectedSession?.id;
    await controller.refreshCurrentWorkspaceSessions();

    expect(state.sessions.map((session) => session.id)).toEqual([temporaryId, oldSession.id]);
    expect(state.selectedSession?.id).toBe(temporaryId);

    startRequest.resolve(started);
    await start;

    expect(state.sessions.map((session) => session.id)).toEqual([started.id, oldSession.id]);
    expect(state.selectedSession?.id).toBe(started.id);
  });

  it("tracks multiple pending session starts without blocking another start", async () => {
    const firstStarted: SessionInfo = { ...oldSession, id: "started-session-1", path: "/tmp/started-session-1.jsonl" };
    const secondStarted: SessionInfo = { ...oldSession, id: "started-session-2", path: "/tmp/started-session-2.jsonl" };
    const startResolvers: ((session: SessionInfo) => void)[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => new Promise<SessionInfo>((resolve) => { startResolvers.push(resolve); }),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const firstStart = launchNewSession(controller);
    const firstTemporaryId = state.selectedSession?.id;
    const secondStart = launchNewSession(controller);
    const secondTemporaryId = state.selectedSession?.id;

    expect(startResolvers).toHaveLength(2);
    expect(state.startingSessionCount).toBe(0);
    expect(state.sessions.map((session) => session.id)).toEqual([secondTemporaryId, firstTemporaryId]);
    expect(state.selectedSession?.id).toBe(secondTemporaryId);
    expect(state.sessions.every((session) => session.persisted === false)).toBe(true);

    startResolvers[0]?.(firstStarted);
    await firstStart;

    expect(state.sessions.map((session) => session.id)).toEqual([secondTemporaryId, "started-session-1"]);
    expect(state.selectedSession?.id).toBe(secondTemporaryId);

    startResolvers[1]?.(secondStarted);
    await secondStart;

    expect(state.startingSessionCount).toBe(0);
    expect(state.sessions.map((session) => session.id)).toEqual(["started-session-2", "started-session-1"]);
    expect(state.selectedSession?.id).toBe("started-session-2");
  });

  it("moves a temporary session draft and cached-new marker to the resolved session", async () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const start = launchNewSession(controller);
    const temporaryId = state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected temporary session id");
    saveDraft(sessionKey(temporaryId), "draft text");

    startRequest.resolve(started);
    await start;

    expect(loadDraft(sessionKey(temporaryId))).toBe("");
    expect(loadDraft(sessionKey(started.id))).toBe("draft text");
    expect(loadCachedNewSessions().map((session) => session.id)).toEqual([started.id]);
    expect(isCachedNewSessionInfo(state.sessions[0])).toBe(true);
  });

  it("keeps a refused temporary start selected with a discardable transient row", async () => {
    const cases: { capabilities: PiWebCapability[]; status: number }[] = [
      { capabilities: [], status: 400 },
      { capabilities: [], status: 504 },
      { capabilities: ["sessions.create-joins"], status: 401 },
      { capabilities: ["sessions.create-joins"], status: 404 },
    ];
    for (const refusal of cases) {
      vi.useFakeTimers();
      let startCalls = 0;
      let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [], machineRuntimes: { local: { machineId: "local", ok: true, checkedAt: "2026-10-21T00:00:00.000Z", capabilities: refusal.capabilities } } };
      const api: typeof defaultApi = {
        ...defaultApi,
        startSession: () => { startCalls += 1; return Promise.reject(new HttpError("backend unavailable", refusal.status)); },
      };
      const controller = new SessionController(
        () => state,
        (patch) => { state = { ...state, ...patch }; },
        () => undefined,
        undefined,
        { api, socket: new FakeSocket() },
      );

      await launchNewSession(controller);
      await vi.advanceTimersByTimeAsync(3000);
      vi.useRealTimers();
      const temporaryId = state.selectedSession?.id;

      expect({ refusal, calls: startCalls }).toEqual({ refusal, calls: 1 });
      expect(temporaryId).toMatch(/^pending-session-/);
      expect(state.sessions.map((session) => session.id)).toEqual([temporaryId]);
      expect(state.sessions[0]?.persisted).toBe(false);
      expect(state.activity).toMatchObject({ sessionId: temporaryId, phase: "error", label: "Session creation failed" });
      expect(state.error).toContain("backend unavailable");

      await controller.deleteCachedNewSession(state.sessions[0]);

      expect(state.sessions).toEqual([]);
      expect(state.selectedSession).toBeUndefined();
    }
  });
});
