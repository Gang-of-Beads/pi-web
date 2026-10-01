import type { FastifyInstance } from "fastify";
import { SESSION_NOT_FOUND_CODE, type Project, type WorkspaceProviderResolution } from "../../shared/apiTypes.js";
import type { SessionDaemonRequestClient } from "../shared/sessiondClient/sessionDaemonClient.js";
import { SESSION_PROXY_DEADLINE_MS } from "./boundedDaemonRequest.js";

/** Where the board comes from: this web process's projects and workspaces, and its daemon's listings. */
export interface SessionBoardSources {
  projects(): Promise<readonly Project[]>;
  workspaces(project: Project): Promise<WorkspaceProviderResolution>;
  /** The daemon's listing for one workspace path, as it answered it. */
  sessions(cwd: string): Promise<unknown>;
  /** The machine's pins, and where a pinned session is when no open project lists it (B49). */
  pinned?: PinnedSessionSource;
}

export interface PinnedSessionSource {
  ids(): Promise<readonly string[]>;
  /** The session as the daemon answered it, or gone when the daemon says no store holds it. */
  locate(sessionId: string): Promise<LocatedSession>;
  /** Unpin a session the daemon answered gone. */
  forget(sessionId: string): Promise<void>;
}

export type LocatedSession = { readonly session: unknown } | { readonly gone: true };

/**
 * How long the board waits for its sources, from the moment it is asked. The
 * page and the gateway give up on a request at 30 s; a source still unanswered
 * at the budget is answered as unknown, so a slow provider or a stalled
 * listing leaves a partial board instead of turning the whole board into a
 * miss.
 */
export const SESSION_BOARD_BUDGET_MS = 20_000;

type ProjectAnswer = { readonly projectId: string; readonly resolution: WorkspaceProviderResolution } | { readonly projectId: string; readonly unknown: true };
type ListingAnswer = { readonly cwd: string; readonly sessions: unknown } | { readonly cwd: string; readonly unknown: true };
type PinnedAnswer = { readonly sessionId: string } & (LocatedSession | { readonly unknown: true });

/**
 * A machine's session board in one answer (P4 slice a; object model §4.4, state-diagram D5).
 *
 * The page used to read the board itself: the projects, then each project's
 * workspaces, then each workspace's sessions - 1 + P + W requests through two
 * lanes of the page's six connections. This web process owns the projects and
 * the workspaces (with their effective config) and reaches its daemon over a
 * local socket, so it answers the whole board at once. Every listing is asked
 * at the same time, so the daemon's scanner shares one pass over the store
 * between them. A source that did not answer stays unknown (B48): a project
 * whose provider failed, or a workspace whose listing failed. Each answer is
 * passed on raw; the page parses it as it parses the per-source reads. A
 * projects read that fails is a miss of the whole board.
 *
 * Pins outlive projects (B49): a pinned session that no answered listing holds
 * - its project was closed - is located on the daemon and answered with the
 * board, as the session, gone, or unknown when it did not answer in time. When
 * the pins cannot be read the answer carries no pinned entries at all, which
 * says nothing about pins rather than that there are none.
 *
 * A deleted session is no longer pinned (owner, 2026-10-01: "删掉了自动就没有了").
 * A pin the daemon answers gone is unpinned here, whoever deleted it: PI WEB, the
 * pi CLI, or a hand on the disk. Its locate searches every store, archived ones
 * included, so gone is an answer and not an absence. A pin that did not answer
 * is kept and asked again at the next board.
 */
