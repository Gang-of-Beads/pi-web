import type {
  DeleteWorkspaceFileResponse,
  FileTreeResponse,
  MoveWorkspaceFileResponse,
  WriteWorkspaceFileResponse,
} from "@gang-of-beads/pi-web/plugin-api";
import type {
  PluginPathAccessConfig,
  ServerPluginRouteContribution,
  WorkspacePathResolution,
  PiWebServerPlugin,
  ServerPluginActivationContext,
  ServerPluginReply,
} from "@gang-of-beads/pi-web/server-plugin-api";
import { deleteWorkspaceFile, moveWorkspaceFile, readWorkspaceFile, writeWorkspaceFile } from "./server/fileContentService.js";
import { isAbsoluteishFileSuggestionQuery, listFileSuggestions, listPathSuggestions } from "./server/fileSuggestions.js";
import { listWorkspaceTree } from "./server/fileTreeService.js";
import { readWorkspaceFilePreview } from "./server/filePreviewService.js";
import { workspaceFilePreviewResponsePolicy } from "./server/filePreviewResponsePolicy.js";
import { applyWorkspaceFilePreviewErrorResponsePolicy } from "./server/previewReply.js";

/**
 * The workspace file family, served as plugin route contributions.
 *
 * The routes keep the core-shaped paths the browser already calls, mounted by
 * the host under the API prefix and its local-machine alias; the federated
 * route table names them, so the transport bounds and the remote proxy remain
 * the core's decision. Workspace identity resolves through the injected catalog
 * port and path access through the injected config port - the plugin never
 * learns what a project or a workspace is beyond those two answers. The
 * config port is read exactly where the core routes read it: never for
 * writes, moves, or deletes, and for suggestions only when the query names an
 * absolute path.
 */
const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Workspaces",
  activate: (context: ServerPluginActivationContext) => {
    const workspaceCatalog = context.ports?.workspaceCatalog;
    const piWebConfig = context.ports?.piWebConfig;
    if (workspaceCatalog === undefined || piWebConfig === undefined) {
      return {
        health: () => Promise.resolve({
          status: "unhealthy" as const,
          message: "This host does not inject the workspace catalog and config ports the file routes resolve through.",
        }),
      };
    }

    interface Resolved {
      root: string;
      projectPath: string;
    }

    const resolveRoot = async (projectId: string | undefined, workspaceId: string | undefined): Promise<Resolved | undefined> => {
      if (projectId === undefined || workspaceId === undefined) return undefined;
      const resolution: WorkspacePathResolution | undefined = await workspaceCatalog.resolveWorkspace(projectId, workspaceId);
      if (resolution === undefined) return undefined;
      return { root: resolution.workspacePath, projectPath: resolution.projectPath };
    };

    const pathAccessFor = async (resolved: Resolved): Promise<PluginPathAccessConfig | undefined> => {
      return await piWebConfig.readPathAccess(resolved.projectPath);
    };

    const sendNotFound = (reply: ServerPluginReply): Promise<void> => {
      return reply.code(400).header("Content-Type", "application/json").send(JSON.stringify({ error: "Workspace not found" }));
    };

    const sendJson = (reply: ServerPluginReply, body: unknown): Promise<void> => {
      return reply.header("Content-Type", "application/json").send(JSON.stringify(body));
    };

    const tree: ServerPluginRouteContribution = {
      method: "GET",
      path: "/projects/:projectId/workspaces/:workspaceId/tree",
      async handle(request, reply) {
        try {
          const resolved = await resolveRoot(request.params["projectId"], request.params["workspaceId"]);
          if (resolved === undefined) {
          await sendNotFound(reply);
          return;
        }
          const response: FileTreeResponse = await listWorkspaceTree(resolved.root, request.query["path"], await pathAccessFor(resolved));
          await sendJson(reply, response);
        } catch (error) {
          await sendError(reply, error, 400);
        }
      },
    };

    const readFile: ServerPluginRouteContribution = {
      method: "GET",
      path: "/projects/:projectId/workspaces/:workspaceId/file",
      async handle(request, reply) {
        try {
          const resolved = await resolveRoot(request.params["projectId"], request.params["workspaceId"]);
          if (resolved === undefined) {
          await sendNotFound(reply);
          return;
        }
          const response = await readWorkspaceFile(resolved.root, request.query["path"], await pathAccessFor(resolved));
          await sendJson(reply, response);
        } catch (error) {
          await sendError(reply, error, 400);
        }
      },
    };

    const writeFile: ServerPluginRouteContribution = {
      method: "PUT",
      path: "/projects/:projectId/workspaces/:workspaceId/file",
      async handle(request, reply) {
        try {
          const resolved = await resolveRoot(request.params["projectId"], request.params["workspaceId"]);
          if (resolved === undefined) {
            await sendNotFound(reply);
            return;
          }
          const body = request.body;
          if (!(body instanceof Uint8Array)) throw new Error("Request body is required");
          const response: WriteWorkspaceFileResponse = await writeWorkspaceFile(resolved.root, request.query["path"], Buffer.from(body), {
            createDirs: request.query["createDirs"] !== "false",
            overwrite: request.query["overwrite"] !== "false",
          });
          await sendJson(reply, response);
        } catch (error) {
          await sendError(reply, error, 400);
        }
      },
    };

    const deleteFile: ServerPluginRouteContribution = {
      method: "DELETE",
      path: "/projects/:projectId/workspaces/:workspaceId/file",
      async handle(request, reply) {
        try {
          const resolved = await resolveRoot(request.params["projectId"], request.params["workspaceId"]);
          if (resolved === undefined) {
          await sendNotFound(reply);
          return;
        }
          const response: DeleteWorkspaceFileResponse = await deleteWorkspaceFile(resolved.root, request.query["path"]);
          await sendJson(reply, response);
        } catch (error) {
          await sendError(reply, error, 400);
        }
      },
    };

    const moveFile: ServerPluginRouteContribution = {
      method: "POST",
      path: "/projects/:projectId/workspaces/:workspaceId/file/move",
      async handle(request, reply) {
        try {
          const resolved = await resolveRoot(request.params["projectId"], request.params["workspaceId"]);
          if (resolved === undefined) {
          await sendNotFound(reply);
          return;
        }
          const response: MoveWorkspaceFileResponse = await moveWorkspaceFile(resolved.root, request.query["fromPath"], request.query["toPath"], {
            createDirs: request.query["createDirs"] !== "false",
            overwrite: request.query["overwrite"] === "true",
          });
          await sendJson(reply, response);
        } catch (error) {
          await sendError(reply, error, 400);
        }
      },
    };

    const preview: ServerPluginRouteContribution = {
      method: "GET",
      path: "/projects/:projectId/workspaces/:workspaceId/file/preview",
      async handle(request, reply) {
        try {
          const resolved = await resolveRoot(request.params["projectId"], request.params["workspaceId"]);
          if (resolved === undefined) {
          await sendNotFound(reply);
          return;
        }
          const download = request.query["download"] === "1" || request.query["download"] === "true";
          const result = await readWorkspaceFilePreview(resolved.root, request.query["path"], await pathAccessFor(resolved), {
            download,
            range: request.headers["range"],
          });
          const policy = workspaceFilePreviewResponsePolicy(result.path, { download });
          // A media element seeks by asking for byte ranges; advertising the
          // capability is what makes the browser issue those requests at all.
          if (result.streamed === true) reply.header("Accept-Ranges", "bytes");
          if (result.contentRange !== undefined) reply.code(206).header("Content-Range", result.contentRange);
          await reply
            .header("Content-Type", policy.contentType)
            .header("Cache-Control", "private, max-age=3600")
            .header("Content-Length", String(result.size))
            .header("Content-Disposition", policy.contentDisposition)
            .header("Content-Security-Policy", policy.contentSecurityPolicy)
            .header("Last-Modified", new Date(result.modifiedAt).toUTCString())
            .header("X-Content-Type-Options", policy.contentTypeOptions)
            .send(result.body);
        } catch (error) {
          applyWorkspaceFilePreviewErrorResponsePolicy(reply);
          await sendError(reply, error, 400);
        }
      },
    };

    const suggestions: ServerPluginRouteContribution = {
      method: "GET",
      path: "/projects/:projectId/workspaces/:workspaceId/files",
      async handle(request, reply, routeContext) {
        try {
          const resolved = await resolveRoot(request.params["projectId"], request.params["workspaceId"]);
          if (resolved === undefined) {
          await sendNotFound(reply);
          return;
        }
          const query = request.query["q"] ?? "";
          const pathAccess = isAbsoluteishFileSuggestionQuery(query) ? await pathAccessFor(resolved) : undefined;
          const execFile = suggestionRunner(context, routeContext.signal);
          const files = request.query["mode"] === "path"
            ? await listPathSuggestions(resolved.root, query, pathAccess, { execFile })
            : await listFileSuggestions(resolved.root, query, { kind: parseSuggestionKind(request.query["kind"]), scope: parseSuggestionScope(request.query["scope"]), pathAccess }, { execFile });
          await sendJson(reply, files);
        } catch (error) {
          await sendError(reply, error, 400);
        }
      },
    };

    return {
      routes: [tree, readFile, writeFile, deleteFile, moveFile, preview, suggestions],
    };
  },
};

