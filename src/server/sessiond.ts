#!/usr/bin/env node
import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { WorkspaceActivityService } from "./daemon/activity/workspaceActivityService.js";
import { MachineStatusService } from "./daemon/status/machineStatusService.js";
import { registerMachineStatusRoutes } from "./daemon/status/machineStatusRoutes.js";
import { CachedWorkspaceAttribution } from "./daemon/status/workspaceAttribution.js";
import { SessionEventHub } from "./daemon/realtime/sessionEventHub.js";
import { drainActiveWork, resolveDrainTimeoutMs } from "./daemon/sessions/shutdownDrain.js";
import { recordInterruptedRuns, takeInterruptedRuns } from "./daemon/sessions/interruptedRunStore.js";
import { AuthService } from "./daemon/sessions/authService.js";
import { bootstrapAndFreezeGlobalExtensionProviders } from "./daemon/sessions/globalProviderPolicy.js";
import { registerAuthRoutes } from "./daemon/sessions/authRoutes.js";
import { ModelCatalogRefresher } from "./daemon/sessions/modelCatalogRefresher.js";
import { PiSessionService } from "./daemon/sessions/piSessionService.js";
import { createPiSessionManagerGateway } from "./daemon/sessions/piSessionManagerGateway.js";
import { registerSessionRoutes } from "./daemon/sessions/sessionRoutes.js";
import { SessionNotificationStore } from "./daemon/sessions/sessionNotificationStore.js";
import { SessionArchiveStore, defaultSessionArchiveFilePath } from "./daemon/sessions/sessionArchiveStore.js";
import { FileSessionUnreadPersistence, SessionUnreadStore, defaultSessionUnreadFilePath } from "./daemon/sessions/sessionUnreadStore.js";
import { ProjectScopedSpawnTargetResolver } from "./daemon/sessions/spawnTargetResolver.js";
import { ProjectService } from "./shared/projects/projectService.js";
import { ProjectStore, projectStorePath } from "./shared/storage/projectStore.js";
import {
  eligibleWorkspaceProviderContributions,
  WorkspaceProviderRegistry,
} from "./daemon/workspaces/workspaceProviderRegistry.js";
import { sessiondSocketPath } from "./shared/sessiondClient/config.js";
import { TerminalService } from "./daemon/terminals/terminalService.js";
import { registerTerminalRoutes } from "./daemon/terminals/terminalRoutes.js";
import { getPiWebRuntimeComponent } from "./shared/piWebStatus.js";
import { SESSIOND_RUNTIME_CAPABILITIES } from "../shared/capabilities.js";
import { agentSessionDirEnvOverride, effectivePiWebConfig, maxUploadBytes, offlineModeEnabled, PI_CODING_AGENT_DIR_ENV, PI_CODING_AGENT_SESSION_DIR_ENV } from "../config.js";
import { createActiveAgentProfileDescriptor } from "./daemon/activeAgentProfile.js";
import { loadServerPluginRecoveryConfig } from "../serverPluginRecovery.js";
import { PiWebPluginCatalog } from "./shared/piWebPluginCatalog.js";
import { applyAgentHttpIdleTimeout } from "./daemon/agentHttpDispatcher.js";
import { scrubNonAgentVisibleEnvKeys } from "./daemon/agentProcessEnvironment.js";
import { claimSessiondStateOwnership } from "./daemon/sessiondStateOwnership.js";
import { dockerEnvironmentPromptSections } from "./daemon/sessions/dockerEnvironmentFacts.js";
import { PI_WEB_SESSION_ENV, sessionEnvironmentPromptSections } from "./daemon/sessions/sessionEnvironmentFacts.js";
import { createServerPluginExecFile } from "./shared/plugins/serverPluginExec.js";
import { createServerPluginRuntime } from "./shared/plugins/serverPluginRuntime.js";
import { runSessionDaemonShutdown } from "./daemon/sessionDaemonShutdown.js";
import { sessionServiceDependencies } from "./daemon/sessionServiceDependencies.js";
import { registerWorkspaceCatalogRoutes } from "./daemon/workspaces/workspaceCatalogRoutes.js";
import { registerPluginBackendRoutes } from "./daemon/workspaces/pluginBackendRoutes.js";
import { registerWorkspaceRemovalRoutes } from "./daemon/workspaces/workspaceRemovalRoutes.js";
import { createWorkspaceProviderRuntimeSnapshot } from "./shared/workspaces/workspaceCatalog.js";
import { WorkspaceRemovalService } from "./daemon/workspaces/workspaceRemovalService.js";

