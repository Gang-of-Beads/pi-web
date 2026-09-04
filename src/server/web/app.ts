import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyServerOptions } from "fastify";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { ProjectStore } from "../shared/storage/projectStore.js";
import { ProjectService } from "../shared/projects/projectService.js";
import type { WorkspaceCatalog } from "../shared/workspaces/workspaceCatalog.js";
import { SessionDaemonWorkspaceCatalog } from "./workspaces/sessionDaemonWorkspaceCatalog.js";
import { sendWorkspaceRequestError } from "./workspaces/workspaceRouteErrors.js";
import { loadEffectiveProjectUploadsConfig } from "./workspaces/projectPiWebConfig.js";
import { listDirectorySuggestions } from "../shared/projects/directorySuggestions.js";
import { SessionDaemonClient } from "../shared/sessiondClient/sessionDaemonClient.js";
import { loadServerPluginRecoveryConfig } from "../../serverPluginRecovery.js";
import { registerSessionProxyRoutes, type SessionProxyDaemon } from "./sessionProxyRoutes.js";
import { registerWorkspaceExplorerRoutes } from "./workspaceExplorerRoutes.js";
import { registerProjectTrustRoutes } from "./projectTrustRoutes.js";
import { registerTerminalProxyRoutes } from "./terminalProxyRoutes.js";
import { registerWorkspaceDeletionRoutes } from "./workspaces/workspaceDeletionRoutes.js";
import { createFilePiWebConfigService, registerConfigRoutes, registerLocalMachineConfigRoutes, type PiWebConfigService } from "./configRoutes.js";
import { PiWebPluginService } from "./piWebPluginService.js";
import { createActiveProfilePiPackageService, type PiPackageService } from "./piPackageService.js";
import { registerPiPackageRoutes } from "./piPackageRoutes.js";
import { createPiWebStatusCache, type PiWebStatusCache } from "./piWebStatusCache.js";
import { getPiWebRuntime, getPiWebStatus, getPiWebVersionStatus } from "../shared/piWebStatus.js";
import {
  ActiveAgentProfileAccessError,
  requireActiveAgentProfile,
  SessionDaemonActiveAgentProfileProvider,
  type ActiveAgentProfileProvider,
} from "./activeAgentProfileProvider.js";
import { MachineService } from "./machines/machineService.js";
import { registerMachineRoutes } from "./machines/machineRoutes.js";
import { registerFleetRoutes } from "./updates/fleetRoutes.js";
import { createRestartService, registerRestartRoutes } from "./updates/restartRoutes.js";
import { createSelfUpdateService, registerSelfUpdateRoutes } from "./updates/selfUpdateRoutes.js";
import { registerMachineProxyRoutes } from "./machines/machineProxyRoutes.js";
import { registerPluginBackendProxyRoutes } from "./plugins/pluginBackendProxyRoutes.js";
import { registerPluginOperationProxyRoutes } from "./plugins/pluginOperationProxyRoutes.js";
import { registerGoalProxyRoutes } from "./workspaces/goalProxyRoutes.js";
import { proxyMachinePluginAsset, registerMachinePluginProxyRoutes } from "./machines/machinePluginProxyRoutes.js";
import type { Project, WorkspaceEffectiveConfig, WorkspaceProviderResolution } from "../shared/types.js";

export interface AppDependencies {
  projects?: ProjectService;
  workspaceCatalog?: WorkspaceCatalog;
  machines?: MachineService;
  sessionDaemon?: SessionProxyDaemon;
  agentProfileProvider?: ActiveAgentProfileProvider;
  piWebPlugins?: Pick<PiWebPluginService, "manifest" | "plugins" | "readAsset">;
  piPackages?: PiPackageService;
  piWebStatusCache?: PiWebStatusCache;
  config?: PiWebConfigService;
  clientDist?: string | false;
  logger?: FastifyServerOptions["logger"];
  /** Maximum accepted HTTP request body size in bytes. */
  bodyLimit?: number;
}

interface LocalProjectRouteOptions {
  config?: Pick<PiWebConfigService, "read">;
}

function registerLocalProjectRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceCatalog, prefix: string, options: LocalProjectRouteOptions = {}): void {
  app.get(`${prefix}/projects`, async () => projects.list());

  app.post<{ Body: { name?: string; path: string; create?: boolean } }>(`${prefix}/projects`, async (request, reply) => {
    try {
      return await projects.add(request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { projectId: string } }>(`${prefix}/projects/:projectId`, async (request, reply) => {
    try {
      await projects.close(request.params.projectId);
      return { closed: true };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Querystring: { q?: string } }>(`${prefix}/project-directories`, async (request, reply) => {
    // Every keystroke re-issues this search, so a client that already moved on
    // (or closed the dialog) must not keep a directory walk running. The
    // request's 'close' fires both on early disconnect and after a normal
    // response, so the response boundary decides whether it means "gone".
    const disconnected = new AbortController();
    request.raw.once("close", () => {
      if (!reply.raw.writableEnded) disconnected.abort();
    });
    try {
      return await listDirectorySuggestions(request.query.q ?? "", disconnected.signal);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string } }>(`${prefix}/projects/:projectId/workspaces`, async (request, reply) => {
    try {
      const project = await projects.requireProject(request.params.projectId);
      return await resolveWorkspacesWithEffectiveConfig(project, workspaces, options.config);
    } catch (error) {
      return sendWorkspaceRequestError(reply, error, 404);
    }
  });
}

async function resolveWorkspacesWithEffectiveConfig(
  project: Project,
  workspaces: WorkspaceCatalog,
  config?: Pick<PiWebConfigService, "read">,
): Promise<WorkspaceProviderResolution> {
  const [resolution, effectiveConfig] = await Promise.all([
    workspaces.resolveProject(project.id),
    workspaceEffectiveConfig(project.path, config),
  ]);
  return {
    ...resolution,
    workspaces: resolution.workspaces.map((workspace) => ({ ...workspace, effectiveConfig })),
  };
}

async function workspaceEffectiveConfig(projectPath: string, config?: Pick<PiWebConfigService, "read">): Promise<WorkspaceEffectiveConfig> {
  const globalConfig = config === undefined ? {} : (await config.read()).effectiveConfig;
  return { uploads: await loadEffectiveProjectUploadsConfig(projectPath, globalConfig) };
}

async function readEffectiveConfig(config: Pick<PiWebConfigService, "read">) {
  return (await config.read()).effectiveConfig;
}

async function desiredPluginAgentDir(
  profiles: ActiveAgentProfileProvider,
  config: Pick<PiWebConfigService, "read">,
): Promise<string> {
  try {
    return (await requireActiveAgentProfile(profiles)).dir;
  } catch (error) {
    if (!(error instanceof ActiveAgentProfileAccessError)) throw error;
    const desiredDir = (await config.read()).effectiveConfig.agent?.dir;
    if (desiredDir === undefined || desiredDir === "") throw error;
    return desiredDir;
  }
}

function invalidatePiWebStatusOnWrite(config: PiWebConfigService, statusCache: Pick<PiWebStatusCache, "invalidate">): PiWebConfigService {
  return {
    read: () => config.read(),
    write: async (nextConfig) => {
      const response = await config.write(nextConfig);
      statusCache.invalidate();
      return response;
    },
  };
}

async function withProfileDependency<T>(reply: FastifyReply, operation: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ActiveAgentProfileAccessError)) throw error;
    return reply.code(503).send({ error: error.message });
  }
}

export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? true, ...(deps.bodyLimit === undefined ? {} : { bodyLimit: deps.bodyLimit }) });
  // Vite proxies development API requests here, while production and machine-scoped
  // API requests already terminate here, so this is the shared browser HTTP edge.
  await app.register(fastifyCompress, {
    globalCompression: true,
    globalDecompression: false,
    threshold: 1024,
  });
  await app.register(fastifyWebsocket);

  const projects = deps.projects ?? new ProjectService(new ProjectStore());
  const configService = deps.config ?? createFilePiWebConfigService();
  const readConfig = () => readEffectiveConfig(configService);
  const sessionDaemon = deps.sessionDaemon ?? new SessionDaemonClient();
  const daemonWorkspaces = new SessionDaemonWorkspaceCatalog(sessionDaemon);
  const workspaces = deps.workspaceCatalog ?? daemonWorkspaces;
  const agentProfileProvider = deps.agentProfileProvider ?? new SessionDaemonActiveAgentProfileProvider(sessionDaemon);
  const piWebPlugins = deps.piWebPlugins ?? new PiWebPluginService({
    configProvider: readConfig,
    agentDirProvider: () => desiredPluginAgentDir(agentProfileProvider, configService),
    runtimeProvider: daemonWorkspaces,
    recoveryProvider: () => loadServerPluginRecoveryConfig(),
  });
  const piPackages = deps.piPackages ?? createActiveProfilePiPackageService(agentProfileProvider);
  const piWebStatusCache = deps.piWebStatusCache ?? createPiWebStatusCache(
    async ({ force }) => {
      const activeAgentProfile = await agentProfileProvider.getActiveAgentProfile();
      return getPiWebStatus(sessionDaemon, {
        forceReleaseCheck: force,
        ...(activeAgentProfile.status === "available" ? { activeAgentProfile: activeAgentProfile.profile } : {}),
      });
    },
    { onError: (error) => { app.log.warn({ err: error }, "failed to refresh PI WEB status cache"); } },
  );
  const machines = deps.machines ?? new MachineService(undefined, {
    localRuntime: () => getPiWebRuntime(sessionDaemon),
  });

  app.get("/pi-web-plugins/manifest.json", async (_request, reply) => withProfileDependency(reply, () => piWebPlugins.manifest()));

  app.get<{ Params: { pluginId: string; "*": string } }>("/pi-web-plugins/:pluginId/*", async (request, reply) => {
    if (await proxyMachinePluginAsset(machines, request.params.pluginId, request.params["*"], request.url, reply)) return;

    return withProfileDependency(reply, async () => {
      const asset = await piWebPlugins.readAsset(
        request.params.pluginId,
        request.params["*"],
        new URL(request.url, "http://pi-web.local").searchParams.get("v") ?? undefined,
      );
      if (asset === undefined) return reply.code(404).send({ error: "Plugin asset not found" });
      return reply.type(asset.contentType).send(asset.content);
    });
  });

  app.get<{ Querystring: { refresh?: string } }>("/api/pi-web/status", async (request) => request.query.refresh === "1"
    ? piWebStatusCache.refresh({ force: true })
    : piWebStatusCache.get());
  app.get("/api/pi-web/version", async () => {
    const activeAgentProfile = await agentProfileProvider.getActiveAgentProfile();
    return getPiWebVersionStatus(sessionDaemon, activeAgentProfile.status === "available" ? { activeAgentProfile: activeAgentProfile.profile } : {});
  });
  app.get("/api/pi-web/runtime", async () => getPiWebRuntime(sessionDaemon));
  app.get("/api/plugins", async (_request, reply) => withProfileDependency(reply, () => piWebPlugins.plugins()));
  app.get("/api/machines/local/plugins", async (_request, reply) => withProfileDependency(reply, () => piWebPlugins.plugins()));
  registerPiPackageRoutes(app, piPackages);
  registerPiPackageRoutes(app, piPackages, "/api/machines/local");
  const invalidatingConfigService = invalidatePiWebStatusOnWrite(configService, piWebStatusCache);
  registerConfigRoutes(app, invalidatingConfigService);
  registerLocalMachineConfigRoutes(app, invalidatingConfigService);
  registerMachineRoutes(app, machines);
  registerMachinePluginProxyRoutes(app, machines);
  // One service instance per concern, shared by the single-machine routes and
  // the fleet fan-out, so "update this machine" and "update every machine"
  // cannot drift into two different local behaviours.
  const restartService = createRestartService(app.log);
  const selfUpdateService = createSelfUpdateService(app.log);
  registerSelfUpdateRoutes(app, { selfUpdate: selfUpdateService });
  registerRestartRoutes(app, { restart: restartService });
  registerFleetRoutes(app, { machines, restart: restartService, selfUpdate: selfUpdateService });

  registerLocalProjectRoutes(app, projects, workspaces, "/api", { config: configService });
  registerLocalProjectRoutes(app, projects, workspaces, "/api/machines/local", { config: configService });

  registerSessionProxyRoutes(app, sessionDaemon);
  registerSessionProxyRoutes(app, sessionDaemon, "/api/machines/local");
  registerPluginBackendProxyRoutes(app, sessionDaemon);
  registerPluginOperationProxyRoutes(app, sessionDaemon);
  registerWorkspaceExplorerRoutes(app, projects, workspaces, "/api", { config: configService });
  registerWorkspaceExplorerRoutes(app, projects, workspaces, "/api/machines/local", { config: configService });
  registerGoalProxyRoutes(app, projects, workspaces, sessionDaemon, "/api");
  registerGoalProxyRoutes(app, projects, workspaces, sessionDaemon, "/api/machines/local");
  const projectTrustDeps = {
    agentDir: async () => (await requireActiveAgentProfile(agentProfileProvider)).dir,
  };
  registerProjectTrustRoutes(app, projects, workspaces, projectTrustDeps);
  registerProjectTrustRoutes(app, projects, workspaces, projectTrustDeps, "/api/machines/local");
  registerTerminalProxyRoutes(app, projects, workspaces, sessionDaemon);
  registerTerminalProxyRoutes(app, projects, workspaces, sessionDaemon, "/api/machines/local");
  registerWorkspaceDeletionRoutes(app, sessionDaemon);
  registerWorkspaceDeletionRoutes(app, sessionDaemon, "/api/machines/local");

  registerMachineProxyRoutes(app, machines);

  const packagedClientDist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "client");
  const clientDist = deps.clientDist ?? (existsSync(packagedClientDist) ? packagedClientDist : join(process.cwd(), "dist", "client"));
  if (clientDist !== false && existsSync(clientDist)) {
    await app.register(fastifyStatic, {
      root: clientDist,
      setHeaders: (response, filePath) => {
        // The document is the one file whose name never changes, so a cached
        // copy points at asset names from whatever build produced it. Hashed
        // assets can be cached forever precisely because their names change;
        // index.html must be re-read every time or an upgrade only reaches
        // people who clear their cache.
        if (filePath.endsWith("index.html")) response.header("cache-control", "no-store");
        else if (filePath.includes(`${sep}assets${sep}`)) response.header("cache-control", "public, max-age=31536000, immutable");
      },
    });
    app.setNotFoundHandler((request, reply) => {
      // The SPA fallback must not answer for assets. A browser holding a
      // cached index.html from a previous build asks for hashed files that no
      // longer exist; answering those with index.html hands HTML to a <script>
      // tag, which throws on the first '<' and leaves a blank page - looking
      // like the app is broken, while an incognito window works because it has
      // no cached document. A 404 lets the browser fail the request it made,
      // and the reload it prompts fetches the current index.
      const path = request.url.split("?")[0] ?? "";
      if (/\.(?:js|mjs|css|map|json|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf)$/i.test(path)) {
        return reply.code(404).type("text/plain").send("Not found");
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
