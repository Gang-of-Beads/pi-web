import type { FastifyInstance } from "fastify";
import type { Project, WorkspaceProviderResolution } from "../../shared/apiTypes.js";
import type { SessionDaemonRequestClient } from "../shared/sessiondClient/sessionDaemonClient.js";
import { SESSION_PROXY_DEADLINE_MS } from "./boundedDaemonRequest.js";

/** Where the board comes from: this web process's projects and workspaces, and its daemon's listings. */
export interface SessionBoardSources {
  projects(): Promise<readonly Project[]>;
  workspaces(project: Project): Promise<WorkspaceProviderResolution>;
  /** The daemon's listing for one workspace path, as it answered it. */
  sessions(cwd: string): Promise<unknown>;
}

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
 */
export function registerSessionBoardRoutes(app: FastifyInstance, sources: SessionBoardSources, prefix = "/api", budgetMs = SESSION_BOARD_BUDGET_MS): void {
  app.get(`${prefix}/session-board`, async (_request, reply) => {
    const deadlineAt = Date.now() + budgetMs;
    try {
      const projects = await sources.projects();
      const projectAnswers = await Promise.all(projects.map((project) => projectAnswer(sources, project, deadlineAt)));
      const paths = [...new Set(projectAnswers.flatMap((answer) => ("resolution" in answer ? answer.resolution.workspaces.map((workspace) => workspace.path) : [])))];
      const listings = await Promise.all(paths.map((cwd) => listingAnswer(sources, cwd, deadlineAt)));
      return { projects: projectAnswers, listings };
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
