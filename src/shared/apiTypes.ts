import type { MachineStatusUiEvent } from "./machineStatus.js";
import type {
  DeleteWorkspaceFileResponse,
  FileContentMediaType,
  FileContentResponse,
  FileTreeEntry,
  FileTreeResponse,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MachineKind,
  MoveWorkspaceFileOptions,
  MoveWorkspaceFileResponse,
  PiWebComponentStatus,
  PiWebDockerMode,
  PiWebInstallationInfo,
  PiWebInstallationKind,
  PiWebReleaseStatus,
  PiWebServiceComponent,
  PiWebStatusMessage,
  PiWebStatusResponse,
  PiWebStatusSeverity,
  PiWebVersionResponse,
  TerminalCommandRun,
  TerminalCommandRunHandle,
  TerminalCommandRunStatus,
  WorkspaceProviderCapabilities,
  WorkspaceProviderMetadata,
  WorkspaceFileRefusal,
  WorkspaceRemovalPresentation,
  WriteWorkspaceFileOptions,
  WriteWorkspaceFileResponse,
} from "./pluginApiTypes.js";

export type {
  DeleteWorkspaceFileResponse,
  FileContentMediaType,
  FileContentResponse,
  FileTreeEntry,
  FileTreeResponse,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MachineKind,
  MoveWorkspaceFileOptions,
  MoveWorkspaceFileResponse,
  PiWebComponentStatus,
  PiWebDockerMode,
  PiWebInstallationInfo,
  PiWebInstallationKind,
  PiWebReleaseStatus,
  PiWebServiceComponent,
  PiWebStatusMessage,
  PiWebStatusResponse,
  PiWebStatusSeverity,
  PiWebVersionResponse,
  TerminalCommandRun,
  TerminalCommandRunHandle,
  TerminalCommandRunStatus,
  WorkspaceProviderCapabilities,
  WorkspaceProviderMetadata,
  WorkspaceRemovalPresentation,
  WriteWorkspaceFileOptions,
  WriteWorkspaceFileResponse,
};

/** Internal query shape for PI WEB's terminal-command-runs host protocol. */
export interface TerminalCommandRunFilter {
  projectId?: string;
  workspaceId?: string;
  terminalId?: string;
  statuses?: TerminalCommandRunStatus[];
  metadata?: Record<string, string>;
}

export type MachineStatus = "unknown" | "online" | "offline" | "error";

/**
 * Registry of feature-gating capabilities. Add an entry here (plus the
 * runtime/requirements entries in `capabilities.ts`) when a feature needs
 * rolling-version gating.
 */
export const PI_WEB_CAPABILITIES = {
  pluginLifecycle: "plugins.lifecycle",
  /** A plugin toggle applies live and the machine announces it with `plugins.changed` (B19 slice C). */
  livePluginToggle: "plugins.live-toggle",
} as const;

export type PiWebCapability = typeof PI_WEB_CAPABILITIES[keyof typeof PI_WEB_CAPABILITIES];

export interface Machine {
  id: string;
  name: string;
  kind: MachineKind;
  baseUrl?: string;
  createdAt: string;
  updatedAt: string;
  status?: MachineStatus;
  statusMessage?: string;
}

export interface MachineHealth {
  machineId: string;
  ok: boolean;
  checkedAt: string;
  status?: MachineStatus;
  web?: PiWebComponentStatus;
  sessiond?: PiWebComponentStatus;
  error?: string;
}

export interface MachineRuntime {
  machineId: string;
  ok: boolean;
  checkedAt: string;
  packageName?: string;
  generatedAt?: string;
  components?: PiWebRuntimeResponse["components"];
  capabilities?: PiWebCapability[];
  /** Deprecated agent-configuration inputs detected on this machine (union of the web and session daemon reports, deduplicated); omitted when none. */
  deprecatedAgentInputs?: readonly PiWebDeprecatedAgentInput[];
  error?: string;
}

export type PiWebShortcutConfig = Record<string, string | null>;
export type PiWebPluginSettings = Record<string, unknown>;
export type PiWebPluginConfigMap = Record<string, PiWebPluginConfig>;

export interface PiWebPluginConfig {
  enabled?: boolean;
  settings?: PiWebPluginSettings;
  [key: string]: unknown;
}

export interface PiWebPathAccessConfig {
  allowedPaths?: string[];
}



export interface PiWebUploadsConfig {
  defaultFolder?: string;
}

export interface PiWebAgentConfig {
  /** Deprecated and ignored: the multi-implementation CLI abstraction was removed; sessions always run on the bundled pi SDK. Detected for the deprecation warning. */
  command?: string;
  /** Deprecated alias for the PI_CODING_AGENT_DIR env var: pi agent state directory containing auth.json, models.json, settings.json, and sessions/. */
  dir?: string;
}

/**
 * A deprecated agent-configuration input detected on one machine, as reported
 * over the runtime/status pipeline. Values from the legacy PI_WEB_AGENT_* env
 * vars and the agent.* config keys are still honored (or, for the removed
 * command concept, ignored) during the deprecation window; every detected
 * input is surfaced as a non-dismissable UI warning until the input is removed.
 */
export interface PiWebDeprecatedAgentInput {
  /** Where the input was found: the process environment or the config file. */
  readonly source: "environment" | "config";
  /** The deprecated input as the user set it: an env var name or a config key path. */
  readonly name: string;
  /** The replacement input; absent when the concept was removed and the input should simply be deleted. */
  readonly replacement?: string;
}

/** Tiles per row in a Navigate list. */
export type ListTilesPerRow = 1 | 2;

/**
 * Tiles per row in the Navigate page's lists (Sessions, Machines, Projects), one choice per PI WEB
 * layout; an absent layout keeps the width rule (docs/design/list-layout.md).
 */
export interface PiWebListTilesConfig {
  phone?: ListTilesPerRow;
  desktop?: ListTilesPerRow;
}

export interface PiWebConfigValues {
  host?: string;
  port?: number;
  allowedHosts?: string[] | true;
  shortcuts?: PiWebShortcutConfig;
  plugins?: PiWebPluginConfigMap;
  /** External filesystem roots PI WEB may expose outside a workspace. */
  pathAccess?: PiWebPathAccessConfig;
  /** Workspace-relative defaults for manual file uploads. */
  uploads?: PiWebUploadsConfig;
  /** Maximum accepted HTTP request body size in bytes (uploads/attachments). */
  maxUploadBytes?: number;
  /** What the web and session daemon logs record, and how much of them stays on disk. */
  logging?: PiWebLoggingConfig;
  /**
   * The command that updates this machine's PI WEB and restarts it, run by the
   * Updates page's Update button. Wins over the services' PI_WEB_UPDATE_COMMAND
   * and over the command PI WEB derives from the install method; empty is none.
   */
  updateCommand?: string;
  /** Tiles per row in the Navigate lists, per layout; see PiWebListTilesConfig. */
  listTiles?: PiWebListTilesConfig;
  /**
   * When true, LLMs can post a question set to the browser via the ask_user
   * tool. Off by default; set to `true` to add the tool to the runtime.
   */
  askUser?: boolean;
  /**
   * When true, PI WEB appends environment facts to session system prompts:
   * the pi-web session nesting every session runs in, plus container facts in
   * Docker deployments. On by default.
   */
  environmentFacts?: boolean;
  /**
   * How long an extension dialog may wait for an answer before the daemon
   * auto-cancels it, in milliseconds. Applies only when the extension set no
   * `timeout` of its own (the sooner of the two wins); `0` waits forever.
   * Tuning knob only — extension dialogs are always enabled.
   */
  extensionDialogsTimeoutMs?: number;
  /** Deprecated agent-configuration keys, still honored as aliases during the deprecation window and detected for the deprecation warning (see PiWebAgentConfig). */
  agent?: PiWebAgentConfig;
}

/**
 * `level`: `errors` records failed (5xx) and slow requests, `requests` every request, `debug`
 * every request and debug messages. `maxFileMb` and `keepFiles`: a log file larger than
 * `maxFileMb` is moved to `<name>.1` and started again; `keepFiles` older copies are kept.
 */
export interface PiWebLoggingConfig {
  level?: "errors" | "requests" | "debug";
  maxFileMb?: number;
  keepFiles?: number;
}

export type PiWebPluginScope = "bundled" | "local" | "user" | "project";

export const PI_WEB_PLUGIN_LIFECYCLE_VERSION = 1;

export type PiWebPluginServerState = "active" | "failed" | "incompatible" | "disabled" | "missing" | "unknown";
export type PiWebPluginLifecyclePhase = "import" | "activate" | "validate" | "start" | "health" | "stop";
export type PiWebPluginHealthStatus = "healthy" | "degraded" | "unhealthy";
export type PiWebPluginRuntimeStatus = "available" | "unavailable" | "incompatible";
export type PiWebPluginSafeStart = "bundled-only" | "none";

