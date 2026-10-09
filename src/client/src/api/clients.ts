import { isRecord } from "../../../shared/unknownValues";
import type { AskUserSubmission, SessionInfo, DeleteWorkspaceFileResponse, ExtensionDialogAnswer, FileSuggestion, MoveWorkspaceFileOptions, PiPackageInstallRequest, PiPackageRemoveRequest, PiPackageScope, PiPackageUpdateRequest, PiWebConfigValues, PromptAttachment, QueuedSessionMessage, RunTerminalCommandInput, SessionBulkMutationRef, SessionCleanupRequest, SessionNotificationDismissThrough, SessionRef, SessionTreeForkRequest, SessionTreeForkResult, SessionTreeNavigateRequest, SessionUnreadAcknowledgeRequest, TerminalCommandRun, TerminalCommandRunFilter, WorkspaceRemovalRequest, WriteWorkspaceFileOptions, SessionsRevisionResponse } from "../../../shared/apiTypes";
import { resolveAppUrl } from "../appUrl";
import { describeError } from "../notice";
import { apiErrorMessage, errorCode, HttpError, request } from "./http";
import { machineIdFromUrl, reportTransportReachable } from "./transportHealth";
import { fetchWithDeadline, isTransportFailure } from "./requestDeadline";
import {
  arrayOf,
  parseAborted,
  parseAskUserCloseResponse,
  parseAccepted,
  parseArchived,
  parseAuthProvidersResponse,
  parseClosed,
  parseCommandResult,
  parseDeleteWorkspaceFileResponse,
  parseDetached,
  parseExtensionDialogCloseResponse,
  parseFileContentResponse,
  parseFileSuggestion,
  parseFileTreeResponse,
  parseMachine,
  parseMachineHealth,
  parseMachineRuntime,
  parseMachinesResponse,
  parseMessagePage,
  parseModelSelectionResponse,
  parseSessionModelCatalogResponse,
  parseMoveWorkspaceFileResponse,
  parseOAuthFlowState,
  parsePiPackageMutationResponse,
  parsePiPackagesResponse,
  parsePiWebConfigResponse,
  parsePiWebPluginsResponse,
  parsePiWebRuntimeResponse,
  parsePiWebStatusResponse,
  parseProject,
  parseReloaded,
  parseRestored,
  parseSavedAttachments,
  parseSessionBulkArchiveResponse,
  parseSessionBulkDeleteArchivedResponse,
  parseSessionCleanupExecuteResponse,
  parseSessionCleanupPreviewResponse,
  parseSessionInfo,
  parseSessionsRevisionResponse,
  parseSessionNotificationDismissResponse,
  parseSessionNotificationInboxSnapshot,
  parseSessionStatus,
  parseSessionStatusCatalogSnapshot,
  parseRecallQueuedMessageResult,
  parseBackgroundTasks,
  parseInterruptedRunSnapshot,
  parseSessionUnreadAcknowledgeResponse,
  parseSessionUnreadCatalogSnapshot,
  parseSessionStreamSnapshot,
  parseSessionTranscriptTail,
  parseSessionStreamSync,
  parseSessionTreeForkResult,
  parseSessionTreeNavigateResult,
  parseSlashCommand,
  parseStopped,
  parseTerminalCommandRun,
  parseTerminalInfo,
  parseThinkingLevelsResponse,
  parseWriteWorkspaceFileResponse,
  parsePiWebFleetReport,
  parsePiWebFleetRunResponse,
  parsePiWebSelfUpdateStatus,
  parseWorkspaceProviderResolution,
  parseSessionBoardAnswer,
  parseWorkspaceTrustResponse,
  parseWebServerVersion,
  requireMachineStatusSnapshot,
  parseOperationOutcomes,
} from "./parsers";
import { messagePath } from "./urls";

const machinePrefix = (machineId = "local") => `api/machines/${encodeURIComponent(machineId)}`;

function sessionBasePath(session: SessionRef, machineId = "local"): string {
  return `${machinePrefix(machineId)}/sessions/${encodeURIComponent(session.id)}`;
}

const parseDialogKeyResponse = (body: unknown): boolean =>
  typeof body === "object" && body !== null && "delivered" in body && body.delivered === true;

function sessionPath(session: SessionRef, endpoint: string, machineId = "local"): string {
  return `${sessionBasePath(session, machineId)}/${endpoint}`;
}

function sessionQueryPath(session: SessionRef, endpoint: string, machineId = "local"): string {
  return `${sessionPath(session, endpoint, machineId)}${sessionQuery(session)}`;
}

function sessionQuery(session: SessionRef): string {
  return `?${new URLSearchParams({ cwd: session.cwd }).toString()}`;
}

function sessionBody(session: SessionRef, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ cwd: session.cwd, ...fields });
}

function sessionBulkMutationBody(sessions: readonly SessionRef[]): string {
  return JSON.stringify({ sessions: sessions.map(sessionBulkMutationRef) });
}

function sessionBulkMutationRef(session: SessionRef): SessionBulkMutationRef {
  return { id: session.id, cwd: session.cwd };
}

function piWebStatusPath(machineId: string): string {
  return machineId === "local" ? "api/pi-web/status" : `${machinePrefix(machineId)}/pi-web/status`;
}

