import type { Project, SessionInfo, Workspace } from "../api";
import type { RealtimeEvent } from "../../../shared/apiTypes";
import { HttpError } from "../api/http";
import { UnexpectedBoardAnswer, type SessionBoardAnswer } from "../api/parsers";
import { sessionLocationVerdict } from "../sessionLocationVerdict";
import { mapWithLanes } from "./lanes";
import { classifyReadError } from "./readPhase";

/** How many of a machine's listings the board reads at once; the page keeps the rest of its six connections (object model §4.5). */
const BOARD_LANES = 2;

/**
 * Every session a machine holds, read from its listings (object model §1.5,
 * B48, B8).
 *
 * The board is many reads: the projects, each project's workspaces, and each
 * workspace's sessions. A workspace whose read failed used to become an empty
 * list, and the board then said the machine had fewer sessions - or "No
 * sessions yet." - than it had. A source that did not answer is kept here as
 * unknown, and the board says how much of it answered.
 */
export interface SessionBoard {
  readonly sessions: readonly SessionInfo[];
  readonly workspaces: readonly Workspace[];
  /** Sources that did not answer. */
  readonly unknownSources: readonly UnknownSource[];
  /** Pinned sessions no open project lists, such as one whose project was closed (B49). */
  readonly pinnedElsewhere?: readonly SessionInfo[];
}

/**
 * A source of the board that did not answer: a project's workspaces, a
 * workspace's sessions, or where a pinned session is when no open project lists
 * it (B49). An unanswered pin keeps the board partial, so it is asked again
 * rather than silently left out of Pinned.
 */
export type UnknownSource =
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "workspace"; readonly path: string }
  | { readonly kind: "pin"; readonly sessionId: string };

/**
 * A partial live board with the remembered rows of exactly the sources that did not answer
 * (owner, 2026-10-07: "先显示缓存+已经加载的"). A remembered session stays when its workspace
 * did not answer, or its project's workspaces did not; a remembered pin when the pin did not. A
 * source that answered said what it holds, so none of its remembered rows is kept. The unknown
 * sources stay unknown, so the board is still partial and still read again.
 */
export function boardFilledFromMemory(live: SessionBoard, remembered: SessionBoard | undefined): SessionBoard {
  if (remembered === undefined || live.unknownSources.length === 0) return live;
  const projectIds = new Set(live.unknownSources.flatMap((source) => (source.kind === "project" ? [source.projectId] : [])));
  const pinIds = new Set(live.unknownSources.flatMap((source) => (source.kind === "pin" ? [source.sessionId] : [])));
  const liveWorkspaceIds = new Set(live.workspaces.map((workspace) => workspace.id));
  const workspaces = remembered.workspaces.filter((workspace) => projectIds.has(workspace.projectId) && !liveWorkspaceIds.has(workspace.id));
  const paths = [...live.unknownSources.flatMap((source) => (source.kind === "workspace" ? [source.path] : [])), ...workspaces.map((workspace) => workspace.path)];
  const listed = new Set([...live.sessions, ...(live.pinnedElsewhere ?? [])].map((session) => session.id));
  const sessions = remembered.sessions.filter((session) => !listed.has(session.id) && paths.some((path) => sessionLocationVerdict(session.cwd, path) === "described"));
  const pinned = (remembered.pinnedElsewhere ?? []).filter((session) => pinIds.has(session.id) && !listed.has(session.id));
  if (sessions.length === 0 && workspaces.length === 0 && pinned.length === 0) return live;
  const pinnedElsewhere = [...(live.pinnedElsewhere ?? []), ...pinned];
  return {
    ...live,
    sessions: [...live.sessions, ...sessions].sort(newestFirst),
    workspaces: [...live.workspaces, ...workspaces],
    ...(pinnedElsewhere.length === 0 ? {} : { pinnedElsewhere }),
  };
}