const daemonEnvironment: NodeJS.ProcessEnv = Object.freeze({ ...process.env });
const serverPluginRecovery = loadServerPluginRecoveryConfig({ env: daemonEnvironment });
const { config, deprecatedAgentInputs } = effectivePiWebConfig({ env: daemonEnvironment });
const activeAgentProfile = createActiveAgentProfileDescriptor(config.agent);
// Normalize the resolved agent state locations into the canonical pi SDK env
// vars before anything agent-visible can spawn: the embedded SDK's own
// resolution (getAgentDir(), its session-dir override), terminals, the bash
// tool, and subsessions then all observe the same values by inheritance. The
// exported canonical values are fully resolved, so agent processes that also
// inherit the deprecated PI_WEB_AGENT_* aliases still resolve to the same
// locations.
process.env[PI_CODING_AGENT_DIR_ENV] = activeAgentProfile.dir;
const agentSessionDirOverride = agentSessionDirEnvOverride(daemonEnvironment);
if (agentSessionDirOverride !== undefined) {
  process.env[PI_CODING_AGENT_SESSION_DIR_ENV] = agentSessionDirOverride;
}
// Deliberately agent-visible nesting marker: every process spawned from a
// session can tell it runs inside this pi-web instance. The session
// environment facts below explain the precautions that follow from it.
process.env[PI_WEB_SESSION_ENV] = "1";
const app = Fastify({ logger: true, bodyLimit: maxUploadBytes(daemonEnvironment, config) });
if (deprecatedAgentInputs.length > 0) {
  app.log.warn({ deprecatedAgentInputs }, "deprecated agent configuration inputs detected; support will be removed in a future release");
}
if (serverPluginRecovery.safeStartDiagnostic !== undefined) {
  app.log.error(
    { component: "server-plugins", configPath: serverPluginRecovery.path },
    serverPluginRecovery.safeStartDiagnostic,
  );
}
await app.register(fastifyWebsocket);
let serverQuiescing = false;
app.addHook("onRequest", (_request, reply, done) => {
  if (!serverQuiescing) {
    done();
    return;
  }
  void reply.code(503).send({ error: "Session daemon is shutting down" });
});
const serverPluginCatalog = new PiWebPluginCatalog({
  cwd: process.cwd(),
  agentDir: activeAgentProfile.dir,
  configProvider: () => config,
  warningSink: (message) => { app.log.warn({ component: "server-plugins" }, message); },
});

let runtimeShutdown: (() => Promise<void>) | undefined;
let pendingShutdownSignal: NodeJS.Signals | undefined;
let shutdownStarted = false;
async function requestShutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) return;
  if (runtimeShutdown === undefined) {
    pendingShutdownSignal = signal;
    return;
  }
  shutdownStarted = true;
  app.log.info({ signal }, "shutting down session daemon");
  await runtimeShutdown();
}
process.once("SIGINT", (signal) => { void requestShutdown(signal); });
process.once("SIGTERM", (signal) => { void requestShutdown(signal); });

/**
 * The session daemon is the long-lived owner of every active run. A plugin's
 * unhandled rejection - a pi-updater timer touching a disposed extension
 * runner killed pid 5602 mid-turn on 2026-09-04, taking two in-flight agent
 * runs with it - must never take the process down once it is serving.
 *
 * Registered only after startup succeeds: a daemon that survives its own
 * failed startup would hold the state-ownership claim as a zombie that serves
 * nothing, which the round-2 reviewers called out. Startup failures crash
 * loudly and release the claim; running failures are logged and survived.
 */
