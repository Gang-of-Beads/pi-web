import {
  PI_WEB_PLUGIN_LIFECYCLE_VERSION,
  type PiWebPluginDiagnostic,
  type PiWebPluginInfo,
  type PiWebPluginRuntimeStatus,
  type PiWebPluginSafeStart,
  type PiWebPluginsResponse,
  type PiWebPluginServerInfo,
} from "../../shared/apiTypes.js";
import { PI_WEB_PLUGIN_RECOVERY_COMMANDS, pluginDisableRecoveryCommand } from "../../shared/pluginRecoveryCommands.js";
import { pluginRunsOnWeb } from "../shared/piWebPluginCatalog.js";
import type { ServerPluginHealthInspection, ServerPluginRuntimeRecord } from "../shared/plugins/serverPluginRuntime.js";
import type {
  PiWebPluginCatalogDiagnostic,
  PiWebPluginCatalogEntry,
  PiWebPluginCatalogSnapshot,
} from "../shared/piWebPluginCatalog.js";
import type { WorkspaceProviderRuntimeSnapshot } from "../shared/workspaces/workspaceCatalog.js";

export type ProviderRuntimeLoadResult =
  | { status: "available"; views: WorkspaceProviderRuntimeViews }
  | { status: Exclude<PiWebPluginRuntimeStatus, "available">; message: string; views?: WorkspaceProviderRuntimeViews };

/**
 * The daemon runtime arrives over the provider-runtime handshake; the web
 * runtime is local to the web process. Each desired plugin reconciles
 * against the snapshot of the process its `runs` declaration addresses, so
 * a web-activated plugin is never judged by daemon records and a flat
 * snapshot never has to say "web active, daemon failed".
 */
export interface WorkspaceProviderRuntimeViews {
  daemon?: WorkspaceProviderRuntimeSnapshot;
  web?: WorkspaceProviderRuntimeSnapshot;
}

export interface ReconciledBrowserPlugin {
  plugin: PiWebPluginCatalogEntry;
  backendRevision?: string;
}

export interface PiWebPluginLifecycleReconciliation {
  response: PiWebPluginsResponse;
  browserPlugins: readonly ReconciledBrowserPlugin[];
}

/** Pure desired/active reconciliation shared by the manifest and diagnostics API. */
export function reconcilePiWebPluginLifecycle(
  desired: PiWebPluginCatalogSnapshot,
  runtime: ProviderRuntimeLoadResult,
  browserModuleUrl: (plugin: PiWebPluginCatalogEntry) => string,
  desiredSafeStart?: PiWebPluginSafeStart | "off",
): PiWebPluginLifecycleReconciliation {
  const activeDaemonSnapshot = runtime.views?.daemon;
  const activeWebSnapshot = runtime.views?.web;
  const desiredById = new Map(desired.plugins.map((plugin) => [plugin.id, plugin]));
  const daemonRecordsById = recordIndex(activeDaemonSnapshot?.records);
  const daemonHealthById = healthIndex(activeDaemonSnapshot?.health);
  const webRecordsById = recordIndex(activeWebSnapshot?.records);
  const webHealthById = healthIndex(activeWebSnapshot?.health);
  const diagnostics = publicDiagnostics(desired.diagnostics, [...(activeDaemonSnapshot?.diagnostics ?? []), ...(activeWebSnapshot?.diagnostics ?? [])]);
  const conflictIds = new Set(diagnostics.flatMap((diagnostic) => diagnostic.kind === "conflict" && diagnostic.pluginId !== undefined ? [diagnostic.pluginId] : []));
  const pluginIds = new Set([...desiredById.keys(), ...daemonRecordsById.keys(), ...webRecordsById.keys()]);
  const browserPlugins: ReconciledBrowserPlugin[] = [];
  const activeSafeStart = activeDaemonSnapshot?.safeStart ?? activeWebSnapshot?.safeStart ?? "off";
  const effectiveDesiredSafeStart = desiredSafeStart ?? activeSafeStart;

  const plugins = [...pluginIds]
    .sort((left, right) => left.localeCompare(right))
    .map((pluginId): PiWebPluginInfo => {
      const plugin = desiredById.get(pluginId);
      const daemonRecord = daemonRecordsById.get(pluginId);
      const webRecord = webRecordsById.get(pluginId);
      const runs = plugin?.runs ?? daemonRecord?.runs ?? webRecord?.runs;
      const onWeb = pluginRunsOnWeb(runs);
      const hasServer = plugin?.serverModule !== undefined || daemonRecord !== undefined || webRecord !== undefined;
      const daemonInfo = () => serverInfo(pluginId, plugin, daemonRecord, daemonHealthById.get(pluginId), runtime.status, activeDaemonSnapshot?.safeStart ?? "off", effectiveDesiredSafeStart);
      const webInfo = () => serverInfo(pluginId, plugin, webRecord, webHealthById.get(pluginId), activeWebSnapshot === undefined ? "unavailable" : "available", activeWebSnapshot?.safeStart ?? "off", effectiveDesiredSafeStart);
      const server = !hasServer
        ? undefined
        : !onWeb
          ? daemonInfo()
          : runs === "both"
            ? mergeBothRoleInfo(webInfo(), daemonInfo())
            : webInfo();
      const record = onWeb ? webRecord : daemonRecord;

      if (plugin?.browserModule !== undefined && shouldPublishBrowserPlugin(plugin, server)) {
        browserPlugins.push({
          plugin,
          ...(server?.activeRevision === undefined ? {} : { backendRevision: server.activeRevision }),
        });
      }

      if (plugin !== undefined) {
        return {
          id: plugin.id,
          ...(plugin.browserModule === undefined ? {} : { module: browserModuleUrl(plugin) }),
          source: plugin.source,
          scope: plugin.scope,
          machineSpecific: plugin.machineSpecific,
          enabled: plugin.enabled,
          discovered: true,
          conflict: conflictIds.has(plugin.id),
          ...(server === undefined ? {} : { server }),
        };
      }

      if (record === undefined || server === undefined) throw new Error(`Missing active server plugin record: ${pluginId}`);
      return {
        id: record.pluginId,
        source: record.source,
        scope: record.scope,
        machineSpecific: record.machineSpecific,
        enabled: false,
        discovered: false,
        conflict: conflictIds.has(record.pluginId),
        server,
      };
    });

  const safeStartRestartRequired = safeStartRestartRequiredFor(runtime, activeDaemonSnapshot, activeWebSnapshot, desiredSafeStart);
  const restartRequired = safeStartRestartRequired || plugins.some((plugin) => plugin.server?.restartRequired === true);
  return {
    response: {
      lifecycleVersion: PI_WEB_PLUGIN_LIFECYCLE_VERSION,
      plugins,
      diagnostics,
      serverRuntime: {
        status: runtime.status,
        ...(activeSafeStart === "off" ? {} : { safeStart: activeSafeStart }),
        ...(desiredSafeStart === undefined ? {} : { desiredSafeStart }),
        restartRequired,
        ...(runtime.status === "available" ? {} : { message: runtime.message }),
        recovery: PI_WEB_PLUGIN_RECOVERY_COMMANDS,
      },
    },
    browserPlugins: Object.freeze(browserPlugins),
  };
}