export function registerSessionBoardRoutes(app: FastifyInstance, sources: SessionBoardSources, prefix = "/api", budgetMs = SESSION_BOARD_BUDGET_MS): void {
  app.get(`${prefix}/session-board`, async (_request, reply) => {
    const deadlineAt = Date.now() + budgetMs;
    try {
      const projects = await sources.projects();
      const projectAnswers = await Promise.all(projects.map((project) => projectAnswer(sources, project, deadlineAt)));
      const paths = [...new Set(projectAnswers.flatMap((answer) => ("resolution" in answer ? answer.resolution.workspaces.map((workspace) => workspace.path) : [])))];
      const listings = await Promise.all(paths.map((cwd) => listingAnswer(sources, cwd, deadlineAt)));
      const pinned = sources.pinned === undefined ? undefined : await pinnedAnswers(sources.pinned, listedSessionIds(listings), deadlineAt);
      return pinned === undefined ? { projects: projectAnswers, listings } : { projects: projectAnswers, listings, pinned };
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

/**
 * One workspace's listing, as the daemon answers it to the session proxy. It
 * has the proxy's deadline, so a listing that never answers leaves its
 * workspace unknown instead of holding the whole board past the page's own.
 */
export function daemonSessionListing(daemon: SessionDaemonRequestClient, deadlineMs = SESSION_PROXY_DEADLINE_MS): (cwd: string) => Promise<unknown> {
  return async (cwd) => {
    const answer = await daemon.request("GET", `/sessions?cwd=${encodeURIComponent(cwd)}`, undefined, { signal: AbortSignal.timeout(deadlineMs) });
    if (answer.statusCode < 200 || answer.statusCode >= 300) throw new Error(`The session daemon answered the listing with ${String(answer.statusCode)}`);
    const listing: unknown = JSON.parse(answer.body);
    return listing;
  };
}

/**
 * Where a pinned session is, from the daemon's machine-wide locate. Its cwd is
 * only where the daemon starts looking before it scans the whole store, so the
 * machine's home directory serves. A missing session is the typed not-found
 * code; any other answer, such as an older daemon without the route, is not an
 * answer.
 */
export function daemonSessionLocate(daemon: SessionDaemonRequestClient, startDir: string, deadlineMs = SESSION_PROXY_DEADLINE_MS): (sessionId: string) => Promise<LocatedSession> {
  return async (sessionId) => {
    const answer = await daemon.request("GET", `/sessions/${encodeURIComponent(sessionId)}/locate?cwd=${encodeURIComponent(startDir)}`, undefined, { signal: AbortSignal.timeout(deadlineMs) });
    const body: unknown = answer.body === "" ? undefined : JSON.parse(answer.body);
    if (answer.statusCode >= 200 && answer.statusCode < 300) return { session: body };
    if (answer.statusCode === 404 && typeof body === "object" && body !== null && Reflect.get(body, "code") === SESSION_NOT_FOUND_CODE) return { gone: true };
    throw new Error(`The session daemon answered the locate with ${String(answer.statusCode)}`);
  };
}

async function pinnedAnswers(pinned: PinnedSessionSource, listed: ReadonlySet<string>, deadlineAt: number): Promise<PinnedAnswer[] | undefined> {
  let ids: readonly string[];
  try {
    ids = await beforeDeadline(pinned.ids(), deadlineAt);
  } catch {
    return undefined;
  }
  return Promise.all(ids.filter((sessionId) => !listed.has(sessionId)).map(async (sessionId): Promise<PinnedAnswer> => {
    let located: LocatedSession;
    try {
      located = await beforeDeadline(pinned.locate(sessionId), deadlineAt);
    } catch {
      return { sessionId, unknown: true };
    }
    if ("gone" in located) await pinned.forget(sessionId).catch((error: unknown) => { console.warn(`[pins] could not unpin deleted session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`); });
    return { sessionId, ...located };
  }));
}

function listedSessionIds(listings: readonly ListingAnswer[]): Set<string> {
  const ids = new Set<string>();
  for (const listing of listings) {
    if (!("sessions" in listing) || !Array.isArray(listing.sessions)) continue;
    for (const entry of listing.sessions) {
      const id: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "id") : undefined;
      if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}

async function projectAnswer(sources: SessionBoardSources, project: Project, deadlineAt: number): Promise<ProjectAnswer> {
  try {
    return { projectId: project.id, resolution: await beforeDeadline(sources.workspaces(project), deadlineAt) };
  } catch {
    return { projectId: project.id, unknown: true };
  }
}

async function listingAnswer(sources: SessionBoardSources, cwd: string, deadlineAt: number): Promise<ListingAnswer> {
  try {
    return { cwd, sessions: await beforeDeadline(sources.sessions(cwd), deadlineAt) };
  } catch {
    return { cwd, unknown: true };
  }
}

function beforeDeadline<T>(work: Promise<T>, deadlineAt: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error("The board's budget ran out before this source answered")); }, Math.max(0, deadlineAt - Date.now()));
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}
