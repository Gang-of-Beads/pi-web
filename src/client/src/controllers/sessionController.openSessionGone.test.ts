import { describe, expect, it, vi } from "vitest";
import type { Project, SessionInfo } from "../api";
import { HttpError } from "../api/http";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, emptyPage, FakeSocket, oldSession, sessionLookupId, status, workspace, type AppState } from "./sessionController.testSupport";
import { WorkspaceController } from "./workspaceController";

const project: Project = { id: workspace.projectId, name: "repo", path: workspace.path, createdAt: "now" };
const otherRow: SessionInfo = { ...oldSession, id: "other-row", path: "/tmp/other-row.jsonl" };
const notFound = () => new HttpError("Session not found", 404, "local", undefined, "session-not-found");

/** The open session is `oldSession`; `deleted()` makes every later read and change of it answer the code, as a daemon does once its file is gone. An archived copy still reads. */
function harness(api: Partial<typeof defaultApi> = {}) {
  let state: AppState = { ...initialAppState(), projects: [project], selectedProject: project };
  let gone = false;
  const urlNames: (string | undefined)[] = [];
  const urlModes: ("push" | "replace")[] = [];
  const urlPlaces: (string | undefined)[] = [];
  let address: string | undefined;
  const getState = () => state;
  const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
  const writeUrl = (options?: { replace?: boolean | undefined }) => {
    urlNames.push(state.sessionTarget?.sessionId ?? state.selectedSession?.id);
    urlModes.push(options?.replace === true ? "replace" : "push");
    urlPlaces.push(state.selectedWorkspace?.id);
    address = state.sessionTarget?.sessionId ?? state.selectedSession?.id;
  };
  const whileThere = <T>(answer: () => Promise<T>) => () => (gone ? Promise.reject(notFound()) : answer());
  const sessions = new SessionController(getState, setState, writeUrl, undefined, {
    api: {
      ...defaultApi,
      messages: (session) => (gone && !("archived" in session && session.archived === true) ? Promise.reject(notFound()) : Promise.resolve(emptyPage)),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
      streamSnapshot: whileThere(() => Promise.resolve({ seq: 0, partial: null })),
      status: (session) => (gone ? Promise.reject(notFound()) : Promise.resolve(status(sessionLookupId(session)))),
      abort: whileThere(() => Promise.resolve({ aborted: true, discarded: [] })),
      locateSession: () => Promise.reject(notFound()),
      ...api,
    },
    socket: new FakeSocket(),
    urlSessionId: () => address,
  });
  const workspaces = new WorkspaceController(getState, setState, vi.fn(), sessions, undefined, {
    api: { workspaces: () => Promise.resolve([workspace]), sessions: () => Promise.resolve([oldSession, otherRow]) },
  });
  return { sessions, workspaces, state: () => state, deleted: () => { gone = true; }, patch: setState, urlNames, urlModes, urlPlaces, goElsewhere: () => { address = undefined; } };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
}

async function opened(api: Partial<typeof defaultApi> = {}) {
  const harnessed = harness(api);
  await harnessed.workspaces.selectWorkspace(workspace, { sessionId: oldSession.id, updateUrl: false });
  await settle();
  if (harnessed.state().selectedSession?.id !== oldSession.id) throw new Error("precondition: the session did not open");
  if (harnessed.state().error !== "") throw new Error(`precondition: opening raised a notice: ${harnessed.state().error}`);
  return harnessed;
}

/**
 * A locate that answers `found` at most `times` times, then never again. A seam without its loop
 * guard would locate, open and locate forever, and a loop made only of promise callbacks starves the
 * test runner's own timeout; capped, it stops and the test fails on its count instead of hanging.
 */
function foundAtMost(times: number, session: () => SessionInfo | undefined, count: () => void = () => undefined) {
  let answered = 0;
  return () => {
    count();
    answered += 1;
    if (answered > times) return new Promise<never>(() => undefined);
    const located = session();
    return located === undefined ? Promise.reject(notFound()) : Promise.resolve({ kind: "found" as const, session: located });
  };
}

const goneTarget = { machineId: "local", workspaceId: workspace.id, cwd: workspace.path, sessionId: oldSession.id, target: { kind: "gone", sessionId: oldSession.id } };