function recordIndex(records: readonly ServerPluginRuntimeRecord[] | undefined): Map<string, ServerPluginRuntimeRecord> {
  return new Map(records?.map((record) => [record.pluginId, record]) ?? []);
}

function healthIndex(health: readonly ServerPluginHealthInspection[] | undefined): Map<string, ServerPluginHealthInspection> {
  return new Map(health?.map((inspection) => [inspection.pluginId, inspection]) ?? []);
}

/**
 * Safe start lives in both processes (the web runtime applies the same
 * level as the daemon), so a mismatch in either one means that process
 * needs a restart. With neither snapshot available, the historical rule
 * holds: an unavailable runtime reports the desired level as unapplied.
 */
function safeStartRestartRequiredFor(
  runtime: ProviderRuntimeLoadResult,
  daemon: WorkspaceProviderRuntimeSnapshot | undefined,
  web: WorkspaceProviderRuntimeSnapshot | undefined,
  desiredSafeStart: PiWebPluginSafeStart | "off" | undefined,
): boolean {
  if (desiredSafeStart === undefined) return false;
  if (daemon !== undefined) return desiredSafeStart !== (daemon.safeStart ?? "off")
    || (web !== undefined && desiredSafeStart !== (web.safeStart ?? "off"));
  if (web !== undefined) return desiredSafeStart !== (web.safeStart ?? "off");
  return runtime.status === "available" ? false : desiredSafeStart !== "off";
}

/**
 * A `both` plugin's browser module must pair with both processes: the web
 * view serves the browser asset and its routes, the daemon still answers
 * the operations the proxy forwards. Either view drifting means a restart
 * is required; the reported revision is the web one because that is what
 * the browser actually loads.
 */
function mergeBothRoleInfo(web: PiWebPluginServerInfo, daemon: PiWebPluginServerInfo): PiWebPluginServerInfo {
  const state = web.state === "active" && daemon.state === "active"
    ? "active"
    : web.state !== "active"
      ? web.state
      : daemon.state;
  return {
    state,
    ...(web.desiredRevision === undefined ? {} : { desiredRevision: web.desiredRevision }),
    ...(web.activeRevision === undefined ? {} : { activeRevision: web.activeRevision }),
    ...(web.phase === undefined && daemon.phase === undefined ? {} : { phase: web.phase ?? daemon.phase }),
    ...(web.message === undefined && daemon.message === undefined ? {} : { message: web.message ?? daemon.message }),
    ...(web.health === undefined && daemon.health === undefined ? {} : { health: web.health ?? daemon.health }),
    staleRevision: web.staleRevision || daemon.staleRevision,
    restartRequired: web.restartRequired || daemon.restartRequired,
    disableCommand: web.disableCommand,
  };
}