/** How much of a board has answered (state-diagram B48, the session board). */
export type BoardAnswer = "none" | "partial" | "complete";

export interface SessionBoardSources {
  /** The whole board in one read, or "unsupported" when the machine predates it (P4 slice a). */
  board?(): Promise<SessionBoardAnswer | "unsupported">;
  projects(): Promise<readonly Project[]>;
  workspaces(projectId: string): Promise<readonly Workspace[]>;
  sessions(workspacePath: string): Promise<readonly SessionInfo[]>;
  /** Where a pinned session is, when the board could not say (B49): the session, gone, or a throw when there was no answer. */
  locatePin?(sessionId: string): Promise<SessionInfo | "gone">;
}

type Listed<T> = { readonly listed: readonly T[] } | { readonly unknown: UnknownSource };

/**
 * Read the board. It rejects when the projects did not answer, which is a miss
 * of the whole board, and when any source states a refusal (401, 403), which is
 * a fact that ends retrying; a later source that does not answer is kept
 * unknown.
 */
export async function readSessionBoard(sources: SessionBoardSources): Promise<SessionBoard> {
  const answer = sources.board === undefined ? undefined : await sources.board();
  if (answer !== undefined && answer !== "unsupported") return boardFromAnswer(answer);
  const projects = await sources.projects();
  return readSources(sources, projects.map((project) => project.id), [], { sessions: [], workspaces: [], unknownSources: [] });
}

/**
 * Ask again only the sources a partial board is missing, and keep what it
 * already has. On 8504 each sessions listing is a whole-store scan on the
 * daemon, so filling one gap must not read every workspace again.
 */
export async function completeSessionBoard(board: SessionBoard, sources: SessionBoardSources): Promise<SessionBoard> {
  const projectIds = board.unknownSources.flatMap((source) => (source.kind === "project" ? [source.projectId] : []));
  const workspacePaths = board.unknownSources.flatMap((source) => (source.kind === "workspace" ? [source.path] : []));
  const pinIds = board.unknownSources.flatMap((source) => (source.kind === "pin" ? [source.sessionId] : []));
  const refilled = await readSources(sources, projectIds, workspacePaths, { ...board, unknownSources: [] });
  return pinIds.length === 0 ? refilled : locatePins(refilled, pinIds, sources);
}

async function locatePins(board: SessionBoard, pinIds: readonly string[], sources: SessionBoardSources): Promise<SessionBoard> {
  const answers = await mapWithLanes(pinIds, BOARD_LANES, async (sessionId): Promise<{ sessionId: string; found?: SessionInfo; gone?: true }> => {
    if (sources.locatePin === undefined) return { sessionId };
    try {
      const located = await sources.locatePin(sessionId);
      return located === "gone" ? { sessionId, gone: true } : { sessionId, found: located };
    } catch (error) {
      if (classifyReadError(error).kind === "fact") throw error;
      return { sessionId };
    }
  });
  const listed = new Set(board.sessions.map((session) => session.id));
  const found = answers.flatMap((answer) => (answer.found !== undefined && !listed.has(answer.found.id) ? [answer.found] : []));
  const unknownPins = answers.flatMap((answer): UnknownSource[] => (answer.found === undefined && answer.gone === undefined ? [{ kind: "pin", sessionId: answer.sessionId }] : []));
  const pinnedElsewhere = dedupeById([...(board.pinnedElsewhere ?? []), ...found]);
  return { ...board, unknownSources: [...board.unknownSources, ...unknownPins], ...(pinnedElsewhere.length === 0 ? {} : { pinnedElsewhere }) };
}