export const piWebApi = {
  piWebStatus: (machineId = "local") => request(piWebStatusPath(machineId), parsePiWebStatusResponse),
  checkForUpdates: (machineId = "local") => request(`${piWebStatusPath(machineId)}?refresh=1`, parsePiWebStatusResponse, { cache: "no-store" }),
  piWebRuntime: () => request("api/pi-web/runtime", parsePiWebRuntimeResponse),
  webServerVersion: () => request("api/pi-web/version", parseWebServerVersion, { cache: "no-store" }),
};

export const machinesApi = {
  machines: () => request("api/machines", parseMachinesResponse),
  addMachine: (input: { name: string; baseUrl: string; token?: string }) => request("api/machines", parseMachine, { method: "POST", body: JSON.stringify(input) }),
  reorderMachines: (order: readonly string[]) => request("api/machines/order", parseMachinesResponse, { method: "POST", body: JSON.stringify({ order: [...order] }) }),
  deleteMachine: (machineId: string) => request(`api/machines/${encodeURIComponent(machineId)}`, (value) => value, { method: "DELETE" }),
  /** Rename a machine (including the local machine, which persists as an alias). */
  updateMachine: (machineId: string, input: { name?: string; baseUrl?: string; token?: string }) => request(`api/machines/${encodeURIComponent(machineId)}`, parseMachine, { method: "PATCH", body: JSON.stringify(input) }),
  health: (machineId: string) => request(`api/machines/${encodeURIComponent(machineId)}/health`, parseMachineHealth),
  runtime: (machineId: string, refresh = false) => request(`api/machines/${encodeURIComponent(machineId)}/runtime${refresh ? "?refresh=1" : ""}`, parseMachineRuntime, refresh ? { cache: "no-store" } : {}),
};

function configPath(machineId?: string): string {
  return machineId === undefined ? "api/config" : `${machinePrefix(machineId)}/config`;
}

export function pluginsPath(machineId?: string): string {
  return machineId === undefined ? "api/plugins" : `${machinePrefix(machineId)}/plugins`;
}

export const configApi = {
  config: (machineId?: string) => request(configPath(machineId), parsePiWebConfigResponse),
  saveConfig: (config: PiWebConfigValues, machineId?: string) => request(configPath(machineId), parsePiWebConfigResponse, { method: "PUT", body: JSON.stringify({ config }) }),
};

interface SelfUpdateApplyResponse { started: boolean; error?: string; }
function parseSelfUpdateApplyResponse(value: unknown): SelfUpdateApplyResponse {
  const record = isRecord(value) ? value : {};
  const started = record["started"] === true;
  const error = typeof record["error"] === "string" ? record["error"] : undefined;
  return error === undefined ? { started } : { started, error };
}

export const pluginsApi = {
  plugins: (machineId?: string) => request(pluginsPath(machineId), parsePiWebPluginsResponse),
};

export const selfUpdateApi = {
  status: () => request("api/pi-web/update/status", parsePiWebSelfUpdateStatus, { cache: "no-store" }),
  apply: () => request("api/pi-web/update/apply", parseSelfUpdateApplyResponse, { method: "POST", body: JSON.stringify({}) }),
};

/**
 * Fleet operations are answered by the server this browser is connected to, so
 * "every machine" is that server's machine list - which the report names.
 */
export const fleetApi = {
  report: () => request("api/pi-web/fleet", parsePiWebFleetReport, { cache: "no-store" }),
  run: (operation: "restart" | "update", machineIds?: readonly string[]) => request("api/pi-web/fleet/run", parsePiWebFleetRunResponse, {
    method: "POST",
    body: JSON.stringify({ operation, ...(machineIds === undefined ? {} : { machineIds }) }),
  }),
};

function piPackagePath(endpoint = "", machineId?: string): string {
  const basePath = machineId === undefined ? "api/pi-packages" : `${machinePrefix(machineId)}/pi-packages`;
  return endpoint === "" ? basePath : `${basePath}/${endpoint}`;
}