function parseSuggestionKind(kind: string | undefined): "tracked" | "untracked" | "other" | undefined {
  if (kind === "tracked" || kind === "untracked" || kind === "other") return kind;
  return undefined;
}

function parseSuggestionScope(scope: string | undefined): "tracked" | "all" | undefined {
  if (scope === "all" || scope === "tracked") return scope;
  return undefined;
}

interface SuggestionRunnerOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv | undefined;
}

type SuggestionRunner = (file: string, args: string[], options: SuggestionRunnerOptions) => Promise<{ stdout: string }>;

/**
 * The suggestions service shells out to git through the contract's execFile
 * port. The route's cancellation signal and the service's sanitized
 * environment ride along; ranking stays the service's JS fallback because the
 * port cannot feed fzf's stdin, and the host owns the output bound - a
 * truncated listing fails the run so the service falls back to the plain
 * filesystem walk instead of ranking a mangled record.
 */
function suggestionRunner(context: ServerPluginActivationContext, signal: AbortSignal): SuggestionRunner {
  return async (file, args, options) => {
    const result = await context.execFile({
      file,
      args,
      cwd: options.cwd,
      ...(options.env === undefined ? {} : { env: stringValuesOnly(options.env) }),
      signal,
    });
    if (result.stdoutTruncated) throw new Error(`${file} listing exceeded the host output bound`);
    return { stdout: result.stdout };
  };
}

function stringValuesOnly(env: NodeJS.ProcessEnv): Record<string, string> {
  const entries = Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return Object.fromEntries(entries);
}

function sendError(reply: ServerPluginReply, error: unknown, fallbackStatus: number): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  return reply.code(fallbackStatus).header("Content-Type", "application/json").send(JSON.stringify({ error: message }));
}

export default plugin;