export interface PiWebPluginServerInfo {
  state: PiWebPluginServerState;
  desiredRevision?: string;
  activeRevision?: string;
  phase?: PiWebPluginLifecyclePhase;
  message?: string;
  health?: {
    status: PiWebPluginHealthStatus;
    message?: string;
  };
  staleRevision: boolean;
  restartRequired: boolean;
  /** Exact offline command; plugin ids are restricted to shell-safe bare ids. */
  disableCommand: string;
}

export interface PiWebPluginInfo {
  id: string;
  /** Browser module URL for the currently discovered package, if any. */
  module?: string;
  source: string;
  scope: PiWebPluginScope;
  machineSpecific: boolean;
  /** Desired config state; the active server snapshot may intentionally differ. */
  enabled: boolean;
  /** False when only the still-active sessiond snapshot knows this plugin. */
  discovered: boolean;
  /** A duplicate id was diagnosed in either the desired or active catalog. */
  conflict: boolean;
  server?: PiWebPluginServerInfo;
}

export interface PiWebPluginDiagnostic {
  kind: "conflict" | "discovery";
  snapshot: "desired" | "active";
  source: string;
  message: string;
  pluginId?: string;
}

export interface PiWebPluginRecoveryCommands {
  showSafeStart: string;
  bundledOnly: string;
  noServerPlugins: string;
  clearSafeStart: string;
}

export interface PiWebPluginRuntimeInfo {
  status: PiWebPluginRuntimeStatus;
  /** Safe-start level active in either process; absence means no process is in recovery. */
  safeStart?: PiWebPluginSafeStart;
  /** Current offline recovery config, including explicit `off` when known. */
  desiredSafeStart?: PiWebPluginSafeStart | "off";
  restartRequired: boolean;
  message?: string;
  recovery: PiWebPluginRecoveryCommands;
}

export interface PiWebPluginsResponse {
  lifecycleVersion: typeof PI_WEB_PLUGIN_LIFECYCLE_VERSION;
  plugins: PiWebPluginInfo[];
  diagnostics: PiWebPluginDiagnostic[];
  serverRuntime: PiWebPluginRuntimeInfo;
}

export type PiPackageScope = "user" | "project";

export interface PiPackageInfo {
  source: string;
  scope: PiPackageScope;
  filtered: boolean;
  installedPath?: string;
}

export interface PiPackagesResponse {
  packages: PiPackageInfo[];
}

export interface PiPackageInstallRequest {
  source: string;
}

export interface PiPackageRemoveRequest {
  source: string;
  /** Optional known scope from a listed package; not an install-location picker. */
  scope?: PiPackageScope;
}

export interface PiPackageUpdateRequest {
  /** Omit to update all configured Pi packages. */
  source?: string;
}

export type PiPackageMutationAction = "install" | "remove" | "update";

export interface PiPackageMutationResponse extends PiPackagesResponse {
  action: PiPackageMutationAction;
  source?: string;
  scope?: PiPackageScope;
  removed?: boolean;
}

export interface PiWebConfigEnvOverrides {
  host: boolean;
  port: boolean;
  allowedHosts: boolean;
  askUser: boolean;
}

export interface PiWebConfigResponse {
  path: string;
  exists: boolean;
  config: PiWebConfigValues;
  effectiveConfig: PiWebConfigValues;
  envOverrides: PiWebConfigEnvOverrides;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  /** The project's folder is certainly gone, as the project list read it (`projectFolderPresence.ts`). */
  folderMissing?: true;
}

export interface WorkspaceEffectiveConfig {
  readonly uploads?: Readonly<PiWebUploadsConfig>;
}

/** Host-only removal state carried by PI WEB's browser/sessiond protocol. */
export interface WorkspaceRemovalHostState extends WorkspaceRemovalPresentation {
  /** Opaque token binding a removal confirmation to this exact owner snapshot. */
  readonly precondition: string;
}

/**
 * Per-project Pi trust state for a workspace path, as stored in the agent
 * directory's `trust.json` (shared with the Pi CLI).
 */
export interface WorkspaceTrustResponse {
  /** The workspace path the decision is keyed on. */
  path: string;
  /** Raw stored decision: `true`/`false` for an explicit entry, `null` when unset. */
  decision: boolean | null;
  /** Effective trust the toggle reflects: the stored decision, else `defaultProjectTrust === "always"`. */
  trusted: boolean;
}

export interface WorkspaceRemovalRequest {
  precondition: string;
}

export type WorkspaceProviderResolutionStatus = "provider" | "folder" | "degraded";
export type WorkspaceProviderTier = "primary" | "fallback";
export type WorkspaceProviderDiagnosticCode = "probe-failed" | "claim-conflict" | "list-failed";

export interface WorkspaceProviderDiagnostic {
  readonly code: WorkspaceProviderDiagnosticCode;
  readonly message: string;
  readonly tier: WorkspaceProviderTier;
  readonly pluginId?: string;
  readonly pluginIds?: readonly string[];
}

/** Provider-neutral result of resolving one project's current workspace owner. */
export interface WorkspaceProviderResolution {
  readonly status: WorkspaceProviderResolutionStatus;
  readonly projectId: string;
  readonly ownerPluginId?: string;
  readonly workspaces: readonly Workspace[];
  readonly diagnostics: readonly WorkspaceProviderDiagnostic[];
}

/** Host-resolved workspace snapshot. */
export interface Workspace {
  readonly id: string;
  readonly projectId: string;
  readonly path: string;
  readonly label: string;
  readonly isMain: boolean;
  /** True when the workspace's folder is gone: the listing stamped it, and
   * sessions or terminals can never start inside it. */
  readonly cwdMissing?: boolean;
  readonly provider?: WorkspaceProviderMetadata;
  readonly removal?: WorkspaceRemovalHostState;
  /** Workspace-effective project/global settings needed by workspace UI features. Always present on current server workspace responses. */
  readonly effectiveConfig: WorkspaceEffectiveConfig;
}

/** Workspace as listed by the workspace authority, before the browser route layer attaches the wire-required effectiveConfig. */
export type WorkspaceListing = Omit<Workspace, "effectiveConfig">;

/** Provider resolution as served by the sessiond workspace authority; the browser route layer attaches effectiveConfig to every workspace before responding. */
export type WorkspaceProviderAuthorityResolution = Omit<WorkspaceProviderResolution, "workspaces"> & {
  workspaces: readonly WorkspaceListing[];
};

export interface SessionRef {
  id: string;
  cwd: string;
}

export const SESSION_UNREAD_LIMIT = 1_000;
export const SESSION_UNREAD_SESSION_ID_MAX_LENGTH = 512;
export const SESSION_UNREAD_CWD_MAX_LENGTH = 32 * 1024;
export const SESSION_UNREAD_CATALOG_ID_MAX_LENGTH = 512;
export const SESSION_UNREAD_COMPLETED_AT_MAX_LENGTH = 64;

/** The code a daemon answers with for a session it does not have (object model §1.6). */
export const SESSION_NOT_FOUND_CODE = "session-not-found";

/** The code the web and the daemon answer with for a route they do not have: the machine is older than the page (B16). */
export const ROUTE_MISSING_CODE = "route-missing";

/**
 * What a failed answer says about the link (B16), in the `transport` field of its error body: the
 * web process found nothing listening where its session daemon should be (the daemon is restarting,
 * or gone), or the gateway could not reach a remote machine. Either heals by itself and the page
 * words it as such. The field is set from the errno or the gateway's own failure, never from words;
 * a failure it does not name keeps its own words and its reader's lifetime.
 */
export const TRANSPORT_FAILURES = ["daemon-not-listening", "machine-unreachable"] as const;
export type TransportFailure = (typeof TRANSPORT_FAILURES)[number];

export type { WorkspaceFileRefusal } from "./pluginApiTypes.js";

export const WORKSPACE_FILE_REFUSALS: readonly WorkspaceFileRefusal[] = ["path-missing", "path-not-a-directory"];

/** What a machine that predates the code answers instead, read until every machine carries it (rolling compatibility). */
const LEGACY_REFUSAL_WORDS: Readonly<Record<string, WorkspaceFileRefusal>> = {
  "Path does not exist": "path-missing",
  "Path is not a directory": "path-not-a-directory",
};

