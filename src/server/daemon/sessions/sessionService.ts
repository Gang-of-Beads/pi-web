import type {
  AskUserCloseResponse,
  AskUserSubmission,
  ExtensionDialogAnswer,
  ExtensionDialogCloseResponse,
  SavedPromptAttachment,
  SessionBulkArchiveResponse,
  SessionBulkDeleteArchivedResponse,
  SessionBulkMutationRef,
  SessionNotificationCatalogSnapshot,
  SessionNotificationDismissAllRequest,
  SessionNotificationDismissRequest,
  SessionNotificationDismissResponse,
  SessionNotificationInboxSnapshot,
  SessionUnreadAcknowledgeRequest,
  SessionStatusCatalogSnapshot,
  SessionUnreadAcknowledgeResponse,
  SessionUnreadCatalogSnapshot,
} from "../../../shared/apiTypes.js";
import type {
  ClientArchiveSessionsResponse,
  ClientCommand,
  ClientCommandResult,
  ClientMessagePage,
  ClientSession,
  ClientSessionCleanupExecuteResponse,
  ClientSessionCleanupPreviewResponse,
  ClientSessionModel,
  ClientSessionModelCatalogEntry,
  ClientSessionRef,
  ClientSessionStatus,
  ClientSessionTreeForkRequest,
  ClientSessionTreeForkResult,
  ClientSessionTreeNavigateRequest,
  ClientSessionTreeNavigateResult,
  ClientThinkingLevel,
  SessionStreamSnapshot,
  SessionStreamSync,
} from "../../shared/types.js";
import type { QueuedSessionMessage, SessionBackgroundTaskInfo, SessionSubagentRunInfo } from "../../../shared/apiTypes.js";
import type { NormalizedSessionCleanupRequest } from "./sessionCleanup.js";
import type { SubsessionSummary } from "./spawnSubsessionTool.js";

export type SessionRouteRef = ClientSessionRef;

/**
 * Route-facing session contract for PI WEB's HTTP/WebSocket API.
 *
 * Keep transport concerns separate from the bundled Pi SDK implementation so
 * routes remain testable. Pi-specific lifecycle hooks such as auth-change
 * handling and daemon shutdown stay on the concrete service.
 */
