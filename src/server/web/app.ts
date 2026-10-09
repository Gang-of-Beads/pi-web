import { homedir } from "node:os";
import { existsSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import { notFoundAnswer, type NotFoundAnswer } from "./notFoundAnswer.js";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { piWebDataDir } from "../../config.js";
import { ProjectStore } from "../shared/storage/projectStore.js";
import { ProjectFolderError, ProjectService } from "../shared/projects/projectService.js";
import { routeMissingBody } from "../shared/routeMissing.js";
import type { WorkspaceCatalog } from "../shared/workspaces/workspaceCatalog.js";
import { SessionDaemonWorkspaceCatalog } from "./workspaces/sessionDaemonWorkspaceCatalog.js";
import { resolveWorkspaceContext } from "../shared/workspaces/workspaceContext.js";
import { isWorkspaceIdentityMiss, sendWorkspaceRequestError } from "../shared/workspaces/workspaceRouteErrors.js";
import { loadEffectiveProjectUploadsConfig, loadEffectiveProjectPathAccess } from "./workspaces/projectPiWebConfig.js";
import { listDirectorySuggestions } from "../shared/projects/directorySuggestions.js";
import { SessionDaemonClient } from "../shared/sessiondClient/sessionDaemonClient.js";
import { loadServerPluginRecoveryConfig } from "../../serverPluginRecovery.js";
import { registerSessionProxyRoutes, type SessionProxyDaemon } from "./sessionProxyRoutes.js";
import { registerProjectTrustRoutes } from "./projectTrustRoutes.js";
import { registerTerminalProxyRoutes } from "./terminalProxyRoutes.js";
import { registerMachineTerminalRoutes } from "./machineTerminalRoutes.js";
import { registerWorkspaceDeletionRoutes } from "./workspaces/workspaceDeletionRoutes.js";
import { createFilePiWebConfigService, registerConfigRoutes, registerLocalMachineConfigRoutes, type PiWebConfigService } from "./configRoutes.js";
import { PiWebPluginService } from "./piWebPluginService.js";
import { askDaemonToReconcilePlugins } from "../shared/plugins/pluginReconcile.js";
import { PiWebPluginCatalog, filterCatalogEntriesByRuns, type LocalPluginRoot } from "../shared/piWebPluginCatalog.js";
import { createServerPluginRuntime, type ServerPluginRuntime } from "../shared/plugins/serverPluginRuntime.js";
import type { ServerPluginRuntimeLogger } from "../shared/plugins/serverPluginRuntime.js";
import { createWorkspaceProviderRuntimeSnapshot, type WorkspaceProviderRuntimeSnapshot } from "../shared/workspaces/workspaceCatalog.js";
import { mountServerPluginRoutes } from "./plugins/serverPluginRouteMount.js";
import { createActiveProfilePiPackageService, type PiPackageService } from "./piPackageService.js";
import { registerPiPackageRoutes } from "./piPackageRoutes.js";
import { registerSessionPinRoutes } from "./sessionPinRoutes.js";
import { daemonSessionListing, daemonSessionLocate, registerSessionBoardRoutes, type SessionBoardSources } from "./sessionBoardRoutes.js";
import { nudgeChange } from "../shared/sessiondClient/changeNudge.js";
import { forgottenPin, SessionPinStore, sessionPinStorePath } from "../shared/storage/sessionPinStore.js";
import { createPiWebStatusCache, type PiWebStatusCache } from "./piWebStatusCache.js";
import { getPiWebRuntime, getPiWebStatus, getPiWebVersionStatus } from "../shared/piWebStatus.js";
import {
  ActiveAgentProfileAccessError,
  requireActiveAgentProfile,
  SessionDaemonActiveAgentProfileProvider,
  type ActiveAgentProfileProvider,
} from "./activeAgentProfileProvider.js";
import { registerFleetRoutes } from "./updates/fleetRoutes.js";
import { createRestartService, registerRestartRoutes } from "./updates/restartRoutes.js";
import { createSelfUpdateService, registerSelfUpdateRoutes } from "./updates/selfUpdateRoutes.js";
import { registerMachineProxyRoutes } from "./machines/machineProxyRoutes.js";
import { registerPluginBackendProxyRoutes } from "./plugins/pluginBackendProxyRoutes.js";
import { registerPluginOperationProxyRoutes } from "./plugins/pluginOperationProxyRoutes.js";
import { withFolderPresence } from "./projectFolderPresence.js";
import { proxyMachinePluginAsset, registerMachinePluginProxyRoutes } from "./machines/machinePluginProxyRoutes.js";
import { localMachineFallback, registerFallbackMachineRoutes, type MachineRegistryFace } from "./machines/localMachineRegistry.js";
import type { Project, WorkspaceEffectiveConfig, WorkspaceProviderResolution } from "../shared/types.js";

export interface AppDependencies {
  projects?: ProjectService;
  workspaceCatalog?: WorkspaceCatalog;
  machines?: MachineRegistryFace;
  sessionDaemon?: SessionProxyDaemon;
  agentProfileProvider?: ActiveAgentProfileProvider;
  piWebPlugins?: Pick<PiWebPluginService, "manifest" | "plugins" | "readAsset">;
  piWebPluginCatalog?: PiWebPluginCatalog;
  /**
   * Where local plugin packages are found; the bundled build output, a source checkout's plugins
   * and the data directory's plugins when omitted. A test that reads the catalog passes its own:
   * the bundled output is rewritten while a build runs beside it, and a scan of it raced that build.
   */
  pluginRoots?: LocalPluginRoot[];
  /** Pre-activated web-process plugin runtime; assembled from the catalog when omitted. */
  serverPluginRuntime?: ServerPluginRuntime;
  piPackages?: PiPackageService;
  sessionPins?: SessionPinStore;
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
  app.get(`${prefix}/projects`, async () => withFolderPresence(await projects.list()));

  app.post<{ Body: { name?: string; path: string; create?: boolean } }>(`${prefix}/projects`, async (request, reply) => {
    try {
      return await projects.add(request.body);
    } catch (error) {
      if (error instanceof ProjectFolderError) return reply.code(400).send({ error: error.message, code: error.refusal });
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Body: unknown }>(`${prefix}/projects/order`, async (request, reply) => {
    const order: unknown = typeof request.body === "object" && request.body !== null ? Reflect.get(request.body, "order") : undefined;
    if (!Array.isArray(order) || order.some((id) => typeof id !== "string" || id === "")) return reply.code(400).send({ error: "order must be a list of project ids" });
    return withFolderPresence(await projects.reorder(order.filter((id): id is string => typeof id === "string")));
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
    workspaces: resolution.workspaces.map((workspace) => ({
      ...workspace,
      effectiveConfig,
      // The same fact the session listing stamps: a workspace whose folder is
      // gone can never host a session or a terminal, and the browser must see
      // that before it offers "+ New session".
      ...((() => { try { return statSync(workspace.path).isDirectory() ? {} : { cwdMissing: true }; } catch { return { cwdMissing: true }; } })()),
    })),
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

/**
 * A write that changes the `plugins` section applies live (B19 slice A): the web process
 * reconciles its own plugin runtime, then asks its daemon to reconcile its. The write already
 * happened, so a failure to apply it is only logged: the plugin list compares desired and running
 * state in each process, so a plugin a reconcile did not reach still reads "Restart required".
 * The answer waits for both, so the plugin list read after it shows what is running.
 */
function reconcilePluginsOnWrite(config: PiWebConfigService, apply: () => Promise<void>, log: (error: unknown) => void): PiWebConfigService {
  return {
    read: () => config.read(),
    write: async (nextConfig) => {
      const before = JSON.stringify((await config.read()).config.plugins ?? {});
      const response = await config.write(nextConfig);
      if (JSON.stringify(response.config.plugins ?? {}) !== before) await apply().catch(log);
      return response;
    },
  };
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
  const app = Fastify({ logger: deps.logger ?? true, disableRequestLogging: true, ...(deps.bodyLimit === undefined ? {} : { bodyLimit: deps.bodyLimit }) });
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
  let webProviderRuntimeSnapshot: (() => WorkspaceProviderRuntimeSnapshot) | undefined;
  const pluginRoots = deps.pluginRoots === undefined ? {} : { roots: deps.pluginRoots };
  const piWebPlugins = deps.piWebPlugins ?? new PiWebPluginService({
    ...pluginRoots,
    configProvider: readConfig,
    agentDirProvider: () => desiredPluginAgentDir(agentProfileProvider, configService),
    runtimeProvider: daemonWorkspaces,
    webRuntimeProvider: () => Promise.resolve(webProviderRuntimeSnapshot?.()),
    recoveryProvider: () => loadServerPluginRecoveryConfig(),
  });
  // The web runtime reads the same config and agent-dir sources the plugin
  // service does; it stays a separate catalog because the service is often a
  // fixture and the runtime must exist even when the daemon is unreachable.
  const piWebPluginCatalog = deps.piWebPluginCatalog ?? new PiWebPluginCatalog({
    ...pluginRoots,
    configProvider: readConfig,
    agentDirProvider: () => desiredPluginAgentDir(agentProfileProvider, configService),
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
  const pinsChanged = (): void => {
    nudgeChange(sessionDaemon, "pins").catch((error: unknown) => { app.log.warn({ err: error }, "Could not announce a pin change to the session daemon"); });
  };
  const sessionPins = deps.sessionPins ?? new SessionPinStore(sessionPinStorePath(), pinsChanged);
  registerSessionPinRoutes(app, sessionPins);
  registerSessionPinRoutes(app, sessionPins, "/api/machines/local");
  const reconcilingConfigService = reconcilePluginsOnWrite(configService, async () => {
    await webServerPluginRuntime?.reconcile();
    await askDaemonToReconcilePlugins(sessionDaemon);
  }, (error) => { app.log.warn({ err: error }, "A plugin toggle could not be applied live; it takes effect after a restart"); });
  const invalidatingConfigService = invalidatePiWebStatusOnWrite(reconcilingConfigService, piWebStatusCache);
  registerConfigRoutes(app, invalidatingConfigService);
  registerLocalMachineConfigRoutes(app, invalidatingConfigService);
  registerLocalProjectRoutes(app, projects, workspaces, "/api", { config: configService });
  registerLocalProjectRoutes(app, projects, workspaces, "/api/machines/local", { config: configService });
  const sessionBoardSources: SessionBoardSources = {
    projects: () => projects.list(),
    workspaces: (project) => resolveWorkspacesWithEffectiveConfig(project, workspaces, configService),
    sessions: daemonSessionListing(sessionDaemon),
    pinned: { ids: () => sessionPins.list(), locate: daemonSessionLocate(sessionDaemon, homedir()) },
  };
  registerSessionBoardRoutes(app, sessionBoardSources);
  registerSessionBoardRoutes(app, sessionBoardSources, "/api/machines/local");

  const unpinDeleted = { sessionsDeleted: async (sessionIds: readonly string[]) => { for (const sessionId of sessionIds) await sessionPins.apply(forgottenPin(sessionId)); } };
  registerSessionProxyRoutes(app, sessionDaemon, "/api", unpinDeleted);
  registerSessionProxyRoutes(app, sessionDaemon, "/api/machines/local", unpinDeleted);
  registerPluginBackendProxyRoutes(app, sessionDaemon);
  registerPluginOperationProxyRoutes(app, sessionDaemon);
  const projectTrustDeps = {
    agentDir: async () => (await requireActiveAgentProfile(agentProfileProvider)).dir,
  };
  registerProjectTrustRoutes(app, projects, workspaces, projectTrustDeps);
  registerProjectTrustRoutes(app, projects, workspaces, projectTrustDeps, "/api/machines/local");
  registerTerminalProxyRoutes(app, projects, workspaces, sessionDaemon);
  registerTerminalProxyRoutes(app, projects, workspaces, sessionDaemon, "/api/machines/local");
  registerMachineTerminalRoutes(app, sessionDaemon);
  registerMachineTerminalRoutes(app, sessionDaemon, "/api/machines/local");
  registerWorkspaceDeletionRoutes(app, sessionDaemon);
  registerWorkspaceDeletionRoutes(app, sessionDaemon, "/api/machines/local");

  // The web process hosts the plugins addressed to it (`runs: "web" |
  // "both"`); everything else stays daemon-owned as before, so an old
  // package activates exactly where it always did. The ports give plugins
  // the two host services the file routes need without importing core
  // internals: tuple resolution and the per-project path-access config.
  // A runtime that cannot activate (daemon profile blip at startup) must not
  // take the web process down: contributed routes are absent until restart,
  // which is the honest absence the seam already defines.
  let webServerPluginRuntime = deps.serverPluginRuntime;
  if (webServerPluginRuntime === undefined) {
    const webRuntimeLogger: ServerPluginRuntimeLogger = {
      debug: (details, message) => {
        app.log.debug({ ...details }, message);
      },
      info: (details, message) => {
        app.log.info({ ...details }, message);
      },
      warn: (details, message) => {
        app.log.warn({ ...details }, message);
      },
      error: (details, message) => {
        app.log.error({ ...details }, message);
      },
    };
    try {
      const recovery = loadServerPluginRecoveryConfig();
      webServerPluginRuntime = await createServerPluginRuntime({
        catalog: {
          snapshot: async (scope) => {
            const snapshot = await piWebPluginCatalog.snapshot(scope);
            return { ...snapshot, plugins: filterCatalogEntriesByRuns(snapshot.plugins, ["web", "both"]) };
          },
        },
        ...(recovery.safeStart === undefined ? {} : { safeStart: recovery.safeStart }),
        logger: webRuntimeLogger,
        hostPorts: {
          workspaceCatalog: {
            resolveWorkspace: async (projectId, workspaceId) => {
              const context = await resolveWorkspaceContext(projects, workspaces, projectId, workspaceId).catch((error: unknown) => {
                if (isWorkspaceIdentityMiss(error)) return undefined;
                throw error;
              });
              if (context === undefined) return undefined;
              return { projectPath: context.project.path, workspacePath: context.root };
            },
          },
          piWebConfig: {
            readPathAccess: async (projectPath) => {
              return loadEffectiveProjectPathAccess(projectPath, await readConfig());
            },
          },
          machinesStorePath: () => piWebDataDir(),
          localRuntime: () => getPiWebRuntime(sessionDaemon),
        },
      });
    } catch (error) {
      app.log.warn({ err: error }, "web-process plugin runtime failed to activate; contributed routes are absent");
    }
  }
  if (webServerPluginRuntime !== undefined) {
    const runtime = webServerPluginRuntime;
    const bootHealth = await runtime.inspectHealth();
    webProviderRuntimeSnapshot = () => createWorkspaceProviderRuntimeSnapshot(
      runtime.healthRecords(),
      bootHealth,
      runtime.safeStartLevel(),
      runtime.catalogDiagnostics(),
    );
    app.addHook("onClose", () => runtime.stop());
    mountServerPluginRoutes(app, runtime, "/api");
    mountServerPluginRoutes(app, runtime, "/api/machines/local");
  }

  const pluginMachineRegistry = webServerPluginRuntime?.machineRegistry()?.registry;
  const machines = deps.machines
    ?? pluginMachineRegistry
    ?? localMachineFallback(() => getPiWebRuntime(sessionDaemon));
  if (pluginMachineRegistry === undefined) registerFallbackMachineRoutes(app, machines);

  registerMachinePluginProxyRoutes(app, machines);
  // One service instance per concern, shared by the single-machine routes and
  // the fleet fan-out, so "update this machine" and "update every machine"
  // cannot drift into two different local behaviours.
  const restartService = createRestartService(app.log);
  const selfUpdateService = createSelfUpdateService(app.log);
  registerSelfUpdateRoutes(app, { selfUpdate: selfUpdateService });
  registerRestartRoutes(app, { restart: restartService });
  registerFleetRoutes(app, machines, { restart: restartService, selfUpdate: selfUpdateService });

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
    const notFoundReplies: Record<NotFoundAnswer, (request: FastifyRequest, reply: FastifyReply) => FastifyReply> = {
      document: (_request, reply) => reply.sendFile("index.html"),
      "missing-asset": (_request, reply) => reply.code(404).type("text/plain").send("Not found"),
      "missing-api": (request, reply) => reply.code(404).send(routeMissingBody(request.method, request.url)),
    };
    app.setNotFoundHandler((request, reply) => notFoundReplies[notFoundAnswer(request.url)](request, reply));
  } else {
    app.setNotFoundHandler((request, reply) => reply.code(404).send(routeMissingBody(request.method, request.url)));
  }

  return app;
}