function survivePluginFailuresWhileServing(): void {
  process.on("unhandledRejection", (reason) => {
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    app.log.error({ detail }, "unhandled promise rejection survived by the session daemon");
  });
  process.on("uncaughtException", (error) => {
    const detail = error.stack ?? error.message;
    app.log.error({ detail }, "uncaught exception survived by the session daemon");
  });
}

// Agent-executed processes (bash tool, terminals, subsessions) are spawned from
// this process and inherit its environment. The scrub removes only the keys
// that silently distort the tools agents run; the daemon's PI_WEB_* wiring
// stays visible on purpose, because a nested instance resolving the same state
// now fails loudly through the ownership claim below instead of corrupting it
// silently. The daemon keeps using the captured daemonEnvironment above; its
// runtime stores resolve their paths from it explicitly below.
const scrubbedEnvKeys = scrubNonAgentVisibleEnvKeys(process.env);
app.log.info({ scrubbedEnvKeys }, "daemon-only environment keys hidden from agent processes");

// Claim ownership of the instance's durable state before any runtime store can
// touch it: a second daemon resolving the same data directory finds a live
// owner here and fails with an actionable error. Service and tsx-watch
// restarts briefly overlap the outgoing daemon, so the claim waits out a short
// grace for it to release first. The web/API process of this instance shares
// the data directory but never claims it.
const stateOwnership = await claimSessiondStateOwnership({ env: daemonEnvironment, logger: app.log });

const runtime = await createSessionDaemonRuntime();
try {
  registerSessionDaemonRoutes(runtime);
  await listenSessionDaemon(runtime);
  survivePluginFailuresWhileServing();
} catch (error) {
  try {
    await runtime.shutdown();
  } catch (disposeError) {
    app.log.error({ err: disposeError }, "session daemon startup failed and runtime disposal was incomplete");
  }
  throw error;
}

type SessionDaemonRuntime = Awaited<ReturnType<typeof createSessionDaemonRuntime>>;

