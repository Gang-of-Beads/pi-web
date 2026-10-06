import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import type { ChatLine } from "../components/shared";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, EmitSocket, emptyPage, oldSession, replacementSession, runPendingAnimationFrames, sessionLookupId, status, workspace, type AppState, type MessagePage } from "./sessionController.testSupport";

function text(messages: readonly ChatLine[]): string {
  return messages.map((line) => line.parts.map((part) => ("text" in part && typeof part.text === "string" ? part.text : "")).join("")).join("|");
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

/**
 * A reconnect refresh reads the page and the snapshot while live frames keep applying. Its
 * result replaced the view, so a frame newer than the snapshot vanished until another frame
 * revealed the gap - never, if the session went quiet.
 */
function refreshRace() {
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
  const socket = new EmitSocket();
  const page = deferred<MessagePage>();
  const syncCalls: number[] = [];
  let armed = false;
  const api: typeof defaultApi = {
    ...defaultApi,
    messages: () => (armed ? page.promise : Promise.resolve(emptyPage)),
    status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
    streamSnapshot: () => Promise.resolve({ seq: 10, epoch: "e.1", partial: null }),
    streamSync: (_session, sinceSeq) => {
      syncCalls.push(sinceSeq);
      const replayAfterTheRefresh = armed && sinceSeq === 10;
      return Promise.resolve(replayAfterTheRefresh
        ? { kind: "replay" as const, sinceSeq, epoch: "e.1", frames: [JSON.stringify({ type: "assistant.delta", text: "A", seq: 11, epoch: "e.1" })] }
        : { kind: "resync" as const, sinceSeq });
    },
  };
  const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket });
  return {
    controller,
    socket,
    page,
    syncCalls,
    arm: () => { armed = true; },
    shown: () => text(state.messages),
  };
}

describe("a waiting message across a reconnect refresh that replays its own acceptance", () => {
  it("stays one waiting row: its echo in the replay is not the agent reading it", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    const id = "waiting-steer-1";
    const text = "second thought";
    const queued = { ...status(oldSession.id), isStreaming: true, queuedMessages: [{ kind: "steer" as const, text, clientMessageId: id }] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: () => Promise.resolve(queued),
      streamSnapshot: () => Promise.resolve({ seq: 10, epoch: "e.1", partial: null }),
      streamSync: (_session, sinceSeq) => Promise.resolve({
        kind: "replay" as const,
        sinceSeq,
        epoch: "e.1",
        frames: [
          JSON.stringify({ type: "prompt.accepted", clientMessageId: id, seq: 11, epoch: "e.1" }),
          JSON.stringify({ type: "message.append", message: { role: "user", content: [{ type: "text", text }], timestamp: 1_790_000_000_000 }, echo: true, clientMessageId: id, seq: 12, epoch: "e.1" }),
          JSON.stringify({ type: "status.update", status: queued, seq: 13, epoch: "e.1" }),
        ],
      }),
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket });
    await controller.selectSession(oldSession, { updateUrl: false });
    const waiting: ChatLine = { role: "user", parts: [{ type: "text", text }], meta: { timestamp: "2026-09-29T06:19:06.985Z", delivery: { clientMessageId: id, state: "queued", kind: "steer" } } };
    state = { ...state, messages: [...state.messages, waiting] };

    await controller.refreshSelectedSession();
    runPendingAnimationFrames();

    const rows = state.messages.filter((line) => line.role === "user" && line.parts.some((part) => "text" in part && part.text === text));
    expect(rows.map((line) => line.meta?.delivery?.state ?? "no delivery")).toEqual(["queued"]);
  });
});

describe("asking the ledger when the tab comes back", () => {
  it("waits for the refresh that reopens the session, which is what re-records a restored inbox", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    let armed = false;
    const page = deferred<MessagePage>();
    const asked: string[] = [];
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => (armed ? page.promise : Promise.resolve(emptyPage)),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
      streamSnapshot: () => Promise.resolve({ seq: 10, epoch: "e.1", partial: null }),
      streamSync: (_session, sinceSeq) => Promise.resolve({ kind: "resync" as const, sinceSeq }),
      operationOutcomes: () => { asked.push(armed ? "during or after" : "before"); return Promise.resolve({ "waiting-1a": "pending" }); },
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new EmitSocket() });
    await controller.selectSession(oldSession, { updateUrl: false });
    state = { ...state, messages: [...state.messages, { role: "user", parts: [{ type: "text", text: "waiting" }], meta: { delivery: { clientMessageId: "waiting-1a", state: "queued" } } }] };
    asked.length = 0;
    armed = true;

    const refreshing = controller.refreshSelectedSession();
    const verifying = controller.verifyUnansweredSends();
    await settle();
    const whileRefreshing = asked.length;
    page.resolve(emptyPage);
    await refreshing;
    await verifying;

    expect({ whileRefreshing, after: asked.length }).toEqual({ whileRefreshing: 0, after: 1 });
  });
});