/** The refusal a rejected workspace file call carries, or undefined for any other failure. */
export function workspaceFileRefusalOf(error: unknown): WorkspaceFileRefusal | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "code");
  const typed = WORKSPACE_FILE_REFUSALS.find((refusal) => refusal === code);
  if (typed !== undefined || code !== undefined) return typed;
  const message: unknown = Reflect.get(error, "message");
  return typeof message === "string" && Object.hasOwn(LEGACY_REFUSAL_WORDS, message) ? LEGACY_REFUSAL_WORDS[message] : undefined;
}

/**
 * Why a folder cannot become a project, as the code of the 400 the add route answers (B16): the
 * page words it from the code, where it used to search the error text for ENOENT and EACCES.
 */
export type ProjectFolderRefusal = "folder-missing" | "not-a-folder" | "folder-unreadable" | "folder-not-created";

export const PROJECT_FOLDER_REFUSALS: readonly ProjectFolderRefusal[] = ["folder-missing", "not-a-folder", "folder-unreadable", "folder-not-created"];

export interface SessionUnreadSummary {
  sessionId: string;
  cwd: string;
  /** Monotonic within a catalog and never greater than its containing revision. */
  completionOrder: number;
  completedAt: string;
}

export interface SessionUnreadCatalogSnapshot {
  /** Stable for one persisted catalog epoch; changes when unread state is reset. */
  catalogId: string;
  /** Monotonic catalog mutation revision; at least every contained completion order. */
  catalogRevision: number;
  /** Bounded by `SESSION_UNREAD_LIMIT` and ordered newest completion first. */
  sessions: SessionUnreadSummary[];
}

/**
 * The answer to a listing refresh that echoed back a stored revision:
 * either the payload with its current revision, or a cheap verdict that
 * nothing changed and the reader's rows already are the truth.
 */
export type SessionsRevisionResponse =
  | { revision: string; unchanged: true }
  | { revision: string; unchanged?: false; sessions: SessionInfo[] };

/**
 * What the daemon did with an acknowledgement.
 *
 * The snapshot alone cannot say: a refused acknowledgement and an accepted one
 * both answer with the current catalog, so a browser that removed the row
 * optimistically could not tell that the row was coming back. Saying which it
 * was lets the reader be told, instead of being left tapping.
 */
export type SessionUnreadAcknowledgeOutcomeValue = "acknowledged" | "superseded" | "stale-epoch";

export interface SessionUnreadAcknowledgeResponse extends SessionUnreadCatalogSnapshot {
  /** Absent from hosts predating this field, which is read as "acknowledged". */
  outcome?: SessionUnreadAcknowledgeOutcomeValue;
}

/**
 * Status of every session the daemon currently holds open, used to hydrate a
 * freshly loaded or freshly reconnected browser.
 *
 * Live status is otherwise delivered only as `status.update` broadcasts, so a
 * browser that arrives mid-stream shows no work indicator for an already-busy
 * session until its next publish. A session missing from `statuses` is not
 * loaded by this daemon, which means its work state is *unknown* rather than
 * idle — a session running under another host reports to nobody here.
 */
export interface SessionStatusCatalogSnapshot {
  statuses: SessionStatus[];
  generatedAt: string;
  /**
   * Identity of the daemon process that produced this catalog, the same id the
   * notifications catalog publishes as `daemonInstanceId`: one id per daemon
   * process, so a changed id means the daemon itself was replaced. Session ids
   * are that process's runtime handles, so a browser reconciling its status
   * indicators against the catalog must know which instance is speaking -
   * entries left behind by an earlier instance describe sessions the current
   * one may not hold. Absent from a daemon that predates the field.
   */
  daemonInstanceId?: string;
}

export interface SessionUnreadAcknowledgeRequest {
  cwd: string;
  /** The catalog epoch in which `throughCompletionOrder` was observed. */
  catalogId: string;
  throughCompletionOrder: number;
}

/** Authoritative delta for one session in the daemon-owned unread catalog. */
export interface SessionUnreadEvent {
  type: "sessions.unread";
  catalogId: string;
  /** At least `unread.completionOrder` when carrying an unread summary. */
  catalogRevision: number;
  sessionId: string;
  cwd: string;
  unread: SessionUnreadSummary | null;
}

export const SESSION_NOTIFICATION_LIMIT = 100;
export const SESSION_NOTIFICATION_MESSAGE_BYTES = 8 * 1024;

export type SessionNotificationSeverity = "info" | "warning" | "error";

export interface SessionNotification {
  id: string;
  message: string;
  truncated: boolean;
  severity: SessionNotificationSeverity;
  receivedAt: string;
  order: number;
  /**
   * Present on a notification filed from a warning that has a server-side
   * off-switch (today: the Anthropic billing notice). Opaque passthrough: the
   * browser hands it back through warnings/dismiss so dismissing the record
   * also silences the warning, instead of it re-filing on the next restart.
   */
  warningDismiss?: { id: string };
}

export interface SessionNotificationSummary {
  sessionId: string;
  cwd: string;
  inboxRevision: number;
  retainedCount: number;
  discardedCount: number;
  highestSeverity?: SessionNotificationSeverity;
}

export interface SessionNotificationDismissThrough {
  order: number;
  overflowWatermark: number;
}

export interface SessionNotificationInboxSnapshot {
  daemonInstanceId: string;
  catalogRevision: number;
  summary: SessionNotificationSummary;
  notifications: SessionNotification[];
  dismissThrough: SessionNotificationDismissThrough;
}

/**
 * What the daemon did with a dismissal.
 *
 * The snapshot alone cannot say, for the same reason an acknowledgement could
 * not: a refused dismissal and an accepted one both answer with the current
 * inbox, so a browser that removed the row optimistically could not tell the
 * row was coming back. "stale-instance" means the daemon restarted since the
 * range was read, not that the request was wrong.
 */
export type SessionNotificationDismissOutcomeValue = "dismissed" | "stale-instance";

export interface SessionNotificationDismissResponse extends SessionNotificationInboxSnapshot {
  /** Absent from hosts predating this field, which is read as "dismissed". */
  outcome?: SessionNotificationDismissOutcomeValue;
}

export interface SessionNotificationCatalogSnapshot {
  daemonInstanceId: string;
  catalogRevision: number;
  sessions: SessionNotificationSummary[];
}

export interface SessionNotificationDismissRequest {
  cwd: string;
  daemonInstanceId: string;
  notificationId: string;
}

export interface SessionNotificationDismissAllRequest {
  cwd: string;
  daemonInstanceId: string;
  throughOrder: number;
  throughOverflowWatermark: number;
}

export type SessionNotificationClearReason =
  | "runtime-close"
  | "archive"
  | "delete"
  | "restore"
  | "archive-reconcile"
  | "replacement"
  | "initialization-failed"
  | "service-dispose";

export type SessionNotificationInboxDelta =
  | { kind: "added"; notification: SessionNotification; evictedNotificationId?: string }
  | { kind: "dismissed"; notificationIds: string[] }
  | { kind: "cleared"; reason: SessionNotificationClearReason }
  | { kind: "resync" };

export interface SessionNotificationInboxEvent {
  type: "notifications.inbox";
  daemonInstanceId: string;
  catalogRevision: number;
  summary: SessionNotificationSummary;
  dismissThrough: SessionNotificationDismissThrough;
  delta: SessionNotificationInboxDelta;
}

export interface SessionNotificationSummaryEvent {
  type: "notifications.summary";
  daemonInstanceId: string;
  catalogRevision: number;
  summary: SessionNotificationSummary;
}

export interface SessionInfo extends SessionRef {
  path: string;
  /** True when the server has verified a backing session file exists; false when known transient. */
  persisted?: boolean;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  parentSessionPath?: string;
  archived?: boolean;
  archivedAt?: string;
  /** The stored working directory is gone: the row renders as unopenable. */
  cwdMissing?: boolean;
}

export interface ArchiveSessionsResponse {
  archived: true;
  sessionIds?: string[];
  archivedCount?: number;
  skippedAlreadyArchivedCount?: number;
}

export interface SessionBulkMutationRef {
  id: string;
  cwd: string;
}

export interface SessionBulkMutationRequest {
  sessions: SessionBulkMutationRef[];
}

export interface SessionBulkFailure {
  sessionId: string;
  error: string;
}

export interface SessionBulkArchiveResponse {
  archived: true;
  archivedSessionIds: string[];
  failures: SessionBulkFailure[];
  generatedAt: string;
}

export interface SessionBulkDeleteArchivedResponse {
  deleted: true;
  deletedSessionIds: string[];
  failures: SessionBulkFailure[];
  generatedAt: string;
}

export interface SessionCleanupRequest {
  /** Archive non-archived sessions whose modified time is older than this many days. Omit/null to disable. */
  archiveIdleDays?: number | null;
  /** Also archive every non-archived session whose folder no longer exists. */
  archiveMissingFolder?: boolean;
  /** Permanently delete archived sessions whose archivedAt time is older than this many days. Omit/null to disable. */
  deleteArchivedDays?: number | null;
  /** Stored cwd paths selected from a preview. Omit/null to include all discovered project/workspace paths. */
  projectCwds?: string[] | null;
}