export const piPackagesApi = {
  packages: (machineId?: string) => request(piPackagePath("", machineId), parsePiPackagesResponse),
  install: (source: string, machineId?: string) => {
    const body: PiPackageInstallRequest = { source };
    return request(piPackagePath("install", machineId), parsePiPackageMutationResponse, { method: "POST", body: JSON.stringify(body) });
  },
  remove: (source: string, scope?: PiPackageScope, machineId?: string) => {
    const body: PiPackageRemoveRequest = scope === undefined ? { source } : { source, scope };
    return request(piPackagePath("remove", machineId), parsePiPackageMutationResponse, { method: "POST", body: JSON.stringify(body) });
  },
  update: (source?: string, machineId?: string) => {
    const body: PiPackageUpdateRequest | undefined = source === undefined ? undefined : { source };
    return request(piPackagePath("update", machineId), parsePiPackageMutationResponse, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  },
};

/**
 * Pins belong to the machine that holds the sessions, so every device that
 * browses that machine reads and writes the same set.
 */
export const sessionPinsApi = {
  pins: (machineId = "local") => request(`${machinePrefix(machineId)}/session-pins`, parseMachinePins, { cache: "no-store" }),
  setPinned: (sessionId: string, pinned: boolean, machineId = "local") => request(
    `${machinePrefix(machineId)}/session-pins`,
    parseMachinePins,
    { method: "POST", body: JSON.stringify({ sessionId, pinned }) },
  ),
  setProjectPinned: (sessionId: string, projectId: string, pinned: boolean, machineId = "local") => request(
    `${machinePrefix(machineId)}/session-pins`,
    parseMachinePins,
    { method: "POST", body: JSON.stringify({ sessionId, pinned, projectId }) },
  ),
  /** The whole order of a pinned list the reader dragged; a project id orders that project's pins. */
  setOrder: (order: readonly string[], machineId = "local", projectId?: string) => request(
    `${machinePrefix(machineId)}/session-pins`,
    parseMachinePins,
    { method: "POST", body: JSON.stringify(projectId === undefined ? { order: [...order] } : { order: [...order], projectId }) },
  ),
  adopt: (sessionIds: readonly string[], machineId = "local") => request(
    `${machinePrefix(machineId)}/session-pins`,
    parseMachinePins,
    { method: "POST", body: JSON.stringify({ adopt: [...sessionIds] }) },
  ),
};

/**
 * A machine's pins (B49): the global ones, and each project's own by project id. `projects` is
 * undefined when the machine answered without them, an older build that keeps no project pins, so
 * the page offers no project pin there rather than one that would vanish.
 */
export interface MachinePins {
  readonly global: readonly string[];
  readonly projects: ReadonlyMap<string, ReadonlySet<string>> | undefined;
}

function parseMachinePins(value: unknown): MachinePins {
  if (typeof value !== "object" || value === null) throw new Error("The machine did not answer with its pins");
  const pinned: unknown = Reflect.get(value, "pinnedSessionIds");
  if (!Array.isArray(pinned)) throw new Error("The machine did not answer with its pins");
  return { global: stringsOf(pinned), projects: parseProjectPins(Reflect.get(value, "projectPins")) };
}

function parseProjectPins(value: unknown): ReadonlyMap<string, ReadonlySet<string>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return new Map(Object.entries(value).flatMap(([projectId, ids]): [string, ReadonlySet<string>][] => (Array.isArray(ids) ? [[projectId, new Set(stringsOf(ids))]] : [])));
}

function stringsOf(values: readonly unknown[]): string[] {
  return values.filter((id): id is string => typeof id === "string");
}

export const machineStatusApi = {
  machineStatus: (machineId = "local") => request(`${machinePrefix(machineId)}/status`, requireMachineStatusSnapshot),
};

export const projectsApi = {
  projects: (machineId = "local") => request(`${machinePrefix(machineId)}/projects`, arrayOf(parseProject)),
  addProject: (path: string, name?: string, create?: boolean, machineId = "local") => request(`${machinePrefix(machineId)}/projects`, parseProject, { method: "POST", body: JSON.stringify({ path, name, create }) }),
  /** The whole order of the projects the reader dragged (R11). */
  reorderProjects: (order: readonly string[], machineId = "local") => request(`${machinePrefix(machineId)}/projects/order`, arrayOf(parseProject), { method: "POST", body: JSON.stringify({ order: [...order] }) }),
  closeProject: (projectId: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}`, parseClosed, { method: "DELETE" }),
  /** `init.signal` aborts the server's directory walk for a superseded query. */
  projectDirectories: (query: string, machineId = "local", init?: RequestInit) => request(`${machinePrefix(machineId)}/project-directories?q=${encodeURIComponent(query)}`, arrayOf(parseFileSuggestion), init),
};

function workspaceResolution(projectId: string, machineId = "local") {
  return request(
    `${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces`,
    (value) => {
      const resolution = parseWorkspaceProviderResolution(value);
      if (resolution.projectId !== projectId) throw new Error("Workspace resolution did not match the requested project");
      return resolution;
    },
  );
}

export const workspacesApi = {
  workspaceResolution,
  workspaces: async (projectId: string, machineId = "local") => [
    ...(await workspaceResolution(projectId, machineId)).workspaces,
  ],
  deleteWorkspace: (projectId: string, workspaceId: string, precondition: string, machineId = "local") => {
    const body: WorkspaceRemovalRequest = { precondition };
    return request(
      `${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}`,
      parseTerminalCommandRun,
      { method: "DELETE", body: JSON.stringify(body) },
    );
  },
  workspaceTree: (projectId: string, workspaceId: string, path = "", machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/tree?path=${encodeURIComponent(path)}`, parseFileTreeResponse),
  workspaceFile: (projectId: string, workspaceId: string, path: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file?path=${encodeURIComponent(path)}`, parseFileContentResponse),
  writeWorkspaceFile: (projectId: string, workspaceId: string, path: string, content: string | Uint8Array, options?: WriteWorkspaceFileOptions, machineId = "local") => {
    const params = new URLSearchParams({ path });
    if (options?.createDirs === false) params.set("createDirs", "false");
    if (options?.overwrite === false) params.set("overwrite", "false");
    const isBinary = content instanceof Uint8Array;
    const body: BodyInit = isBinary ? new Uint8Array(content) : new TextEncoder().encode(content);
    return request(
      `${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file?${params.toString()}`,
      parseWriteWorkspaceFileResponse,
      { method: "PUT", body, headers: { "Content-Type": isBinary ? "application/octet-stream" : "text/plain" } },
    );
  },
  deleteWorkspaceFile: (projectId: string, workspaceId: string, path: string, machineId = "local"): Promise<DeleteWorkspaceFileResponse> => {
    const params = new URLSearchParams({ path });
    return request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file?${params.toString()}`, parseDeleteWorkspaceFileResponse, { method: "DELETE" });
  },
  moveWorkspaceFile: (projectId: string, workspaceId: string, fromPath: string, toPath: string, options?: MoveWorkspaceFileOptions, machineId = "local") => {
    const params = new URLSearchParams({ fromPath, toPath });
    if (options?.createDirs === false) params.set("createDirs", "false");
    if (options?.overwrite === true) params.set("overwrite", "true");
    return request(
      `${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/file/move?${params.toString()}`,
      parseMoveWorkspaceFileResponse,
      { method: "POST" },
    );
  },
};