async function createSessionDaemonRuntime() {
  // Apply the active agent profile's httpIdleTimeoutMs before any other
  // startup work so even catalog-refresh fetches run under the configured
  // HTTP idle timeouts (issue #113).
  const appliedHttpIdleTimeout = applyAgentHttpIdleTimeout({ agentDir: activeAgentProfile.dir, cwd: process.cwd() });
  if (appliedHttpIdleTimeout.warning !== undefined) {
    app.log.warn({ httpIdleTimeoutMs: appliedHttpIdleTimeout.timeoutMs }, appliedHttpIdleTimeout.warning);
  } else {
    app.log.info({ httpIdleTimeoutMs: appliedHttpIdleTimeout.timeoutMs }, "applied agent profile HTTP idle timeout to the session daemon HTTP stack");
  }
  const serverPlugins = await createServerPluginRuntime({
    catalog: serverPluginCatalog,
    ...(serverPluginRecovery.safeStart === undefined ? {} : { safeStart: serverPluginRecovery.safeStart }),
    logger: app.log,
    execFile: createServerPluginExecFile({ env: daemonEnvironment }),
  });
  try {
    const eventHub = new SessionEventHub();
    // Keepalives start with the daemon: a browser can only notice a dead
    // connection if it expects traffic (see KEEPALIVE_INTERVAL_MS).
    eventHub.startKeepalive();
    const notificationStore = new SessionNotificationStore();
    const unreadStore = new SessionUnreadStore({
      persistence: new FileSessionUnreadPersistence(defaultSessionUnreadFilePath(daemonEnvironment)),
      onPersistenceError(operation, error) {
        app.log.error({ err: error, operation }, "session unread persistence failed");
      },
    });
    await unreadStore.load();
    // Activity and status are mutually dependent by design: the record notifies
    // the projection, the projection reads the record. The notification runs
    // long after both are constructed.
    const workspaceActivity = new WorkspaceActivityService(() => { machineStatus.notifyChanged(); });
    const auth = await AuthService.create({ agentDir: activeAgentProfile.dir, logger: app.log });
    // Capture providers registered by global extensions while the runtime is
    // still mutable, then freeze every later extension-provider mutation before
    // any real session can load project resources.
    await bootstrapAndFreezeGlobalExtensionProviders(auth.runtime, activeAgentProfile.dir, app.log);
    // The shared model runtime is constructed offline so request paths never
    // wait on provider-catalog fetches; this is the single bounded network
    // refresher, and auth changes (login/logout) ask it for a prompt run. It
    // stays fully inert when the operator asked for offline behavior.
    const catalogRefresher = new ModelCatalogRefresher({
      runtime: auth.runtime,
      logger: app.log,
      offline: offlineModeEnabled(daemonEnvironment),
    });
    catalogRefresher.start();
    auth.subscribe(() => { catalogRefresher.requestRefresh(); });
    const projects = new ProjectService(new ProjectStore(projectStorePath(daemonEnvironment)));
    const providerHealth = await serverPlugins.inspectHealth();
    const workspaceProviders = new WorkspaceProviderRegistry({
      contributions: eligibleWorkspaceProviderContributions(serverPlugins.providerContributions(), providerHealth),
      logger: app.log,
    });
    const workspaceProviderRuntime = createWorkspaceProviderRuntimeSnapshot(
      serverPlugins.healthRecords(),
      providerHealth,
      serverPlugins.safeStartLevel(),
      serverPlugins.catalogDiagnostics(),
    );
    const statusAttribution = new CachedWorkspaceAttribution({
      projects,
      workspaces: workspaceProviders,
      logger: app.log,
    });
    const machineStatus = new MachineStatusService({
      activity: workspaceActivity,
      unread: unreadStore,
      attribution: statusAttribution,
      publisher: { publish: (snapshot) => { eventHub.publishRealtime({ type: "machine.status", status: snapshot }); } },
      logger: app.log,
    });
    // Every global subscriber is handed the current projection on connect, so a
    // browser never has to reconcile a snapshot fetch against live frames.
    eventHub.setGlobalJoinFrame(() => ({ type: "machine.status", status: machineStatus.snapshot() }));
    // Unread state was loaded from disk above, so the projection is computed
    // once at startup instead of waiting for the first change. It is not
    // awaited: resolving it lists workspaces through provider plugins, and
    // daemon startup must not depend on how long that takes.
    machineStatus.notifyChanged();
    const projectWorkspaceDeps = { projects, workspaces: workspaceProviders };
    const spawnTargets = config.spawnSessions ? new ProjectScopedSpawnTargetResolver(projectWorkspaceDeps) : undefined;
    const sessions = new PiSessionService(eventHub, sessionServiceDependencies({
      modelRuntime: auth.runtime,
      agentDir: activeAgentProfile.dir,
      archiveStore: new SessionArchiveStore(defaultSessionArchiveFilePath(daemonEnvironment)),
      workspaceActivity,
      logger: app.log,
      ...(spawnTargets === undefined ? {} : { spawnTargets }),
      subsessionsEnabled: config.subsessions,
      askUserEnabled: config.askUser,
      hostContributions: {
        // Sessions always run nested in this daemon, so they always get the
        // session environment facts; Docker deployments add their container
        // facts on top. Resolved once here, from the captured daemon
        // environment, because the deployment cannot change while the daemon
        // runs.
        systemPromptSections: [
          ...sessionEnvironmentPromptSections({
            env: daemonEnvironment,
            enabled: config.environmentFacts,
          }),
          ...dockerEnvironmentPromptSections({
            env: daemonEnvironment,
            enabled: config.environmentFacts,
            logger: app.log,
          }),
        ],
        // The one surface the browser cannot draw today: an extension's free
        // form. Requests are answered for the human in the browser; the call
        // resolves to a cancellation, announced, never silent.
        unsupportedSurfaces: ["custom"],
      },
      extensionDialogsTimeoutMs: config.extensionDialogsTimeoutMs,
      notificationStore,
      unreadStore,
      onUnreadChanged: () => { machineStatus.notifyChanged(); },
      catalogRefreshStatus: catalogRefresher,
      sessionManager: createPiSessionManagerGateway({
        agentDir: activeAgentProfile.dir,
        env: daemonEnvironment,
      }),
    }));
    auth.subscribe((change) => { sessions.applyAuthChange(change); });
    const terminals = new TerminalService(eventHub, workspaceActivity);
    const workspaceRemovals = new WorkspaceRemovalService(workspaceProviders, terminals);
    const runtimeComponent = Object.freeze({
      // The deprecated-input report is fixed at startup: it was detected from
      // the captured pre-scrub daemon environment and the config snapshot this
      // daemon actually honors, so it stays accurate for this daemon lifetime
      // and clears only when the inputs are removed and the daemon restarts.
      ...getPiWebRuntimeComponent("sessiond", SESSIOND_RUNTIME_CAPABILITIES, deprecatedAgentInputs),
      activeAgentProfile,
    });
    let disposed = false;
    const shutdown = async (): Promise<void> => {
      if (disposed) return;
      disposed = true;
      await runSessionDaemonShutdown({
        logger: app.log,
        dependencies: {
          quiesceServer: () => { serverQuiescing = true; },
          // Give agent turns already in flight a bounded chance to finish, so
          // updating or restarting does not cut work off mid-run. Disable with
          // PI_WEB_SHUTDOWN_DRAIN_MS=0.
          drainActiveWork: async () => {
            const timeoutMs = resolveDrainTimeoutMs(daemonEnvironment);
            const startedAt = Date.now();
            const decision = await drainActiveWork(timeoutMs, {
              activeSessionIds: () => sessions.activeWorkSessionIds(),
              elapsedMs: () => Date.now() - startedAt,
              wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            });
            if (decision.reason === "deadline-reached") {
              // Named, not swallowed: these are the runs the restart cut off.
              app.log.warn(
                { activeSessionIds: decision.activeSessionIds, timeoutMs },
                "shutdown drain deadline reached with work still running",
              );
              // Recorded so the next start can say which conversations were cut
              // off. The drain deadline is deliberately shorter than systemd's
              // TimeoutStopSec, so there is still time to write this before the
              // process is killed outright.
              const interrupted = new Set(decision.activeSessionIds);
              await recordInterruptedRuns(
                sessions
                  .activeWorkSessions()
                  .filter(({ sessionId }) => interrupted.has(sessionId))
                  .map(({ sessionId, cwd }) => ({ sessionId, cwd, interruptedAt: new Date().toISOString() })),
              );
            } else if (decision.reason === "waiting-for-active-work" || decision.reason === "no-active-work") {
              app.log.info({ waitedMs: Date.now() - startedAt }, "shutdown drain finished");
            }
          },
          serverPlugins,
          terminals,
          catalogRefresher,
          auth,
          sessions,
          unreadStore,
          closeServer: () => app.close(),
        },
        onFailure: () => { process.exitCode = 1; },
      });
      // Release last: the daemon owns the instance state until everything that
      // writes it is down. Best-effort; a leftover marker goes stale and the
      // next start discards it.
      await stateOwnership.release();
    };
    return { eventHub, machineStatus, statusAttribution, auth, sessions, terminals, unreadStore, activeAgentProfile, runtimeComponent, catalogRefresher, serverPlugins, projects, workspaceProviders, workspaceProviderRuntime, workspaceRemovals, shutdown };
  } catch (error) {
    try {
      await serverPlugins.stop();
    } catch (disposeError) {
      app.log.error({ err: disposeError }, "session daemon construction failed and server plugin disposal was incomplete");
    }
    throw error;
  }
}

