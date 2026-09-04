import type { FastifyInstance, FastifyReply } from "fastify";
import type { ProjectService } from "../../shared/projects/projectService.js";
import type { WorkspaceCatalog } from "../../shared/workspaces/workspaceCatalog.js";
import type { SessionDaemonRequestClient } from "../../shared/sessiondClient/sessionDaemonClient.js";
import { requestCancellation } from "../../shared/requestCancellation.js";
import { resolveWorkspaceContext } from "./workspaceContext.js";
import { sendWorkspaceRequestError } from "./workspaceRouteErrors.js";

/**
 * The browser-facing goal routes, kept at their published paths while the
 * reading and writing they do lives in the goals plugin.
 *
 * The workspace is still resolved here, because a client must never name a
 * directory the host has not vouched for; everything past that is the
 * plugin's, reached through its declared operations so there is one
 * implementation rather than one per process.
 */

/** Matches the convention the session-ref surfaces already apply to client-supplied cwds. */
const SESSION_CWD_MAX_LENGTH = 32 * 1024;

const GOALS_PLUGIN_ID = "goals";

export function registerGoalProxyRoutes(
  app: FastifyInstance,
  projects: Pick<ProjectService, "requireProject">,
  workspaces: Pick<WorkspaceCatalog, "resolve">,
  daemon: SessionDaemonRequestClient,
  prefix = "/api",
): void {
  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { sessionCwd?: string } }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/goals`,
    async (request, reply) => {
      const cancellation = requestCancellation(request, reply);
      try {
        const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
        const sessionCwd = request.query.sessionCwd?.slice(0, SESSION_CWD_MAX_LENGTH);
        const answer = await callGoals(daemon, "goals.read", {
          workspacePath: context.root,
          ...(sessionCwd === undefined ? {} : { sessionCwd }),
        }, cancellation.signal);
        return await reply.type("application/json; charset=utf-8").send(answer);
      } catch (error) {
        if (cancellation.signal.aborted) throw error;
        return await sendWorkspaceRequestError(reply, error, 400);
      } finally {
        cancellation.dispose();
      }
    },
  );

  app.post<{ Params: { projectId: string; workspaceId: string; goalId: string } }>(
    `${prefix}/projects/:projectId/workspaces/:workspaceId/goals/:goalId/archive`,
    async (request, reply) => {
      const cancellation = requestCancellation(request, reply);
      try {
        const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
        const answer = await callGoals(daemon, "goals.archive", {
          workspacePath: context.root,
          goalId: request.params.goalId,
        }, cancellation.signal);
        return await sendArchiveAnswer(reply, answer);
      } catch (error) {
        if (cancellation.signal.aborted) throw error;
        return await sendWorkspaceRequestError(reply, error, 400);
      } finally {
        cancellation.dispose();
      }
    },
  );
}

async function callGoals(
  daemon: SessionDaemonRequestClient,
  operation: string,
  input: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  const upstream = await daemon.request("POST", `/plugin-operations/${GOALS_PLUGIN_ID}/${operation}`, input, { signal });
  if (upstream.statusCode >= 400) throw new Error(refusalMessage(upstream.body, operation));
  return upstream.body === "" ? null : JSON.parse(upstream.body);
}

/**
 * A locked archive keeps its own status. Reporting it as an ordinary bad
 * request would tell the reader to fix their request when what they have to do
 * is wait for whoever holds the lock.
 */
async function sendArchiveAnswer(reply: FastifyReply, answer: unknown): Promise<FastifyReply> {
  if (isRecord(answer) && answer["refused"] === true) {
    const code = answer["code"];
    const message = answer["message"];
    return await reply.code(code === "locked" ? 409 : 400).send({ error: typeof message === "string" ? message : "The goal could not be archived", code });
  }
  return await reply.type("application/json; charset=utf-8").send(answer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function refusalMessage(body: string, operation: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const error = isRecord(parsed) ? parsed["error"] : undefined;
    if (typeof error === "string" && error !== "") return error;
  } catch {
    return `The goals plugin refused ${operation}`;
  }
  return `The goals plugin refused ${operation}`;
}