export interface SessionCleanupThresholds {
  archiveIdleDays?: number;
  deleteArchivedDays?: number;
  /** Archive every non-archived session whose folder no longer exists. */
  archiveMissingFolder?: boolean;
}

export interface SessionCleanupProjectSummary {
  cwd: string;
  archiveCount: number;
  deleteCount: number;
}

export interface SessionCleanupTotals {
  archiveCount: number;
  deleteCount: number;
}

export interface SessionCleanupPreviewResponse {
  generatedAt: string;
  thresholds: SessionCleanupThresholds;
  projects: SessionCleanupProjectSummary[];
  totals: SessionCleanupTotals;
  skippedBusySessionIds?: string[];
}

export interface SessionCleanupExecuteResponse extends SessionCleanupPreviewResponse {
  archivedSessionIds: string[];
  deletedSessionIds: string[];
}

/** A tool executing now, with what it was called with. */
export interface RunningTool {
  id: string;
  name: string;
  target?: string;
}

/**
 * What the session's agent is doing right now (B25, state-diagram D3 "The status
 * line narrates"), from one reducer over pi's event pairs. A step ends when its
 * pair closes; nothing keeps one alive.
 */
export type SessionStep =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "thinking" }
  | { kind: "writing" }
  | { kind: "preparing"; tool?: string }
  | { kind: "running"; tools: RunningTool[] }
  | { kind: "retrying"; attempt: number; maxAttempts: number; reason: string }
  | { kind: "compacting" }
  | { kind: "bash"; command: string };

export interface SessionActivity {
  sessionId: string;
  phase: "active" | "idle" | "error";
  label: string;
  detail?: string;
  at: string;
  /** The step the agent is in, from a daemon that publishes it; `label` and `detail` are words derived for older readers. */
  step?: SessionStep;
  /** When the step began. */
  stepSince?: string;
  /**
   * Set only on the startup window's own reports. A startup phase is genuinely
   * in progress, so it is published as `active` and rendered like any other
   * activity, but *starting* a session is not *working* in it: there is nothing
   * to stop, nothing that blocks reloading from disk, and no workspace-level
   * work to report. `isSessionActive()` reads this to keep the two apart.
   */
  startup?: boolean;
}

export interface QueuedSessionMessage {
  kind: "steer" | "followUp";
  text: string;
  /**
   * Id minted by the browser that sent the prompt. It correlates a queued entry
   * with the transcript bubble the sender already sees, so the sender can show
   * a delivery mark on that bubble instead of listing the same text a second
   * time under "Queued messages". Absent for prompts sent before this field
   * existed, by another client, or by a non-browser caller.
   */
  clientMessageId?: string;
}

/**
 * `customType` of the follow-up custom message that carries a closed ask back to
 * the model and into the transcript. Its `details` are an {@link AskUserOutcome}.
 */
export const ASK_USER_ANSWERS_CUSTOM_TYPE = "pi-web.ask.answers";

/** Largest question set one `ask_user` call may post. */
export const ASK_USER_QUESTION_LIMIT = 20;
/** Largest option list one question may offer. */
export const ASK_USER_OPTION_LIMIT = 12;
/** Length bound for ids: the ask id, question ids, and option values. */
export const ASK_USER_ID_MAX_LENGTH = 128;
/** Length bound for model-authored prose: questions, details, and option labels. */
export const ASK_USER_TEXT_MAX_LENGTH = 1_000;
/** Length bound for the free text a user types as a custom answer. */
export const ASK_USER_OTHER_TEXT_MAX_LENGTH = 4_000;

/** One selectable option of an {@link AskUserQuestion}. */
export interface AskUserQuestionOption {
  /** Stable machine value reported back to the model. */
  value: string;
  /** Short human label rendered in the browser. */
  label: string;
  /** Optional clarifying line rendered under the label. */
  detail?: string;
}

/**
 * One question of an `ask_user` set. Questions are never required: the user may
 * submit while leaving any of them untouched, and unanswered questions are
 * reported to the model as such.
 */
export interface AskUserQuestion {
  /** Unique within the ask; used as the answer key. */
  id: string;
  /** The question itself, as one plain-text line. */
  question: string;
  /** Optional supporting context rendered under the question. */
  detail?: string;
  /** Offered options; may be empty when only free text makes sense. */
  options: AskUserQuestionOption[];
  /** When true, several options may be selected at once. */
  multiple?: boolean;
  /** When false, the browser offers no Custom choice and a typed answer is refused. */
  custom?: boolean;
}

/**
 * The open, unanswered question set of a session. Daemon-owned and reported in
 * {@link SessionStatus}, so a reconnecting or reloading browser rehydrates it
 * without depending on having seen the `ask.opened` event.
 */
export interface PendingAskUser {
  askId: string;
  askedAt: string;
  questions: AskUserQuestion[];
}

/** Why an ask stopped being the session's open ask. */
export type AskUserCloseReason = "submitted" | "superseded" | "cancelled";

/**
 * What the user replied to one question. Absent from a submission means the
 * question was left untouched; an empty `values` with no `otherText` means the
 * same thing.
 */
export interface AskUserAnswer {
  /** Matches an {@link AskUserQuestion.id} of the open ask. */
  id: string;
  /** Selected {@link AskUserQuestionOption.value} entries; several only when the question allows it. */
  values: string[];
  /** Free text typed as the question's custom answer. */
  otherText?: string;
}

/** One submit of the open ask: answers for some or all of its questions. */
export interface AskUserSubmission {
  answers: AskUserAnswer[];
}

/**
 * One question of a closed ask paired with what came back for it. Carries the
 * question itself so the record renders without the original ask still existing.
 */
export interface AskUserQuestionRecord {
  question: AskUserQuestion;
  /** True when at least one option was selected or custom text was given. */
  answered: boolean;
  values: string[];
  otherText?: string;
}

/**
 * The complete result of an ask, computed when it closes. Shared by the
 * model-facing follow-up message and the browser's read-only record, so both
 * report the same answered and unanswered questions.
 */
/**
 * Who closed an unanswered ask, when it was not the reader answering it. A
 * bare "cancelled" is indistinguishable from a bug - the owner watched his
 * open form close itself and asked what broke; nothing had, his own message
 * had voided it by design, and the card never said so.
 */
export type AskUserCloseCause = "user-message";

export interface AskUserOutcome {
  askId: string;
  reason: AskUserCloseReason;
  /** Present only on closes the reader did not perform through the card. */
  cause?: AskUserCloseCause;
  askedAt: string;
  closedAt: string;
  questions: AskUserQuestionRecord[];
  answeredCount: number;
  /** Ids of the questions left unanswered, in the order they were asked. */
  unansweredIds: string[];
  /** One line, for example `Answered 3 of 5; unanswered: q2, q5`. */
  summary: string;
}

/**
 * Result of the browser closing an ask by submitting or cancelling it.
 *
 * `"stale"` is an ordinary race rather than an error: the named ask was already
 * submitted, superseded by a newer one, or gone with its session runtime. The
 * browser drops its card and trusts `sessionStatus`, which is returned in both
 * cases so closing an ask needs no follow-up status request.
 */
export interface AskUserCloseResponse {
  result: "closed" | "stale";
  /** Present only when this call is the one that closed the ask. */
  outcome?: AskUserOutcome;
  sessionStatus: SessionStatus;
}

/** Length bound for extension-dialog ids. */
export const EXTENSION_DIALOG_ID_MAX_LENGTH = 128;
/**
 * Payload bound for an input dialog's placeholder. A dialog is never refused for its content
 * (owner, 2026-10-04: show everything, as pi's terminal does); past a bound the daemon cuts the
 * text and says how much is missing.
 */
export const EXTENSION_DIALOG_TEXT_MAX_LENGTH = 1_000;
/**
 * Payload bound for the prose a dialog presents: its title and message. The card splits the first
 * line into the heading and scrolls the rest, so long prose is shown; the bound only keeps one
 * dialog from swelling every status read while it is open, and matches a declared screen's
 * detail. Options have no bound: cutting one would change the answer the extension receives.
 */
export const EXTENSION_DIALOG_PROSE_MAX_LENGTH = 32_000;

/**
 * Longest detail a question on a declared extension screen may carry. A goal draft
 * puts its whole proposal (objective, task tree, contracts) in one detail; at the
 * 8000-character prose bound a large draft was refused and drew the terminal frame
 * the declaration exists to replace. The detail rides the status payload only while
 * the dialog is open.
 */