export const sessionsApi = {
  sessions: (cwd: string, machineId = "local") => request(`${machinePrefix(machineId)}/sessions?cwd=${encodeURIComponent(cwd)}`, arrayOf(parseSessionInfo)),
  /** Every project's workspaces and every workspace's sessions in one read (P4 slice a). */
  sessionBoard: (machineId = "local") => request(`${machinePrefix(machineId)}/session-board`, parseSessionBoardAnswer),
  sessionsIfChanged: async (cwd: string, revision: string, machineId = "local"): Promise<SessionsRevisionResponse> =>
    request(
      `${machinePrefix(machineId)}/sessions?cwd=${encodeURIComponent(cwd)}&revision=${encodeURIComponent(revision)}`,
      parseSessionsRevisionResponse,
      { cache: "no-store" },
    ),
  unreadCatalog: (machineId = "local") => request(`${machinePrefix(machineId)}/sessions/unread`, parseSessionUnreadCatalogSnapshot, { cache: "no-store" }),
  // `no-store`: a cached snapshot would reinstate work indicators the browser
  // has already superseded with live `status.update` events.
  statusCatalog: (machineId = "local") => request(`${machinePrefix(machineId)}/sessions/statuses`, parseSessionStatusCatalogSnapshot, { cache: "no-store" }),
  // Reading this clears it on the daemon, so it is fetched once per connection
  // rather than polled: the record answers "what did the last restart cut off".
  interruptedRuns: (machineId = "local") => request(`${machinePrefix(machineId)}/sessions/interrupted`, parseInterruptedRunSnapshot, { cache: "no-store" }),
  acknowledgeUnread: (session: SessionRef, catalogId: string, throughCompletionOrder: number, machineId = "local") => {
    const body: SessionUnreadAcknowledgeRequest = { cwd: session.cwd, catalogId, throughCompletionOrder };
    return request(sessionPath(session, "unread/acknowledge", machineId), parseSessionUnreadAcknowledgeResponse, { method: "POST", body: JSON.stringify(body) });
  },
  notificationInbox: (session: SessionRef, machineId = "local") => request(sessionQueryPath(session, "notifications", machineId), parseSessionNotificationInboxSnapshot),
  dismissNotification: (session: SessionRef, daemonInstanceId: string, notificationId: string, machineId = "local") => request(sessionPath(session, "notifications/dismiss", machineId), parseSessionNotificationDismissResponse, { method: "POST", body: sessionBody(session, { daemonInstanceId, notificationId }) }),
  dismissAllNotifications: (session: SessionRef, daemonInstanceId: string, through: SessionNotificationDismissThrough, machineId = "local") => request(sessionPath(session, "notifications/dismiss-all", machineId), parseSessionNotificationDismissResponse, { method: "POST", body: sessionBody(session, { daemonInstanceId, throughOrder: through.order, throughOverflowWatermark: through.overflowWatermark }) }),
  startSession: (cwd: string, machineId = "local", startupToken?: string) => request(`${machinePrefix(machineId)}/sessions`, parseSessionInfo, { method: "POST", body: JSON.stringify(startupToken === undefined ? { cwd } : { cwd, startupToken }) }),
  cleanupPreview: (input: SessionCleanupRequest, machineId = "local") => request(`${machinePrefix(machineId)}/sessions/cleanup/preview`, parseSessionCleanupPreviewResponse, { method: "POST", body: JSON.stringify(input) }),
  cleanup: (input: SessionCleanupRequest, machineId = "local") => request(`${machinePrefix(machineId)}/sessions/cleanup`, parseSessionCleanupExecuteResponse, { method: "POST", body: JSON.stringify(input) }),
  archiveMany: (sessions: readonly SessionRef[], machineId = "local") => request(`${machinePrefix(machineId)}/sessions/bulk/archive`, parseSessionBulkArchiveResponse, { method: "POST", body: sessionBulkMutationBody(sessions) }),
  deleteArchivedMany: (sessions: readonly SessionRef[], machineId = "local") => request(`${machinePrefix(machineId)}/sessions/bulk/delete-archived`, parseSessionBulkDeleteArchivedResponse, { method: "POST", body: sessionBulkMutationBody(sessions) }),
  messages: (session: SessionRef, options?: { limit?: number; before?: number }, machineId = "local") => request(messagePath(session, options, machineId), parseMessagePage),
  status: (session: SessionRef, machineId = "local") => request(sessionQueryPath(session, "status", machineId), parseSessionStatus),
  streamSnapshot: (session: SessionRef, machineId = "local") => request(sessionQueryPath(session, "stream-snapshot", machineId), parseSessionStreamSnapshot),
  /** Gap repair: replay frames after the client's last seen seq in its epoch, or resync. */
  streamSync: (session: SessionRef, sinceSeq: number, machineId = "local", epoch?: string) =>
    request(`${sessionPath(session, "stream-snapshot", machineId)}${sessionQuery(session)}&sinceSeq=${String(sinceSeq)}${epoch === undefined ? "" : `&epoch=${encodeURIComponent(epoch)}`}`, parseSessionStreamSync),
  backgroundTasks: (session: SessionRef, machineId = "local") =>
    request(`${sessionPath(session, "background-tasks", machineId)}?cwd=${encodeURIComponent(session.cwd)}`, parseBackgroundTasks, { cache: "no-store" }),
  clearQueue: (session: SessionRef, machineId = "local") => request(sessionPath(session, "queue/clear", machineId), parseSessionStatus, { method: "POST", body: sessionBody(session) }),
  // Same route as clearQueue: a body carrying `text` means "take this one
  // back", an empty one still means "empty the queue".
  recallQueuedMessage: (session: SessionRef, message: QueuedSessionMessage, machineId = "local") =>
    request(sessionPath(session, "queue/clear", machineId), parseRecallQueuedMessageResult, {
      method: "POST",
      body: sessionBody(session, {
        text: message.text,
        kind: message.kind,
        ...(message.clientMessageId === undefined ? {} : { clientMessageId: message.clientMessageId }),
      }),
    }),
  dismissWarning: (session: SessionRef, dismissId: string, machineId = "local") => request(sessionPath(session, "warnings/dismiss", machineId), parseSessionStatus, { method: "POST", body: sessionBody(session, { dismissId }) }),
  submitAsk: (session: SessionRef, askId: string, submission: AskUserSubmission, machineId = "local") => request(sessionPath(session, "ask/submit", machineId), parseAskUserCloseResponse, { method: "POST", body: sessionBody(session, { askId, answers: submission.answers }) }),
  cancelAsk: (session: SessionRef, askId: string, machineId = "local") => request(sessionPath(session, "ask/cancel", machineId), parseAskUserCloseResponse, { method: "POST", body: sessionBody(session, { askId }) }),
  answerDialog: (session: SessionRef, dialogId: string, value: ExtensionDialogAnswer, machineId = "local") => request(sessionPath(session, "dialogs/answer", machineId), parseExtensionDialogCloseResponse, { method: "POST", body: sessionBody(session, { dialogId, value }) }),
  sendDialogKey: (session: SessionRef, dialogId: string, key: string, machineId = "local") =>
    request(sessionPath(session, "dialog/key", machineId), parseDialogKeyResponse, { method: "POST", body: sessionBody(session, { dialogId, key }) }),
  cancelDialog: (session: SessionRef, dialogId: string, machineId = "local") => request(sessionPath(session, "dialogs/cancel", machineId), parseExtensionDialogCloseResponse, { method: "POST", body: sessionBody(session, { dialogId }) }),
  models: (session: SessionRef, machineId = "local") => request(sessionQueryPath(session, "models", machineId), parseModelSelectionResponse),
  modelCatalog: (session: SessionRef, machineId = "local") => request(sessionQueryPath(session, "models/catalog", machineId), parseSessionModelCatalogResponse),
  setModelEnabled: (session: SessionRef, provider: string, modelId: string, enabled: boolean, machineId = "local") => request(sessionPath(session, "models/enabled", machineId), parseSessionModelCatalogResponse, { method: "POST", body: sessionBody(session, { provider, modelId, enabled }) }),
  setModel: (session: SessionRef, provider: string, modelId: string, machineId = "local") => request(sessionPath(session, "model", machineId), parseSessionStatus, { method: "POST", body: sessionBody(session, { provider, modelId }) }),
  cycleModel: (session: SessionRef, direction: "forward" | "backward", machineId = "local") => request(sessionPath(session, "model/cycle", machineId), parseSessionStatus, { method: "POST", body: sessionBody(session, { direction }) }),
  thinkingLevels: (session: SessionRef, machineId = "local") => request(sessionQueryPath(session, "thinking-levels", machineId), parseThinkingLevelsResponse),
  setThinkingLevel: (session: SessionRef, level: string, machineId = "local") => request(sessionPath(session, "thinking-level", machineId), parseSessionStatus, { method: "POST", body: sessionBody(session, { level }) }),
  cycleThinkingLevel: (session: SessionRef, machineId = "local") => request(sessionPath(session, "thinking-level/cycle", machineId), parseSessionStatus, { method: "POST", body: sessionBody(session) }),
  commands: (session: SessionRef, machineId = "local") => request(sessionQueryPath(session, "commands", machineId), arrayOf(parseSlashCommand)),
  prompt: (session: SessionRef, text: string, streamingBehavior?: "steer" | "followUp", machineId = "local", attachments?: PromptAttachment[], clientMessageId?: string, sentAt?: string) => request(sessionPath(session, "prompt", machineId), parseAccepted, { method: "POST", body: sessionBody(session, { text, ...(streamingBehavior === undefined ? {} : { streamingBehavior }), ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}), ...(clientMessageId === undefined ? {} : { clientMessageId }), ...(sentAt === undefined ? {} : { sentAt }) }) }),
  saveAttachments: (session: SessionRef, attachments: PromptAttachment[], machineId = "local", folder?: string) => request(sessionPath(session, "attachments", machineId), parseSavedAttachments, { method: "POST", body: sessionBody(session, { attachments, ...(folder === undefined ? {} : { folder }) }) }),
  shell: (session: SessionRef, text: string, machineId = "local") => request(sessionPath(session, "shell", machineId), parseAccepted, { method: "POST", body: sessionBody(session, { text }) }),
  runCommand: (session: SessionRef, text: string, machineId = "local") => request(sessionPath(session, "commands/run", machineId), parseCommandResult, { method: "POST", body: sessionBody(session, { text }) }),
  respondToCommand: (session: SessionRef, requestId: string, value: string, machineId = "local") => request(sessionPath(session, "commands/respond", machineId), parseCommandResult, { method: "POST", body: sessionBody(session, { requestId, value }) }),
  navigateTree: (session: SessionRef, navigation: SessionTreeNavigateRequest, machineId = "local") => request(sessionPath(session, "tree/navigate", machineId), parseSessionTreeNavigateResult, {
    method: "POST",
    body: sessionBody(session, { targetId: navigation.targetId, expectedLeafId: navigation.expectedLeafId, summary: navigation.summary }),
  }),
  forkTree: (session: SessionRef, fork: SessionTreeForkRequest, machineId = "local") => requestSessionFork(session, "tree/fork", { entryId: fork.entryId, expectedLeafId: fork.expectedLeafId }, machineId),
  continueInNewSession: (session: SessionRef, machineId = "local") => requestSessionFork(session, "continue", {}, machineId),
  locateSession: (session: SessionRef, machineId = "local") => requestSessionLocation(session, machineId),
  transcriptTail: (session: SessionRef, options: { limit: number }, machineId = "local") => readNewerDaemonRoute(`${sessionQueryPath(session, "transcript-tail", machineId)}&${new URLSearchParams({ limit: String(options.limit) }).toString()}`, machineId, parseSessionTranscriptTail, /^Route GET:.*\/transcript-tail(\?.*)? not found$/i),
  /**
   * Ask what became of identities this browser could not settle. Identities the
   * daemon has no row for are absent from the answer, which keeps "unknown"
   * distinct from "failed".
   */
  operationOutcomes: (session: SessionRef, operationIds: readonly string[], machineId = "local") =>
    request(sessionPath(session, "operations", machineId), parseOperationOutcomes, {
      method: "POST",
      body: sessionBody(session, { operationIds: [...operationIds] }),
    }),
  abort: (session: SessionRef, machineId = "local") => request(sessionPath(session, "abort", machineId), parseAborted, { method: "POST", body: sessionBody(session) }),
  stop: (session: SessionRef, machineId = "local") => request(sessionPath(session, "stop", machineId), parseStopped, { method: "POST", body: sessionBody(session) }),
  archive: (session: SessionRef, machineId = "local") => request(sessionPath(session, "archive", machineId), parseArchived, { method: "POST", body: sessionBody(session) }),
  archiveWithDescendants: (session: SessionRef, machineId = "local") => request(sessionPath(session, "archive-tree", machineId), parseArchived, { method: "POST", body: sessionBody(session) }),
  restore: (session: SessionRef, machineId = "local") => request(sessionPath(session, "restore", machineId), parseRestored, { method: "POST", body: sessionBody(session) }),
  detachParent: (session: SessionRef, machineId = "local") => request(sessionPath(session, "detach-parent", machineId), parseDetached, { method: "POST", body: sessionBody(session) }),
  reloadSession: (session: SessionRef, machineId = "local") => request(sessionPath(session, "reload", machineId), parseReloaded, { method: "POST", body: sessionBody(session) }),
  authProviders: (options?: { mode?: "login" | "logout"; authType?: "oauth" | "api_key"; machineId?: string }) => {
    const params = new URLSearchParams();
    if (options?.mode !== undefined) params.set("mode", options.mode);
    if (options?.authType !== undefined) params.set("authType", options.authType);
    const query = params.toString();
    return request(`${machinePrefix(options?.machineId)}/auth/providers${query === "" ? "" : `?${query}`}`, parseAuthProvidersResponse);
  },
  startInteractiveApiKeyLogin: (providerId: string, machineId = "local") => request(`${machinePrefix(machineId)}/auth/api-key/interactive`, parseOAuthFlowState, { method: "POST", body: JSON.stringify({ providerId }) }),
  logoutProvider: (providerId: string, machineId = "local") => request(`${machinePrefix(machineId)}/auth/logout`, parseAccepted, { method: "POST", body: JSON.stringify({ providerId }) }),
  startOAuthLogin: (providerId: string, machineId = "local") => request(`${machinePrefix(machineId)}/auth/oauth`, parseOAuthFlowState, { method: "POST", body: JSON.stringify({ providerId }) }),
  oauthFlow: (flowId: string, machineId = "local") => request(`${machinePrefix(machineId)}/auth/oauth/${encodeURIComponent(flowId)}`, parseOAuthFlowState),
  respondOAuthFlow: (flowId: string, requestId: string, value: string, machineId = "local") => request(`${machinePrefix(machineId)}/auth/oauth/${encodeURIComponent(flowId)}/respond`, parseOAuthFlowState, { method: "POST", body: JSON.stringify({ requestId, value }) }),
  cancelOAuthFlow: (flowId: string, machineId = "local") => request(`${machinePrefix(machineId)}/auth/oauth/${encodeURIComponent(flowId)}/cancel`, parseOAuthFlowState, { method: "POST" }),
};