describe("a live frame from a restarted daemon", () => {
  it("is shown, not dropped as below a watermark from the previous daemon's numbering", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    let reads = 0;
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => { reads += 1; return reads === 1 ? Promise.resolve(emptyPage) : new Promise<MessagePage>(() => undefined); },
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
      streamSnapshot: () => Promise.resolve({ seq: 40, epoch: "daemon-a.1", partial: null }),
      streamSync: (_session, sinceSeq) => Promise.resolve({ kind: "resync" as const, sinceSeq }),
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket });
    await controller.selectSession(oldSession, { updateUrl: false });

    socket.emit({ type: "assistant.delta", text: "after restart", seq: 7, epoch: "daemon-b.1" });
    runPendingAnimationFrames();
    await settle();

    expect({ shown: text(state.messages), fullReadAsked: reads > 1 }).toEqual({ shown: "after restart", fullReadAsked: true });
  });
});

describe("a gap repair that outlives its selection", () => {
  it("applies nothing of session A into session B when A's replay lands after the switch", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const socket = new EmitSocket();
    const replay = deferred<{ kind: "replay"; sinceSeq: number; epoch: string; frames: string[] }>();
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
      streamSnapshot: () => Promise.resolve({ seq: 10, epoch: "e.1", partial: null }),
      streamSync: (session) => (sessionLookupId(session) === oldSession.id ? replay.promise : Promise.resolve({ kind: "resync" as const, sinceSeq: 0 })),
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket });
    await controller.selectSession(oldSession, { updateUrl: false });
    socket.emit({ type: "assistant.delta", text: "A-late", seq: 13, epoch: "e.1" });
    await settle();

    await controller.selectSession(replacementSession, { updateUrl: false });
    replay.resolve({ kind: "replay", sinceSeq: 10, epoch: "e.1", frames: [JSON.stringify({ type: "assistant.delta", text: "A-missed", seq: 11, epoch: "e.1" })] });
    await settle();
    runPendingAnimationFrames();

    expect({ selected: state.selectedSession?.id, shown: text(state.messages) }).toEqual({ selected: replacementSession.id, shown: "" });
  });
});

describe("a message recalled while the link was down", () => {
  it("stays gone after the catch-up replays its echo and its withdrawal", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const id = "recalled-1a";
    const text = "never mind";
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
      streamSnapshot: () => Promise.resolve({ seq: 10, epoch: "e.1", partial: null }),
      streamSync: (_session, sinceSeq) => Promise.resolve({
        kind: "replay" as const,
        sinceSeq,
        frames: [
          JSON.stringify({ type: "message.append", message: { role: "user", content: text, timestamp: 1_790_000_000_000 }, echo: true, clientMessageId: id, seq: 11, epoch: "e.1" }),
          JSON.stringify({ type: "prompt.withdrawn", clientMessageId: id, seq: 12, epoch: "e.1" }),
        ],
      }),
    };
    const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, { api, socket: new EmitSocket() });
    await controller.selectSession(oldSession, { updateUrl: false });
    state = { ...state, messages: [...state.messages, { role: "user", parts: [{ type: "text", text }], meta: { delivery: { clientMessageId: id, state: "queued", kind: "steer" } } }] };

    await controller.catchUp();
    await settle();
    runPendingAnimationFrames();

    expect(state.messages.filter((line) => line.parts.some((part) => "text" in part && part.text === text))).toEqual([]);
  });
});

describe("a live frame applied while a reconnect refresh is in flight", () => {
  it("is fetched again as soon as the refresh replaces the view, without waiting for another frame", async () => {
    const race = refreshRace();
    await race.controller.selectSession(oldSession, { updateUrl: false });
    race.arm();
    const refresh = race.controller.refreshSelectedSession();
    await settle();
    race.socket.emit({ type: "assistant.delta", text: "A", seq: 11, epoch: "e.1" });
    runPendingAnimationFrames();
    race.page.resolve(emptyPage);
    await refresh;
    await settle();
    runPendingAnimationFrames();

    expect({ shown: race.shown(), syncCalls: race.syncCalls }).toEqual({ shown: "A", syncCalls: [10] });
  });

  it("applies once when it was still waiting for the next render as the refresh landed", async () => {
    const race = refreshRace();
    await race.controller.selectSession(oldSession, { updateUrl: false });
    race.arm();
    const refresh = race.controller.refreshSelectedSession();
    await settle();
    race.socket.emit({ type: "assistant.delta", text: "A", seq: 11, epoch: "e.1" });
    race.page.resolve(emptyPage);
    await refresh;
    await settle();
    runPendingAnimationFrames();
    race.socket.emit({ type: "assistant.delta", text: "B", seq: 12, epoch: "e.1" });
    runPendingAnimationFrames();

    expect(race.shown()).toBe("AB");
  });
});
