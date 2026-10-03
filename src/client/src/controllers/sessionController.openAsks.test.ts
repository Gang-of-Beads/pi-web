import { describe, expect, it } from "vitest";
import type { PendingAskUser } from "../../../shared/apiTypes";
import { initialAppState } from "../appState";
import { openAsksIn } from "../openAsks";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, status, type AppState, type SessionInfo } from "./sessionController.testSupport";

const form = (askId: string): PendingAskUser => ({ askId, questions: [{ id: "q", question: askId, options: [{ value: "a", label: "A" }] }], askedAt: "2026-10-03T00:00:00.000Z" });
const other: SessionInfo = { ...oldSession, id: "other-session", path: "/tmp/other-session.jsonl" };

/** The selected session's open forms belong to it (state-diagram D2; review b2c94ee9, DeepSeek F4). */
describe("the open forms a selection shows", () => {
  function harness(statusForm?: PendingAskUser) {
    const withForms = { ...status(oldSession.id), pendingAsk: form("first"), pendingAsks: [form("first"), form("second")] };
    let state: AppState = { ...initialAppState(), sessionStatuses: { [oldSession.id]: withForms }, selectedSession: oldSession, pendingAsk: withForms.pendingAsk, pendingAsks: withForms.pendingAsks };
    const sessions = new SessionController(() => state, (patch) => { state = { ...state, ...patch }; }, () => undefined, undefined, {
      api: {
        ...defaultApi,
        messages: () => (statusForm === undefined ? new Promise(() => undefined) : Promise.resolve({ messages: [], start: 0, total: 0 })),
        status: (session) => (statusForm === undefined ? new Promise(() => undefined) : Promise.resolve({ ...status(session.id), pendingAsk: statusForm, pendingAsks: [statusForm] })),
        streamSnapshot: () => (statusForm === undefined ? new Promise(() => undefined) : Promise.resolve({ seq: 0, partial: null })),
        thinkingLevels: () => Promise.resolve({ levels: [] }),
      },
      socket: new FakeSocket(),
    });
    const forms = () => ({ oldest: state.pendingAsk?.askId, all: state.pendingAsks.map((ask) => ask.askId) });
    return { sessions, forms };
  }

  it("leave with their session, and come back with it the moment it is selected again", () => {
    const { sessions, forms } = harness();

    void sessions.selectSession(other);
    const next = forms();
    void sessions.selectSession(oldSession);
    const selected = forms();
    sessions.clearActiveSession();

    expect({ next, selected, cleared: forms() }).toEqual({
      next: { oldest: undefined, all: [] },
      selected: { oldest: "first", all: ["first", "second"] },
      cleared: { oldest: undefined, all: [] },
    });
  });

  it("are what the session's status says once it arrives", async () => {
    const { sessions, forms } = harness(form("from-status"));

    await sessions.selectSession(other);

    expect(forms()).toEqual({ oldest: "from-status", all: ["from-status"] });
  });
});

describe("the open forms a status says", () => {
  it.each<[string, Parameters<typeof openAsksIn>[0], { oldest: string | undefined; all: string[] }]>([
    ["no status: none", undefined, { oldest: undefined, all: [] }],
    ["a status with none: none", {}, { oldest: undefined, all: [] }],
    ["an older daemon that names only the oldest: that one", { pendingAsk: form("only") }, { oldest: "only", all: ["only"] }],
    ["every open form: all of them, the oldest first", { pendingAsk: form("first"), pendingAsks: [form("first"), form("second")] }, { oldest: "first", all: ["first", "second"] }],
  ])("%s", (_name, given, expected) => {
    const open = openAsksIn(given);

    expect({ oldest: open.pendingAsk?.askId, all: open.pendingAsks.map((ask) => ask.askId) }).toEqual(expected);
  });
});