export const terminalsApi = {
  terminals: (projectId: string, workspaceId: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals`, arrayOf(parseTerminalInfo)),
  startTerminal: (projectId: string, workspaceId: string, options?: { name?: string; cols?: number; rows?: number }, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals`, parseTerminalInfo, { method: "POST", body: JSON.stringify(options ?? {}) }),
  closeWorkspaceTerminals: (projectId: string, workspaceId: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals`, parseClosed, { method: "DELETE" }),
  closeTerminal: (projectId: string, workspaceId: string, terminalId: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(terminalId)}`, parseClosed, { method: "DELETE" }),
  continueTerminal: (projectId: string, workspaceId: string, terminalId: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(terminalId)}/continue`, parseTerminalInfo, { method: "POST" }),
  renameTerminal: (projectId: string, workspaceId: string, terminalId: string, name: string, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(terminalId)}/rename`, parseTerminalInfo, { method: "POST", body: JSON.stringify({ name }) }),
  runTerminalCommand: (origin: string, input: RunTerminalCommandInput, machineId = "local") => request(`${machinePrefix(machineId)}/projects/${encodeURIComponent(input.workspace.projectId)}/workspaces/${encodeURIComponent(input.workspace.id)}/terminal-command-runs`, parseTerminalCommandRun, { method: "POST", body: JSON.stringify({ origin, title: input.title, command: input.command, metadata: input.metadata ?? {} }) }),
  listCommandRuns: (filter?: TerminalCommandRunFilter, machineId = "local") => request(`${machinePrefix(machineId)}/terminal-command-runs${terminalCommandRunFilterQuery(filter)}`, arrayOf(parseTerminalCommandRun)),
  getCommandRun: (runId: string, machineId = "local") => getOptionalTerminalCommandRun(runId, machineId),
  cancelCommandRun: (runId: string, machineId = "local") => request(`${machinePrefix(machineId)}/terminal-command-runs/${encodeURIComponent(runId)}/cancel`, parseTerminalCommandRun, { method: "POST" }),
  /** The machine's own terminals, in its home folder (machineTerminalRoutes.ts). */
  machineTerminals: (machineId = "local") => request(`${machinePrefix(machineId)}/terminals`, arrayOf(parseTerminalInfo)),
  startMachineTerminal: (options?: { name?: string; cols?: number; rows?: number }, machineId = "local") => request(`${machinePrefix(machineId)}/terminals`, parseTerminalInfo, { method: "POST", body: JSON.stringify(options ?? {}) }),
  closeMachineTerminals: (machineId = "local") => request(`${machinePrefix(machineId)}/terminals`, parseClosed, { method: "DELETE" }),
  closeMachineTerminal: (terminalId: string, machineId = "local") => request(`${machinePrefix(machineId)}/terminals/${encodeURIComponent(terminalId)}`, parseClosed, { method: "DELETE" }),
  continueMachineTerminal: (terminalId: string, machineId = "local") => request(`${machinePrefix(machineId)}/terminals/${encodeURIComponent(terminalId)}/continue`, parseTerminalInfo, { method: "POST" }),
  renameMachineTerminal: (terminalId: string, name: string, machineId = "local") => request(`${machinePrefix(machineId)}/terminals/${encodeURIComponent(terminalId)}/rename`, parseTerminalInfo, { method: "POST", body: JSON.stringify({ name }) }),
};