function registerSessionDaemonRoutes({ eventHub, machineStatus, statusAttribution, auth, sessions, terminals, runtimeComponent, projects, workspaceProviders, workspaceProviderRuntime, workspaceRemovals }: SessionDaemonRuntime): void {
  registerMachineStatusRoutes(app, machineStatus);
  registerAuthRoutes(app, auth);
  registerSessionRoutes(app, sessions, eventHub);
  // Debug-only frame-drop arming for the e2e legs that need REAL loss. The
  // route exists only when the operator launched the daemon with
  // PI_WEB_DEBUG_FRAME_DROP=1; production daemons have no such endpoint.
  if (daemonEnvironment["PI_WEB_DEBUG_FRAME_DROP"] === "1") {
    // Under /api/ so the web/API process's proxy forwards it to this daemon.
    app.post("/api/debug/frame-drop", async (request, reply) => {
      const body: unknown = request.body;
      const sessionId: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "sessionId") : undefined;
      const count: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "count") : undefined;
      if (typeof sessionId !== "string" || sessionId === "" || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
        return reply.code(400).send({ error: "sessionId and a non-negative integer count are required" });
      }
      eventHub.debugDropNext(sessionId, count);
      return { armed: count };
    });
  }
  // Debug-only model-surface capture for the host-vs-native e2e leg
  // (match-tui-prompt 4.1). Exists only under PI_WEB_DEBUG_PROMPT_CAPTURE=1;
  // production daemons have no such endpoint. Absence answers
  // { available: false } — unavailable is never an empty claim.
  if (daemonEnvironment["PI_WEB_DEBUG_PROMPT_CAPTURE"] === "1") {
    app.get<{ Querystring: { sessionId?: string } }>("/api/debug/model-surface", async (request, reply) => {
      const sessionId: unknown = request.query.sessionId;
      if (typeof sessionId !== "string" || sessionId === "") {
        return reply.code(400).send({ error: "sessionId is required" });
      }
      const capture = sessions.captureModelSurface(sessionId);
      if (capture === undefined) {
        return reply.code(404).send({ available: false, error: "session not active or its runtime carries no capture" });
      }
      return { available: true, ...capture };
    });
  }
  registerTerminalRoutes(app, terminals);
  registerWorkspaceCatalogRoutes(app, {
    projects,
    workspaces: workspaceProviders,
    providerRuntime: workspaceProviderRuntime,
  });
  registerPluginBackendRoutes(app, {
    projects,
    backends: workspaceProviders,
    onWorkspacesMutated: () => { statusAttribution.invalidate(); },
  });
  registerWorkspaceRemovalRoutes(app, {
    projects,
    removals: workspaceRemovals,
    onWorkspacesMutated: () => { statusAttribution.invalidate(); },
  });

  app.get("/health", () => ({
    ok: true,
    activeSessions: sessions.activeCount(),
    checkedAt: new Date().toISOString(),
    version: {
      component: runtimeComponent.component,
      label: runtimeComponent.label,
      ...(runtimeComponent.runtimeVersion === undefined ? {} : { runtimeVersion: runtimeComponent.runtimeVersion }),
      ...(runtimeComponent.piVersion === undefined ? {} : { piVersion: runtimeComponent.piVersion }),
      stale: false,
      available: runtimeComponent.available,
    },
  }));

  app.get("/runtime", () => runtimeComponent);
}

