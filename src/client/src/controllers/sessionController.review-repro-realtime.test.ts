import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import type { ChatLine } from "../components/shared";
import { SessionSocket } from "../sessionSocket";
import { SessionController } from "./sessionController";
import { deferred, defaultApi, EmitSocket, emptyPage, oldSession, runPendingAnimationFrames, sessionLookupId, status, workspace, type AppState, type SessionStatus } from "./sessionController.testSupport";

class WireSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: WireSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) { WireSocket.instances.push(this); }
  open(): void { this.readyState = 1; this.onopen?.(); }
  frame(value: unknown): void { this.onmessage?.({ data: JSON.stringify(value) }); }
  close(): void { this.readyState = 3; }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function text(messages: ChatLine[]): string {
  return messages.map((line) => line.parts.map((part) => ("text" in part && typeof part.text === "string" ? part.text : "")).join("")).join("|");
}

function streaming(sessionId: string): SessionStatus {
  return { ...status(sessionId), isStreaming: true };
}

describe("review-repro realtime: status facts carry no order", () => {
  it("an HTTP status read before a socket frame, answered after it, overwrites the newer fact", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    let statusCalls = 0;
    let armed = false;
    const lateRead = deferred<SessionStatus>();
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => { statusCalls += 1; return armed ? lateRead.promise : Promise.resolve(status(sessionLookupId(session))); },
      streamSnapshot: () => Promise.resolve({ seq: 10, partial: null }),
      streamSync: (_session, sinceSeq) => Promise.resolve({ kind: "replay", sinceSeq, frames: [] }),
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket });
    await controller.selectSession(oldSession, { updateUrl: false });
    armed = true;
    const before = statusCalls;
    const refresh = controller.refreshSelectedSession();
    await settle();
    expect(statusCalls).toBe(before + 1);
    socket.emit({ type: "status.update", status: streaming(oldSession.id), seq: 11 });
    runPendingAnimationFrames();
    expect(state.status?.isStreaming).toBe(true);
    lateRead.resolve(status(oldSession.id));
    await refresh;
    expect(state.status?.isStreaming, "the daemon published isStreaming=true at seq 11; the HTTP body was read before it").toBe(true);
  });
});

describe("review-repro realtime: the join window and the gap monitor", () => {
  beforeEach(() => {
    WireSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", WireSocket);
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("a frame published between the snapshot watermark and the first live frame is never repaired", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const syncCalls: number[] = [];
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(streaming(sessionLookupId(session))),
      streamSnapshot: () => Promise.resolve({ seq: 5, partial: null }),
      streamSync: (_session, sinceSeq) => { syncCalls.push(sinceSeq); return Promise.resolve({ kind: "replay", sinceSeq, frames: [JSON.stringify({ type: "status.update", status: status(oldSession.id), seq: 6 })] }); },
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new SessionSocket() });
    const selecting = controller.selectSession(oldSession, { updateUrl: false });
    WireSocket.instances[0]?.open();
    await selecting;
    WireSocket.instances[0]?.frame({ type: "activity.update", activity: { sessionId: oldSession.id, phase: "idle", label: "message complete", at: "2026-09-28T19:00:00.000Z" }, seq: 7 });
    await settle();
    runPendingAnimationFrames();
    expect(syncCalls, "seq 6 is asked for from the snapshot's 5, then the idle turn end catches up from the frontier 7").toEqual([5, 7]);
    expect(state.status?.isStreaming).toBe(false);
  });

  it("a gap seen during the join is replayed on top of frames the join flush already applied", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const snapshot = deferred<{ seq: number; partial: null }>();
    const replay = deferred<{ kind: "replay"; sinceSeq: number; frames: string[] }>();
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(streaming(sessionLookupId(session))),
      streamSnapshot: () => snapshot.promise,
      streamSync: () => replay.promise,
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new SessionSocket() });
    const selecting = controller.selectSession(oldSession, { updateUrl: false });
    const wire = WireSocket.instances[0];
    wire?.open();
    wire?.frame({ type: "assistant.delta", text: "A", seq: 10 });
    wire?.frame({ type: "assistant.delta", text: "C", seq: 12 });
    await settle();
    snapshot.resolve({ seq: 9, partial: null });
    await selecting;
    runPendingAnimationFrames();
    replay.resolve({ kind: "replay", sinceSeq: 10, frames: [JSON.stringify({ type: "assistant.delta", text: "B", seq: 11 }), JSON.stringify({ type: "assistant.delta", text: "C", seq: 12 })] });
    await settle();
    runPendingAnimationFrames();
    expect(text(state.messages), "frames 10..12 must each apply exactly once, in seq order").toBe("ABC");
  });
});