export interface SessionRouteService {
  list(cwd: string): Promise<ClientSession[]>;
  /**
   * Create a session. `startupToken` is an opaque label the caller supplies so
   * it can recognise this construction's startup progress reports; the service
   * echoes it and never interprets it.
   */
  start(cwd: string, options?: { startupToken?: string }): Promise<ClientSession>;
  messages(ref: SessionRouteRef, page?: { before?: number; limit?: number }): Promise<ClientMessagePage>;
  status(ref: SessionRouteRef): Promise<ClientSessionStatus>;
  streamSnapshot(ref: SessionRouteRef): Promise<SessionStreamSnapshot>;
  /** Gap repair: replay the frames after the client's last seen seq, or resync. */
  streamSync(ref: SessionRouteRef, sinceSeq: number): Promise<SessionStreamSync>;
  notificationCatalog(): SessionNotificationCatalogSnapshot | Promise<SessionNotificationCatalogSnapshot>;
  unreadCatalog(): Promise<SessionUnreadCatalogSnapshot>;
  /** Status of every currently loaded session, for browser hydration. */
  sessionStatusCatalog(): SessionStatusCatalogSnapshot | Promise<SessionStatusCatalogSnapshot>;
  acknowledgeUnread(sessionId: string, request: SessionUnreadAcknowledgeRequest): Promise<SessionUnreadAcknowledgeResponse>;
  notificationInbox(ref: SessionRouteRef): SessionNotificationInboxSnapshot | Promise<SessionNotificationInboxSnapshot>;
  dismissNotification(ref: SessionRouteRef, request: Omit<SessionNotificationDismissRequest, "cwd">): SessionNotificationDismissResponse | Promise<SessionNotificationDismissResponse>;
  dismissAllNotifications(ref: SessionRouteRef, request: Omit<SessionNotificationDismissAllRequest, "cwd">): SessionNotificationDismissResponse | Promise<SessionNotificationDismissResponse>;
  /** Subagent-tool runs started by this session; see subagentRuns.ts. */
  subagentRuns(ref: SessionRouteRef): Promise<SessionSubagentRunInfo[]>;
  /** The result artifact of one finished run, if it wrote one. */
  subagentRunOutput(ref: SessionRouteRef, runId: string): Promise<string | undefined>;
  /** One run's conversation, projected like any other transcript; undefined when it has none yet. */
  subagentRunMessages(ref: SessionRouteRef, runId: string, page?: { before?: number; limit?: number }): Promise<ClientMessagePage | undefined>;
  /** Background-task runs started by this session; see backgroundTasks.ts. */
  backgroundTasks(ref: SessionRouteRef): Promise<SessionBackgroundTaskInfo[]>;
  /** Tail of a background task's log. */
  backgroundTaskOutput(ref: SessionRouteRef, taskId: string): Promise<string | undefined>;
  clearQueue(ref: SessionRouteRef): Promise<ClientSessionStatus>;
  /** Remove one queued message, leaving the rest of the queue in order. */
  recallQueuedMessage(ref: SessionRouteRef, target: { kind?: "steer" | "followUp"; text: string; clientMessageId?: string }): Promise<{ recalled: boolean; status: ClientSessionStatus }>;
  submitAsk(ref: SessionRouteRef, askId: string, submission: AskUserSubmission): Promise<AskUserCloseResponse>;
  cancelAsk(ref: SessionRouteRef, askId: string): Promise<AskUserCloseResponse>;
  answerDialog(ref: SessionRouteRef, dialogId: string, value: ExtensionDialogAnswer): Promise<ExtensionDialogCloseResponse>;
  cancelDialog(ref: SessionRouteRef, dialogId: string): Promise<ExtensionDialogCloseResponse>;
  dismissWarning(ref: SessionRouteRef, dismissId: string): Promise<ClientSessionStatus>;
  availableModels(ref: SessionRouteRef): Promise<ClientSessionModel[]>;
  /** The session machine's full available-model catalog with per-model enabled state, enabled models first. */
  modelCatalog(ref: SessionRouteRef): Promise<ClientSessionModelCatalogEntry[]>;
  setModel(ref: SessionRouteRef, provider: string, modelId: string): Promise<ClientSessionStatus>;
  /** Add/remove one model to/from pi's enabled-models scope; returns the updated full catalog. */
  setModelEnabled(ref: SessionRouteRef, provider: string, modelId: string, enabled: boolean): Promise<ClientSessionModelCatalogEntry[]>;
  cycleModel(ref: SessionRouteRef, direction: "forward" | "backward"): Promise<ClientSessionStatus>;
  availableThinkingLevels(ref: SessionRouteRef): Promise<ClientThinkingLevel[]>;
  setThinkingLevel(ref: SessionRouteRef, level: string): Promise<ClientSessionStatus>;
  cycleThinkingLevel(ref: SessionRouteRef): Promise<ClientSessionStatus>;
  commands(ref: SessionRouteRef): Promise<ClientCommand[]>;
  prompt(ref: SessionRouteRef, text: unknown, streamingBehavior?: unknown, attachments?: unknown, options?: { echoUserMessage?: boolean; clientMessageId?: unknown }): Promise<void>;
  saveAttachments(ref: SessionRouteRef, attachments: unknown, folder?: string): Promise<SavedPromptAttachment[]>;
  cleanupPreview(request: NormalizedSessionCleanupRequest): Promise<ClientSessionCleanupPreviewResponse>;
  cleanup(request: NormalizedSessionCleanupRequest): Promise<ClientSessionCleanupExecuteResponse>;
  archiveMany(refs: readonly SessionBulkMutationRef[]): Promise<SessionBulkArchiveResponse>;
  deleteArchivedMany(refs: readonly SessionBulkMutationRef[]): Promise<SessionBulkDeleteArchivedResponse>;
  shell(ref: SessionRouteRef, text: string): Promise<void>;
  runCommand(ref: SessionRouteRef, text: string): Promise<ClientCommandResult>;
  /**
   * Child sessions the agent spawned while working in this session.
   *
   * The web UI shows them so a parent conversation does not end the moment its
   * own turn does: the children keep running and now have somewhere visible to
   * live. Returned with the fields the client needs to label and reopen them.
   */
  subsessions(ref: SessionRouteRef): Promise<SubsessionSummary[]>;
  respondToCommand(ref: SessionRouteRef, requestId: string, value: string): Promise<ClientCommandResult>;
  navigateTree(ref: SessionRouteRef, request: ClientSessionTreeNavigateRequest): Promise<ClientSessionTreeNavigateResult>;
  forkFromTree(ref: SessionRouteRef, request: ClientSessionTreeForkRequest): Promise<ClientSessionTreeForkResult>;
  /** Stops current work and returns whatever was queued, so it is not lost. */
  abort(ref: SessionRouteRef): Promise<{ discarded: QueuedSessionMessage[] }>;
  stop(ref: SessionRouteRef): void | Promise<void>;
  archive(ref: SessionRouteRef): Promise<void>;
  archiveTree(ref: SessionRouteRef): Promise<ClientArchiveSessionsResponse>;
  restore(ref: SessionRouteRef): Promise<void>;
  reload(ref: SessionRouteRef): Promise<void>;
  detachParent(ref: SessionRouteRef): Promise<void>;
}