async function readSources(sources: SessionBoardSources, projectIds: readonly string[], workspacePaths: readonly string[], known: SessionBoard): Promise<SessionBoard> {
  const workspaceLists = await mapWithLanes(projectIds, BOARD_LANES, (projectId) => listed(sources.workspaces(projectId), { kind: "project", projectId }));
  const listedWorkspaces = workspaceLists.flatMap((entry) => ("listed" in entry ? entry.listed : []));
  const paths = [...new Set([...listedWorkspaces.map((workspace) => workspace.path), ...workspacePaths])];
  const sessionLists = await mapWithLanes(paths, BOARD_LANES, (path) => listed(sources.sessions(path), { kind: "workspace", path }));
  return assembleBoard(known, workspaceLists, sessionLists);
}

function boardFromAnswer(answer: SessionBoardAnswer): SessionBoard {
  const workspaceLists = answer.projects.map((entry): Listed<Workspace> => ("workspaces" in entry ? { listed: entry.workspaces } : { unknown: { kind: "project", projectId: entry.projectId } }));
  const sessionLists = answer.listings.map((entry): Listed<SessionInfo> => ("sessions" in entry ? { listed: entry.sessions } : { unknown: { kind: "workspace", path: entry.cwd } }));
  const board = assembleBoard({ sessions: [], workspaces: [], unknownSources: [] }, workspaceLists, sessionLists);
  const listed = new Set(board.sessions.map((session) => session.id));
  const pinnedElsewhere = (answer.pinned ?? []).flatMap((entry) => ("session" in entry && !listed.has(entry.session.id) ? [entry.session] : []));
  const unknownPins = (answer.pinned ?? []).flatMap((entry): UnknownSource[] => ("unknown" in entry ? [{ kind: "pin", sessionId: entry.sessionId }] : []));
  return { ...board, unknownSources: [...board.unknownSources, ...unknownPins], ...(pinnedElsewhere.length === 0 ? {} : { pinnedElsewhere }) };
}

function assembleBoard(known: SessionBoard, workspaceLists: readonly Listed<Workspace>[], sessionLists: readonly Listed<SessionInfo>[]): SessionBoard {
  const listedWorkspaces = workspaceLists.flatMap((entry) => ("listed" in entry ? entry.listed : []));
  const sessions = dedupeById([...known.sessions, ...sessionLists.flatMap((entry) => ("listed" in entry ? entry.listed : []))])
    .sort(newestFirst);
  const unknownSources = [...known.unknownSources, ...[...workspaceLists, ...sessionLists].flatMap((entry) => ("unknown" in entry ? [entry.unknown] : []))];
  const listed = new Set(sessions.map((session) => session.id));
  const pinnedElsewhere = (known.pinnedElsewhere ?? []).filter((session) => !listed.has(session.id));
  return { sessions, workspaces: dedupeById([...known.workspaces, ...listedWorkspaces]), unknownSources, ...(pinnedElsewhere.length === 0 ? {} : { pinnedElsewhere }) };
}

/** Whether a failed board read means the machine has no such route, or is a read that failed. */
export type BoardRouteVerdict = "unsupported" | "error";

/**
 * A machine whose web process predates the board answers its path with 404,
 * or with the app shell, which is not JSON; the route itself never answers
 * 404. Anything else is a read that failed, retried as any read is. A
 * gateway's 404 for a machine it does not know yet, and a sign-in page from a
 * proxy in front of the machine, read the same way: the board is then read
 * source by source until the page reloads, which costs requests, never rows.
 */
export function boardRouteVerdict(error: unknown): BoardRouteVerdict {
  if (error instanceof HttpError) return error.status === 404 ? "unsupported" : "error";
  return error instanceof SyntaxError || error instanceof UnexpectedBoardAnswer ? "unsupported" : "error";
}

/**
 * Ask a machine for its board in one read until it shows it has no such
 * route, then stop asking for the life of the page: the board is then read
 * source by source. A remote machine that upgrades is asked again on reload.
 */
export function oneReadBoard(read: () => Promise<SessionBoardAnswer>): () => Promise<SessionBoardAnswer | "unsupported"> {
  let missing = false;
  return async () => {
    if (missing) return "unsupported";
    try {
      return await read();
    } catch (error) {
      if (boardRouteVerdict(error) === "error") throw error;
      missing = true;
      return "unsupported";
    }
  };
}