export const EXTENSION_SCREEN_DETAIL_MAX_LENGTH = 32_000;

/**
 * @deprecated No longer enforced: a select dialog shows every option it is given (owner, 2026-10-04).
 * @public Kept for plugins that import it.
 */
export const EXTENSION_DIALOG_OPTION_LIMIT = 24;
/** Length bound for the text a user types into an `input` dialog. */
export const EXTENSION_DIALOG_INPUT_MAX_LENGTH = 4_000;
/**
 * Length bound for an `editor` dialog's text, both the text it opens with and the text sent back.
 * The opening text rides every status read while the dialog is open, as a dialog's prose does, so
 * it shares the prose bound; past it the daemon keeps the start and the card says how much it cut,
 * outside the text, so the cut never becomes part of the answer.
 */
export const EXTENSION_DIALOG_EDITOR_MAX_LENGTH = 32_000;

/** How an extension's `setEditorText` / `pasteToEditor` writes a session's composer. */
export type ExtensionEditorTextMode = "set" | "paste";

/** Where an extension widget sits: pi's `WidgetPlacement`, or pi's header and footer (`setHeader`, `setFooter`). */
export type ExtensionWidgetPlacement = "aboveEditor" | "belowEditor" | "header" | "footer";

/**
 * One `setWidget` block (extension-keys-in-go-to.md). `lines` is empty once the extension
 * cleared it: the extension's key stays until the session's extensions reload.
 */
export interface ExtensionWidgetStanding {
  key: string;
  placement: ExtensionWidgetPlacement;
  lines: string[];
  /**
   * The extension that set it, read off the call: `id` is stable for its package, `title` is the
   * name its package gives itself (`piWeb.title`, else its name), and `surface` is the declared
   * surface it backs, when a plugin's page fronts it. Absent when the call could not be matched.
   */
  extension?: { id: string; title: string; surface?: string };
}

/** An extension's `registerShortcut`, as a session offers it (pi-insertion-points.md slice 4). */
export interface ExtensionShortcutInfo {
  /** pi's key id, such as `ctrl+shift+p`. */
  key: string;
  description?: string;
  /** The extension that registered it, by its package or file name. */
  extension: string;
}

/** One suggestion of a session's extension autocomplete providers: pi's `AutocompleteItem` (pi-insertion-points.md slice 6). */
export interface ExtensionCompletionItem {
  value: string;
  label: string;
  description?: string;
}

/**
 * What a session's extension autocomplete providers suggest at the cursor. No items covers every case
 * the composer treats alike, by showing its own completions: nothing suggested, a newer ask, an answer
 * later than 2 s, a provider that failed, and a session without a running runtime.
 */
export interface ExtensionCompletionSuggestions {
  /** The text before the cursor the items would replace, as the provider counts it. */
  prefix: string;
  items: ExtensionCompletionItem[];
}

/** A completion applied by the session's providers: the composer's whole text and its cursor offset. */
export interface ExtensionCompletionApplied {
  text: string;
  cursor: number;
}

/**
 * What a session's extensions left standing through `ctx.ui` (extension-ui-counterpart.md):
 * footer statuses, widgets, the working row's words, mark and visibility, the hidden-thinking label and the
 * tab title. Absent when nothing stands, and from a daemon that
 * predates the field. Every field is the extension's; PI WEB's own default applies when absent.
 */
export interface ExtensionUiStanding {
  /** `setStatus` values, sorted by key as pi's footer sorts them; never empty when present. */
  statuses?: { key: string; text: string }[];
  /** `setWidget` blocks, each with the extension that set it; drawn as that extension's page in Go to. */
  widgets?: ExtensionWidgetStanding[];
  workingMessage?: string;
  workingHidden?: true;
  /** `[]`: no mark; otherwise the first frame stands as the mark. */
  workingFrames?: string[];
  hiddenThinkingLabel?: string;
  title?: string;
  /** Present while the session's extensions stack an autocomplete provider; the characters it also triggers on. */
  completion?: { triggerCharacters: string[] };
}

/** The level of an extension's `ctx.ui.notify`, as pi's terminal draws it. */
export type ExtensionNoticeLevel = "info" | "warning" | "error";

/** Which extension UI dialog primitive a pending dialog belongs to. */
export type ExtensionDialogKind = "confirm" | "select" | "input" | "editor" | "custom";

/**
 * How many lines of a `custom` screen are kept.
 *
 * A TUI component renders to lines and the browser shows them in a modal; the
 * whole screen rides the status payload inside `pendingDialogs`, so it is bounded
 * the way every other status string is.
 */
export const EXTENSION_DIALOG_SCREEN_MAX_LINES = 200;

/** A forwarded keypress is a name ("escape", "ctrl+c") or one character. */
export const EXTENSION_DIALOG_KEY_MAX_LENGTH = 32;

/**
 * The value a user gave in an extension dialog: a boolean for `confirm`, the
 * chosen option for `select`, the typed text for `input` and `editor`, the answers of a
 * `custom` screen declared as questions. Absent when the dialog closed without
 * an answer.
 */
export type ExtensionDialogAnswer = boolean | string | AskUserSubmission;

/**
 * Why a dialog stopped being open. `"answered"` carries an
 * {@link ExtensionDialogAnswer}; every other reason is a close without one.
 */
export type ExtensionDialogCloseReason = "answered" | "cancelled" | "timeout" | "aborted" | "session-ended";

/**
 * One open extension dialog of a session, opened by `ctx.ui.confirm()`,
 * `ctx.ui.select()`, or `ctx.ui.input()`. Daemon-owned and reported in
 * {@link SessionStatus.pendingDialogs}, so a reconnecting or reloading browser
 * rehydrates it without depending on having seen the `dialog.opened` event.
 *
 * Unlike asks, several dialogs may be open per session at once: each dialog is
 * an independent blocking wait inside extension code, so opening never
 * supersedes an existing one.
 */
export interface ExtensionDialogScreen {
  kind: "questions";
  title?: string;
  questions: AskUserQuestion[];
}

export interface PendingExtensionDialog {
  dialogId: string;
  kind: ExtensionDialogKind;
  title: string;
  /** Supporting line of a `confirm` dialog. */
  message?: string;
  /** Offered choices of a `select` dialog. */
  options?: string[];
  /** Placeholder text of an `input` dialog. */
  placeholder?: string;
  /** The text an `editor` dialog opens with (pi's `ctx.ui.editor(title, prefill)`). */
  prefill?: string;
  /**
   * How many characters at the end of an `editor` dialog's opening text the daemon cut to keep
   * it within {@link EXTENSION_DIALOG_EDITOR_MAX_LENGTH}. Absent when nothing was cut.
   */
  prefillCut?: number;
  /**
   * The rendered screen of a `custom` dialog: what the extension's TUI component
   * drew, at the width the daemon asked it to draw for. Plain text, because the
   * daemon hands the component a plain theme.
   */
  lines?: string[];
  /**
   * What the extension declared this screen to be, for the browser to draw natively.
   *
   * `ctx.ui.custom(factory, { web: { kind: "questions", questions } })` makes the
   * screen the Questions card `ask_user` uses: the daemon never mounts the terminal
   * component, so the reader sees one native card instead of a terminal dump, and
   * `custom()` resolves with the {@link AskUserSubmission}. Absent for an extension
   * that only draws.
   */
  screen?: ExtensionDialogScreen;
  askedAt: string;
  /**
   * When the dialog auto-cancels, as ISO: the sooner of the extension's own
   * `timeout` and the daemon's `extensionDialogsTimeoutMs` default. Absent
   * when the dialog waits forever.
   */
  timeoutAt?: string;
  /** Opened while a run was in flight, so `agent_end` settles it as `"aborted"`. */
  runScoped: boolean;
}

/**
 * The complete result of a closed extension dialog. Unlike an ask outcome it
 * stays small — the dialog itself is not embedded, because a settled card is a
 * browser-local record that stays until the user dismisses it; reloads
 * rehydrate open dialogs from {@link SessionStatus.pendingDialogs} alone.
 */
export interface ExtensionDialogOutcome {
  dialogId: string;
  reason: ExtensionDialogCloseReason;
  /** Present only when `reason` is `"answered"`. */
  answer?: ExtensionDialogAnswer;
  askedAt: string;
  closedAt: string;
}

/**
 * Browser request to answer an open extension dialog with the user's value.
 * `cwd` rides along as the standard session-lookup field, as on every other
 * session route; whether the value fits the dialog's kind is the store's call,
 * so an ill-fitting answer is a 400 that leaves the dialog open.
 */
export interface ExtensionDialogAnswerRequest {
  cwd?: string;
  dialogId: string;
  value: ExtensionDialogAnswer;
}