/**
 * Raised when an older session daemon cannot serve the specific `tree/fork`
 * route. The message is user-facing and explains how to enable the operation.
 */
export class SessionTreeForkUnavailableError extends Error {
  constructor() {
    super("Fork from the session tree is unavailable. Restart the session daemon to enable it.");
    this.name = "SessionTreeForkUnavailableError";
  }
}

/** The two ways a session forks, and what an older daemon that lacks the route says for each. */
type SessionForkEndpoint = "tree/fork" | "continue";

const SESSION_FORK_ROUTES: Readonly<Record<SessionForkEndpoint, { missing: RegExp; unavailable: () => Error }>> = {
  "tree/fork": { missing: /^Route POST:.*\/tree\/fork not found$/i, unavailable: () => new SessionTreeForkUnavailableError() },
  continue: { missing: /^Route POST:.*\/continue not found$/i, unavailable: () => new Error("This machine's session daemon cannot continue a session in a new one yet. Update PI WEB there and restart its session daemon.") },
};

async function requestSessionFork(session: SessionRef, endpoint: SessionForkEndpoint, fields: Record<string, unknown>, machineId: string): Promise<SessionTreeForkResult> {
  const route = SESSION_FORK_ROUTES[endpoint];
  try {
    return await fetchWithDeadline(resolveAppUrl(sessionPath(session, endpoint, machineId)), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: sessionBody(session, fields),
    }, async (response) => {
      reportTransportReachable(sessionPath(session, endpoint, machineId));
      if (!response.ok) {
        const body: unknown = await response.json().catch((): unknown => ({}));
        if (isMissingDaemonRoute(response.status, body, route.missing)) throw route.unavailable();
        throw new HttpError(apiErrorMessage(body) ?? response.statusText, response.status, machineIdFromUrl(sessionPath(session, endpoint, machineId)), undefined, errorCode(body));
      }
      return parseSessionTreeForkResult(await response.json());
    });
  } catch (error) {
    // A bare TypeError is the browser's link-failure shape; unscoped, it
    // lands page-level and any other machine's success erases it.
    if (isTransportFailure(error)) throw new HttpError(describeError(error), 0, machineId);
    throw error;
  }
}

