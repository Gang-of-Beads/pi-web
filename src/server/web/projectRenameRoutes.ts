import type { FastifyInstance, FastifyReply } from "fastify";
import { parseProjectRenameRequest, PROJECT_RENAME_DAEMON_TIMEOUT_MS, PROJECT_RENAME_REQUEST_BODY_MAX_BYTES } from "../../shared/projectRenameProtocol.js";
import { errorMessage } from "../../shared/unknownValues.js";
import { SessionDaemonClient } from "../shared/sessiondClient/sessionDaemonClient.js";
import { daemonTransport } from "../shared/transportFailure.js";
import type { SessionProxyDaemon } from "./sessionProxyRoutes.js";

/**
 * Browser-facing adapter for renaming a project. The session daemon owns the rename: it holds the
 * sessions and shells that must not be working, and the records that name the folder.
 */
export function registerProjectRenameRoutes(
  app: FastifyInstance,
  daemon: SessionProxyDaemon = new SessionDaemonClient(),
  prefix = "/api",
): void {
  app.get<{ Params: { projectId: string }; Querystring: { name?: string } }>(`${prefix}/projects/:projectId/rename`, async (request, reply) => {
    const query = request.query.name === undefined ? "" : `?${new URLSearchParams({ name: request.query.name }).toString()}`;
    return proxy(reply, () => daemon.request("GET", `${daemonPath(request.params.projectId)}${query}`));
  });

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    `${prefix}/projects/:projectId/rename`,
    { bodyLimit: PROJECT_RENAME_REQUEST_BODY_MAX_BYTES },
    async (request, reply) => {
      let body: ReturnType<typeof parseProjectRenameRequest>;
      try {
        body = parseProjectRenameRequest(request.body);
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }
      return proxy(reply, () => daemon.request("POST", daemonPath(request.params.projectId), body, { signal: AbortSignal.timeout(PROJECT_RENAME_DAEMON_TIMEOUT_MS) }));
    },
  );
}

function daemonPath(projectId: string): string {
  return `/project-renames/projects/${encodeURIComponent(projectId)}`;
}

async function proxy(
  reply: FastifyReply,
  send: () => Promise<{ statusCode: number; headers: Record<string, string>; body: string }>,
): Promise<unknown> {
  let upstream: { statusCode: number; headers: Record<string, string>; body: string };
  try {
    upstream = await send();
  } catch (error) {
    return reply.code(502).send({ error: `Session daemon unavailable: ${errorMessage(error)}`, ...daemonTransport(error) });
  }
  reply.code(upstream.statusCode);
  if (upstream.body === "") return undefined;
  try {
    const value: unknown = JSON.parse(upstream.body);
    return value;
  } catch (error) {
    return reply.code(502).send({ error: `Invalid session daemon rename response: ${errorMessage(error)}` });
  }
}