/** What a machine announces about its sessions that the board can take without a read (state-diagram D5). */
export type SessionBoardEvent =
  | { readonly type: "session.name"; readonly sessionId: string; readonly name?: string | undefined }
  | { readonly type: "session.created"; readonly session: SessionInfo }
  | { readonly type: "session.activity"; readonly sessionId: string; readonly at: string };

/**
 * The board's share of a frame on a machine's socket: a rename, a new session, or a status that
 * says when its session last changed (B28). Anything else is not the board's.
 */
export function boardEventOf(event: RealtimeEvent): SessionBoardEvent | undefined {
  if (event.type === "session.name" || event.type === "session.created") return event;
  if (event.type !== "status.update" || event.status.lastActivityAt === undefined) return undefined;
  return { type: "session.activity", sessionId: event.status.sessionId, at: event.status.lastActivityAt };
}

/**
 * The board with an announced change applied. A rename renames the session
 * wherever the board lists it; a new session joins the board when one of its
 * listed workspaces holds its folder. Each is a set, so applying it again over
 * a read that already has it changes nothing. A session the board already
 * lists keeps its row: the announcement is the session as it was created, and
 * a read that lists it holds it as it is now (written, titled, counted). A
 * session in no listed workspace is not this board's to add. A session's
 * newer activity moves its row, and an older one, from a frame that waited
 * behind a read, changes nothing.
 */
export function boardWithEvent(board: SessionBoard, event: SessionBoardEvent): SessionBoard {
  if (event.type === "session.name") return withEachListed(board, event.sessionId, (session) => withName(session, event.name));
  if (event.type === "session.activity") return withActivity(board, event.sessionId, event.at);
  const listed = board.sessions.some((session) => session.id === event.session.id);
  const held = board.workspaces.some((workspace) => sessionLocationVerdict(event.session.cwd, workspace.path) === "described");
  if (listed || !held) return board;
  return { ...board, sessions: [event.session, ...board.sessions].sort(newestFirst) };
}

function withActivity(board: SessionBoard, sessionId: string, at: string): SessionBoard {
  const atMs = Date.parse(at);
  const listed = [...board.sessions, ...(board.pinnedElsewhere ?? [])].find((session) => session.id === sessionId);
  if (listed === undefined || Number.isNaN(atMs) || atMs <= Date.parse(listed.modified)) return board;
  const moved = withEachListed(board, sessionId, (session) => ({ ...session, modified: at }));
  return { ...moved, sessions: [...moved.sessions].sort(newestFirst) };
}

function withEachListed(board: SessionBoard, sessionId: string, change: (session: SessionInfo) => SessionInfo): SessionBoard {
  const each = (sessions: readonly SessionInfo[]) => sessions.map((session) => (session.id === sessionId ? change(session) : session));
  return { ...board, sessions: each(board.sessions), ...(board.pinnedElsewhere === undefined ? {} : { pinnedElsewhere: each(board.pinnedElsewhere) }) };
}

function newestFirst(left: SessionInfo, right: SessionInfo): number {
  return Date.parse(right.modified) - Date.parse(left.modified);
}

function withName(session: SessionInfo, name: string | undefined): SessionInfo {
  if (name !== undefined && name !== "") return { ...session, name };
  const unnamed = { ...session };
  delete unnamed.name;
  return unnamed;
}

export function boardAnswer(board: SessionBoard | undefined): BoardAnswer {
  if (board === undefined) return "none";
  return board.unknownSources.length === 0 ? "complete" : "partial";
}

async function listed<T>(read: Promise<readonly T[]>, source: UnknownSource): Promise<Listed<T>> {
  try {
    return { listed: await read };
  } catch (error) {
    if (classifyReadError(error).kind === "fact") throw error;
    return { unknown: source };
  }
}

/** The first of each id, in order. */
export function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
