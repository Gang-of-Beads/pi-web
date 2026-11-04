import type { FastifyInstance, FastifyReply } from "fastify";
import { parseProjectRenameRequest, PROJECT_RENAME_REQUEST_BODY_MAX_BYTES } from "../../../shared/projectRenameProtocol.js";
import { errorMessage } from "../../../shared/unknownValues.js";
import { ProjectRenameFailure, ProjectRenameRefusal, type ProjectRenameService } from "./projectRenameService.js";

/**
 * The session daemon's rename endpoints, reached through the web/API's proxy. The rename runs to
 * its end - done, or put back - even when the asking browser goes away, so the request's
 * disconnect does not cancel it.
 */
export function registerProjectRenameRoutes(app: FastifyInstance, renames: ProjectRenameService, prefix = "/project-renames"): void {
  app.get<{ Params: { projectId: string }; Querystring: { name?: string } }>(`${prefix}/projects/:projectId`, async (request, reply) => {
    try {
      return await renames.preview(request.params.projectId, request.query.name);
    } catch (error) {
      return renameFailed(reply, error);
    }
  });

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    `${prefix}/projects/:projectId`,
    { bodyLimit: PROJECT_RENAME_REQUEST_BODY_MAX_BYTES },
    async (request, reply) => {
      let name: string;
      try {
        name = parseProjectRenameRequest(request.body).name;
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }
      try {
        return await renames.rename(request.params.projectId, name);
      } catch (error) {
        return renameFailed(reply, error);
      }
    },
  );
}

function renameFailed(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ProjectRenameRefusal) return reply.code(error.statusCode).send({ error: error.message });
  if (error instanceof ProjectRenameFailure) return reply.code(500).send({ error: error.message });
  return reply.code(500).send({ error: errorMessage(error) });
}