async function listenSessionDaemon({ shutdown }: SessionDaemonRuntime): Promise<void> {
  runtimeShutdown = shutdown;
  if (pendingShutdownSignal !== undefined) {
    await requestShutdown(pendingShutdownSignal);
    return;
  }

  // Anything still marked in flight belongs to the previous process, which is
  // gone -- so it did not finish. Promoted into the record the API serves, and
  // cleared, so a restart cannot report the same interruption forever.
  const leftOverRuns = await takeInterruptedRuns();
  if (leftOverRuns.length > 0) {
    app.log.warn(
      { sessionIds: leftOverRuns.map((run) => run.sessionId) },
      "runs were in flight when the previous session daemon exited",
    );
    await recordInterruptedRuns(leftOverRuns);
  }

  const portValue = daemonEnvironment["PI_WEB_SESSIOND_PORT"];
  const port = portValue !== undefined && portValue !== "" ? Number(portValue) : undefined;
  const host = daemonEnvironment["PI_WEB_SESSIOND_HOST"] ?? "127.0.0.1";

  if (port !== undefined) {
    await app.listen({ port, host });
  } else {
    const path = sessiondSocketPath(daemonEnvironment);
    await mkdir(dirname(path), { recursive: true });
    await rm(path, { force: true });
    await app.listen({ path });
    process.on("exit", () => void rm(path, { force: true }));
  }
}