/**
 * Where a session is, machine-wide (P2 slice b): the daemon's answer, or
 * `unsupported` from a daemon older than the route. A missing session is the
 * typed error, which the read classifier turns into `gone`.
 */
export type SessionLocation = { kind: "found"; session: SessionInfo } | { kind: "unsupported" };

async function requestSessionLocation(session: SessionRef, machineId: string): Promise<SessionLocation> {
  const read = await readNewerDaemonRoute(sessionQueryPath(session, "locate", machineId), machineId, parseSessionInfo, /^Route GET:.*\/locate(\?.*)? not found$/i);
  return read.kind === "answered" ? { kind: "found", session: read.value } : read;
}

/** A read of a route newer daemons have: its answer, or `unsupported` from a daemon older than the route. */
export type NewerRouteRead<T> = { kind: "answered"; value: T } | { kind: "unsupported" };

async function readNewerDaemonRoute<T>(path: string, machineId: string, parse: (value: unknown) => T, route: RegExp): Promise<NewerRouteRead<T>> {
  try {
    return await fetchWithDeadline(resolveAppUrl(path), { cache: "no-store" }, async (response): Promise<NewerRouteRead<T>> => {
      reportTransportReachable(path);
      if (response.ok) return { kind: "answered", value: parse(await response.json()) };
      const body: unknown = await response.json().catch((): unknown => ({}));
      if (isMissingDaemonRoute(response.status, body, route)) return { kind: "unsupported" };
      throw new HttpError(apiErrorMessage(body) ?? response.statusText, response.status, machineIdFromUrl(path), undefined, errorCode(body));
    });
  } catch (error) {
    if (isTransportFailure(error)) throw new HttpError(describeError(error), 0, machineId);
    throw error;
  }
}