/** Browser request to dismiss an open extension dialog without an answer. */
export interface ExtensionDialogCancelRequest {
  cwd?: string;
  dialogId: string;
}

/**
 * Result of the browser answering or cancelling an extension dialog. Mirrors
 * {@link AskUserCloseResponse}: `"stale"` is an ordinary lost race — another
 * browser, a timeout, or a teardown closed the dialog first — not an error.
 * The browser drops its card and trusts `sessionStatus`, which is returned in
 * both cases so closing a dialog needs no follow-up status request.
 */
export interface ExtensionDialogCloseResponse {
  result: "closed" | "stale";
  /** Present only when this call is the one that closed the dialog. */
  outcome?: ExtensionDialogOutcome;
  sessionStatus: SessionStatus;
}

/**
 * Progress of the session startup window, where the daemon is still
 * constructing the agent session and no `PiAgentSession` exists yet, so
 * `activity.update` cannot be published for it.
 *
 * `startupToken` is the opaque label a create request supplied, echoed back so a
 * browser row still waiting for a session id recognises its own construction.
 * The daemon never interprets it and it never becomes the session id:
 * `activity.sessionId` always carries the real id, which is how an *open* of a
 * session the browser already knows is routed instead.
 *
 * `activity.phase === "idle"` means the startup window ended with nothing left
 * to report, so a browser that substituted its own text should restore it.
 */
export interface SessionStartupProgressEvent {
  type: "session.startup";
  startupToken?: string;
  activity: SessionActivity;
}

/**
 * A pi-native image attachment carried with a prompt. The wire format mirrors
 * pi's own `ImageContent` shape (`{ type: "image", data, mimeType }`) so these
 * attachments are compatible with native multimodal delivery after validation.
 */
export interface PromptImageAttachment {
  kind: "image";
  /** Supported image MIME type (image/png, image/jpeg, image/gif, or image/webp). */
  mimeType: string;
  /** Base64-encoded binary payload (no data: URL prefix). */
  data: string;
  /** Optional original filename, used for previews and folder-mode filenames. */
  name?: string;
}

/** A general file attachment that must be saved into the workspace before use. */
export interface PromptFileAttachment {
  kind: "file";
  /** Non-empty IANA MIME type (for example "application/pdf"). */
  mimeType: string;
  /** Base64-encoded binary payload (no data: URL prefix). Empty for zero-byte files. */
  data: string;
  /** Optional original filename, used for previews and folder-mode filenames. */
  name?: string;
}

export type PromptAttachment = PromptImageAttachment | PromptFileAttachment;

/**
 * How prompt attachments should be delivered to the session.
 * - "inline": send the binary to pi as native image content (multimodal input).
 * - "folder": save the file into the workspace and reference it from the prompt
 *   text so the agent reads it with its own tools.
 */
export type PromptAttachmentDelivery = "inline" | "folder";

export interface SavedPromptAttachment {
  /** Workspace-relative path the attachment was written to. */
  path: string;
  mimeType: string;
  size: number;
}

export interface SessionModel {
  provider?: string;
  id?: string;
  name?: string;
  contextWindow?: number;
  reasoning?: unknown;
}

/**
 * One row of a session machine's full available-model catalog: the model plus
 * its membership in pi's enabled-models scope (`enabledModels` setting). Model
 * scope is selection UX for picking/cycling, never an authorization boundary.
 */
export interface SessionModelCatalogEntry {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  reasoning?: unknown;
  enabled: boolean;
}

/**
 * The session machine's full available model catalog with per-model enabled
 * state. Enabled models come first — in the same set and order as the
 * session's pickable ("Enabled") model list — followed by the remaining
 * models in catalog order.
 */
export interface SessionModelCatalogResponse {
  models: SessionModelCatalogEntry[];
}

// Domain type is owned by pi and re-exported from the shared thinking-levels
// module. Wire/data fields below intentionally use `string` so an unknown level
// from a newer pi runtime parses and renders gracefully instead of failing.
export type { ThinkingLevel } from "./thinkingLevels.js";

export type AuthType = "oauth" | "api_key";
export type AuthStatusSource = "stored" | "runtime" | "environment" | "fallback" | "models_json_key" | "models_json_command";

export interface AuthProviderStatus {
  configured: boolean;
  source?: AuthStatusSource;
  label?: string;
}

export interface AuthProviderOption {
  id: string;
  name: string;
  authType: AuthType;
  status: AuthProviderStatus;
  /** Present when the provider logs in through the generic AuthInteraction flow. */
  loginFlow?: "interactive";
}

export interface AuthProvidersResponse {
  providers: AuthProviderOption[];
}

export interface OAuthFlowState {
  flowId: string;
  providerId: string;
  providerName: string;
  status: "running" | "complete" | "error" | "cancelled";
  auth?: {
    url: string;
    instructions?: string;
    deviceCode?: { userCode: string; intervalSeconds?: number; expiresInSeconds?: number };
  };
  prompt?: {
    requestId: string;
    message: string;
    placeholder?: string;
    allowEmpty?: boolean;
    promptType: "text" | "secret" | "manual_code";
  };
  select?: { requestId: string; message: string; options: CommandOption[] };
  progress: string[];
  info?: { message: string; links?: { url: string; label?: string }[] }[];
  error?: string;
}

export interface ModelSelectionResponse {
  models: SessionModel[];
}

export interface ThinkingLevelsResponse {
  levels: string[];
}

export type SessionWarningSeverity = "info" | "warning" | "error";

/**
 * A live, runtime-scoped warning surfaced to the browser (skill/resource
 * diagnostics, extension load errors, subscription-auth billing notice, etc.).
 *
 * Warnings are recomputed whenever the runtime is (re)built inside sessiond and
 * are not persisted chat messages. `source` is an optional short origin label
 * (e.g. `"skill"`, `"extension"`, `"anthropic"`); `path` carries a related file
 * path when the warning came from a resource diagnostic.
 *
 * `dismiss` is present only when the warning has a durable, first-class
 * off-switch in the underlying `pi` agent (not a UI-only hide). Its `id` is the
 * opaque token the server maps back to that suppression; the client renders a
 * dismiss control for any warning carrying it, without knowing what it means.
 */
export interface SessionWarning {
  severity: SessionWarningSeverity;
  message: string;
  source?: string;
  path?: string;
  dismiss?: { id: string };
}

/**
 * What a plugin-backed surface can honestly say about itself.
 *
 * "failed" is kept apart from "absent" on purpose: an extension that threw on
 * load is not one nobody installed, and calling it absent would hide a broken
 * install behind a tidy empty panel.
 */
export type PluginSurfaceState = "present" | "absent" | "failed";

/**
 * Presence per surface, by the name the server plugin that fronts it declared
 * (`agentFacts.surfaces`); the host names none. An omitted surface is unknown,
 * not absent.
 */
export type PluginSurfacePresence = Readonly<Record<string, PluginSurfaceState>>;

