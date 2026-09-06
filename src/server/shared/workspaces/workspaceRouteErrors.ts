import type { FastifyReply } from "fastify";
import { WorkspaceCatalogRequestError, workspaceCatalogHttpStatus } from "./workspaceCatalog.js";

/**
 * Identity misses answer the routes' 400 shape through the plugin's own
 * undefined handling; availability failures (daemon down, protocol) stay
 * exceptional so they never read as "no such workspace".
 */
export function isWorkspaceIdentityMiss(error: unknown): boolean {
  if (error instanceof WorkspaceCatalogRequestError) return error.statusCode === 404;
  const message = error instanceof Error ? error.message : "";
  return message === "Project not found" || message === "Workspace not found";
}

export function sendWorkspaceRequestError(
  reply: FastifyReply,
  error: unknown,
  fallbackStatus: number,
): FastifyReply {
  return reply.code(workspaceCatalogHttpStatus(error, fallbackStatus)).send({
    error: error instanceof Error ? error.message : String(error),
  });
}
