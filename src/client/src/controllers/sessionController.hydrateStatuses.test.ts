import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import type { PendingAskUser } from "../api";
import { SessionController } from "./sessionController";
import { defaultApi, FakeSocket, oldSession, status, type AppState, type SessionStatus } from "./sessionController.testSupport";

const ask: PendingAskUser = {
  askId: "ask-1",
  questions: [{ id: "q1", question: "Proceed?", options: [{ value: "yes", label: "Yes" }] }],
  askedAt: "2026-07-20T00:00:00.000Z",
};

function asking(sessionId: string): SessionStatus {
  return { ...status(sessionId), pendingAsk: ask };
}

/**
 * The status catalog is a statement of everything still worth an indicator.
 * Merging it kept every indicator the catalog no longer mentioned, so a
 * session answered and left behind held its amber "waiting" circle until a
 * reload: hydration could add a circle but never take one away.
 */
describe("hydrating session statuses from the catalog", () => {
  it("retracts the indicator of a session the catalog no longer mentions", async () => {
    let state: AppState = {
      ...initialAppState(),
      sessions: [oldSession],
      sessionStatuses: { [oldSession.id]: asking(oldSession.id) },
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      statusCatalog: () => Promise.resolve({ statuses: [], generatedAt: "2026-07-27T10:00:00.000Z" }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.hydrateSessionStatuses("local", { replaceKnown: true });

    expect(state.sessionStatuses[oldSession.id]).toBeUndefined();
  });

  it("keeps an indicator the catalog still stands behind", async () => {
    const waiting = asking(oldSession.id);
    let state: AppState = {
      ...initialAppState(),
      sessions: [oldSession],
      sessionStatuses: {},
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      statusCatalog: () => Promise.resolve({ statuses: [waiting], generatedAt: "2026-07-27T10:00:00.000Z" }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.hydrateSessionStatuses("local", { replaceKnown: true });

    expect(state.sessionStatuses[oldSession.id]).toEqual(waiting);
  });

  it("replaces the whole map when the catalog comes from a different daemon instance", async () => {
    // Session ids are the daemon's runtime handles. A catalog stamped with a
    // new instance id says the process that minted the ids the browser holds
    // is gone, so even a fill-only read must not keep its entries: they
    // describe sessions the current daemon may not hold at all.
    const live = asking(oldSession.id);
    let state: AppState = {
      ...initialAppState(),
      sessions: [oldSession],
      sessionStatuses: { [oldSession.id]: asking(oldSession.id), "dead-session": asking("dead-session") },
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      statusCatalog: () => Promise.resolve({ statuses: [live], generatedAt: "2026-07-27T10:00:00.000Z", daemonInstanceId: "daemon-next" }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.hydrateSessionStatuses("local");

    expect(state.sessionStatuses).toEqual({ [oldSession.id]: live });
  });

  it("keeps entries the catalog does not mention while the daemon instance is unchanged", async () => {
    // A fill-only read trusts what the browser holds: live events are
    // fresher than the snapshot, and a session the daemon does not list may
    // simply be hosted elsewhere. Only a replaced instance or a replaceKnown
    // read may retract.
    const held = asking(oldSession.id);
    let state: AppState = {
      ...initialAppState(),
      sessions: [oldSession],
      sessionStatuses: {},
    };
    let catalog: { statuses: SessionStatus[]; generatedAt: string; daemonInstanceId: string } = {
      statuses: [held],
      generatedAt: "2026-07-27T10:00:00.000Z",
      daemonInstanceId: "daemon-same",
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      statusCatalog: () => Promise.resolve(catalog),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.hydrateSessionStatuses("local", { replaceKnown: true });
    catalog = { statuses: [], generatedAt: "2026-07-27T10:00:01.000Z", daemonInstanceId: "daemon-same" };
    await controller.hydrateSessionStatuses("local");

    expect(state.sessionStatuses[oldSession.id]).toEqual(held);
  });
});