function serverInfo(
  pluginId: string,
  desired: PiWebPluginCatalogEntry | undefined,
  active: ServerPluginRuntimeRecord | undefined,
  health: ServerPluginHealthInspection | undefined,
  runtimeStatus: PiWebPluginRuntimeStatus,
  activeSafeStart: PiWebPluginSafeStart | "off",
  desiredSafeStart: PiWebPluginSafeStart | "off",
): PiWebPluginServerInfo {
  const staleRevision = revisionsAreStale(desired, active);
  const state = runtimeStatus !== "available"
    ? "unknown"
    : active?.state ?? (desired !== undefined && !serverEnabledForSafeStart(desired, activeSafeStart) ? "disabled" : "missing");
  const restartRequired = runtimeStatus === "available" && serverRestartRequired(desired, active, staleRevision, desiredSafeStart);
  const phase = active?.phase ?? health?.phase;
  const message = active?.message ?? health?.error;
  return {
    state,
    ...(desired?.serverModule === undefined ? {} : { desiredRevision: desired.serverModule.revision }),
    ...(active === undefined ? {} : { activeRevision: active.moduleRevision }),
    ...(phase === undefined ? {} : { phase }),
    ...(message === undefined ? {} : { message }),
    ...(health === undefined ? {} : {
      health: {
        status: health.health.status,
        ...(health.health.message === undefined ? {} : { message: health.health.message }),
      },
    }),
    staleRevision,
    restartRequired,
    disableCommand: pluginDisableRecoveryCommand(pluginId),
  };
}

function serverRestartRequired(
  desired: PiWebPluginCatalogEntry | undefined,
  active: ServerPluginRuntimeRecord | undefined,
  staleRevision: boolean,
  desiredSafeStart: PiWebPluginSafeStart | "off",
): boolean {
  if (desired === undefined) {
    if (active === undefined) return false;
    return active.state !== "disabled";
  }
  const shouldBeActive = serverEnabledForSafeStart(desired, desiredSafeStart);
  if (active === undefined) return shouldBeActive;
  if (!shouldBeActive) return active.state !== "disabled";
  if (staleRevision) return true;
  return active.state !== "active";
}

function serverEnabledForSafeStart(plugin: PiWebPluginCatalogEntry, safeStart: PiWebPluginSafeStart | "off"): boolean {
  return plugin.enabled
    && safeStart !== "none"
    && (safeStart !== "bundled-only" || plugin.scope === "bundled");
}

function shouldPublishBrowserPlugin(
  plugin: PiWebPluginCatalogEntry,
  server: PiWebPluginServerInfo | undefined,
): boolean {
  if (plugin.browserModule === undefined) return false;
  if (server === undefined) return plugin.enabled;
  if (plugin.serverModule === undefined) return false;
  return server.state === "active"
    && !server.staleRevision
    && server.health?.status !== "unhealthy";
}

function revisionsAreStale(
  desired: PiWebPluginCatalogEntry | undefined,
  active: ServerPluginRuntimeRecord | undefined,
): boolean {
  if (desired === undefined) return false;
  if (active === undefined) return false;
  const browserRevision = desired.browserModule?.revision;
  return desired.serverModule?.revision !== active.moduleRevision
    || (browserRevision !== undefined && browserRevision !== active.browserRevision)
    || desired.settingsRevision !== active.settingsRevision
    || desired.source !== active.source
    || desired.scope !== active.scope
    || desired.machineSpecific !== active.machineSpecific;
}

function publicDiagnostics(
  desired: readonly PiWebPluginCatalogDiagnostic[],
  active: readonly PiWebPluginCatalogDiagnostic[],
): PiWebPluginDiagnostic[] {
  return [
    ...desired.map((diagnostic) => publicDiagnostic(diagnostic, "desired")),
    ...active.map((diagnostic) => publicDiagnostic(diagnostic, "active")),
  ];
}

function publicDiagnostic(
  diagnostic: PiWebPluginCatalogDiagnostic,
  snapshot: PiWebPluginDiagnostic["snapshot"],
): PiWebPluginDiagnostic {
  return {
    kind: diagnostic.code === "duplicate-id" ? "conflict" : "discovery",
    snapshot,
    source: diagnostic.source,
    message: diagnostic.message,
    ...(diagnostic.pluginId === undefined ? {} : { pluginId: diagnostic.pluginId }),
  };
}