describe("the open session answers session-not-found (P2 slice b part 2; owner: report that it was deleted)", () => {
  it("becomes a named target when a refresh answers the code, and the daemon's locate says it is gone", async () => {
    const { sessions, state, deleted } = await opened();
    deleted();

    await sessions.refreshSelectedSession();
    await settle();

    expect({ selected: state().selectedSession?.id, target: state().sessionTarget, notice: state().error }).toEqual({ selected: undefined, target: goneTarget, notice: "" });
  });

  it("does the same when only the status read answers the code, the transcript having been read just before the file went", async () => {
    let statusGone = false;
    const { sessions, state } = await opened({ status: (session) => (statusGone ? Promise.reject(notFound()) : Promise.resolve(status(sessionLookupId(session)))) });
    statusGone = true;

    await sessions.refreshSelectedSession();
    await settle();

    expect({ selected: state().selectedSession?.id, target: state().sessionTarget, notice: state().error, statusFailed: state().statusReadFailed }).toEqual({ selected: undefined, target: goneTarget, notice: "", statusFailed: undefined });
  });

  it("does the same when Stop answers the code", async () => {
    const { sessions, state, deleted } = await opened();
    deleted();

    await sessions.stopActiveWork();
    await settle();

    expect({ selected: state().selectedSession?.id, target: state().sessionTarget, notice: state().error }).toEqual({ selected: undefined, target: goneTarget, notice: "" });
  });

  it("opens it read-only when the locate finds it archived on another device", async () => {
    const archived: SessionInfo = { ...oldSession, archived: true, archivedAt: "2026-10-01T00:00:00.000Z" };
    const { sessions, state, deleted } = await opened({ locateSession: foundAtMost(2, () => archived) });
    deleted();

    await sessions.refreshSelectedSession();
    await settle();

    expect({ selected: state().selectedSession?.id, archived: state().selectedSession?.archived, target: state().sessionTarget }).toEqual({ selected: oldSession.id, archived: true, target: undefined });
  });

  it("says it is gone, without asking again, when the session located elsewhere still answers the code as it opens", async () => {
    let locates = 0;
    const elsewhere: SessionInfo = { ...oldSession, cwd: `${workspace.path}/packages/app` };
    const { sessions, state, deleted } = await opened({ locateSession: foundAtMost(2, () => elsewhere, () => { locates += 1; }) });
    deleted();

    await sessions.refreshSelectedSession();
    await settle();
    await settle();

    expect({ locates, selected: state().selectedSession?.id, target: state().sessionTarget?.target }).toEqual({ locates: 1, selected: undefined, target: { kind: "gone", sessionId: oldSession.id } });
  });

  it("asks the machine again when a session it located and opened answers the code later", async () => {
    let locates = 0;
    let archivedElsewhere = true;
    const archived: SessionInfo = { ...oldSession, archived: true, archivedAt: "2026-10-01T00:00:00.000Z" };
    const { sessions, state, deleted } = await opened({ locateSession: foundAtMost(3, () => (archivedElsewhere ? archived : undefined), () => { locates += 1; }) });
    deleted();
    await sessions.refreshSelectedSession();
    await settle();
    const openedArchived = state().selectedSession?.archived === true;

    archivedElsewhere = false;
    await sessions.stopActiveWork();
    await settle();

    expect({ openedArchived, locates, target: state().sessionTarget?.target }).toEqual({ openedArchived: true, locates: 2, target: { kind: "gone", sessionId: oldSession.id } });
  });

  it("asks the machine again when a session found in another directory, and opened there, answers the code later", async () => {
    let locates = 0;
    let moved = false;
    let everywhere = false;
    const elsewhere: SessionInfo = { ...oldSession, cwd: `${workspace.path}/packages/app` };
    const readable = (ref: { readonly cwd: string }) => !(everywhere || (moved && ref.cwd === workspace.path));
    const { sessions, state } = await opened({
      messages: (ref) => (readable(ref) ? Promise.resolve(emptyPage) : Promise.reject(notFound())),
      status: (ref) => (readable(ref) ? Promise.resolve(status(sessionLookupId(ref))) : Promise.reject(notFound())),
      streamSnapshot: (ref) => (readable(ref) ? Promise.resolve({ seq: 0, partial: null }) : Promise.reject(notFound())),
      abort: (ref) => (readable(ref) ? Promise.resolve({ aborted: true, discarded: [] }) : Promise.reject(notFound())),
      locateSession: foundAtMost(3, () => (everywhere ? undefined : elsewhere), () => { locates += 1; }),
    });
    moved = true;
    await sessions.refreshSelectedSession();
    for (let turn = 0; turn < 20 && (state().selectedSession?.cwd !== elsewhere.cwd || state().isLoadingTranscript || state().status === undefined); turn++) await settle();
    await settle();
    const openedThere = state().isLoadingTranscript ? "still loading" : state().selectedSession?.cwd;

    everywhere = true;
    await sessions.stopActiveWork();
    await settle();

    expect({ openedThere, locates, target: state().sessionTarget?.target }).toEqual({ openedThere: elsewhere.cwd, locates: 2, target: { kind: "gone", sessionId: oldSession.id } });
  });

  it("says a picked row that answers the code is gone instead of failing to load it, and the URL names that row", async () => {
    const { sessions, state, urlNames } = await opened({ messages: (session) => (session.id === otherRow.id ? Promise.reject(notFound()) : Promise.resolve(emptyPage)) });

    await sessions.selectSession(otherRow, { updateUrl: false });
    await settle();

    expect({ selected: state().selectedSession?.id, failed: state().transcriptFailed, target: state().sessionTarget, url: urlNames.at(-1) }).toEqual({
      selected: undefined,
      failed: undefined,
      target: { ...goneTarget, sessionId: otherRow.id, target: { kind: "gone", sessionId: otherRow.id } },
      url: otherRow.id,
    });
  });

  /** D8, one intent adds at most one history entry (review ae155c79): the tap already wrote its entry. */
  it("adds no entry of its own when a row the tap already wrote answers the code", async () => {
    const { sessions, urlNames, urlModes } = await opened({ messages: (session) => (session.id === otherRow.id ? Promise.reject(notFound()) : Promise.resolve(emptyPage)) });
    urlNames.length = 0;
    urlModes.length = 0;

    await sessions.selectSession(otherRow, { updateUrl: false });
    await settle();

    expect({ urlNames, urlModes }).toEqual({ urlNames: [otherRow.id], urlModes: ["replace"] });
  });

  it("pushes the one entry a pick left to it when its first read answers the code", async () => {
    const { sessions, urlNames, urlModes } = await opened({ messages: (session) => (session.id === otherRow.id ? Promise.reject(notFound()) : Promise.resolve(emptyPage)) });
    urlNames.length = 0;
    urlModes.length = 0;

    await sessions.selectSession(otherRow);
    await settle();

    expect({ urlNames, urlModes }).toEqual({ urlNames: [otherRow.id], urlModes: ["push"] });
  });

  it("replaces the tap's entry when the row it picked is located and opened in another workspace", async () => {
    const elsewhere = { ...workspace, id: "ws-elsewhere", path: "/elsewhere", label: "elsewhere", isMain: false };
    const located: SessionInfo = { ...otherRow, cwd: elsewhere.path };
    const { sessions, state, patch, urlNames, urlModes, urlPlaces } = await opened({
      messages: (session) => (session.id === otherRow.id && session.cwd === workspace.path ? Promise.reject(notFound()) : Promise.resolve(emptyPage)),
      locateSession: foundAtMost(1, () => located),
    });
    patch({ workspaces: [workspace, elsewhere] });
    urlNames.length = 0;
    urlModes.length = 0;

    await sessions.selectSession(otherRow, { updateUrl: false });
    for (let turn = 0; turn < 20 && (state().selectedSession?.cwd !== elsewhere.path || state().isLoadingTranscript); turn++) await settle();

    expect({ opened: state().selectedSession?.cwd, workspace: state().selectedWorkspace?.id, pushes: urlModes.filter((mode) => mode === "push").length, last: urlNames.at(-1), lastPlace: urlPlaces.at(-1) })
      .toEqual({ opened: elsewhere.path, workspace: elsewhere.id, pushes: 0, last: otherRow.id, lastPlace: elsewhere.id });
  });

  /** Review 1c0cb377: a restore's caller (a machine switch, a terminal run) writes the entry; a replace took the reader's previous place out of Back. */
  it("writes nothing for a restore that opens a session in another workspace, leaving the entry to its caller", async () => {
    const elsewhere = { ...workspace, id: "ws-elsewhere", path: "/elsewhere", label: "elsewhere", isMain: false };
    const restored: SessionInfo = { ...otherRow, cwd: elsewhere.path };
    const { sessions, state, patch, urlModes } = await opened();
    patch({ workspaces: [workspace, elsewhere] });
    urlModes.length = 0;

    await sessions.selectSession(restored, { updateUrl: false });
    await settle();

    expect({ workspace: state().selectedWorkspace?.id, writes: urlModes }).toEqual({ workspace: elsewhere.id, writes: [] });
  });

  /** Review ca45d6ed: a correction that lands after the reader left took the page and the entry they went to. */
  it("opens nothing when the located session answers after the reader went elsewhere", async () => {
    const elsewhere = { ...workspace, id: "ws-elsewhere", path: "/elsewhere", label: "elsewhere", isMain: false };
    const located: SessionInfo = { ...otherRow, cwd: elsewhere.path };
    let answer: () => void = () => undefined;
    const { sessions, state, patch, urlModes, goElsewhere } = await opened({
      messages: (session) => (session.id === otherRow.id && session.cwd === workspace.path ? Promise.reject(notFound()) : Promise.resolve(emptyPage)),
      locateSession: () => new Promise((resolve) => { answer = () => { resolve({ kind: "found" as const, session: located }); }; }),
    });
    patch({ workspaces: [workspace, elsewhere] });

    await sessions.selectSession(otherRow, { updateUrl: false });
    await settle();
    urlModes.length = 0;
    goElsewhere();
    answer();
    for (let turn = 0; turn < 6; turn++) await settle();

    expect({ selected: state().selectedSession?.id, target: state().sessionTarget, writes: urlModes }).toEqual({ selected: undefined, target: undefined, writes: [] });
  });

  /** Review ca45d6ed (both lanes' residual): a located session belongs to the machine it was looked for on. */
  it("opens nothing on another machine when the located session answers after a machine switch", async () => {
    const elsewhere = { ...workspace, id: "ws-elsewhere", path: "/elsewhere", label: "elsewhere", isMain: false };
    const located: SessionInfo = { ...otherRow, cwd: elsewhere.path };
    const readOn: (string | undefined)[] = [];
    let answer: () => void = () => undefined;
    const { sessions, state, patch } = await opened({
      messages: (session, _query, machineId) => {
        readOn.push(machineId);
        return session.id === otherRow.id && session.cwd === workspace.path ? Promise.reject(notFound()) : Promise.resolve(emptyPage);
      },
      locateSession: () => new Promise((resolve) => { answer = () => { resolve({ kind: "found" as const, session: located }); }; }),
    });
    patch({ workspaces: [workspace, elsewhere] });

    await sessions.selectSession(otherRow, { updateUrl: false });
    await settle();
    readOn.length = 0;
    patch({ selectedMachine: { id: "remote", name: "remote", kind: "remote", createdAt: "2026-07-27T10:00:00.000Z", updatedAt: "2026-07-27T10:00:00.000Z" } });
    answer();
    for (let turn = 0; turn < 6; turn++) await settle();

    expect({ selected: state().selectedSession?.id, target: state().sessionTarget, readOn }).toEqual({ selected: undefined, target: undefined, readOn: [] });
  });

  it("adds no entry when an open session its pick already wrote answers the code later", async () => {
    const { sessions, deleted, urlModes } = await opened();
    await sessions.selectSession(oldSession);
    await settle();
    urlModes.length = 0;

    deleted();
    await sessions.refreshSelectedSession();
    await settle();

    expect({ writes: urlModes.length > 0, pushes: urlModes.filter((mode) => mode === "push").length }).toEqual({ writes: true, pushes: 0 });
  });

  it("does the same when cancelling a tree summary answers the code", async () => {
    const { sessions, state, deleted, patch } = await opened();
    patch({ treeDialog: { nodes: [], activeLeafId: null, activePathIds: [] } });
    deleted();

    await sessions.abortTreeNavigation().catch(() => undefined);
    await settle();

    expect({ selected: state().selectedSession?.id, target: state().sessionTarget, notice: state().error }).toEqual({ selected: undefined, target: goneTarget, notice: "" });
  });

  it("asks the machine again when the first locate got no answer and the session, opened again, answers the code", async () => {
    let locates = 0;
    const { sessions, state, deleted } = await opened({ locateSession: () => { locates += 1; return locates === 1 ? Promise.reject(new TypeError("Failed to fetch")) : Promise.reject(notFound()); } });
    deleted();
    await sessions.refreshSelectedSession();
    await settle();

    await sessions.selectSession(oldSession, { updateUrl: false });
    await settle();

    expect({ locates, target: state().sessionTarget?.target }).toEqual({ locates: 2, target: { kind: "gone", sessionId: oldSession.id } });
  });

  it("asks the machine again when the session it located fails to open for another reason, then answers the code", async () => {
    let locates = 0;
    let phase: "open" | "server" | "gone" = "open";
    const elsewhere: SessionInfo = { ...oldSession, cwd: `${workspace.path}/packages/app` };
    const read = <T>(ref: { readonly cwd: string }, value: T, failsOnServer: boolean): Promise<T> => {
      if (phase === "open") return Promise.resolve(value);
      if (ref.cwd === workspace.path || phase === "gone") return Promise.reject(notFound());
      return failsOnServer ? Promise.reject(new HttpError("Internal error", 500, "local")) : Promise.resolve(value);
    };
    const { sessions, state } = await opened({
      messages: (ref) => read(ref, emptyPage, true),
      status: (ref) => read(ref, status(sessionLookupId(ref)), false),
      streamSnapshot: (ref) => read(ref, { seq: 0, partial: null }, false),
      locateSession: foundAtMost(3, () => elsewhere, () => { locates += 1; }),
    });
    phase = "server";
    await sessions.refreshSelectedSession();
    for (let turn = 0; turn < 20 && state().transcriptFailed === undefined; turn++) await settle();
    const serverFailureShown = { failed: state().transcriptFailed, cwd: state().selectedSession?.cwd };

    phase = "gone";
    await sessions.refreshSelectedSession();
    await settle();

    expect({ serverFailureShown, locates }).toEqual({ serverFailureShown: { failed: "Internal error", cwd: elsewhere.cwd }, locates: 2 });
  });

  it("says it could not load a picked session that answers the code when the page knows no workspace to send the reader back to", async () => {
    const { sessions, state, patch } = await opened({ messages: (session) => (session.id === otherRow.id ? Promise.reject(notFound()) : Promise.resolve(emptyPage)) });
    patch({ selectedWorkspace: undefined });

    await sessions.selectSession(otherRow, { updateUrl: false });
    await settle();

    expect({ selected: state().selectedSession?.id, failed: state().transcriptFailed, target: state().sessionTarget }).toEqual({ selected: otherRow.id, failed: "Session not found", target: undefined });
  });

  it("keeps the old words when the session is not in any workspace the page knows", async () => {
    const { sessions, state, deleted, patch } = await opened();
    patch({ selectedWorkspace: undefined });
    deleted();

    await sessions.refreshSelectedSession();
    await settle();

    expect({ selected: state().selectedSession?.id, target: state().sessionTarget, notice: state().error }).toEqual({ selected: oldSession.id, target: undefined, notice: "Session not found" });
  });

  it("keeps the open session and says so in a notice when a change of another row answers the code", async () => {
    const { sessions, state } = await opened({ runCommand: () => Promise.reject(notFound()) });

    await sessions.renameSession(otherRow, "renamed");
    await settle();

    expect({ selected: state().selectedSession?.id, target: state().sessionTarget, notice: state().error }).toEqual({ selected: oldSession.id, target: undefined, notice: "Session not found" });
  });

  it("changes nothing when the answer belongs to a session the reader already left", async () => {
    let answerStop: (error: unknown) => void = () => undefined;
    const { sessions, state } = await opened({ abort: () => new Promise((_resolve, reject) => { answerStop = reject; }) });
    const stopping = sessions.stopActiveWork();
    await sessions.selectSession(otherRow, { updateUrl: false });
    await settle();

    answerStop(notFound());
    await stopping;
    await settle();

    expect({ selected: state().selectedSession?.id, target: state().sessionTarget }).toEqual({ selected: otherRow.id, target: undefined });
  });
});
