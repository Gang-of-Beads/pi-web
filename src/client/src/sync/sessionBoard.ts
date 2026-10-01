import type { Project, SessionInfo, Workspace } from "../api";
import { HttpError } from "../api/http";
import { UnexpectedBoardAnswer, type SessionBoardAnswer } from "../api/parsers";
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
}

/** A source of the board that did not answer: a project's workspaces, or a workspace's sessions. */
export type UnknownSource = { readonly kind: "project"; readonly projectId: string } | { readonly kind: "workspace"; readonly path: string };

/** How much of a board has answered (state-diagram B48, the session board). */
export type BoardAnswer = "none" | "partial" | "complete";

export interface SessionBoardSources {
  /** The whole board in one read, or "unsupported" when the machine predates it (P4 slice a). */
  board?(): Promise<SessionBoardAnswer | "unsupported">;
  projects(): Promise<readonly Project[]>;
  workspaces(projectId: string): Promise<readonly Workspace[]>;
  sessions(workspacePath: string): Promise<readonly SessionInfo[]>;
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
export function completeSessionBoard(board: SessionBoard, sources: SessionBoardSources): Promise<SessionBoard> {
  const projectIds = board.unknownSources.flatMap((source) => (source.kind === "project" ? [source.projectId] : []));
  const workspacePaths = board.unknownSources.flatMap((source) => (source.kind === "workspace" ? [source.path] : []));
  return readSources(sources, projectIds, workspacePaths, { ...board, unknownSources: [] });
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
  return assembleBoard({ sessions: [], workspaces: [], unknownSources: [] }, workspaceLists, sessionLists);
}

function assembleBoard(known: SessionBoard, workspaceLists: readonly Listed<Workspace>[], sessionLists: readonly Listed<SessionInfo>[]): SessionBoard {
  const listedWorkspaces = workspaceLists.flatMap((entry) => ("listed" in entry ? entry.listed : []));
  const sessions = dedupeById([...known.sessions, ...sessionLists.flatMap((entry) => ("listed" in entry ? entry.listed : []))])
    .sort((left, right) => Date.parse(right.modified) - Date.parse(left.modified));
  const unknownSources = [...known.unknownSources, ...[...workspaceLists, ...sessionLists].flatMap((entry) => ("unknown" in entry ? [entry.unknown] : []))];
  return { sessions, workspaces: dedupeById([...known.workspaces, ...listedWorkspaces]), unknownSources };
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

function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
