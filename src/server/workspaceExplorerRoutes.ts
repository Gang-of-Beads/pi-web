import type { FastifyInstance } from "fastify";
import type { WriteWorkspaceFileOptions } from "../shared/apiTypes.js";
import type { PiWebConfigService } from "./configRoutes.js";
import type { ProjectService } from "./projects/projectService.js";
import { deleteWorkspaceFile, moveWorkspaceFile, readWorkspaceFile, writeWorkspaceFile } from "./workspaces/fileContentService.js";
import { isAbsoluteishFileSuggestionQuery, listFileSuggestions, listPathSuggestions } from "./workspaces/fileSuggestions.js";
import { listWorkspaceTree } from "./workspaces/fileTreeService.js";
import { readWorkspaceFilePreview } from "./workspaces/filePreviewService.js";
import { workspaceFilePreviewResponsePolicy } from "./workspaces/filePreviewResponsePolicy.js";
import { applyWorkspaceFilePreviewErrorResponsePolicy } from "./workspaces/filePreviewResponseHeaders.js";
import { readWorkspaceGoals } from "./goals/goalStore.js";
import { archiveWorkspaceGoal, GoalArchiveError } from "./goals/goalArchive.js";
import { resolveWorkspaceContext } from "./workspaces/workspaceContext.js";
import { pathAccessForWorkspaceContext } from "./workspaces/effectivePathAccess.js";
import type { WorkspaceCatalog } from "./workspaces/workspaceCatalog.js";
import { sendWorkspaceRequestError } from "./workspaces/workspaceRouteErrors.js";

export interface WorkspaceExplorerRouteOptions {
  config?: Pick<PiWebConfigService, "read">;
}

/** Matches the convention the session-ref surfaces already apply to client-supplied cwds. */
const SESSION_CWD_MAX_LENGTH = 32 * 1024;

export function registerWorkspaceExplorerRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceCatalog, prefix = "/api", options: WorkspaceExplorerRouteOptions = {}): void {
  registerWorkspaceFileContentParsers(app);

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/tree`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await listWorkspaceTree(context.root, request.query.path, await pathAccessForWorkspaceContext(context, options.config));
    } catch (error) {
      return sendWorkspaceRequestError(reply, error, 400);
    }
  });

  // Goals are read straight from the workspace's `.pi/goals/` directory rather
  // than through a session: the records outlive any one session, and several
  // sessions of the same workspace share the directory. The focused session's
  // cwd rides along because the extension records beside it, and that cwd can
  // diverge from the workspace root - a divergent read covers both.
  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { sessionCwd?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/goals`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      const rawSessionCwd = request.query.sessionCwd?.slice(0, SESSION_CWD_MAX_LENGTH);
      return await readWorkspaceGoals(context.root, rawSessionCwd === undefined ? {} : { sessionCwd: rawSessionCwd });
    } catch (error) {
      return sendWorkspaceRequestError(reply, error, 400);
    }
  });

  /**
   * Archiving is the one write pi-web makes to goal state, and only because a
   * paused goal has no other way out of the panel: the extension's own clear
   * command refuses without a confirmable UI, which a web session has not got.
   * The protocol it follows is the extension's (see docs/pi-goal-integration.md).
   */
  app.post<{ Params: { projectId: string; workspaceId: string; goalId: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/goals/:goalId/archive`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await archiveWorkspaceGoal(context.root, request.params.goalId);
    } catch (error) {
      if (error instanceof GoalArchiveError) return reply.code(error.code === "locked" ? 409 : 400).send({ error: error.message, code: error.code });
      return sendWorkspaceRequestError(reply, error, 400);
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await readWorkspaceFile(context.root, request.query.path, await pathAccessForWorkspaceContext(context, options.config));
    } catch (error) {
      return sendWorkspaceRequestError(reply, error, 400);
    }
  });

  app.put<{ Params: { projectId: string; workspaceId: string }; Body: Buffer; Querystring: { path?: string; createDirs?: string; overwrite?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      const writeOptions: WriteWorkspaceFileOptions = {
        createDirs: request.query.createDirs !== "false",
        overwrite: request.query.overwrite !== "false",
      };
      return await writeWorkspaceFile(context.root, request.query.path, request.body, writeOptions);
    } catch (error) {
      return sendWorkspaceRequestError(reply, error, 400);
    }
  });

  app.delete<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await deleteWorkspaceFile(context.root, request.query.path);
    } catch (error) {
      return sendWorkspaceRequestError(reply, error, 400);
    }
  });

  app.post<{ Params: { projectId: string; workspaceId: string }; Querystring: { fromPath?: string; toPath?: string; createDirs?: string; overwrite?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file/move`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await moveWorkspaceFile(context.root, request.query.fromPath, request.query.toPath, {
        createDirs: request.query.createDirs !== "false",
        overwrite: request.query.overwrite === "true",
      });
    } catch (error) {
      return sendWorkspaceRequestError(reply, error, 400);
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string; download?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/file/preview`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      const download = request.query.download === "1" || request.query.download === "true";
      const preview = await readWorkspaceFilePreview(context.root, request.query.path, await pathAccessForWorkspaceContext(context, options.config), { download });
      const policy = workspaceFilePreviewResponsePolicy(preview.path, { download });
      return await reply
        .header("Content-Type", policy.contentType)
        .header("Cache-Control", "private, max-age=3600")
        .header("Content-Length", String(preview.size))
        .header("Content-Disposition", policy.contentDisposition)
        .header("Content-Security-Policy", policy.contentSecurityPolicy)
        .header("Last-Modified", new Date(preview.modifiedAt).toUTCString())
        .header("X-Content-Type-Options", policy.contentTypeOptions)
        .send(preview.body);
    } catch (error) {
      applyWorkspaceFilePreviewErrorResponsePolicy(reply);
      return sendWorkspaceRequestError(reply, error, 400);
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { q?: string; kind?: "tracked" | "untracked" | "other"; mode?: "file" | "path"; scope?: "tracked" | "all" } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/files`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      const query = request.query.q ?? "";
      const pathAccess = isAbsoluteishFileSuggestionQuery(query) ? await pathAccessForWorkspaceContext(context, options.config) : undefined;
      if (request.query.mode === "path") return await listPathSuggestions(context.root, query, pathAccess);
      return await listFileSuggestions(context.root, query, { kind: request.query.kind, scope: request.query.scope, pathAccess });
    } catch (error) {
      return sendWorkspaceRequestError(reply, error, 400);
    }
  });
}

function registerWorkspaceFileContentParsers(app: FastifyInstance): void {
  // Fastify's default parser only handles JSON; workspace file writes need to
  // accept text and arbitrary binary payloads. This route module is registered
  // for both local aliases, so parser registration must tolerate repeats.
  try { app.addContentTypeParser("text/plain", { parseAs: "string" }, (_request, body, done) => { done(null, Buffer.from(body)); }); } catch { /* already registered */ }
  try { app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => { done(null, body); }); } catch { /* already registered */ }
  try { app.addContentTypeParser(/^([a-z]+\/[a-z0-9.+-]+)$/u, { parseAs: "buffer" }, (_request, body, done) => { done(null, body); }); } catch { /* already registered */ }
}