/** Fastify's own not-found envelope for a route this daemon does not have; an older daemon answers it for a newer route. */
function isMissingDaemonRoute(status: number, value: unknown, route: RegExp): boolean {
  if (status !== 404 || !isRecord(value)) return false;
  if (value["statusCode"] !== 404 || value["error"] !== "Not Found") return false;
  const message = value["message"];
  return typeof message === "string" && route.test(message);
}

async function getOptionalTerminalCommandRun(runId: string, machineId: string): Promise<TerminalCommandRun | undefined> {
  const path = `${machinePrefix(machineId)}/terminal-command-runs/${encodeURIComponent(runId)}`;
  try {
    return await fetchWithDeadline(resolveAppUrl(path), undefined, async (response) => {
      reportTransportReachable(path);
      if (response.status === 404) return undefined;
      if (!response.ok) {
        const body: unknown = await response.json().catch((): unknown => ({}));
        throw new HttpError(apiErrorMessage(body) ?? response.statusText, response.status, machineId, undefined, errorCode(body));
      }
      return parseTerminalCommandRun(await response.json());
    });
  } catch (error) {
    if (isTransportFailure(error)) throw new HttpError(describeError(error), 0, machineId);
    throw error;
  }
}

function terminalCommandRunFilterQuery(filter: TerminalCommandRunFilter | undefined): string {
  if (filter === undefined) return "";
  const params = new URLSearchParams();
  if (filter.projectId !== undefined) params.set("projectId", filter.projectId);
  if (filter.workspaceId !== undefined) params.set("workspaceId", filter.workspaceId);
  if (filter.terminalId !== undefined) params.set("terminalId", filter.terminalId);
  if (filter.statuses !== undefined && filter.statuses.length > 0) params.set("statuses", filter.statuses.join(","));
  if (filter.metadata !== undefined && Object.keys(filter.metadata).length > 0) params.set("metadata", JSON.stringify(filter.metadata));
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export interface FileSuggestionQueryOptions {
  kind?: FileSuggestion["kind"] | undefined;
  mode?: "file" | "path" | undefined;
  scope?: "tracked" | "all" | undefined;
  machineId?: string | undefined;
  projectId: string;
  workspaceId: string;
}

export const filesApi = {
  files: (query: string, options: FileSuggestionQueryOptions) => {
    const params = new URLSearchParams({ q: query });
    if (options.kind !== undefined) params.set("kind", options.kind);
    if (options.mode !== undefined) params.set("mode", options.mode);
    if (options.scope !== undefined) params.set("scope", options.scope);
    return request(`${machinePrefix(options.machineId)}/projects/${encodeURIComponent(options.projectId)}/workspaces/${encodeURIComponent(options.workspaceId)}/files?${params.toString()}`, arrayOf(parseFileSuggestion));
  },
};

const workspaceTrustPath = (machineId: string, projectId: string, workspaceId: string) =>
  `${machinePrefix(machineId)}/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/trust`;

const projectTrustPath = (machineId: string, path: string) => {
  const params = new URLSearchParams({ path });
  return `${machinePrefix(machineId)}/projects/trust?${params.toString()}`;
};

export const trustApi = {
  /** Existing-decision lookup for a raw path (add-project dialog); the server resolves the path first. */
  projectTrust: (path: string, machineId = "local") => request(projectTrustPath(machineId, path), parseWorkspaceTrustResponse),
  workspaceTrust: (projectId: string, workspaceId: string, machineId = "local") => request(workspaceTrustPath(machineId, projectId, workspaceId), parseWorkspaceTrustResponse),
  setWorkspaceTrust: (projectId: string, workspaceId: string, trusted: boolean, machineId = "local") => request(workspaceTrustPath(machineId, projectId, workspaceId), parseWorkspaceTrustResponse, { method: "PUT", body: JSON.stringify({ trusted }) }),
};

export const api = {
  ...piWebApi,
  ...machinesApi,
  ...configApi,
  ...pluginsApi,
  ...piPackagesApi,
  ...projectsApi,
  ...workspacesApi,
  ...sessionsApi,
  ...terminalsApi,
  ...filesApi,
  ...trustApi,

};
