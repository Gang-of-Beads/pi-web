import { describe, expect, it } from "vitest";
import type { SessionStatus } from "../api";
import { HttpError } from "../api/http";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, sessionLookupId, status, workspace, type AppState } from "./sessionController.testSupport";

const page = { messages: [{ role: "user", content: "hello from the file", timestamp: 1 }], start: 0, total: 1 };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness(api: Partial<typeof defaultApi>, seed: Partial<AppState> = {}) {
  let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession], ...seed };
  const controller = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, {
    api: {
      ...defaultApi,
      messages: () => Promise.resolve(page),
      streamSnapshot: () => Promise.resolve({ seq: 3, partial: null }),
      transcriptTail: () => Promise.resolve({ kind: "answered", value: { page, stream: { seq: 3, epoch: "e1", partial: null } } }),
      streamSync: (_session, sinceSeq) => Promise.resolve({ kind: "resync", sinceSeq }),
      thinkingLevels: () => Promise.resolve({ levels: [], current: undefined }),
      ...api,
    },
    socket: new FakeSocket(),
  });
  return { controller, state: () => state };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
}

function shownTexts(state: AppState): string[] {
  return state.messages.flatMap((line) => line.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])));
}

describe("opening a session without waiting for its runtime (P2 slice c)", () => {
  it("shows the transcript while the status is still being read", async () => {
    const statusRead = deferred<SessionStatus>();
    const { controller, state } = harness({ status: () => statusRead.promise });

    const opening = controller.selectSession(oldSession);
    await settle();
    const whileStatusPending = { texts: shownTexts(state()), loading: state().isLoadingTranscript, status: state().status };
    statusRead.resolve(status(oldSession.id));
    await opening;

    expect(whileStatusPending).toEqual({ texts: ["hello from the file"], loading: false, status: undefined });
    expect(state().status?.sessionId).toBe(sessionLookupId(oldSession));
  });

  it("keeps the transcript when only the status read fails, and says so even when an older status is on screen", async () => {
    const { controller, state } = harness({ status: () => Promise.reject(new HttpError("EIO: i/o error, read", 500, "local")) }, { sessionStatuses: { [oldSession.id]: status(oldSession.id) } });

    await controller.selectSession(oldSession);
    await settle();

    expect({ texts: shownTexts(state()), transcriptFailed: state().transcriptFailed, statusFailed: state().statusReadFailed !== undefined, notice: state().error.includes("EIO: i/o error, read") }).toEqual({
      texts: ["hello from the file"],
      transcriptFailed: undefined,
      statusFailed: true,
      notice: true,
    });
  });

  it("forgets a failed status read once a status for the session arrives by any path", async () => {
    const { controller, state } = harness({ status: () => Promise.reject(new HttpError("EIO: i/o error, read", 500, "local")) });
    await controller.selectSession(oldSession);
    await settle();

    controller.applyGlobalEvent({ type: "status.update", status: status(oldSession.id) });
    controller.flushPendingUpdates();

    expect(state().statusReadFailed).toBeUndefined();
  });

  it("seeds the reply still being written when the tail carries one", async () => {
    const partial = { role: "assistant", content: [{ type: "text", text: "still writing" }], timestamp: 2 };
    const { controller, state } = harness({
      transcriptTail: () => Promise.resolve({ kind: "answered", value: { page, stream: { seq: 3, epoch: "e1", partial } } }),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    });

    await controller.selectSession(oldSession);

    expect(shownTexts(state())).toEqual(["hello from the file", "still writing"]);
  });

  it("reads the transcript the old way from a daemon that lacks the tail route", async () => {
    const { controller, state } = harness({
      transcriptTail: () => Promise.resolve({ kind: "unsupported" }),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
    });

    await controller.selectSession(oldSession);

    expect(shownTexts(state())).toEqual(["hello from the file"]);
  });
});
