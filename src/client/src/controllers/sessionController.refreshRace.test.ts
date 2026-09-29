import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import type { ChatLine } from "../components/shared";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, EmitSocket, emptyPage, oldSession, runPendingAnimationFrames, sessionLookupId, status, workspace, type AppState, type MessagePage } from "./sessionController.testSupport";

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
      const replayAfterTheRefresh = armed && syncCalls.length > 1 && sinceSeq === 10;
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

    expect({ shown: race.shown(), syncCalls: race.syncCalls }).toEqual({ shown: "A", syncCalls: [10, 10] });
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