export interface SessionStatus {
  sessionId: string;
  /**
   * The session stream's position when a status read was computed: its seq and the epoch of
   * that seq space. A browser drops a read computed before a status frame it already applied.
   * Present on the answer to a status read, not on status frames, which carry their own stamp.
   */
  streamPosition?: { seq: number; epoch: string };
  /**
   * Which plugin-backed surfaces have something behind them in this session.
   *
   * A panel for an extension nobody installed used to look exactly like an
   * installed one with nothing in it yet: both empty, neither saying why. The
   * runtime knows which extensions registered which tools, so the question is
   * "does anything provide this surface" rather than "is package X installed" -
   * a fork or a local copy provides it just as well.
   *
   * Absent from a daemon that predates the field, and from a runtime that
   * cannot answer. Absent means unknown, not absent: a surface must not be
   * hidden on no evidence.
   */
  pluginSurfaces?: PluginSurfacePresence;
  /** True when the server has verified a backing session file exists; false when known transient. */
  persisted?: boolean;
  /**
   * When the working turn began, read off the transcript (its last input
   * boundary). Present only while the session is working, and only from a
   * daemon that publishes it; a browser that joins mid-turn anchors its
   * elapsed readout here instead of clocking from when it first looked.
   */
  turnStartedAt?: string;
  /**
   * The timestamp of the session's leaf entry, the newest on its current branch (B28). A session
   * list orders by when a session last changed; carried on every status frame, it moves a row when
   * the run ends instead of at the next whole read of the list. Absent from a daemon that predates it.
   */
  lastActivityAt?: string;
  model?: SessionModel;
  thinkingLevel?: string;
  isStreaming: boolean;
  isCompacting: boolean;
  isBashRunning: boolean;
  pendingMessageCount: number;
  queuedMessages: QueuedSessionMessage[];
  /**
   * Answers to question cards that the agent has not read yet, oldest first
   * (B26). Read off pi's queues on every status. Absent when there are none,
   * and from a daemon that predates the field.
   */
  queuedAnswers?: AskUserOutcome[];
  /**
   * The session's latest activity with its step (B25), so a page that opens in
   * the middle of a long step can say it before the next frame. Live activity
   * frames supersede it. Absent before the session published any.
   */
  activity?: SessionActivity;
  messageCount?: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  /**
   * Live, runtime-scoped warnings for this session (skill/resource diagnostics,
   * extension load errors, Anthropic subscription-auth billing notice, etc.).
   * Recomputed on each status read from the current runtime; absent/empty when
   * there are none. The browser does not parse it: warnings reach the reader as
   * session notifications. See {@link SessionWarning}.
   */
  warnings?: SessionWarning[];
  /**
   * The session's open `ask_user` question set, when one is waiting for the
   * user. Daemon-owned, so it survives browser reload and web/API restarts.
   */
  pendingAsk?: PendingAskUser;
  /**
   * Every open question form, oldest first.
   *
   * `pendingAsk` is the oldest of these, kept because it is what the waiting
   * slot shows first; a second `ask_user` used to supersede the first and leave
   * it unanswerable.
   */
  pendingAsks?: PendingAskUser[];
  /**
   * The session's open extension dialogs, oldest first, when any are waiting
   * for the user. Daemon-owned, so they survive browser reload and web/API
   * restarts. Several may be open at once; the UI presents them as a queue.
   */
  pendingDialogs?: PendingExtensionDialog[];
  /**
   * Monotonic mutation revision of the dialog surface, incremented on every
   * dialog open and close. Card frames carry the same counter, so a client
   * that sees a skipped revision knows a frame was lost and repairs from this
   * authoritative read instead of keeping a stale card. Absent from a daemon
   * that predates the field; clients fail open without it.
   */
  pendingDialogsRevision?: number;
  /**
   * Identity of the daemon process that produced this status, the id the
   * notifications catalog publishes as `daemonInstanceId`. A dialog revision
   * only orders frames within one daemon instance, so a client comparing them
   * must know when the instance - and the revision space - was replaced.
   * Absent from a daemon that predates the field.
   */
  daemonInstanceId?: string;
  /**
   * Work this session started that outlives its turn: working subsessions,
   * running subagent-tool runs, running background shell tasks. Absent when
   * there is none.
   *
   * Published so surfaces that never load a session's activity panel — the
   * session list, the quick switcher — can still tell "finished" apart from
   * "turn over, children still running". See
   * server/sessions/backgroundRunCount.ts for how it is counted.
   */
  backgroundRunCount?: number;
  /** The session's extension shortcuts; absent when it has none or its runtime is not open. */
  extensionShortcuts?: ExtensionShortcutInfo[];
  extensionUi?: ExtensionUiStanding;
}

export interface SlashCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "builtin";
}

export type { FileSuggestion } from "./pluginApiTypes.js";

export interface TerminalInfo {
  id: string;
  cwd: string;
  name: string;
  createdAt: string;
  exited: boolean;
  exitCode?: number;
  commandRunId?: string;
}

export interface RunTerminalCommandInput {
  workspace: Workspace;
  title: string;
  command: string;
  metadata?: Record<string, string>;
  open?: boolean;
}

/** Secret-free identity of the pi agent state directory fixed for one sessiond lifetime. */
export interface ActiveAgentProfileDescriptor {
  readonly schemaVersion: 2;
  readonly dir: string;
}

export interface PiWebRuntimeComponent {
  component: PiWebServiceComponent;
  label: string;
  runtimeVersion?: string;
  /** Version of the Pi coding agent library loaded by this component's process; omitted when the component does not report it. */
  piVersion?: string;
  available: boolean;
  capabilities: PiWebCapability[];
  /** Present only for a session daemon that supports active-profile reporting. */
  activeAgentProfile?: ActiveAgentProfileDescriptor;
  /** Deprecated agent-configuration inputs detected in this component's process environment and config file; omitted when none. */
  deprecatedAgentInputs?: readonly PiWebDeprecatedAgentInput[];
  error?: string;
}

export interface PiWebRuntimeResponse {
  packageName: string;
  generatedAt: string;
  components: {
    web: PiWebRuntimeComponent;
    sessiond: PiWebRuntimeComponent;
  };
  capabilities: PiWebCapability[];
}

export type TerminalUiEvent =
  | { type: "terminal.created"; terminal: TerminalInfo }
  | { type: "terminal.exited"; terminal: TerminalInfo }
  | { type: "terminal.closed"; terminalId: string; cwd: string };

export interface CommandOption {
  value: string;
  label: string;
  description?: string;
}

export type SessionTreeNodeKind =
  | "user"
  | "assistant"
  | "tool-result"
  | "bash"
  | "custom-message"
  | "compaction"
  | "branch-summary"
  | "model-change"
  | "thinking-level-change"
  | "session-info"
  | "label"
  | "custom"
  | "other";

export interface SessionTreeNode {
  id: string;
  parentId: string | null;
  kind: SessionTreeNodeKind;
  summary: string;
  timestamp?: string;
  label?: string;
}

export interface SessionTreeSnapshot {
  /** Pre-order, parent-linked projection of all retained roots and descendants. */
  nodes: SessionTreeNode[];
  activeLeafId: string | null;
  /** Root-to-leaf IDs for explicit, non-color-only active-path rendering. */
  activePathIds: string[];
}

export const SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH = 10_000;

export type SessionTreeSummaryChoice =
  | { mode: "none" }
  | { mode: "default" }
  | { mode: "custom"; instructions: string };

export interface SessionTreeNavigateRequest {
  targetId: string;
  /** Leaf shown when the navigator opened; null is valid for an empty/root position. */
  expectedLeafId: string | null;
  summary: SessionTreeSummaryChoice;
}

export type SessionTreeNavigateResult =
  | { cancelled: false; editorText?: string }
  | { cancelled: true; aborted?: boolean };

export interface SessionTreeForkRequest {
  entryId: string;
  /** Leaf shown when the navigator opened; null is valid for an empty/root position. */
  expectedLeafId: string | null;
}

/**
 * Fork-from-entry creates a new session file up to the selected entry and
 * switches the runtime to it, leaving the original session untouched. User
 * entries fork from "before" so their text returns as a `promptDraft` for the
 * forked session; every other entry forks "at".
 */
export type SessionTreeForkResult =
  | { cancelled: false; session: SessionInfo; promptDraft?: string }
  | { cancelled: true };

export interface MessagePage {
  messages: unknown[];
  start: number;
  total: number;
  /** Where the transcript stood when this page was read (docs/design/sync-convergence.md). */
  head?: TranscriptHead;
}

/**
 * Where a transcript stands: how many messages it projects to and the entry id of the last.
 * The value a page compares with the daemon's, never a count the page made itself.
 */
export interface TranscriptHead {
  n: number;
  leaf: string | null;
}

/**
 * Join-time snapshot of a session's in-flight assistant stream. `seq` is the
 * `SessionEventHub` watermark captured together with `partial` in a single tick,
 * so a joining client can seed `partial` and then apply only buffered live events
 * with `seq > snapshot.seq` (exactly-once). `partial` is a browser-projected
 * in-flight `AssistantMessage` (thinking signatures stripped), or `null` when the
 * session is not mid assistant-message stream.
 */
export interface SessionStreamSnapshot {
  seq: number;
  /** The seq space `seq` belongs to. A watermark cited with any other epoch is answered with resync. */
  epoch?: string;
  /** Browser-projected in-flight `AssistantMessage`, or `null` when idle. */
  partial: unknown;
}

/**
 * A session's last transcript page with the stream position it is current
 * through, read without waiting for the session's runtime to open (object
 * model §1.7, P2 slice c).
 */
export interface SessionTranscriptTail {
  page: MessagePage;
  stream: SessionStreamSnapshot;
}

/**
 * What a client citing `sinceSeq` gets from the sync route: the frames it
 * missed, replayed oldest-first exactly as live; or a resync verdict when the
 * server's ring cannot serve the request and the client must fall back to a
 * full read. The three kinds are the whole contract - a client that meets an
 * unknown kind ignores it and resyncs.
 */
export type SessionStreamSync =
  | { kind: "snapshot"; seq: number; partial: unknown }
  | { kind: "replay"; sinceSeq: number; frames: string[] }
  | { kind: "resync"; sinceSeq: number };

/**
 * `deferred` marks a command the daemon accepted but has not run: a runtime
 * command forwarded behind the reply in flight, or a reload parked until the
 * session is idle. The browser must show it as queued, never as done; the
 * daemon says so explicitly because the browser cannot tell from the prose.
 */
export type CommandResult =
  | { type: "done"; message?: string; session?: SessionInfo; promptDraft?: string; deferred?: true }
  | { type: "select"; requestId: string; title: string; options: CommandOption[] }
  | { type: "tree"; tree: SessionTreeSnapshot }
  | { type: "unsupported"; message: string };

/**
 * Transport-level per-session sequence stamp. `SessionEventHub.publish` assigns a
 * monotonic `seq` to every per-session event as it is serialized to the socket.
 * Clients use it as a watermark against the join-time stream snapshot so buffered
 * live events are applied exactly once. Existing consumers may ignore it.
 */
export type SessionUiEvent = SessionUiEventBody & { seq?: number; epoch?: string };

type SessionUiEventBody =
  /**
   * `echo` marks the server's optimistic copy of a prompt it has accepted but
   * the agent has not committed yet. The agent emits its own copy later, so a
   * client that cannot correlate by id (another device, or this one after a
   * reload) still knows which rendered line the committed message supersedes
   * instead of showing the same text twice.
   */
  | { type: "message.append"; message: unknown; clientMessageId?: string; echo?: boolean }
  | { type: "assistant.delta"; text: string }
  | { type: "assistant.thinking.delta"; text: string }
  /** `drawnCall`/`drawnResult`: the lines pi's resolved tool renderers draw - extensions' `registerToolRenderer` resolvers in load order, then the extension tool's own `renderCall`/`renderResult` (pi-insertion-points.md slice 2). */
  | { type: "tool.start"; toolName: string; toolCallId: string; summary: string; args?: unknown; drawnCall?: string[] }
  | { type: "tool.update"; toolName: string; toolCallId: string; text: string; content?: unknown; details?: unknown; drawnResult?: string[] }
  | { type: "tool.end"; toolName: string; toolCallId: string; text: string; isError: boolean; content?: unknown; details?: unknown; drawnResult?: string[] }
  | { type: "shell.start"; command: string; excludeFromContext?: boolean }
  | { type: "shell.chunk"; chunk: string }
  | { type: "shell.end"; output?: string; exitCode?: number | null; cancelled?: boolean; truncated?: boolean; fullOutputPath?: string; isError?: boolean }
  | { type: "agent.start" }
  | { type: "agent.end" }
  | { type: "message.end"; message?: unknown }
  | { type: "status.update"; status: SessionStatus }
  | { type: "activity.update"; activity: SessionActivity }
  | { type: "command.output"; level: "info" | "success" | "error"; message: string }
  /**
   * An extension's `ctx.ui` reaching the browser (extension-ui-counterpart.md). `notify` is
   * momentary: drawn by the browsers attached at that moment and never saved, as in pi's terminal.
   */
  | { type: "extension.ui"; kind: "notify"; level: ExtensionNoticeLevel; message: string }
  /**
   * An extension's `setEditorText` (`set`: the composer becomes the text) or `pasteToEditor`
   * (`paste`: the text goes in at the caret) for the session's composer in every browser showing
   * it. Momentary, like `notify`: a browser that opens the session later does not get it.
   */
  | { type: "extension.ui"; kind: "editorText"; mode: ExtensionEditorTextMode; text: string }
  /**
   * A turn was stopped deliberately, and by what. An abort otherwise travels as
   * the provider's own "Request was aborted", which cannot say whether the
   * reader pressed Stop or another device did ("user"), or the runtime closed ("closed").
   */
  | { type: "session.stopped"; cause: "user" | "closed" }
  | SessionNotificationInboxEvent
  | { type: "session.error"; message: string }
  | { type: "ask.opened"; ask: PendingAskUser; revision?: number; daemonInstanceId?: string }
  | { type: "ask.closed"; askId: string; reason: AskUserCloseReason; revision?: number; daemonInstanceId?: string }
  | { type: "prompt.accepted"; clientMessageId: string }
  | { type: "prompt.withdrawn"; clientMessageId: string }
  | { type: "prompt.consumed"; clientMessageId: string }
  | { type: "prompt.refused"; clientMessageId: string; message: string }
  /** Sent by an older daemon when a background-work tool started or ended; read and ignored. */
  | { type: "activity.changed" }
  | { type: "dialog.opened"; dialog: PendingExtensionDialog; revision?: number; daemonInstanceId?: string }
  | { type: "dialog.closed"; dialogId: string; reason: ExtensionDialogCloseReason; answer?: ExtensionDialogAnswer; revision?: number; daemonInstanceId?: string }
  | { type: "session.name"; sessionId: string; name?: string }
  | { type: "session.created"; session: SessionInfo }
  | { type: "pi.event"; eventType: string };

export type GlobalSessionEvent =
  | Extract<SessionUiEventBody, { type: "status.update" | "activity.update" | "session.name" | "session.created" }>
  | SessionNotificationSummaryEvent
  | SessionUnreadEvent
  | SessionStartupProgressEvent;
/**
 * A watched working directory changed on disk. The daemon names the directory
 * only; the browser decides whether it is the workspace it shows and refreshes
 * its panels through the invalidation they already implement.
 */
export interface WorkspaceChangedUiEvent {
  readonly type: "workspace.changed";
  readonly cwd: string;
}

/**
 * The machine's pins changed: a device pinned or unpinned a session, or handed over its old
 * local pins. The web process that wrote them nudges its daemon, which announces it here; a
 * browser reads that machine's pins once more (state-diagram D5, "Every surface is live").
 */
export interface PinsChangedUiEvent {
  readonly type: "pins.changed";
}

/**
 * The machine's running plugins changed: a toggle was applied in its web process and daemon (B19).
 * A browser reads that machine's plugin manifest again, loading what was turned on and disposing
 * what was turned off, instead of reloading the page.
 */
export interface PluginsChangedUiEvent {
  readonly type: "plugins.changed";
}

export type RealtimeEvent = GlobalSessionEvent | TerminalUiEvent | MachineStatusUiEvent | WorkspaceChangedUiEvent | PinsChangedUiEvent | PluginsChangedUiEvent;

/** A run a restart cut off, as reported once by the daemon and then cleared. */
export interface InterruptedRunInfo {
  readonly sessionId: string;
  readonly cwd: string;
  readonly interruptedAt: string;
}

export interface InterruptedRunSnapshot {
  readonly runs: readonly InterruptedRunInfo[];
}

/** A child session a parent session started through PI WEB's subsession routes. */
export interface SessionSubsessionInfo {
  readonly sessionId: string;
  readonly cwd: string;
  readonly status: "working" | "idle" | "error" | "unknown";
}

export interface SessionSubsessionsSnapshot {
  readonly subsessions: readonly SessionSubsessionInfo[];
}

/**
 * Whether a newer build of this checkout is available on the fork remote.
 *
 * Reported for one machine at a time; the UI only shows the update affordance
 * when the machine hosting the daemon is a git checkout with a fork remote.
 */
/** A fleet operation runs on the machines the answering server knows. */
export type PiWebFleetOperation = "restart" | "update";

export interface PiWebFleetMachineIdentity {
  readonly machineId: string;
  readonly name: string;
}

export interface PiWebFleetTargetReport extends PiWebFleetMachineIdentity {
  readonly kind: "local" | "remote";
  readonly online: boolean;
  /** PI WEB build reported by that machine's web process. */
  readonly version?: string;
  /** Pi coding agent version loaded there; the two drift independently. */
  readonly piVersion?: string;
  readonly error?: string;
}

/**
 * Who would be covered by a fleet operation, as seen from one server. `hub` is
 * the server that answered - the scope of "all" is only meaningful next to it.
 */
export interface PiWebFleetReport {
  readonly hub: PiWebFleetMachineIdentity;
  readonly machines: readonly PiWebFleetTargetReport[];
}

export interface PiWebFleetTargetOutcome extends PiWebFleetMachineIdentity {
  readonly started: boolean;
  readonly error?: string;
}

export interface PiWebFleetRunResponse {
  readonly operation: PiWebFleetOperation;
  readonly hub: PiWebFleetMachineIdentity;
  readonly outcomes: readonly PiWebFleetTargetOutcome[];
}

export interface PiWebSelfUpdateStatus {
  /** False when this host has no fork checkout to update (e.g. containers). */
  readonly enabled: boolean;
  /** Current local commit, short form. */
  readonly current: string;
  /** Latest commit on the fork remote, short form. */
  readonly latest: string | undefined;
  /** True when the fork remote has commits this checkout does not. */
  readonly available: boolean;
  readonly branch: string | undefined;
  readonly checkedAt: string;
  /** Human reason when updates are not supported here. */
  readonly disabledReason?: string;
}
