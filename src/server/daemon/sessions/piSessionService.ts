import { existsSync, statSync } from "node:fs";
import { sessionActivityLabel } from "./sessionActivityLabel.js";
import { EMPTY_HOST_CONTRIBUTIONS, type HostContributions } from "./hostContributions.js";
import { takeUnfiledWarnings } from "./warningFiling.js";
import { basename, dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createEditToolDefinition,
  defineTool,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  readStoredCredential,
  SessionManager,
  SettingsManager,
  type AgentSessionRuntimeDiagnostic,
  type AgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
  type CreateAgentSessionServicesOptions,
  type EditToolDetails,
  type ExtensionUIDialogOptions,
  type ExtensionUIContext,
  type ModelRuntime,
  type PromptOptions,
  type ProjectTrustContext,
  type ProjectTrustEvent,
  type ProjectTrustEventResult,
  type ResourceDiagnostic,
  CURRENT_SESSION_VERSION,
  migrateSessionEntries,
  parseSessionEntries,
  type FileEntry,
} from "@earendil-works/pi-coding-agent";
import type { SessionBackgroundTaskInfo, SessionSubagentRunInfo, TranscriptHead } from "../../../shared/apiTypes.js";
import type { ClientArchiveSessionsResponse, ClientCommand, ClientCommandResult, ClientMessagePage, ClientSession, ClientSessionCleanupExecuteResponse, ClientSessionCleanupPreviewResponse, ClientSessionModel, ClientSessionModelCatalogEntry, ClientSessionStatus, ClientSessionTreeForkRequest, ClientSessionTreeForkResult, ClientSessionTreeNavigateRequest, ClientSessionTreeNavigateResult, ClientThinkingLevel, SessionStreamSnapshot, SessionStreamSync, SessionTranscriptTail, SessionUiEvent } from "../../shared/types.js";
import { projectBrowserMessage } from "../browserMessageProjection.js";
import { pageMessagesAtSafeBoundary } from "./messagePaging.js";
import { annotateAssistantThinkingLevel, branchMessages, branchTranscript, isCutAssistant, stoppedTurnMessage, transcriptHead, TURN_STOPPED_CUSTOM_TYPE } from "../../../shared/branchMessages.js";
import { runTranscriptMessages } from "../../../shared/subagentRunTranscript.js";
import { readableMessageCount } from "./readableMessageCount.js";
import { pluginSurfacePresence } from "./pluginSurfaces.js";
import type { SessionEventHub } from "../realtime/sessionEventHub.js";
import { BUILTIN_COMMANDS } from "./builtinCommands.js";
import { SessionCommandService } from "./sessionCommandService.js";
import { projectSessionTree, type ProjectableSessionTreeNode } from "./sessionTreeProjection.js";
import { clearRunInFlight, markRunInFlight } from "./interruptedRunStore.js";
import { SessionArchiveStore, type ArchivedSessionRecord, type ArchiveSessionInput } from "./sessionArchiveStore.js";
import { findArchiveCandidateByIdOrPrefix, planSessionArchiveTree, type SessionArchiveTreeCandidate } from "./sessionArchiveTree.js";
import { deterministicSessionName, fallbackSessionName, generateShortSessionName } from "./sessionNameGenerator.js";
import { computeEditPreview, type EditPreviewResult } from "./editPreview.js";
import { attachmentsToInlineImages, saveAttachmentsToWorkspace } from "./attachmentService.js";
import { parsePromptAttachments } from "../../../shared/promptAttachments.js";
import { ASK_USER_ANSWERS_CUSTOM_TYPE, SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH, SESSION_UNREAD_LIMIT } from "../../../shared/apiTypes.js";
import { AGENT_NOTICE_DELIVERY, AgentNotices } from "./agentNotices.js";
import { IDLE_STEP, nextSessionStep, stepPhase, stepWords } from "./sessionStep.js";
import type {
  AskUserCloseResponse,
  AskUserOutcome,
  AskUserSubmission,
  ExtensionDialogAnswer,
  ExtensionDialogCloseResponse,
  ExtensionDialogKind,
  ExtensionDialogScreen,
  ExtensionDialogOutcome,
  QueuedSessionMessage,
  SavedPromptAttachment,
  SessionBulkArchiveResponse,
  SessionBulkDeleteArchivedResponse,
  SessionBulkFailure,
  SessionBulkMutationRef,
  SessionNotificationCatalogSnapshot,
  SessionActivity,
  SessionNotificationClearReason,
  SessionStep,
  SessionNotificationDismissAllRequest,
  SessionNotificationDismissRequest,
  SessionNotificationDismissResponse,
  SessionNotificationInboxSnapshot,
  SessionUnreadAcknowledgeRequest,
  SessionStatusCatalogSnapshot,
  SessionUnreadAcknowledgeResponse,
  SessionUnreadCatalogSnapshot,
  SessionWarning,
} from "../../../shared/apiTypes.js";
import type { SessionRouteRef, SessionRouteService } from "./sessionService.js";

import { type AuthChange } from "./authService.js";
import { canonicalizeStoredCwd, cwdPathsEqual } from "../workingDirectory.js";
import { readSessionHeaderSummary } from "./sessionFileHeader.js";
import type { WorkspaceActivityService } from "../activity/workspaceActivityService.js";
import { createAskUserToolDefinition, type AskUserInvocation, type AskUserToolDeps } from "./askUserTool.js";
import { PendingAskStore, renderAskUserAnswersText, type PendingAskCloseResult, type PendingAskOpenResult } from "./pendingAskStore.js";
import { PendingExtensionDialogStore, PendingExtensionDialogValidationError, type ExtensionDialogCancelReason, type PendingExtensionDialogOpenInput } from "./pendingExtensionDialogStore.js";
import type { PendingExtensionDialog } from "../../../shared/apiTypes.js";
import { ExtensionDialogWaiters, effectiveExtensionDialogTimeoutMs, extensionDialogCancelValue } from "./extensionDialogWaiters.js";
import { DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS } from "../../../config.js";
import type { DelegationRequest, SpawnSessionInvocation, SpawnSessionResult, SpawnSubsessionInvocation, SpawnSubsessionResult, SubsessionCheckResult, SubsessionReadQuery, SubsessionReadResult, SubsessionStatus, SubsessionSummary } from "./delegation.js";
import { createBackgroundRunCountCycle } from "./backgroundRunCount.js";
import { BackgroundWorkWatcher } from "./backgroundWorkWatcher.js";
import { WorkspaceWatcher } from "../workspaces/workspaceWatcher.js";
import { listBackgroundTasks, readTaskOutput } from "./backgroundTasks.js";
import { promptDeliveryBehavior, type QueuedPromptKind } from "./promptDelivery.js";
import { createInMemoryAcceptanceLedger } from "./acceptanceLedger.js";
import { HANDOFF_RUN_STATE, HANDOFF_WAKE_EVENTS, idleBatchSize, isSettling, nextHandoff, refusalKind, runStateOf, type HandoffVerdict, type RunState } from "./promptHandoff.js";
import { SETTLEABLE, createDurableAcceptanceLedger, type AcceptanceFace } from "./operationLedger.js";
import { CommandHandlerScope } from "./commandHandlerScope.js";
import { CommittedPromptExpectations } from "./committedPromptIdentity.js";
import { messageSentAt } from "./messageSentAt.js";
import { LOCAL_HOLD_ID_PREFIX, OwnedPromptQueue, dataDirInboxLocation, entryKey, listWaitingInboxes, memoryInboxLocation, type OwnedQueueEntry } from "./ownedPromptQueue.js";
import { findSubagentRunTranscript, listSubagentRuns, readSessionEntries, readSubagentRunOutput } from "./subagentRuns.js";
import { branchFromFileEntries, isCurrentVersionFile } from "./fileBranch.js";
import { applyProviderSafeToolSchemas } from "./providerSafeToolSchema.js";
import { buildTranscriptView } from "./subsessionTranscript.js";
import { planSessionCleanup, summarizeSessionCleanupExecution, type NormalizedSessionCleanupRequest, type SessionCleanupPlan } from "./sessionCleanup.js";
import type { SpawnTargetDecision, SpawnTargetResolver } from "./spawnTargetResolver.js";
import {
  SessionNotificationStore,
  type SessionNotificationGeneration,
  type SessionNotificationMutation,
} from "./sessionNotificationStore.js";
import { plainTextTheme } from "./plainTextTheme.js";
import { customScreenHarness, extensionNameFromStack, renderCustomScreen, type CustomScreenComponent } from "./customScreen.js";
import { DECLARABLE_SCREENS, declaredScreen, refusedDeclarationSummary } from "./declaredScreen.js";
import { dialogAnswerText } from "../../../shared/dialogAnswerText.js";
import { SessionUnreadStore, type SessionUnreadMutation } from "./sessionUnreadStore.js";
import { applyEnabledModelToggle, catalogWithEnabledFirst, liveScopedModelIds, modelScopeId, persistedEnabledModelPatterns, resolveEnabledModelIds, resolveSessionModelOptions, type EnabledModelCatalogEntry } from "./sessionModelScope.js";
import { deferToolResultImages, findToolResultImage } from "./toolResultImages.js";
import { boundToolResultText } from "./toolResultBounds.js";
import { correlateQueuedPromptIds } from "./queuedPromptIdentity.js";
import { SessionNotFoundError } from "./sessionErrors.js";

interface ActiveSession<TRuntime> {
  runtime: TRuntime;
  unsubscribe: () => void;
}

/**
 * Minimal structured-logging seam, shaped like Fastify's logger so sessiond can
 * pass `app.log` directly. Defaults to a no-op so the service stays usable
 * without booting a server (e.g. in tests).
 */
export interface PiSessionLogger {
  info(details: Record<string, unknown>, message: string): void;
}

const noopLogger: PiSessionLogger = { info() { /* no-op */ } };
const DEFAULT_UNREAD_PUBLICATION_RETRY_MS = 1_000;
/**
 * How long closing or shutting down waits for a steer batch in flight before taking back what pi
 * holds. A batch settles within milliseconds unless an extension input handler never returns;
 * the bound keeps that from holding a close or a daemon shutdown open.
 */
const TEARDOWN_TAKE_BACK_MS = 5_000;
/**
 * The longest a closing session holds back its reopen. A close normally finishes within its
 * abort; an abort that never returns (a tool ignoring the signal) must not lock the session id
 * - and the daemon's shutdown, which awaits pending opens - forever.
 */
const CLOSE_LOCK_MAX_MS = 10_000;
/**
 * User-facing names for the two phases of session startup PI WEB can prove it
 * is inside: it awaits exactly one call for each, so the phase is a fact rather
 * than a guess. Deliberately free of internal symbol names and file paths.
 */
const STARTUP_PHASE_RUNTIME = "Starting the Pi session";
const STARTUP_PHASE_EXTENSIONS = "Loading session extensions";
/**
 * Appended to whichever phase is running when a background provider catalog
 * refresh happens to be in flight. It is stated as a concurrent fact, never as
 * the cause: PI WEB can verify that a refresh is running, but not that this
 * particular startup is waiting on it.
 */
const STARTUP_CONCURRENT_CATALOG_REFRESH = "provider model lists are refreshing";
const MAX_UNREAD_PUBLICATION_RETRY_MS = 30_000;
const MAX_PENDING_UNREAD_MUTATIONS = SESSION_UNREAD_LIMIT + 1;

function noop(): void {
  // Intentionally empty default unsubscribe callback.
}

function spawnTargetError(decision: Extract<SpawnTargetDecision, { allowed: false }>): Error {
  if (decision.reason === "not-registered") return new Error("Spawning session is not in a registered project");
  return new Error(`cwd must be a workspace of this project. Allowed: ${decision.allowedCwds.join(", ")}`);
}

/**
 * Tracked subsessions are worktree-scoped, so a requested target other than the
 * parent's own cwd fails closed instead of being silently retargeted. The
 * message names the rule and both supported ways to get work done elsewhere.
 */
function subsessionCwdError(spawningCwd: string, requestedCwd: string): Error {
  return new Error(`A tracked subsession runs in this session's working directory (${spawningCwd}); ${requestedCwd} was requested. Instruct the child to work elsewhere from this workspace, or start an independent session in the other workspace.`);
}

function inheritedModelFields(session: PiAgentSession, modelSpec: string | undefined): Pick<SpawnSessionInvocation, "model" | "modelSpec" | "thinkingLevel"> {
  return {
    ...(session.model === undefined ? {} : { model: session.model }),
    ...(modelSpec === undefined ? {} : { modelSpec }),
    thinkingLevel: session.thinkingLevel,
  };
}

function modelSpecOf(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Parse a strict `provider/model-id` spec: split on the first `/` (model ids
 * may themselves contain `/`) and require both parts to be non-empty.
 */
function parseModelSpec(spec: string): { provider: string; modelId: string } | undefined {
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) return undefined;
  return { provider: spec.slice(0, slash), modelId: spec.slice(slash + 1) };
}

/**
 * Error for a spawn-tool model spec that matched nothing. States the facts —
 * the bad spec and the required format — with deliberately no model list
 * (a list would invite guesses). The agent loop turns the throw into an
 * error tool result; how to recover is the agent's call.
 */
function unknownSpawnModelError(modelSpec: string): Error {
  return new Error(`Unknown model "${modelSpec}". Pass an exact "provider/model-id".`);
}

function authLossWarningKey(sessionId: string, provider: string, modelId: string): string {
  return `${sessionId}:${provider}/${modelId}`;
}

function refMatchesActiveSession(ref: PiSessionRef, active: ActiveSession<PiSessionRuntime>): boolean {
  return cwdPathsEqual(active.runtime.cwd, ref.cwd);
}

function refMatchesStartupSession(ref: PiSessionRef, session: PiAgentSession): boolean {
  return cwdPathsEqual(session.sessionManager.getCwd(), ref.cwd);
}


const WAITING_MESSAGES_BLOCK_ARCHIVE = "Messages are waiting for this session. Open it to deliver them before archiving";
const WAITING_MESSAGES_BLOCK_DELETE = "Messages are waiting for this session. Restore and open it to deliver them before deleting";

/** The sender ids pi wrote on user entries of a transcript branch (stamped at `message_start`). */
function committedClientMessageIds(branch: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of branch) {
    const message = getProperty(entry, "message");
    if (getProperty(message, "role") !== "user") continue;
    const id = getProperty(message, "clientMessageId");
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/**
 * Every steer pi holds has a held-steer record, so lane positions correlate one to one; a steer
 * sent without an id gets a local one (`entryKey`). It never leaves the daemon: this drops it.
 */
function publishedId(id: string | undefined): string | undefined {
  return id === undefined || id.startsWith(LOCAL_HOLD_ID_PREFIX) ? undefined : id;
}

interface HeldSteerRecord {
  clientMessageId: string;
  text: string;
  kind?: string;
  entry?: OwnedQueueEntry;
}

/**
 * Where the SDK put a handed prompt, as seen at its preflight: in pi's steer lane, or at the
 * start of a run. The SDK chooses after its own input-handler await, so the daemon's request
 * (steer or direct) is not the answer.
 */
type HandoffLanding = "lane" | "run" | "handled";
type PromptDisposition = Parameters<NonNullable<PromptOptions["preflightResult"]>>[0];

const PREFLIGHT_LANDING: Record<PromptDisposition, HandoffLanding> = { queued: "lane", started: "run", handled: "handled" };

/**
 * How many of pi's shown lane entries, oldest first, its agent loop has already taken.
 *
 * The loop drains agent-core's queue when it polls, but pi removes a message from the lane it
 * shows only at that message's `message_start`, and between the two the loop can spend a whole
 * between-turn compaction. It then commits them even if the run is aborted meanwhile (the loop
 * emits drained messages without checking the signal). So they are read whatever happens, and
 * taking them back would have them read twice. Each lane is counted on its own, against the
 * user messages agent-core still queues in it: custom messages (ask answers, subsession
 * notices) share agent-core's queues but never appear in pi's lanes.
 */
function loopHeldCounts(session: PiAgentSession): Record<QueuedPromptKind, number> {
  return {
    steer: heldBeyondQueue(session.getSteeringMessages().length, Reflect.get(session.agent, "steeringQueue")),
    followUp: heldBeyondQueue(session.getFollowUpMessages().length, Reflect.get(session.agent, "followUpQueue")),
  };
}

/**
 * The queue's own array, not `peek()`: `peek()` is the next drain, which in one-at-a-time mode
 * (agent-core's default, and every lane after a `/reload` until pi-web re-arms it) is the head
 * alone, and would count every other still-queued message as taken.
 */
function heldBeyondQueue(shown: number, queue: unknown): number {
  const pending: unknown = typeof queue === "object" && queue !== null ? Reflect.get(queue, "messages") : undefined;
  if (!Array.isArray(pending)) return 0;
  const queuedUsers = pending.filter((message: unknown) => getProperty(message, "role") === "user").length;
  return Math.max(0, shown - queuedUsers);
}

interface LaneEntry { kind: QueuedPromptKind; text: string; clientMessageId?: string }

/** pi's lanes with identities, split into what the loop already holds and what still waits. */
function partitionLanes(session: PiAgentSession, records: readonly HeldSteerRecord[]): { loopHeld: LaneEntry[]; waiting: LaneEntry[] } {
  const held = loopHeldCounts(session);
  const seen: Record<QueuedPromptKind, number> = { steer: 0, followUp: 0 };
  const loopHeld: LaneEntry[] = [];
  const waiting: LaneEntry[] = [];
  for (const entry of correlateQueuedPromptIds(runtimeLanes(session), records)) {
    const position = seen[entry.kind];
    seen[entry.kind] = position + 1;
    (position < held[entry.kind] ? loopHeld : waiting).push(entry);
  }
  return { loopHeld, waiting };
}

/**
 * Whether a handoff's prompt resolving means the agent has taken the message: a run has, and so
 * has a command or input handler that consumed it. A message in pi's lane has not been read yet.
 */
const READ_WHEN_RESOLVED: Readonly<Record<HandoffLanding, boolean>> = { lane: false, run: true, handled: true };

/** How many messages pi's steering lane holds, per a `queue_update` event. */
function queueUpdateSize(event: unknown): number {
  const steering = getProperty(event, "steering");
  return Array.isArray(steering) ? steering.length : 0;
}

/**
 * Whether the SDK is inside `_emitAgentSettled`, where it defers any `prompt()` into a list it
 * runs later: the prompt returns at once, is invisible and unrecallable, and a refusal of its
 * later run surfaces on another prompt. The field is private SDK state, pinned by a real-SDK
 * test so an upgrade that renames it fails there instead of silently re-opening the window.
 */
function isEmittingAgentSettled(session: PiAgentSession): boolean {
  return Reflect.get(session, "_isEmittingAgentSettled") === true;
}

/** The two callbacks one direct handoff installs, so only its own are cleared. */
interface HandoffWatchers {
  onCommit: () => void;
  markHanded: () => void;
}

interface DeferredSubsessionNotification {
  parentId: string;
  childId: string;
  text: string;
}

interface TreeExclusiveOperationTarget {
  sessionId: string;
  session?: PiAgentSession;
  runtime?: PiSessionRuntime;
}

type PiTreeNavigationOptions =
  | { summarize: false }
  | { summarize: true; customInstructions?: string };

function sessionTreeNavigationOptions(request: ClientSessionTreeNavigateRequest): PiTreeNavigationOptions {
  switch (request.summary.mode) {
    case "none":
      return { summarize: false };
    case "default":
      return { summarize: true };
    case "custom": {
      const customInstructions = request.summary.instructions.trim();
      if (customInstructions === "") throw new Error("Custom branch-summary instructions are required");
      if (customInstructions.length > SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH) {
        throw new Error(`Custom branch-summary instructions must be at most ${String(SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH)} characters`);
      }
      return { summarize: true, customInstructions };
    }
  }
}

function decrementWeakCount<Key extends object>(counts: WeakMap<Key, number>, key: Key): void {
  const remaining = (counts.get(key) ?? 1) - 1;
  if (remaining <= 0) counts.delete(key);
  else counts.set(key, remaining);
}

function decrementMapCount<Key>(counts: Map<Key, number>, key: Key): void {
  const remaining = (counts.get(key) ?? 1) - 1;
  if (remaining <= 0) counts.delete(key);
  else counts.set(key, remaining);
}

interface TrackedSubsessionLink {
  parentSessionId: string;
  childSessionId: string;
  childSessionFile?: string;
  parentSessionFile?: string;
  cwd?: string;
}

interface PersistedParentSubsessionLink {
  spawnedBySessionId: string;
  spawnedSessionId: string;
  spawnedSessionFile?: string;
  cwd?: string;
}

interface PersistedChildSubsessionLink {
  spawnedBySessionId: string;
  spawnedSessionId: string;
}

type SessionCreationProvenance = "tracked-subsession";

interface StartSessionOptions {
  parentSession?: string;
  initialModel?: AgentModel;
  /**
   * Thinking level for the brand new session; omit to resolve from settings
   * and pi defaults. Pi clamps it to the initial model's capabilities.
   */
  initialThinkingLevel?: ClientThinkingLevel;
  /**
   * Opaque label, echoed on this construction's startup progress so a browser
   * row with no session id yet can recognise its own.
   */
  startupToken?: string;
}

interface InternalStartSessionOptions extends StartSessionOptions {
  creationProvenance?: SessionCreationProvenance;
}

function requirePromptText(value: unknown): string {
  if (typeof value !== "string") throw new Error("Prompt text is required");
  return value;
}

function parsePromptStreamingBehavior(value: unknown): QueuedPromptKind | undefined {
  if (value === undefined) return undefined;
  if (value === "steer" || value === "followUp") return value;
  throw new Error('Prompt streamingBehavior must be "steer" or "followUp"');
}

type SessionArchiveRepository = Pick<SessionArchiveStore, "list" | "get" | "archive" | "restore" | "isArchived"> & {
  archiveMany?: (sessions: readonly ArchiveSessionInput[]) => Promise<ArchivedSessionRecord[]>;
  deleteArchived?: (sessionId: string) => Promise<void>;
  deleteArchivedMany?: (sessionIds: readonly string[]) => Promise<string[]>;
};

export type PiSessionRef = SessionRouteRef;

export interface PiSessionListEntry {
  id: string;
  path: string;
  cwd: string;
  created: Date;
  modified: Date;
  /**
   * Number of `message` entries in the transcript. The streaming summary
   * scanner counts message lines by their leading bytes and a trailing `}`
   * without validating the JSON, so a final write read mid-flight can add a
   * transient +1; the count self-heals on the next listing once the line
   * completes.
   */
  messageCount: number;
  firstMessage: string;
  allMessagesText: string;
  name?: string;
  parentSessionPath?: string;
  /** The stored working directory is gone: the session cannot open, only be
   * read about (cleanup, archive). Stamped at listing time so the row can
   * refuse the click instead of navigating into a red banner. */
  cwdMissing?: boolean;
}

/** A session file located by id without parsing its transcript. */
export interface ResolvedSessionFile {
  id: string;
  cwd: string;
  path: string;
}

interface WorkspaceArchiveCandidate extends SessionArchiveTreeCandidate {
  cwd: string;
  listEntry?: PiSessionListEntry;
  activeSession?: PiAgentSession;
}

interface BulkSessionRefContext {
  sessionsByCwd: Map<string, PiSessionListEntry[]>;
}

interface BulkArchivePlanItem {
  input: ArchiveSessionInput;
}

interface BulkDeletePlanItem {
  record: ArchivedSessionRecord;
}

type AgentModel = NonNullable<SpawnSessionInvocation["model"]>;

export interface PiSessionManager {
  getCwd(): string;
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getBranch(): unknown[];
  getEntries?(): readonly unknown[];
  getTree?(): readonly ProjectableSessionTreeNode[];
  getLeafId(): string | null;
  getHeader?(): { parentSession?: string } | null | undefined;
  appendCustomEntry?(customType: string, data?: unknown): string;
}

export interface PiSessionManagerGateway {
  list(cwd: string): Promise<PiSessionListEntry[]>;
  /**
   * Locate a session file by id, with an exact header id taking priority over
   * a prefix, without parsing message bodies or building a full workspace
   * transcript listing.
   */
  resolveSessionFile(cwd: string, sessionId: string): Promise<ResolvedSessionFile | undefined>;
  /**
   * Drop any cached listing summary for a session file that was rewritten in
   * place (detach clears the header while keeping the inode): file identity
   * and size checks cannot detect such rewrites, so the scanner memo must be
   * told explicitly.
   */
  invalidateSessionFile(sessionFile: string): void;
  create(cwd: string, options?: { parentSession?: string }): PiSessionManager;
  /**
   * Cross-project listing of Pi's session stores (the default store plus any
   * env-configured session dir). Session cleanup scans every project at once;
   * cwd-scoped UI listings use `list`, while direct named lookups use
   * `resolveSessionFile`.
   */
  listAll(): Promise<PiSessionListEntry[]>;
  /**
   * One session by its whole id, wherever this machine keeps it: the asking
   * workspace's own session directory, the env-configured one, then every
   * directory of the default store. Undefined when none holds it.
   */
  findSession(cwd: string, sessionId: string): Promise<PiSessionListEntry | undefined>;
  open(path: string): PiSessionManager;
}

interface PiExtensionError {
  extensionPath: string;
  event: string;
  error: string;
  stack?: string;
}

interface PiExtensionBindings {
  uiContext?: ExtensionUIContext;
  mode?: "rpc";
  onError?: (error: PiExtensionError) => void;
}

export interface PiAgentSession {
  modelRuntime: ModelRuntime;
  /**
   * Narrow read/write of the SDK `SettingsManager`, exposing the warning
   * suppression flags consumed here (e.g. `anthropicExtraUsage`) and pi's
   * `enabledModels` model-scope setting. The warnings gate the Anthropic
   * subscription-auth billing warning the same way the TUI does; the enabled
   * models let the model picker read and edit pi's model scope (shared with
   * the pi TUI) the way `showModelsSelector` does.
   */
  settingsManager: {
    getWarnings(): { anthropicExtraUsage?: boolean };
    setWarnings(warnings: { anthropicExtraUsage?: boolean }): void;
    getEnabledModels(): string[] | undefined;
    setEnabledModels(patterns: string[] | undefined): void;
  };
  sessionManager: PiSessionManager;
  scopedModels: readonly { model: AgentModel; thinkingLevel?: ClientThinkingLevel }[];
  /** Update the session's cycling scope, mirroring pi's `AgentSession.setScopedModels`. */
  setScopedModels(models: { model: AgentModel; thinkingLevel?: ClientThinkingLevel }[]): void;
  sessionId: string;
  sessionFile: string | undefined;
  sessionName: string | undefined;
  messages: readonly unknown[];
  /**
   * Narrow read of the SDK `AgentState`. Only the in-flight partial is consumed
   * here: `state.streamingMessage` is the current streamed assistant message
   * (an `AssistantMessage`) while a turn is mid-stream, and `undefined`
   * otherwise (idle, or during post-message tool execution). Used by
   * {@link PiSessionService.streamSnapshot} to seed a joining client.
   */
  readonly state: { readonly streamingMessage?: unknown };
  model: AgentModel | undefined;
  thinkingLevel: ClientThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  isBashRunning: boolean;
  pendingMessageCount: number;
  extensionRunner: {
    getRegisteredCommands(): readonly { invocationName: string; description?: string }[];
    getUIContext(): ExtensionUIContext;
    setUIContext(uiContext?: ExtensionUIContext, mode?: "rpc"): void;
  };
  promptTemplates: readonly { name: string; description?: string }[];
  resourceLoader: {
    getSkills(): { skills: readonly { name: string; description?: string }[] };
    /**
     * The loaded extensions and the ones that failed. This is what lets a
     * plugin-backed surface tell absent from installed-but-empty instead of
     * inferring it from whatever data the plugin happens to have written.
     */
    getExtensions?(): { extensions: readonly { path: string; tools?: ReadonlyMap<string, unknown> }[]; errors: readonly { path: string; error: string }[] };
  };
  subscribe(listener: (event: unknown) => void): () => void;
  bindExtensions(bindings: PiExtensionBindings): Promise<void>;
  compact(instructions?: string): Promise<{ summary: string; tokensBefore: number }>;
  getUserMessagesForForking(): readonly { entryId: string; text: string }[];
  getSessionStats(): { sessionId: string; totalMessages: number; userMessages: number; assistantMessages: number; toolCalls: number; tokens: ClientSessionStatus["tokens"]; cost: number };
  reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void>;
  /**
   * The registered tools and the mutable definitions behind them.
   *
   * `getAllTools` hands back fresh wrappers, so a schema rewritten on one of
   * those is lost; the definition returned by `getToolDefinition` is the object
   * the runtime re-reads when it rebuilds the tool list. Used to make tool
   * schemas safe for the provider boundary.
   */
  getAllTools(): readonly { name: string; parameters?: unknown }[];
  getToolDefinition(name: string): { parameters: unknown } | undefined;
  getContextUsage(): ClientSessionStatus["contextUsage"] | undefined;
  prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp"; images?: ImageContent[]; preflightResult?: (disposition: PromptDisposition) => void }): Promise<void>;
  /** Queue a message in pi's steering lane whatever the run state; input handlers and expansion run first. Refuses an extension command. */
  steer(text: string, images?: ImageContent[]): Promise<unknown>;
  sendCustomMessage(message: { customType: string; content: string; display: boolean; details?: unknown }, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): Promise<void>;
  executeBash(command: string, onChunk?: (chunk: string) => void, options?: { excludeFromContext?: boolean }): Promise<{ output: string; exitCode: number | undefined; cancelled: boolean; truncated: boolean; fullOutputPath?: string }>;
  navigateTree?(targetId: string, options?: { summarize?: boolean; customInstructions?: string }): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: unknown }>;
  abortBranchSummary?(): void;
  abort(): Promise<void>;
  clearQueue(): { steering: string[]; followUp: string[] };
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  setModel(model: AgentModel): Promise<void>;
  cycleModel(direction?: "forward" | "backward"): Promise<{ model: AgentModel } | undefined>;
  getAvailableThinkingLevels(): ClientThinkingLevel[];
  setThinkingLevel(level: ClientThinkingLevel): void;
  cycleThinkingLevel(): ClientThinkingLevel | undefined;
  setSessionName(name: string): void;
  /**
   * Narrow re-expression of `AgentSession.agent` (an `@earendil-works/pi-agent-core`
   * `Agent`), exposing only `streamFunction` — the resolved-auth/headers/retry "call
   * this model" function pi's own compaction/branch-summarization code uses
   * internally. Lets callers (e.g. session title generation) issue one-off model
   * calls without depending on pi-ai's deprecated `/compat` provider registry or
   * leaking the full `Agent`/`AgentSession` surface.
   */
  agent: { streamFunction: StreamFn; steeringMode?: "all" | "one-at-a-time"; readonly state?: { readonly isStreaming: boolean } };
  /**
   * Debug-only capture of the exact model surface this session was constructed
   * with — the system prompt and the configured tools (name + description).
   * Backs the match-tui-prompt 4.1 capture leg behind an env-gated debug
   * route; present only on SDK-backed sessions, absent on lightweight test
   * fakes, so callers must treat missing capture as "unavailable", not empty.
   */
  captureModelSurface?(): { systemPrompt: string; tools: readonly { name: string; description: string }[] };
}

export interface PiSessionRuntime {
  readonly cwd: string;
  readonly session: PiAgentSession;
  /**
   * Live, runtime-scoped diagnostics/services used to compute session warnings.
   *
   * These mirror the SDK runtime and are recomputed whenever the runtime is
   * (re)built. `undefined` on lightweight/test runtimes that do not carry SDK
   * services; callers must treat missing sources as "no warnings".
   */
  readonly diagnostics?: readonly AgentSessionRuntimeDiagnostic[];
  readonly services?: AgentSessionServices;
  setRebindSession(rebindSession?: (session: PiAgentSession) => Promise<void>): void;
  fork(entryId: string, options?: { position?: "before" | "at" }): Promise<{ cancelled: boolean; selectedText?: string }>;
  dispose(): Promise<void>;
}

interface PendingSessionOpen {
  sessionId: string;
  promise: Promise<ActiveSession<PiSessionRuntime>>;
}

interface CreateSessionRuntimeOptions extends Pick<InternalStartSessionOptions, "initialModel" | "initialThinkingLevel" | "creationProvenance" | "startupToken"> {
  notificationGeneration?: SessionNotificationGeneration;
  notifications?: "enabled" | "disabled";
  /**
   * What the user asked for, so startup progress can say "Creating" instead of
   * "Opening". Only `startSession()` creates a brand new session; every other
   * caller opens an existing one, so "open" is the default.
   */
  startupIntent?: "create" | "open";
}

/**
 * Read-only view of the background catalog refresher, so session startup can
 * state what it is concurrent with without being able to influence it.
 */
export interface CatalogRefreshStatus {
  isRefreshInFlight(): boolean;
}

/**
 * Publishes what a session startup is waiting on while it waits. Every call is
 * synchronous and event-only, so reporting never adds an await to session
 * creation and leaves no per-session state to unwind if creation fails.
 */
interface SessionStartupProgressReporter {
  report(phase: string): void;
  end(): void;
}

type NotificationClosePolicy =
  | { kind: "clear"; reason: SessionNotificationClearReason }
  | { kind: "defer" };

const CLEAR_RUNTIME_NOTIFICATIONS: NotificationClosePolicy = { kind: "clear", reason: "runtime-close" };
const DEFER_RUNTIME_NOTIFICATIONS: NotificationClosePolicy = { kind: "defer" };

function resourceDiagnosticToWarning(diagnostic: ResourceDiagnostic, source: string): SessionWarning {
  return {
    severity: diagnostic.type === "error" ? "error" : "warning",
    message: diagnostic.message,
    source,
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
  };
}

function runtimeDiagnosticToWarning(diagnostic: AgentSessionRuntimeDiagnostic): SessionWarning {
  return { severity: diagnostic.type, message: diagnostic.message, source: "runtime" };
}

/**
 * Minimal structural view of a runtime's warning sources: the runtime setup
 * diagnostics plus the resource loader's per-collection diagnostics and
 * extension load errors. Narrowed to just what {@link collectRuntimeWarnings}
 * reads so the real SDK runtime and lightweight test doubles both satisfy it.
 */
export interface RuntimeWarningSources {
  readonly diagnostics?: readonly AgentSessionRuntimeDiagnostic[];
  readonly services?: {
    resourceLoader: {
      getSkills(): { diagnostics: readonly ResourceDiagnostic[] };
      getPrompts(): { diagnostics: readonly ResourceDiagnostic[] };
      getThemes(): { diagnostics: readonly ResourceDiagnostic[] };
      getExtensions(): { errors: readonly { path: string; error: string }[] };
    };
  };
}

/**
 * Compute the live warnings for a runtime by re-reading its current resource
 * loader diagnostics, extension load errors, and runtime setup diagnostics.
 *
 * This mimics the TUI recomputing warnings on every (re)bind: it reads the
 * runtime's current state rather than a cached snapshot, so a rebuilt runtime
 * yields fresh warnings. Runtimes without SDK services (e.g. test fakes)
 * contribute no warnings.
 */
export function collectRuntimeWarnings(runtime: RuntimeWarningSources): SessionWarning[] {
  const warnings: SessionWarning[] = [];
  for (const diagnostic of runtime.diagnostics ?? []) warnings.push(runtimeDiagnosticToWarning(diagnostic));
  const resourceLoader = runtime.services?.resourceLoader;
  if (resourceLoader !== undefined) {
    for (const diagnostic of resourceLoader.getSkills().diagnostics) warnings.push(resourceDiagnosticToWarning(diagnostic, "skill"));
    for (const diagnostic of resourceLoader.getPrompts().diagnostics) warnings.push(resourceDiagnosticToWarning(diagnostic, "prompt"));
    for (const diagnostic of resourceLoader.getThemes().diagnostics) warnings.push(resourceDiagnosticToWarning(diagnostic, "theme"));
    for (const error of resourceLoader.getExtensions().errors) {
      warnings.push({ severity: "error", message: `${error.path}: ${error.error}`, source: "extension", path: error.path });
    }
  }
  return warnings;
}

/**
 * Verbatim TUI wording for the Anthropic subscription-auth billing notice. Kept
 * character-for-character in sync with `ANTHROPIC_SUBSCRIPTION_AUTH_WARNING` in
 * the SDK's interactive mode so the browser shows the same message the TUI does.
 */
const ANTHROPIC_SUBSCRIPTION_AUTH_WARNING =
  "Anthropic subscription auth is active. Third-party harness usage draws from extra usage and is billed per token, not your Claude plan limits. Manage extra usage at https://claude.ai/settings/usage.";

/** Mirror of the SDK TUI `isAnthropicSubscriptionAuthKey` (subscription API keys start with `sk-ant-oat`). */
function isAnthropicSubscriptionAuthKey(apiKey: string | undefined): boolean {
  return typeof apiKey === "string" && apiKey.startsWith("sk-ant-oat");
}

/**
 * Dismiss id for the Anthropic subscription-auth billing notice. This is `pi`'s
 * own `WarningSettings` key verbatim (`anthropicExtraUsage`): we carry the
 * coupling `pi` already defines rather than inventing a parallel vocabulary, and
 * {@link dismissSessionWarning} maps it back to `setWarnings`.
 */
const ANTHROPIC_EXTRA_USAGE_DISMISS_ID = "anthropicExtraUsage";

/**
 * Port of the TUI `maybeWarnAboutAnthropicSubscriptionAuth` gate/trigger, computed
 * live from the session's current model, stored Anthropic credential, and warning
 * settings. Returns the billing warning when the active provider is `anthropic`
 * and auth is a subscription credential (stored `oauth`, or an `sk-ant-oat` API
 * key), unless suppressed via `getWarnings().anthropicExtraUsage === false`.
 *
 * The stored credential is read synchronously (matching the TUI's `oauth` branch
 * and the documented `sk-ant-oat` key trigger) so warnings stay part of the
 * synchronous live status computation.
 */
/**
 * The provider a per-account alias stands for.
 *
 * The multi-account extension registers `anthropic-<account>` as real
 * providers, and this service deliberately keeps the alias as the session's
 * provider so the session stays pinned to that account (see setModel). That
 * makes every `provider === "anthropic"` test silently false for anyone using
 * an account, which is not a display detail: the subscription billing warning
 * below simply stopped appearing for exactly the sessions that are billed
 * against a subscription.
 *
 * Prefix-based because that is the alias shape the extension documents
 * (ALIAS_PREFIX = "anthropic-"), and a provider genuinely named
 * `anthropic-something-else` would still be an Anthropic provider.
 */
export function canonicalProviderId(provider: string | undefined): string | undefined {
  if (provider === undefined) return undefined;
  return provider.startsWith("anthropic-") ? "anthropic" : provider;
}

export function anthropicSubscriptionWarning(
  session: Pick<PiAgentSession, "model" | "settingsManager">,
  authPath?: string,
): SessionWarning | undefined {
  if (session.settingsManager.getWarnings().anthropicExtraUsage === false) return undefined;
  if (canonicalProviderId(session.model?.provider) !== "anthropic") return undefined;
  const credential = readStoredCredential("anthropic", authPath);
  if (credential === undefined) return undefined;
  const isSubscriptionAuth = credential.type === "oauth"
    ? true
    : isAnthropicSubscriptionAuthKey(credential.key);
  if (!isSubscriptionAuth) return undefined;
  return {
    severity: "warning",
    message: ANTHROPIC_SUBSCRIPTION_AUTH_WARNING,
    source: "anthropic",
    dismiss: { id: ANTHROPIC_EXTRA_USAGE_DISMISS_ID },
  };
}

/**
 * Durably suppress a dismissable session warning by mapping its opaque dismiss
 * id back to the concrete `pi` suppression it represents. Only known ids are
 * honored; unknown ids throw so a stale/forged client cannot silently no-op.
 *
 * This is the single place provider-specific suppression lives: the wire type,
 * parser, and UI stay agnostic. Adding a future dismissable warning is a
 * server-only change here plus a `dismiss` id on its producer.
 */
export function dismissSessionWarning(
  session: Pick<PiAgentSession, "settingsManager">,
  dismissId: string,
): void {
  if (dismissId !== ANTHROPIC_EXTRA_USAGE_DISMISS_ID) {
    throw new Error(`Unknown session warning dismiss id: ${dismissId}`);
  }
  session.settingsManager.setWarnings({ ...session.settingsManager.getWarnings(), anthropicExtraUsage: false });
}

interface CreateAgentRuntimeOptions {
  cwd: string;
  agentDir: string;
  sessionManager: PiSessionManager;
  initialModel?: AgentModel;
  initialThinkingLevel?: ClientThinkingLevel;
}

type PiWebRuntimeFactoryOptions = Parameters<CreateAgentSessionRuntimeFactory>[0] & {
  initialModel?: AgentModel;
  initialThinkingLevel?: ClientThinkingLevel;
};

type PiWebCreateAgentSessionRuntimeFactory = (
  options: PiWebRuntimeFactoryOptions
) => ReturnType<CreateAgentSessionRuntimeFactory>;

type CreateAgentRuntime = (createRuntime: PiWebCreateAgentSessionRuntimeFactory, options: CreateAgentRuntimeOptions) => Promise<PiSessionRuntime>;

function defaultCreateAgentRuntime(createRuntime: PiWebCreateAgentSessionRuntimeFactory, options: CreateAgentRuntimeOptions): Promise<PiSessionRuntime> {
  if (!(options.sessionManager instanceof SessionManager)) throw new Error("Default runtime creation requires an SDK SessionManager");
  const runtimeFactory = createRuntimeWithOneShotSessionOptions(createRuntime, options.initialModel, options.initialThinkingLevel);
  return createAgentSessionRuntime(runtimeFactory, {
    cwd: options.cwd,
    agentDir: options.agentDir,
    sessionManager: options.sessionManager,
  });
}

function createRuntimeWithOneShotSessionOptions(
  createRuntime: PiWebCreateAgentSessionRuntimeFactory,
  initialModel: AgentModel | undefined,
  initialThinkingLevel: ClientThinkingLevel | undefined,
): CreateAgentSessionRuntimeFactory {
  // These inputs belong only to the session being opened. A later runtime
  // replacement resolves its own model, and restores the thinking level from
  // the existing session file.
  let pendingInitialModel = initialModel;
  let pendingInitialThinkingLevel = initialThinkingLevel;
  return async (options) => {
    const model = pendingInitialModel;
    const thinkingLevel = pendingInitialThinkingLevel;
    pendingInitialModel = undefined;
    pendingInitialThinkingLevel = undefined;
    return createRuntime({
      ...options,
      ...(model === undefined ? {} : { initialModel: model }),
      ...(thinkingLevel === undefined ? {} : { initialThinkingLevel: thinkingLevel }),
    });
  };
}

/**
 * The tools PI WEB puts on a session: pi's own `edit`, wrapped to compute a diff
 * preview, and nothing it adds. Owner, 2026-09-30: "pi web should not give the AI any
 * extra tools; those should all be defined by the user's own plugins" - delegation is a session route (docs/design/no-builtin-agent-tools.md).
 */
export function createPiWebCustomToolDefinitions(cwd: string, askUser?: AskUserToolDeps) {
  return [
    createPiWebEditToolDefinition(cwd),
    ...(askUser === undefined ? [] : [createAskUserToolDefinition(askUser)]),
  ];
}

/**
 * Error collected from a `project_trust` handler, mirroring the per-extension
 * errors the SDK's `emitProjectTrustEvent` returns (its `extensionPath` and
 * `error` fields are what the reported message needs).
 */
export interface WebProjectTrustExtensionError {
  extensionPath: string;
  error: string;
}

/**
 * The slice of the SDK's `LoadExtensionsResult` the trust event emitter reads:
 * each pre-trust extension's path and its registered `project_trust` handlers.
 * Narrowing keeps this module free of the SDK's full `Extension` internals; a
 * real `LoadExtensionsResult` (as handed to the resource loader's
 * `resolveProjectTrust` callback) is structurally assignable to it.
 */
export interface WebProjectTrustExtensionSet {
  extensions: {
    path: string;
    handlers: Map<string, readonly ((event: ProjectTrustEvent, ctx: ProjectTrustContext) => unknown)[]>;
  }[];
}

/**
 * Inputs for {@link resolveWebProjectTrusted} — the web mirror of the inputs
 * the SDK's `resolveProjectTrusted` takes.
 */
export interface WebProjectTrustResolution {
  cwd: string;
  /**
   * The pre-trust extension set the SDK loaded for this resolution (user/global
   * extensions; project-local ones are not loaded yet because trust is still
   * unresolved). When present, those extensions may decide trust via the
   * `project_trust` event.
   */
  extensionsResult?: WebProjectTrustExtensionSet;
  /** The agent dir's trust store; `remember`-ed decisions are written here. */
  trustStore: ProjectTrustStore;
  /** Settings manager whose `defaultProjectTrust` applies when nothing decided. */
  settingsManager: SettingsManager;
  /**
   * Reports a `project_trust` handler error, mirroring the SDK's
   * `onExtensionError`.
   */
  onExtensionError?: (message: string) => void;
}

/**
 * Run the `project_trust` event over a pre-trust extension set, mirroring
 * `emitProjectTrustEvent` in the SDK's `dist/core/extensions/runner.js`. That
 * helper is not part of the package's public exports (the main index exports
 * only the `ProjectTrust*` types and `ProjectTrustStore`, and the package's
 * `exports` map blocks subpath imports, so `resolveProjectTrusted`/
 * `emitProjectTrustEvent` are not callable from here), so PI WEB reimplements
 * its documented decision loop over the SDK-provided extension objects: per
 * extension, the registered `project_trust` handlers run in order; the first
 * handler returning `yes`/`no` decides and `undecided` falls through to the
 * next handler/extension; a throwing handler is collected as an error and
 * later handlers still get their chance.
 */
export async function emitWebProjectTrustEvent(
  extensionsResult: WebProjectTrustExtensionSet,
  event: ProjectTrustEvent,
  ctx: ProjectTrustContext,
): Promise<{ result?: ProjectTrustEventResult; errors: WebProjectTrustExtensionError[] }> {
  const errors: WebProjectTrustExtensionError[] = [];
  for (const extension of extensionsResult.extensions) {
    // A single extension may register multiple handlers for the same event.
    // The handlers map is keyed exactly as the extension registered it, so a
    // `project_trust` key guarantees `ProjectTrustHandler` entries — the same
    // assumption the SDK's emitProjectTrustEvent makes.
    const handlers = extension.handlers.get("project_trust");
    if (handlers === undefined || handlers.length === 0) continue;
    for (const handler of handlers) {
      try {
        const handlerResult: unknown = await handler(event, ctx);
        // The SDK reads `trusted` straight off the handler result, so a
        // non-object would throw there; PI WEB reports it as a handler error
        // and lets the next handler/extension try.
        if (typeof handlerResult !== "object" || handlerResult === null) {
          errors.push({ extensionPath: extension.path, error: "project_trust handler returned a non-object result" });
          continue;
        }
        const trusted = "trusted" in handlerResult ? handlerResult.trusted : undefined;
        if (trusted === "undecided") {
          continue;
        }
        // Rebuild the decision so only the documented `trusted`/`remember`
        // fields carry over — the SDK's resolver reads exactly those two.
        const remember = "remember" in handlerResult ? handlerResult.remember : undefined;
        return {
          result: {
            trusted: trusted === "yes" ? "yes" : "no",
            ...(remember === true ? { remember: true } : {}),
          },
          errors,
        };
      } catch (error) {
        errors.push({
          extensionPath: extension.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { errors };
}

/**
 * PI WEB's headless project-trust context. `hasUI` is false because there is
 * no browser trust prompt (chartered behavior: `ask` never loads untrusted
 * resources), so the UI methods are inert — the same no-UI shape the SDK
 * passes when pi runs without a trust UI. The host mode is `rpc`, mirroring
 * how PI WEB binds its session extension contexts.
 */
function webProjectTrustContext(cwd: string): ProjectTrustContext {
  return {
    cwd,
    mode: "rpc",
    hasUI: false,
    ui: {
      select: () => Promise.resolve(undefined),
      confirm: () => Promise.resolve(false),
      input: () => Promise.resolve(undefined),
      notify: () => undefined,
    },
  };
}

/**
 * Resolve whether a workspace's project-local `.pi/` resources may load, the
 * way `pi` resolves it — a faithful mirror of the SDK's `resolveProjectTrusted`
 * (`dist/core/project-trust.js`, also not a public export). PI WEB has no
 * browser trust prompt, so the precedence is, in order:
 *
 * 1. Nothing trust-requiring under `cwd` → trusted.
 * 2. Pre-trust extensions (user/global — project-local ones are not loaded
 *    yet) may decide via the `project_trust` event; `remember: true` persists
 *    the decision to the agent dir's `trust.json`. Handler errors are reported
 *    through {@link WebProjectTrustResolution.onExtensionError} and never
 *    abort resolution.
 * 3. Otherwise the saved `trust.json` decision wins.
 * 4. Otherwise `defaultProjectTrust` decides (`always` trusts; `never`/`ask`
 *    do not — `ask` cannot prompt in the browser, matching `pi` run without a
 *    trust UI).
 */
export async function resolveWebProjectTrusted(resolution: WebProjectTrustResolution): Promise<boolean> {
  const { cwd, trustStore, settingsManager } = resolution;
  if (!hasTrustRequiringProjectResources(cwd)) return true;
  if (resolution.extensionsResult) {
    const { result, errors } = await emitWebProjectTrustEvent(
      resolution.extensionsResult,
      { type: "project_trust", cwd },
      webProjectTrustContext(cwd),
    );
    for (const error of errors) {
      resolution.onExtensionError?.(`Extension "${error.extensionPath}" project_trust error: ${error.error}`);
    }
    if (result) {
      const trusted = result.trusted === "yes";
      if (result.remember === true) {
        trustStore.set(cwd, trusted);
      }
      return trusted;
    }
  }
  const saved = trustStore.get(cwd);
  if (saved !== null) return saved;
  return settingsManager.getDefaultProjectTrust() === "always";
}

/**
 * Resource-loader options that append PI WEB's own system-prompt sections.
 *
 * `appendSystemPromptOverride` composes with what the loader already resolved,
 * so the operator's `SYSTEM.md` / `APPEND_SYSTEM.md` files keep their content
 * and PI WEB's sections land after them. Returns `undefined` when there is
 * nothing to add, leaving the loader exactly as pi configures it.
 */
export function piWebResourceLoaderOptions(
  appendSystemPromptSections: readonly string[],
): CreateAgentSessionServicesOptions["resourceLoaderOptions"] | undefined {
  if (appendSystemPromptSections.length === 0) return undefined;
  return { appendSystemPromptOverride: (base) => [...base, ...appendSystemPromptSections] };
}

function createDefaultRuntimeFactory(
  modelRuntime: ModelRuntime,
  askUser?: AskUserToolDeps,
  appendSystemPromptSections: readonly string[] = [],
): PiWebCreateAgentSessionRuntimeFactory {
  const resourceLoaderOptions = piWebResourceLoaderOptions(appendSystemPromptSections);
  return async ({ cwd, agentDir, sessionManager, sessionStartEvent, initialModel, initialThinkingLevel }) => {
    // PI WEB always honors pi's project-trust model. When the workspace ships
    // trust-requiring resources, trust is resolved exactly once, mirroring the
    // SDK's flow: the resource loader first loads the pre-trust extension set
    // (user/global; project-local ones stay out) and calls back with it, so
    // those extensions may decide via the `project_trust` event; the resolved
    // value then lands in the SettingsManager before any project-local
    // resource (extensions, packages, settings, prompts) loads. With no
    // browser trust prompt, an untrusted project's resources are skipped
    // (matching `pi` run without a UI). Projects without trust-requiring
    // resources skip resolution entirely and are trusted, as before.
    const projectTrustRequiring = hasTrustRequiringProjectResources(cwd);
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: !projectTrustRequiring });
    // Pre-session-creation trust failures (`project_trust` handler errors)
    // land in the runtime diagnostics next to the services diagnostics,
    // exactly as the CLI appends its project-trust diagnostics.
    const projectTrustDiagnostics: AgentSessionRuntimeDiagnostic[] = [];
    const services: AgentSessionServices = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      settingsManager,
      ...(resourceLoaderOptions === undefined ? {} : { resourceLoaderOptions }),
      ...(projectTrustRequiring
        ? {
            resourceLoaderReloadOptions: {
              resolveProjectTrust: async ({ extensionsResult }) =>
                resolveWebProjectTrusted({
                  cwd,
                  trustStore: new ProjectTrustStore(agentDir),
                  settingsManager,
                  extensionsResult,
                  onExtensionError: (message) => projectTrustDiagnostics.push({ type: "warning", message }),
                }),
            },
          }
        : {}),
    });
    const modelOptions = await resolveSessionModelOptions({
      services,
      hasExistingSession: sessionManager.buildSessionContext().messages.length > 0,
      ...(initialModel === undefined ? {} : { initialModel }),
      ...(initialThinkingLevel === undefined ? {} : { initialThinkingLevel }),
    });
    services.diagnostics.push(...modelOptions.diagnostics);
    const customTools = createPiWebCustomToolDefinitions(cwd, askUser);
    const result = await createAgentSessionFromServices({
      services,
      sessionManager,
      customTools,
      ...(sessionStartEvent === undefined ? {} : { sessionStartEvent }),
      ...(modelOptions.model === undefined ? {} : { model: modelOptions.model }),
      ...(modelOptions.thinkingLevel === undefined ? {} : { thinkingLevel: modelOptions.thinkingLevel }),
      ...(modelOptions.scopedModels.length === 0 ? {} : { scopedModels: modelOptions.scopedModels }),
    });
    // Attach the debug-only model-surface capture to the SDK session itself:
    // the narrow PiAgentSession interface declares it optional, real sessions
    // carry it, test fakes legitimately do not.
    const sdkSession = result.session;
    if (process.env["PI_WEB_RAW_TOOL_SCHEMAS"] !== "1") applyProviderSafeToolSchemas(sdkSession);
    const sessionWithCapture: typeof sdkSession & Pick<PiAgentSession, "captureModelSurface"> = Object.assign(sdkSession, {
      captureModelSurface: (): { systemPrompt: string; tools: readonly { name: string; description: string }[] } => ({
        systemPrompt: sdkSession.systemPrompt,
        tools: sdkSession.getAllTools().map((tool) => ({ name: tool.name, description: tool.description })),
      }),
    });
    return { ...result, session: sessionWithCapture, services, diagnostics: [...projectTrustDiagnostics, ...services.diagnostics] };
  };
}

type PiWebEditToolDetails = EditToolDetails | { preview: EditPreviewResult } | undefined;

function createPiWebEditToolDefinition(cwd: string) {
  const editTool = createEditToolDefinition(cwd);
  return defineTool<typeof editTool.parameters, PiWebEditToolDetails>({
    name: editTool.name,
    label: editTool.label,
    description: editTool.description,
    ...(editTool.promptSnippet === undefined ? {} : { promptSnippet: editTool.promptSnippet }),
    ...(editTool.promptGuidelines === undefined ? {} : { promptGuidelines: editTool.promptGuidelines }),
    parameters: editTool.parameters,
    ...(editTool.renderShell === undefined ? {} : { renderShell: editTool.renderShell }),
    ...(editTool.prepareArguments === undefined ? {} : { prepareArguments: editTool.prepareArguments }),
    ...(editTool.executionMode === undefined ? {} : { executionMode: editTool.executionMode }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const preview = await computeEditPreview(params.path, params.edits, cwd);
      if (signal?.aborted !== true) {
        onUpdate?.({ content: [{ type: "text", text: "Edit preview computed." }], details: { preview } });
      }
      return editTool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}

export interface PiSessionServiceDependencies {
  agentDir: string;
  /** Where operation rows are kept, so a restart can answer a retry. */
  operationLedgerDir?: string;
  sessionManager: PiSessionManagerGateway;
  archiveStore?: SessionArchiveRepository;
  createRuntime?: PiWebCreateAgentSessionRuntimeFactory;
  createAgentRuntime?: CreateAgentRuntime;
  modelRuntime: ModelRuntime;
  heartbeatIntervalMs?: number;
  workspaceActivity?: Pick<WorkspaceActivityService, "applySessionStatus" | "applySessionActivity" | "removeSession" | "reconcileSessionActivity">;
  /**
   * Project-scope resolver behind the spawn and subsession routes. Omitted, every
   * spawn is refused.
   */
  spawnTargets?: SpawnTargetResolver;
  /**
   * When true, `ask_user` is available to every session, so an agent can post a
   * question set to the browser. Independent of the delegation capabilities: the
   * questions reach the user of the asking session, not another session.
   */
  askUserEnabled?: boolean;
  /**
   * Everything the host adds to what sessions receive - prompt sections and
   * unsupported-surface handling - as data. THE seam: a contribution added
   * anywhere else cannot reach the model, and the deviation list is derived
   * from this. Empty in ordinary installs.
   */
  hostContributions?: HostContributions;
  /** Daemon-lifetime open-ask state; defaults to an in-memory store in tests. */
  pendingAskStore?: PendingAskStore;
  /** Daemon-lifetime open-dialog state; defaults to an in-memory store in tests. */
  pendingExtensionDialogStore?: PendingExtensionDialogStore;
  /**
   * How long an extension dialog with no extension-set `timeout` waits for an
   * answer before the daemon auto-cancels it; `0` waits forever. A tuning
   * knob, not a gate: extension dialogs are always on.
   */
  extensionDialogsTimeoutMs?: number;
  /** Structured logger for notable runtime events (e.g. spawns). */
  logger?: PiSessionLogger;
  /** Clock seam for cleanup planning tests. */
  now?: () => Date;
  /** Daemon-lifetime notification state, injected by sessiond in production. */
  notificationStore?: SessionNotificationStore;
  /** Durable daemon-owned unread state; defaults to an in-memory store in tests. */
  unreadStore?: SessionUnreadStore;
  /** Initial retry delay for durable unread publication failures. */
  unreadPublicationRetryDelayMs?: number;
  /**
   * Called when unread state changed, so the machine status projection can
   * recompute. The unread catalog itself stays the authority for unread detail.
   */
  onUnreadChanged?: () => void;
  /**
   * Lets session startup report that provider model lists are refreshing while
   * a session is being constructed. Omit to report the startup phase alone.
   */
  catalogRefreshStatus?: CatalogRefreshStatus;
}

/** The extension's own options, read defensively: it may pass nothing or junk. */
function customScreenOptions(opts: unknown): {
  signal?: AbortSignal | undefined;
  timeout?: number | undefined;
  screen?: ExtensionDialogScreen | undefined;
} {
  if (opts === null || typeof opts !== "object") return {};
  const signal: unknown = Reflect.get(opts, "signal");
  const timeout: unknown = Reflect.get(opts, "timeout");
  const web: unknown = Reflect.get(opts, "web");
  const screen = declaredScreen(web);
  if (web !== undefined && screen === undefined) console.error("[extension-screen] declaration refused, drawing the terminal frame:", refusedDeclarationSummary(web));
  return {
    ...(signal instanceof AbortSignal ? { signal } : {}),
    ...(typeof timeout === "number" ? { timeout } : {}),
    ...(screen === undefined ? {} : { screen }),
  };
}

/** Run the extension's factory, which arrives as `unknown` like everything else from it. */
function applyFactory(factory: unknown, args: unknown[]): unknown {
  if (typeof factory !== "function") return undefined;
  return Reflect.apply(factory, undefined, args);
}

const CUSTOM_SCREEN_HINT = "keys go to the extension · Esc closes";

function customScreenOwner(stack: string | undefined): string | undefined {
  return extensionNameFromStack(stack);
}

function isCustomScreenComponent(value: unknown): value is CustomScreenComponent {
  return value !== null && typeof value === "object" && typeof Reflect.get(value, "render") === "function";
}

export class PiSessionService implements SessionRouteService {
  private readonly active = new Map<string, ActiveSession<PiSessionRuntime>>();
  /** Transcript heads by session manager, valid while its leaf is the one they were computed at. */
  private readonly transcriptHeads = new WeakMap<object, { leafId: string | null; head: TranscriptHead }>();
  private readonly pendingSessionOpens = new Map<string, PendingSessionOpen>();
  /**
   * Sessions whose extension binding is still in flight. A `session_start`
   * dialog parks that window before the session ever becomes active, so this
   * is the only way the dialog answer/cancel and status paths can reach it;
   * {@link getOrOpen} never consults it, keeping every other operation gated
   * on full readiness.
   */
  private readonly startupSessions = new Map<string, PiAgentSession>();
  /** Session ids currently marked in flight on disk, to write only on change. */
  private readonly runInFlight = new Set<string>();
  /** Per-session tail of the queue-rewrite chain; see withQueueLock. */
  private readonly queueLocks = new Map<string, Promise<void>>();
  private readonly activities = new Map<string, { phase: "active" | "idle" | "error"; label: string; detail?: string; at: string }>();
  /** What each session's agent is doing (B25), and since when; every activity it publishes carries it. */
  private readonly steps = new Map<string, { step: SessionStep; since: string }>();
  /** Last counted background runs per open session; see refreshBackgroundRunCounts. */
  private readonly backgroundRunCounts = new Map<string, number>();
  private backgroundRunScanInFlight = false;
  private backgroundRunRefreshRequested = true;
  private readonly backgroundWorkWatcher: BackgroundWorkWatcher;
  private readonly workspaceWatcher: WorkspaceWatcher;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly commandService: SessionCommandService<PiAgentSession>;
  /** Runtime-identity gate held while Pi may await abandoned-branch summarization. */
  private readonly treeNavigations = new WeakSet<PiAgentSession>();
  /** Counts async operations that may append an entry before they settle. */
  private readonly sessionEntryMutationCounts = new WeakMap<PiAgentSession, number>();
  /** Runtime/session-identity reservations for operations that must not overlap tree navigation. */
  private readonly treeExclusiveRuntimeOperationCounts = new WeakMap<PiSessionRuntime, number>();
  private readonly treeExclusiveSessionOperationCounts = new Map<string, number>();
  private readonly deferredSubsessionNotifications = new WeakMap<PiAgentSession, DeferredSubsessionNotification[]>();
  private readonly deferredGeneratedSessionNames = new WeakMap<PiAgentSession, string>();
  private readonly arrivalChains = new Map<string, Promise<unknown>>();
  private readonly handoffChains = new Map<string, Promise<unknown>>();
  private readonly handing = new Set<string>();
  private readonly handingCommands = new Set<string>();
  private readonly commandHandlers = new CommandHandlerScope();
  /** The answers records this daemon handed to pi, found again by identity while they wait in its queues. */
  private readonly sentAnswers = new WeakMap<object, AskUserOutcome>();
  private readonly notices = new AgentNotices(new Set([ASK_USER_ANSWERS_CUSTOM_TYPE, SUBSESSION_NOTIFICATION_CUSTOM_TYPE]));
  /** Accepted prompt identities, so a lost response answers instead of re-running. */
  /**
   * Durable when the daemon has a data directory, in-memory otherwise (tests
   * and embedded runs). The old ledger said out loud that a restart forgot it,
   * which turned the browser's correct retry into a second run of the prompt.
   */
  private readonly acceptanceLedger: AcceptanceFace;
  private readonly committedExpectations = new CommittedPromptExpectations();
  private readonly ownedQueue: OwnedPromptQueue;
  private readonly inboxDataDir: string | undefined;
  /**
   * Ids the sending browser minted for prompts that went into pi's steer or
   * follow-up queue, in submission order. pi's queue APIs carry text only, so
   * this is what lets a status update tell the sender "the entry you are
   * looking at is *your* message" instead of making it guess by text.
   * Entries are dropped as soon as their text leaves the queue.
   */
  private readonly queuedPromptClientIds = new Map<string, HeldSteerRecord[]>();
  private readonly openRuns = new Map<string, { quietSince: number | undefined }>();
  private readonly directCommitWatchers = new Map<string, () => void>();
  private readonly runStartWatchers = new Map<string, () => void>();
  private readonly steerBatches = new Map<string, Promise<void>>();
  private readonly replayingLanes = new Set<string>();
  private readonly emptying = new Set<string>();
  private readonly closingSessions = new Map<string, Promise<void>>();
  /**
   * Runtimes opened to read an archived session. The inbox hands nothing to them: messages that
   * wait for an archived session keep waiting until it is restored and opened for work.
   */
  private readonly archivedRuntimes = new WeakSet<PiAgentSession>();
  private readonly laneSizes = new Map<string, number>();
  private readonly laneGrowth = new Map<string, number>();
  /**
   * Images that queued prompts carried, keyed by session and matched on text.
   *
   * The runtime's queue is text-only - `clearQueue()` hands back strings - so a
   * recall, which has to clear and replay, would put every *surviving* message
   * back without its attachments. Nothing in the UI would say so: the bubble
   * still reads "queued", the count is unchanged, and the image is simply
   * absent when the agent finally reads it. Remembering them here is what makes
   * the replay lossless for messages whose only crime was being queued next to
   * a message someone recalled.
   */
  private readonly queuedPromptImages = new Map<string, { text: string; images: ImageContent[] }[]>();
  private readonly authLossWarnings = new Set<string>();
  /** Tracked subsession id -> the parent session id that spawned it. */
  private readonly subsessionParents = new Map<string, string>();
  /** Parent session id -> the set of tracked subsession ids it spawned. */
  private readonly subsessionChildren = new Map<string, Set<string>>();
  /** Tracked subsession id -> persisted recovery details for the child. */
  private readonly subsessionLinks = new Map<string, TrackedSubsessionLink>();
  /** Parent id/file identities whose persisted links have already been loaded. */
  private readonly subsessionHydratedParents = new Set<string>();
  /**
   * Tracked subsession id -> whether a completion notification is armed.
   * Armed when the child starts working; firing on completion disarms it so a
   * child that works again (and stops again) notifies the parent each time.
   */
  private readonly subsessionNotifyArmed = new Map<string, boolean>();
  private readonly archiveStore: SessionArchiveRepository;
  private readonly agentDir: string;
  private readonly sessionManager: PiSessionManagerGateway;
  private readonly createRuntime: PiWebCreateAgentSessionRuntimeFactory;
  private readonly createAgentRuntime: CreateAgentRuntime;
  private readonly modelRuntime: ModelRuntime;
  private readonly workspaceActivity: Pick<WorkspaceActivityService, "applySessionStatus" | "applySessionActivity" | "removeSession" | "reconcileSessionActivity"> | undefined;
  private readonly spawnTargets: SpawnTargetResolver | undefined;
  private readonly logger: PiSessionLogger;
  private readonly now: () => Date;
  private readonly notificationStore: SessionNotificationStore;
  private readonly notificationGenerationBySession = new WeakMap<PiAgentSession, SessionNotificationGeneration>();
  /** Warning identities already filed in the drawer, per live session. */
  private readonly filedWarningsBySession = new WeakMap<PiAgentSession, Set<string>>();
  /**
   * Mutation counter of each session's dialog surface, incremented on every
   * dialog open and close. Frames carry the value they produced, so a client
   * that saw revision N and then N+2 knows a frame was lost and repairs from
   * the authoritative status instead of keeping a stale card.
   */
  private readonly dialogRevisionBySession = new Map<string, number>();
  private readonly unreadStore: SessionUnreadStore;
  private readonly hostContributions: HostContributions;
  private readonly pendingAskStore: PendingAskStore;
  private readonly pendingExtensionDialogStore: PendingExtensionDialogStore;
  private readonly extensionDialogsTimeoutMs: number;
  /** The parked extension Promise resolvers behind the store's open dialogs. */
  /** The last factory call's stack, read for the extension's own frame. */
  private customScreenStack: string | undefined;
  /** Open extension screens, by dialog id, so a keypress can find its component. */
  private readonly customScreens = new Map<string, (key: string) => void>();
  /** Sessions whose running turn the reader stopped, with the moment recorded; settled once, at the latest when that turn ends. */
  private readonly stoppedByReader = new Map<string, string>();
  private readonly dialogWaiters = new ExtensionDialogWaiters();
  private readonly catalogRefreshStatus: CatalogRefreshStatus | undefined;
  private readonly unreadPublicationRetryInitialMs: number;
  private readonly onUnreadChanged: (() => void) | undefined;
  private readonly pendingUnreadMutations: SessionUnreadMutation[] = [];
  private unreadPublication: Promise<void> | undefined;
  private unreadPublicationFailure: unknown;
  private unreadPublicationFlushRequested = false;
  private unreadPublicationRetryTimer: NodeJS.Timeout | undefined;
  private unreadPublicationRetryDelayMs: number;
  private unreadPublicationStopped = false;

  /**
   * What the daemon knows about identities a client could not settle.
   *
   * A reconnecting browser holds rows whose answer was lost. Asking is the
   * honest way to close them: an identity the daemon never saw is simply absent
   * from the answer, because "no row" and "it failed" are different facts and
   * only one of them justifies sending again.
   */
  operationOutcomes(sessionId: string, operationIds: readonly string[]): Record<string, string> {
    return this.acceptanceLedger.outcomesFor(sessionId, operationIds);
  }

  constructor(private readonly events: SessionEventHub, deps: PiSessionServiceDependencies) {
    this.acceptanceLedger = deps.operationLedgerDir === undefined
      ? createInMemoryAcceptanceLedger()
      : createDurableAcceptanceLedger(deps.operationLedgerDir);
    this.ownedQueue = new OwnedPromptQueue(deps.operationLedgerDir === undefined ? memoryInboxLocation : dataDirInboxLocation(deps.operationLedgerDir));
    this.inboxDataDir = deps.operationLedgerDir;
    this.hostContributions = deps.hostContributions ?? EMPTY_HOST_CONTRIBUTIONS;
    this.archiveStore = deps.archiveStore ?? new SessionArchiveStore();
    this.agentDir = deps.agentDir;
    this.sessionManager = deps.sessionManager;
    this.modelRuntime = deps.modelRuntime;
    this.spawnTargets = deps.spawnTargets;
    this.logger = deps.logger ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.notificationStore = deps.notificationStore ?? new SessionNotificationStore();
    this.unreadStore = deps.unreadStore ?? new SessionUnreadStore();
    this.onUnreadChanged = deps.onUnreadChanged;
    this.pendingAskStore = deps.pendingAskStore ?? new PendingAskStore();
    this.pendingExtensionDialogStore = deps.pendingExtensionDialogStore ?? new PendingExtensionDialogStore();
    this.extensionDialogsTimeoutMs = deps.extensionDialogsTimeoutMs ?? DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS;
    this.catalogRefreshStatus = deps.catalogRefreshStatus;
    this.unreadPublicationRetryInitialMs = Math.max(
      0,
      deps.unreadPublicationRetryDelayMs ?? DEFAULT_UNREAD_PUBLICATION_RETRY_MS,
    );
    this.unreadPublicationRetryDelayMs = this.unreadPublicationRetryInitialMs;
    this.createRuntime = deps.createRuntime ?? createDefaultRuntimeFactory(
      this.modelRuntime,
      deps.askUserEnabled === true ? { open: (input) => this.openAsk(input) } : undefined,
      deps.hostContributions?.systemPromptSections ?? [],
    );
    this.createAgentRuntime = deps.createAgentRuntime ?? defaultCreateAgentRuntime;
    this.workspaceActivity = deps.workspaceActivity;
    this.backgroundWorkWatcher = new BackgroundWorkWatcher(() => {
      this.backgroundRunRefreshRequested = true;
      void this.refreshBackgroundRunCounts();
    });
    this.workspaceWatcher = new WorkspaceWatcher((event) => { this.events.publishRealtime(event); });
    this.heartbeat = setInterval(() => { this.publishHeartbeats(); }, deps.heartbeatIntervalMs ?? 2000);
    this.commandService = new SessionCommandService(
      (sessionId) => this.getActive(this.activeSessionRef(sessionId)),
      (sessionId, text) => this.prompt(this.activeSessionRef(sessionId), text, undefined, undefined, { echoUserMessage: false }),
      events,
      {
        onCompactionStart: (session) => {
          this.beginSessionEntryMutation(session, "compact the session");
          this.publishActivity(session, "compacting", "active");
          this.publishStatus(session);
        },
        onCompactionEnd: (session, result, detail) => {
          this.endSessionEntryMutation(session);
          this.publishActivity(session, result === "success" ? "compaction complete" : "compaction failed", result === "success" ? "idle" : "error", detail);
          this.publishStatus(session);
        },
        reloadSession: (session) => this.reloadSessionRuntime(session),
        getSessionTree: (session) => {
          if (typeof session.sessionManager.getTree !== "function" || typeof session.navigateTree !== "function") return undefined;
          return projectSessionTree(session.sessionManager.getTree(), session.sessionManager.getLeafId());
        },
        hasActiveWork: (session) => this.hasActiveWork(session),
        isTreeNavigationActive: (session) => this.treeNavigations.has(session),
        runSessionReplacement: (session, operation) => this.runTreeExclusiveOperation(
          [{ sessionId: session.sessionId, session }],
          "Stop current session activity before replacing the session",
          operation,
        ),
        // The transcript line a silent command gets is transient; this record
        // survives a reload in the notification drawer.
        onSilentCommand: (sessionId, command) => {
          const session = this.active.get(sessionId)?.runtime.session;
          if (session === undefined) return;
          this.fileSessionNotification(session, `${command} finished without any output.`, "warning");
        },
      },
      { listSessionNames: (cwd) => this.listSessionNames(cwd) },
    );
  }

  activeCount(): number {
    return this.active.size;
  }

  notificationCatalog(): SessionNotificationCatalogSnapshot {
    return this.notificationStore.catalogSnapshot();
  }

  async unreadCatalog(): Promise<SessionUnreadCatalogSnapshot> {
    await this.publishUnreadMutations([]);
    return this.unreadStore.durableCatalogSnapshot();
  }

  /**
   * Status of every session this daemon currently holds open.
   *
   * Live status reaches the browser only through `status.update` broadcasts, so
   * a browser that connects while a session is already streaming sees no work
   * indicator until that session happens to publish again — which, for a long
   * quiet tool call, can be minutes. This snapshot is the hydration source for
   * a fresh load and for socket reconnects, closing the same gap the unread
   * catalog closes for unread state.
   *
   * Only loaded sessions can report: a session running under a different host
   * (a terminal pi) is not in this registry and is reported by nobody, so the
   * absence of an entry means "unknown", not "idle".
   */
  sessionStatusCatalog(): SessionStatusCatalogSnapshot {
    const statuses = [...new Set(this.active.values())]
      .map((active) => this.statusFromSession(active.runtime.session));
    return {
      statuses,
      generatedAt: new Date(this.now()).toISOString(),
      // One id per daemon process: the browser reconciles its indicator map
      // against this catalog, and a different id means the process that
      // produced the entries it already holds is gone.
      daemonInstanceId: this.notificationStore.daemonInstanceId,
    };
  }

  async acknowledgeUnread(sessionId: string, request: SessionUnreadAcknowledgeRequest): Promise<SessionUnreadAcknowledgeResponse> {
    const result = this.unreadStore.acknowledge(sessionId, {
      ...request,
      cwd: canonicalizeStoredCwd(request.cwd),
    });
    await this.publishUnreadMutations(result.mutations);
    // The outcome rides with the snapshot because the snapshot cannot carry it:
    // a refusal and an acceptance both answer with the current catalog.
    return { ...(await this.unreadStore.durableCatalogSnapshot()), outcome: result.outcome };
  }

  notificationInbox(ref: PiSessionRef): SessionNotificationInboxSnapshot {
    return this.notificationStore.inboxSnapshot(ref.id, canonicalizeStoredCwd(ref.cwd));
  }

  dismissNotification(
    ref: PiSessionRef,
    request: Omit<SessionNotificationDismissRequest, "cwd">,
  ): SessionNotificationDismissResponse {
    const result = this.notificationStore.dismissNotification(
      ref.id,
      canonicalizeStoredCwd(ref.cwd),
      request.daemonInstanceId,
      request.notificationId,
    );
    this.publishNotificationMutations(result.mutations);
    return { ...result.snapshot, outcome: result.outcome };
  }

  dismissAllNotifications(
    ref: PiSessionRef,
    request: Omit<SessionNotificationDismissAllRequest, "cwd">,
  ): SessionNotificationDismissResponse {
    const result = this.notificationStore.dismissAll(
      ref.id,
      canonicalizeStoredCwd(ref.cwd),
      request.daemonInstanceId,
      request.throughOrder,
      request.throughOverflowWatermark,
    );
    this.publishNotificationMutations(result.mutations);
    return { ...result.snapshot, outcome: result.outcome };
  }

  async cleanupPreview(request: NormalizedSessionCleanupRequest): Promise<ClientSessionCleanupPreviewResponse> {
    return previewResponseFromPlan(await this.cleanupPlan(request));
  }

  async cleanup(request: NormalizedSessionCleanupRequest): Promise<ClientSessionCleanupExecuteResponse> {
    const plan = await this.cleanupPlan(request);
    if (plan.deleteRecords.length > 0 && this.archiveStore.deleteArchived === undefined && this.archiveStore.deleteArchivedMany === undefined) throw new Error("Archive store does not support deletion");

    const archiveInputs: ArchiveSessionInput[] = [];
    const readyArchiveInputs: ArchiveSessionInput[] = [];
    const deleteRecords: ArchivedSessionRecord[] = [];
    const readyDeleteRecords: ArchivedSessionRecord[] = [];
    const skippedBusySessionIds = new Set(plan.skippedBusySessionIds);

    for (const input of plan.archiveInputs) {
      if (this.activeSessionHasWork(input.sessionId) || await this.closedSessionHasWaiting(input.sessionId, input.cwd)) {
        skippedBusySessionIds.add(input.sessionId);
        continue;
      }
      await this.closeActive(input.sessionId, { kind: "clear", reason: "archive" });
      readyArchiveInputs.push(input);
    }
    await this.archiveStoreArchiveMany(readyArchiveInputs);
    archiveInputs.push(...readyArchiveInputs);
    await this.forgetUnreadSessions(readyArchiveInputs);

    for (const record of plan.deleteRecords) {
      if (this.activeSessionHasWork(record.sessionId) || await this.closedSessionHasWaiting(record.sessionId, record.cwd)) {
        skippedBusySessionIds.add(record.sessionId);
        continue;
      }
      await this.closeActive(record.sessionId, { kind: "clear", reason: "delete" });
      readyDeleteRecords.push(record);
    }
    const deletedSessionIds = new Set(await this.archiveStoreDeleteArchivedMany(readyDeleteRecords.map((record) => record.sessionId)));
    deleteRecords.push(...readyDeleteRecords.filter((record) => deletedSessionIds.has(record.sessionId)));
    await this.forgetUnreadSessions(deleteRecords);

    return summarizeSessionCleanupExecution({
      archiveInputs,
      deleteRecords,
      thresholds: plan.thresholds,
      generatedAt: plan.generatedAt,
      skippedBusySessionIds: [...skippedBusySessionIds],
    });
  }

  async dispose(): Promise<void> {
    this.unreadPublicationStopped = true;
    this.clearUnreadPublicationRetry();
    clearInterval(this.heartbeat);
    this.backgroundWorkWatcher.dispose();
    // Same startup-park hazard as closeActive(): settle `session_start` dialogs
    // of sessions still binding extensions before awaiting their pending opens.
    for (const sessionId of this.startupSessions.keys()) this.endSessionExtensionDialogs(sessionId);
    const pendingOpens = this.pendingSessionOpenPromises();
    if (pendingOpens.length > 0) await Promise.allSettled(pendingOpens);
    this.workspaceWatcher.dispose();
    const activeSessions = Array.from(new Set(this.active.values()));
    for (const active of activeSessions) {
      this.forgetUnreadActivity(active.runtime.session);
      this.pendingAskStore.forgetSession(active.runtime.session.sessionId);
      this.endSessionExtensionDialogs(active.runtime.session.sessionId);
    }
    this.active.clear();
    this.pendingSessionOpens.clear();
    this.startupSessions.clear();
    this.activities.clear();
    this.steps.clear();
    this.authLossWarnings.clear();
    this.subsessionParents.clear();
    this.subsessionChildren.clear();
    this.subsessionLinks.clear();
    this.subsessionHydratedParents.clear();
    this.subsessionNotifyArmed.clear();
    this.notificationStore.clearAll("service-dispose");
    await Promise.all(activeSessions.map(async (active) => {
      await this.keepWhatThePiHolds(active.runtime.session);
      active.unsubscribe();
      active.runtime.setRebindSession(undefined);
      this.workspaceActivity?.removeSession(active.runtime.session.sessionId, active.runtime.session.sessionManager.getCwd());
      try {
        await this.abortStampingCommits(active.runtime.session);
        await this.notices.commit(active.runtime.session);
      } finally {
        await active.runtime.dispose();
      }
    }));
    await this.publishUnreadMutations([]);
  }

  async list(cwd: string): Promise<ClientSession[]> {
    const [sessions, archivedRecords] = await Promise.all([this.sessionManager.list(cwd), this.archiveStore.list()]);
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const archivedForCwd = archivedRecords.filter((record) => record.cwd === cwd);
    const archivedById = new Map(archivedForCwd.map((record) => [record.sessionId, record]));
    for (const record of archivedForCwd) {
      this.publishNotificationMutations(this.notificationStore.clearSession(record.sessionId, "archive-reconcile"));
    }
    const unarchivedSessions = sessions.filter((session) => !archivedById.has(session.id)).map(clientSessionFromListEntry);
    const reconcilableSessionIds = this.reconcilableSessionIds(cwd, unarchivedSessions.map((session) => session.id), archivedById);
    this.workspaceActivity?.reconcileSessionActivity(cwd, reconcilableSessionIds);
    await this.publishUnreadMutations(this.unreadStore.reconcileCwd(canonicalizeStoredCwd(cwd), reconcilableSessionIds));
    const archivedSessions = archivedForCwd
      .sort(compareArchivedRecords)
      .map((record) => clientSessionFromArchivedRecord(record, sessionsById.get(record.sessionId)))
      .filter(isDefined);
    return [...unarchivedSessions, ...archivedSessions];
  }

  async start(cwd: string, options: StartSessionOptions = {}): Promise<ClientSession> {
    return this.startSession(cwd, options);
  }

  /**
   * Where a session is, machine-wide, and whether it is archived (P2 slice b).
   *
   * A link names a session and the workspace it was opened in. The workspace
   * listing covers that workspace's tree, and a read by its cwd sees only the
   * session directory of that exact cwd, so neither absence is an answer: a
   * session recorded in a subdirectory, or archived there, would read as
   * deleted. This answers with the session, or with the typed error when no
   * store holds it. A new session not written to disk yet is found among the
   * open ones.
   */
  async locate(ref: PiSessionRef): Promise<ClientSession> {
    const entry = await this.sessionManager.findSession(ref.cwd, ref.id);
    const archived = await this.archiveStore.get(entry?.id ?? ref.id);
    const archivedSession = archived === undefined ? undefined : clientSessionFromArchivedRecord(archived, entry);
    if (archivedSession !== undefined) return archivedSession;
    if (entry !== undefined) return clientSessionFromListEntry(entry);
    const unwritten = this.unwrittenSession(ref.id);
    if (unwritten !== undefined) return unwritten;
    throw new SessionNotFoundError();
  }

  private unwrittenSession(sessionId: string): ClientSession | undefined {
    const runtime = this.active.get(sessionId)?.runtime;
    return runtime === undefined ? undefined : freshClientSession(runtime.session, runtime.cwd);
  }

  private async startSession(cwd: string, options: InternalStartSessionOptions): Promise<ClientSession> {
    try {
      return await this.startSessionCreating(cwd, options);
    } catch (error) {
      // The SDK materialises the session file first and fails on the missing
      // cwd after; its multi-line diagnostic is the reader's whole banner.
      // Translate to one sentence the composer can sit under.
      if (error instanceof Error && error.message.includes("Stored session working directory does not exist")) {
        throw new Error(`Workspace folder does not exist: ${cwd}`, { cause: error });
      }
      throw error;
    }
  }

  private async startSessionCreating(cwd: string, options: InternalStartSessionOptions): Promise<ClientSession> {
    const active = await this.create(
      this.sessionManager.create(cwd, options.parentSession === undefined ? undefined : { parentSession: options.parentSession }),
      cwd,
      {
        startupIntent: "create",
        ...(options.startupToken === undefined ? {} : { startupToken: options.startupToken }),
        ...(options.initialModel === undefined ? {} : { initialModel: options.initialModel }),
        ...(options.initialThinkingLevel === undefined ? {} : { initialThinkingLevel: options.initialThinkingLevel }),
        ...(options.creationProvenance === undefined ? {} : { creationProvenance: options.creationProvenance }),
      },
    );
    const created: ClientSession = {
      ...freshClientSession(active.runtime.session, cwd),
      // Include the parent so listeners can nest the new session in the tree
      // immediately, instead of showing it flat until the next reload.
      ...(options.parentSession === undefined ? {} : { parentSessionPath: options.parentSession }),
    };
    // Broadcast so other clients (and the spawning agent's UI) can add the new
    // session to their list without a manual reload.
    this.events.publishGlobal({ type: "session.created", session: created });
    return created;
  }

  /**
   * Start a new session on behalf of a LLM and deliver an initial prompt to it.
   * The target cwd is constrained to a workspace of the same registered project
   * as the spawning session so the new session is visible in the web UI.
   */
  async spawnSession(input: SpawnSessionInvocation): Promise<SpawnSessionResult> {
    if (this.spawnTargets === undefined) throw new Error("Spawning sessions is disabled");
    const decision = await this.spawnTargets.resolveSpawnTarget(input.spawningCwd, input.cwd);
    if (!decision.allowed) throw spawnTargetError(decision);
    // A model spec overrides the inherited model. Only a spec resolves
    // against the spawning session; the default path must not depend on it.
    const model = input.modelSpec === undefined
      ? input.model
      : await this.resolveSpawnModel({ id: input.spawningSessionId, cwd: input.spawningCwd }, input.modelSpec);
    const created = await this.start(decision.cwd, {
      ...(model === undefined ? {} : { initialModel: model }),
      ...(input.thinkingLevel === undefined ? {} : { initialThinkingLevel: input.thinkingLevel }),
    });
    const modelUsed = this.active.get(created.id)?.runtime.session.model;
    await this.prompt(created, input.prompt);
    this.logger.info(
      { spawningCwd: input.spawningCwd, sessionId: created.id, cwd: decision.cwd, promptLength: input.prompt.length },
      "spawn route started a new session",
    );
    return {
      sessionId: created.id,
      cwd: decision.cwd,
      ...(modelUsed === undefined ? {} : { model: modelSpecOf(modelUsed) }),
    };
  }

  /**
   * Start a *tracked* child session on behalf of a LLM. Unlike
   * {@link spawnSession}, a tracked child always runs in the parent's own
   * workspace: parent/child trees are worktree-scoped, so a child elsewhere
   * would be invisible to the parent's listing. The child records its parent
   * (so it shows in the session tree) and is registered so the parent is
   * notified when it stops working and can inspect it later.
   */
  async spawnSubsession(input: SpawnSubsessionInvocation): Promise<SpawnSubsessionResult> {
    if (this.spawnTargets === undefined) throw new Error("Spawning sessions is disabled");
    if (input.cwd !== undefined && input.cwd !== "" && !cwdPathsEqual(input.cwd, input.spawningCwd)) {
      throw subsessionCwdError(input.spawningCwd, input.cwd);
    }
    // Resolved against the parent's own cwd only: this still refuses spawning
    // from an unregistered directory, which keeps the child visible in the UI.
    const decision = await this.spawnTargets.resolveSpawnTarget(input.spawningCwd, undefined);
    if (!decision.allowed) throw spawnTargetError(decision);
    // A model spec overrides the inherited model and is resolved against the
    // parent's model runtime; only a spec resolves against the parent.
    const model = input.modelSpec === undefined
      ? input.model
      : await this.resolveSpawnModel({ id: input.parentSessionId, cwd: input.spawningCwd }, input.modelSpec);
    const created = await this.startSession(decision.cwd, {
      ...(input.parentSessionFile === undefined ? {} : { parentSession: input.parentSessionFile }),
      ...(model === undefined ? {} : { initialModel: model }),
      ...(input.thinkingLevel === undefined ? {} : { initialThinkingLevel: input.thinkingLevel }),
      creationProvenance: "tracked-subsession",
    });
    const modelUsed = this.active.get(created.id)?.runtime.session.model;
    const parentSessionFile = nonEmptyString(input.parentSessionFile);
    const link: TrackedSubsessionLink = {
      parentSessionId: input.parentSessionId,
      childSessionId: created.id,
      ...(created.path === "" ? {} : { childSessionFile: created.path }),
      ...(parentSessionFile === undefined ? {} : { parentSessionFile }),
      cwd: decision.cwd,
    };
    await this.registerVerifiedSubsession(link);
    this.persistSubsessionLink(link);
    this.persistSubsessionChildMarker(input.parentSessionId, created.id);
    await this.prompt(created, input.prompt);
    this.logger.info(
      { parentSessionId: input.parentSessionId, sessionId: created.id, cwd: decision.cwd, promptLength: input.prompt.length },
      "subsession route started a tracked child session",
    );
    return {
      sessionId: created.id,
      cwd: decision.cwd,
      ...(modelUsed === undefined ? {} : { model: modelSpecOf(modelUsed) }),
    };
  }

  /**
   * The models a session may pick from: its scoped set when model-scoped,
   * otherwise the runtime's available snapshot. Refreshes the runtime catalog
   * first so callers see newly configured providers and models. The refresh
   * stays local (`allowNetwork: false`); network refreshes belong to the
   * bounded background catalog refresher, not this request path.
   */
  private async sessionModelCandidates(session: PiAgentSession): Promise<readonly AgentModel[]> {
    await session.modelRuntime.refresh({ allowNetwork: false });
    return session.scopedModels.length > 0
      ? session.scopedModels.map((scoped) => scoped.model)
      : session.modelRuntime.getAvailableSnapshot();
  }

  /**
   * The session machine's full available catalog with per-model enabled state,
   * ordered enabled-first the way the All-models picker lists it. Reads the
   * snapshot after every refresh so the rows and the enabled-id resolution
   * describe the same catalog.
   */
  private async enabledModelCatalog(session: PiAgentSession): Promise<EnabledModelCatalogEntry<AgentModel>[]> {
    await session.modelRuntime.refresh({ allowNetwork: false });
    const enabledIds = await resolveEnabledModelIds(sessionScopeSource(session));
    return catalogWithEnabledFirst(session.modelRuntime.getAvailableSnapshot(), enabledIds);
  }

  /**
   * Resolve a strict `provider/model-id` spec from a spawn tool against the
   * *spawning* session's model runtime, using the same candidates
   * {@link setModel} offers plus a direct runtime lookup as fallback. Unknown
   * or malformed specs throw; the agent loop turns that into an error tool
   * result the spawning agent can retry from.
   */
  private async resolveSpawnModel(spawningRef: PiSessionRef, modelSpec: string): Promise<AgentModel> {
    const session = await this.getOrOpen(spawningRef);
    const parsed = parseModelSpec(modelSpec);
    const candidates = await this.sessionModelCandidates(session);
    const model = parsed === undefined
      ? undefined
      : candidates.find((candidate) => candidate.provider === parsed.provider && candidate.id === parsed.modelId)
        ?? session.modelRuntime.getModel(parsed.provider, parsed.modelId);
    if (model === undefined) throw unknownSpawnModelError(modelSpec);
    return model;
  }

  /**
   * Register the question set an agent wants the user to answer as the session's
   * open ask. Deliberately does not wait for the user: `ask_user` terminates the
   * run and the submitted answers come back later as a follow-up message.
   *
   * Rejected question sets throw {@link PendingAskValidationError}, which the
   * agent loop reports to the model as an error tool result.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- async so a rejected question set becomes a rejection rather than a synchronous throw from a promise-returning method.
  async openAsk(input: AskUserInvocation): Promise<PendingAskOpenResult> {
    // Snapshot what is already queued: those messages predate the questions,
    // and only their delivery may void the form. A message sent while the form
    // is on screen is an addition to the request, not a refusal of it.
    // INVARIANT: this snapshot must enumerate every queue that can later emit
    // a user message_start - today the runtime's two lanes plus the compaction
    // parking lot. A queue added without joining this list reopens the class:
    // its drained messages would either never void the form or void it as
    // strangers. Identity rides beside the text because texts drift (template
    // expansion) and captionless photos have none.
    const active = this.active.get(input.sessionId)?.runtime.session;
    const ownedEntries = this.ownedQueue.entries(input.sessionId);
    const queuedMessageTexts = [
      ...(active === undefined ? [] : [...active.getSteeringMessages(), ...active.getFollowUpMessages()]),
      ...ownedEntries.map((entry) => entry.text),
    ];
    const queuedMessageIds = [
      ...(this.queuedPromptClientIds.get(input.sessionId) ?? []).map((record) => publishedId(record.clientMessageId)).filter((id): id is string => id !== undefined),
      ...ownedEntries.map((entry) => entry.clientMessageId).filter((id): id is string => id !== undefined),
    ];
    const result = this.pendingAskStore.open({ ...input, queuedMessageTexts, queuedMessageIds });
    this.events.publish(input.sessionId, { type: "ask.opened", ask: result.ask, revision: this.nextDialogRevision(input.sessionId), daemonInstanceId: this.notificationStore.daemonInstanceId });
    this.publishStatusForSessionId(input.sessionId);
    return result;
  }

  /**
   * Record the user's answers to the session's open ask and hand them to the
   * model. The answers travel as a system-authored custom message rather than a
   * user message, so they are not attributed to the human in the transcript;
   * they wake an idle session and reach a running one at its next injection
   * point (`AGENT_NOTICE_DELIVERY`, B26).
   */
  async submitAsk(ref: PiSessionRef, askId: string, submission: AskUserSubmission): Promise<AskUserCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    // Checked before the store closes the ask so a refused delivery cannot
    // discard answers the user already submitted.
    this.assertTreeNavigationInactive(session, "answer questions");
    return this.closeAsk(session, this.pendingAskStore.submit(session.sessionId, askId, submission));
  }

  /**
   * Close the open ask without answers. The model is still told, naming every
   * question as unanswered: it was promised a follow-up message and would
   * otherwise wait for one that never comes.
   */
  async cancelAsk(ref: PiSessionRef, askId: string): Promise<AskUserCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertTreeNavigationInactive(session, "dismiss questions");
    return this.closeAsk(session, this.pendingAskStore.cancel(session.sessionId, askId));
  }

  /**
   * Publish and deliver a closed ask. A stale close is reported rather than
   * thrown: losing the race against a supersede, another browser, or a session
   * that went away is ordinary, and the returned status tells the browser what
   * the session's open ask is now.
   */
  private async closeAsk(session: PiAgentSession, result: PendingAskCloseResult): Promise<AskUserCloseResponse> {
    if (result.status === "stale") return { result: "stale", sessionStatus: this.statusFromSession(session) };
    const { outcome } = result;
    this.publishAskClosed(session.sessionId, outcome);
    this.sentAnswers.set(outcome, outcome);
    await this.runSessionEntryMutation(session, "deliver answers to your questions", () => session.sendCustomMessage(
      { customType: ASK_USER_ANSWERS_CUSTOM_TYPE, content: renderAskUserAnswersText(outcome), display: true, details: outcome },
      AGENT_NOTICE_DELIVERY,
    ));
    this.publishStatus(session);
    return { result: "closed", outcome, sessionStatus: this.statusFromSession(session) };
  }

  private publishAskClosed(sessionId: string, outcome: AskUserOutcome): void {
    this.events.publish(sessionId, { type: "ask.closed", askId: outcome.askId, reason: outcome.reason, revision: this.nextDialogRevision(sessionId), daemonInstanceId: this.notificationStore.daemonInstanceId });
  }

  /**
   * A message delivered while the form is open leaves it alone.
   *
   * It used to void the ask: the model was told the questions were dead and
   * carried on with defaults. The owner's ruling is the opposite - a message
   * neither answers the form nor disturbs it - so the questions stay up and the
   * answers arrive later as their own turn. The case that made this visible was
   * a message queued *before* the questions were posted: it was delivered a
   * second after the form appeared, so the reader watched a form they had never
   * touched close itself, reported as "I never replied, why does it say
   * unanswered".
   *
   * The message is still claimed, which is what tells a message queued before
   * the questions from one sent after them; the claim is spent either way so a
   * redelivery stays idempotent.
   */
  private voidOpenAskForDeliveredMessage(session: PiAgentSession, event: unknown): void {
    if (this.pendingAskStore.pendingAsk(session.sessionId) === undefined) return;
    const message = getProperty(event, "message");
    const { text } = committedMessageShape(getProperty(message, "content"));
    // The stamp ran before this handler in the same subscription, so a prompt
    // this daemon accepted carries its sender's id here.
    const stamped = isRecord(message) && typeof message["clientMessageId"] === "string" ? message["clientMessageId"] : undefined;
    this.pendingAskStore.claimPreAskDelivery(session.sessionId, { ...(stamped === undefined ? {} : { clientMessageId: stamped }), text });
  }

  /**
   * Record the user's answer to an open extension dialog and resolve the
   * extension's parked Promise with it. Unlike an ask, nothing is delivered to
   * the model: the waiter is extension code inside an already in-flight run
   * (or an idle handler), so no custom message and no turn are triggered.
   */
  async answerDialog(ref: PiSessionRef, dialogId: string, value: ExtensionDialogAnswer): Promise<ExtensionDialogCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.sessionForStatusOrDialogClose(ref);
    // The title must be read before the store closes the dialog: afterwards it
    // is no longer pending anywhere.
    const pending = this.pendingExtensionDialogStore.pendingDialogs(session.sessionId).find((dialog) => dialog.dialogId === dialogId);
    const result = this.pendingExtensionDialogStore.answer(session.sessionId, dialogId, value);
    if (result.status === "stale") return { result: "stale", sessionStatus: this.statusFromSession(session) };
    const { outcome } = result;
    const answer = outcome.answer ?? value;
    this.recordAnsweredDialogNotification(session, pending, answer);
    this.publishDialogClosed(session.sessionId, outcome);
    this.dialogWaiters.settleWithAnswer(dialogId, answer);
    this.publishStatus(session);
    return { result: "closed", outcome, sessionStatus: this.statusFromSession(session) };
  }

  /** Close an open extension dialog without an answer; the extension's wait settles with its kind's cancel value. */
  async cancelDialog(ref: PiSessionRef, dialogId: string): Promise<ExtensionDialogCloseResponse> {
    await this.assertWritable(ref);
    const session = await this.sessionForStatusOrDialogClose(ref);
    const result = this.pendingExtensionDialogStore.cancel(session.sessionId, dialogId, "cancelled");
    if (result.status === "stale") return { result: "stale", sessionStatus: this.statusFromSession(session) };
    const { outcome } = result;
    this.publishDialogClosed(session.sessionId, outcome);
    this.dialogWaiters.settleWithCancelValue(dialogId);
    this.publishStatus(session);
    return { result: "closed", outcome, sessionStatus: this.statusFromSession(session) };
  }

  /**
   * Implement one `ctx.ui.select()`/`confirm()`/`input()` call from extension
   * code: open the store record, tell the browsers, and park a Promise that
   * settles when the browser answers or cancels, the extension's own
   * `signal`/`timeout` dismisses the dialog, the daemon default timeout
   * elapses, or the runtime goes away. `store.open` validates the dialog, so a
   * malformed one rejects the extension's call rather than rendering garbage.
   * `async` so a rejected dialog becomes a rejection rather than a synchronous
   * throw from a promise-returning method.
   */
  private async openExtensionDialog(
    session: PiAgentSession,
    request: { kind: ExtensionDialogKind; title: string; message?: string | undefined; options?: string[] | undefined; placeholder?: string | undefined },
    opts: ExtensionUIDialogOptions | undefined,
  ): Promise<ExtensionDialogAnswer | undefined> {
    const signal = opts?.signal;
    // A pre-aborted signal dismisses the dialog before it ever opens.
    if (signal?.aborted === true) return extensionDialogCancelValue(request.kind);
    const timeoutMs = effectiveExtensionDialogTimeoutMs(opts?.timeout, this.extensionDialogsTimeoutMs);
    const dialog = this.openDialogRecord(session, {
      sessionId: session.sessionId,
      kind: request.kind,
      title: request.title,
      ...(request.message === undefined ? {} : { message: request.message }),
      ...(request.options === undefined ? {} : { options: request.options }),
      ...(request.placeholder === undefined ? {} : { placeholder: request.placeholder }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      runScoped: this.dialogRunScoped(session),
    });
    const revision = this.nextDialogRevision(session.sessionId);
    this.events.publish(session.sessionId, { type: "dialog.opened", dialog, revision, daemonInstanceId: this.notificationStore.daemonInstanceId });
    this.publishStatus(session);
    return this.dialogWaiters.park(dialog, {
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(signal === undefined ? {} : { signal }),
      onTrigger: (reason) => {
        if (this.closeExtensionDialogFromTrigger(session.sessionId, dialog.dialogId, reason)) this.publishStatusForSessionId(session.sessionId);
      },
    });
  }

  /**
   * Run an extension's TUI component as a browser modal.
   *
   * The component draws lines for a width and takes keys back; the dialog id
   * survives each redraw so the browser sees one screen being updated rather than
   * a new dialog every keystroke. `done(result)` (which the component calls) ends
   * the wait with that result; closing the modal ends it with `undefined`, which
   * is what pi's own cancel path answered before.
   */
  private async openCustomScreen(session: PiAgentSession, factory: unknown, opts: unknown): Promise<unknown> {
    if (typeof factory !== "function") return undefined;
    const options = customScreenOptions(opts);
    // Captured before the factory runs so the frame belongs to the extension.
    this.customScreenStack = new Error().stack;
    if (options.screen !== undefined) {
      const questionsId = this.openCustomDialog(session, [], customScreenOwner(this.customScreenStack), options.screen);
      return await this.customDialogClosed(session, questionsId, options);
    }
    const harness = customScreenHarness();
    let settle: (result: unknown) => void = () => undefined;
    const finished = new Promise<unknown>((resolve) => { settle = resolve; });
    // An object rather than a boolean: the flag is set from inside `done`, and TS
    // narrows a closed-over boolean to its initial `false` at the check below.
    const lifecycle = { settledBeforeMount: false };
    // Assigned once, after the factory has run - but the factory may call `done`
    // while being built, which reads this, so it cannot be a `const` below.
    // eslint-disable-next-line prefer-const
    let dialogId: string | undefined;
    // The component finishing closes its screen: the reader must not be left with a
    // modal the extension has already moved past.
    const done = (result: unknown): void => {
      if (dialogId === undefined) lifecycle.settledBeforeMount = true;
      else {
        const closed = this.pendingExtensionDialogStore.answer(session.sessionId, dialogId, "done");
        if (closed.status === "closed") {
          this.publishDialogClosed(session.sessionId, closed.outcome);
          this.dialogWaiters.settleWithAnswer(dialogId, "done");
        }
      }
      settle(result);
    };
    let component: CustomScreenComponent;
    try {
      component = await this.buildCustomScreen(factory, harness, done);
    } catch (error) {
      console.error("[extension-screen] factory failed", String(error));
      this.publishActivity(session, `extension screen failed: ${String(error)}`, "idle");
      return undefined;
    }
    // A component that calls done() while being built (a capability probe does
    // exactly that) never mounts: opening a modal for it and closing it in the
    // same tick would flash an empty screen.
    console.error("[extension-screen] mounted", {
      session: session.sessionId,
      settledBeforeMount: lifecycle.settledBeforeMount,
    });
    if (lifecycle.settledBeforeMount) return await finished;
    const lines = renderCustomScreen(component);
    dialogId = this.openCustomDialog(session, lines, customScreenOwner(this.customScreenStack), options.screen);
    const onKey = (key: string): void => {
      try {
        component.handleInput?.(key);
      } finally {
        this.pendingExtensionDialogStore.update(dialogId, renderCustomScreen(component));
        this.publishStatusForSessionId(session.sessionId);
      }
    };
    this.customScreens.set(dialogId, onKey);
    try {
      return await Promise.race([finished, this.customDialogClosed(session, dialogId, options)]);
    } finally {
      this.customScreens.delete(dialogId);
      component.dispose?.();
    }
  }

  /**
   * Run the extension's factory and require the shape a component must have.
   *
   * The factory arrives as `unknown` (it comes from the extension), so the check
   * is a type guard rather than a cast: a component that cannot render is a clear
   * error at the boundary instead of a crash inside the host later.
   */
  private async buildCustomScreen(factory: unknown, harness: { tui: object; keybindings: object }, done: (result: unknown) => void): Promise<CustomScreenComponent> {
    const built: unknown = await applyFactory(factory, [harness.tui, plainTextTheme, harness.keybindings, done]);
    if (!isCustomScreenComponent(built)) throw new Error("the extension's custom factory did not return a component");
    return built;
  }

  /** The wait that ends when the reader closes the screen instead of the component. */
  private async customDialogClosed(session: PiAgentSession, dialogId: string, options: { signal?: AbortSignal | undefined; timeout?: number | undefined }): Promise<unknown> {
    const dialog = this.pendingExtensionDialogStore.pendingDialogs(session.sessionId).find((candidate) => candidate.dialogId === dialogId);
    if (dialog === undefined) return undefined;
    const timeoutMs = effectiveExtensionDialogTimeoutMs(options.timeout, this.extensionDialogsTimeoutMs);
    const value = await this.dialogWaiters.park(dialog, {
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onTrigger: (reason) => {
        if (this.closeExtensionDialogFromTrigger(session.sessionId, dialog.dialogId, reason)) this.publishStatusForSessionId(session.sessionId);
      },
    });
    return value === undefined || value === "done" ? undefined : value;
  }

  /**
   * Whether a dialog opening now belongs to the run in flight, so the run's end or a Stop
   * settles it. A dialog an extension command opens is the command's even while a run goes
   * on beside it (B54, `CommandHandlerScope`).
   */
  private dialogRunScoped(session: PiAgentSession): boolean {
    return session.isStreaming && !this.commandHandlers.inHandler;
  }

  private openCustomDialog(
    session: PiAgentSession,
    lines: string[],
    openedBy: string | undefined,
    screen?: ExtensionDialogScreen,
  ): string {
    const dialog = this.openDialogRecord(session, {
      sessionId: session.sessionId,
      kind: "custom",
      title: screen === undefined ? "Extension screen" : screen.title ?? "Questions",
      // Who and what, in one line: the surface carried no title of its own and
      // "Extension screen" alone read as something unannounced.
      message: openedBy === undefined ? CUSTOM_SCREEN_HINT : `${openedBy} · ${CUSTOM_SCREEN_HINT}`,
      lines,
      ...(screen === undefined ? {} : { screen }),
      runScoped: this.dialogRunScoped(session),
    });
    const revision = this.nextDialogRevision(session.sessionId);
    this.events.publish(session.sessionId, { type: "dialog.opened", dialog, revision, daemonInstanceId: this.notificationStore.daemonInstanceId });
    this.publishStatus(session);
    return dialog.dialogId;
  }

  /**
   * Deliver a keypress to an open extension screen.
   *
   * Returns whether a screen was there to take it: a keystroke that arrives after
   * the component finished is the normal race, not an error.
   */
  async sendCustomScreenKey(ref: PiSessionRef, dialogId: string, key: string): Promise<boolean> {
    await this.assertWritable(ref);
    const session = await this.sessionForStatusOrDialogClose(ref);
    const handler = this.customScreens.get(dialogId);
    if (handler === undefined) return false;
    void session;
    handler(key);
    return true;
  }

  /**
   * Close a dialog whose wait ended without the browser (timeout, signal
   * abort, run end, runtime teardown) and settle its parked Promise. Returns
   * whether this call closed the dialog; a stale close means a browser answer
   * or an earlier trigger already settled everything.
   */
  private closeExtensionDialogFromTrigger(sessionId: string, dialogId: string, reason: ExtensionDialogCancelReason): boolean {
    const result = this.pendingExtensionDialogStore.cancel(sessionId, dialogId, reason);
    if (result.status !== "closed") return false;
    this.publishDialogClosed(sessionId, result.outcome);
    this.dialogWaiters.settleWithCancelValue(dialogId);
    return true;
  }

  /**
   * Settle the session's run-scoped dialogs as `"aborted"`. Runs at
   * abort-request time (a user abort parks the agent loop behind the dialog
   * handler, so `agent_end` would never arrive on its own) and again from
   * the `agent_end` observer as the run-crash backstop — the store makes the
   * second settlement a stale no-op. Idle-opened dialogs (a `session_start`
   * probe, say) and a command's dialogs, even one typed mid-run, are not
   * run-scoped and survive, because their waiter outlives the run.
   */
  private abortRunScopedExtensionDialogs(sessionId: string): void {
    let closedAny = false;
    for (const dialog of this.pendingExtensionDialogStore.pendingDialogs(sessionId)) {
      if (dialog.runScoped) closedAny = this.closeExtensionDialogFromTrigger(sessionId, dialog.dialogId, "aborted") || closedAny;
    }
    if (closedAny) this.publishStatusForSessionId(sessionId);
  }

  /**
   * Settle every dialog of the session as `"session-ended"`: the runtime
   * whose extension code is parked on them is being closed, replaced, or
   * disposed, so those Promises would otherwise never settle.
   */
  private endSessionExtensionDialogs(sessionId: string): void {
    let closedAny = false;
    for (const dialog of this.pendingExtensionDialogStore.pendingDialogs(sessionId)) {
      closedAny = this.closeExtensionDialogFromTrigger(sessionId, dialog.dialogId, "session-ended") || closedAny;
    }
    // Publishes only while the session is still (or already re-)registered as
    // active, so teardown paths stay silent and runtime replacement refreshes.
    if (closedAny) this.publishStatusForSessionId(sessionId);
  }

  private publishDialogClosed(sessionId: string, outcome: ExtensionDialogOutcome): void {
    this.events.publish(sessionId, {
      type: "dialog.closed",
      dialogId: outcome.dialogId,
      reason: outcome.reason,
      ...(outcome.answer === undefined ? {} : { answer: outcome.answer }),
      revision: this.nextDialogRevision(sessionId),
      daemonInstanceId: this.notificationStore.daemonInstanceId,
    });
  }

  /**
   * The interactive surface's next mutation revision - asks and dialogs share
   * one counter and one repair path on purpose: both are cards the same
   * status resync recovers, and a shared strict-+1 stream means a lost frame
   * of either kind is caught by whichever frame arrives next.
   */
  private nextDialogRevision(sessionId: string): number {
    const next = (this.dialogRevisionBySession.get(sessionId) ?? 0) + 1;
    this.dialogRevisionBySession.set(sessionId, next);
    return next;
  }

  /** The surface's current revision without mutating it; a status read is not a mutation. */
  private currentDialogRevision(sessionId: string): number {
    return this.dialogRevisionBySession.get(sessionId) ?? 0;
  }

  /**
   * Open a dialog's record, or tell the reader why it could not open. Content is never refused
   * (owner, 2026-10-04: show everything, as pi's terminal does); what remains is a dialog kind this
   * daemon does not know, which a newer pi could introduce. Then the extension's call rejects, and
   * the reader is told the way `notify` tells them: a row in the live transcript and a filed
   * notification (state-diagram D2, B10).
   */
  private openDialogRecord(session: PiAgentSession, input: PendingExtensionDialogOpenInput): PendingExtensionDialog {
    try {
      return this.pendingExtensionDialogStore.open(input);
    } catch (error) {
      if (error instanceof PendingExtensionDialogValidationError) this.reportRefusedDialog(session, error.message);
      throw error;
    }
  }

  private reportRefusedDialog(session: PiAgentSession, reason: string): void {
    const message = `An extension asked something PI WEB could not show: ${reason}.`;
    this.events.publish(session.sessionId, { type: "command.output", level: "error", message });
    this.fileSessionNotification(session, message, "error");
  }

  /** File a notification in the session's current generation, if it has one, and tell the browsers. */
  private fileSessionNotification(session: PiAgentSession, message: string, severity: "info" | "warning" | "error"): void {
    const generation = this.notificationGenerationBySession.get(session);
    if (generation === undefined) return;
    const added = this.notificationStore.addNotification(generation, message, severity);
    this.publishNotificationMutations(added.mutations);
  }

  /**
   * An answered dialog leaves no transcript: the answer went to extension
   * code, not to the model, so nothing in the conversation records what was
   * asked or what was chosen. The notification drawer is where this session's
   * settled facts live, so the answer is filed there too - through the same
   * store, dismissal path, and scope binding as every other notification.
   */
  private recordAnsweredDialogNotification(session: PiAgentSession, pending: PendingExtensionDialog | undefined, value: ExtensionDialogAnswer): void {
    if (pending === undefined) return;
    const title = pending.title.replace(/\s+/gu, " ").trim();
    const answer = dialogAnswerText(pending.screen, value);
    this.fileSessionNotification(session, `Answered "${title}": ${answer === "" ? (typeof value === "string" ? "an empty response" : "no answers") : answer}`, "info");
  }

  /**
   * Publish status for a session known only by id, as the ask tools are: they
   * run inside the session's own runtime, so the active entry is the session.
   */
  private publishStatusForSessionId(sessionId: string): void {
    const session = this.active.get(sessionId)?.runtime.session;
    if (session !== undefined) this.publishStatus(session);
  }

  /** Summaries of the tracked subsessions spawned by `parentSessionId`. */
  async listSubsessions(parentSessionId: string, parentSessionFile?: string): Promise<SubsessionSummary[]> {
    const parentFile = nonEmptyString(parentSessionFile);
    await this.hydrateSubsessionsForParent(parentSessionId, parentFile);
    const childIds = this.subsessionChildren.get(parentSessionId);
    if (childIds === undefined) return [];
    const authorizedChildIds = [...childIds].filter((childId) => this.subsessionLinkBelongsToParent(parentSessionId, parentFile, childId));
    return Promise.all(authorizedChildIds.map(async (childId) => ({ sessionId: childId, ...(await this.subsessionSummaryFields(childId)) })));
  }

  /** Status and final result of a subsession, scoped to the caller's children. */
  async checkSubsession(parentSessionId: string, sessionId: string, parentSessionFile?: string): Promise<SubsessionCheckResult> {
    const session = await this.openSubsession(parentSessionId, sessionId, parentSessionFile);
    const messages = historyMessages(session);
    return {
      sessionId,
      cwd: session.sessionManager.getCwd(),
      status: this.subsessionStatus(session),
      finalText: finalAssistantText(messages),
      messageCount: messages.length,
    };
  }

  /** Filtered, paginated transcript of a subsession, scoped to the caller's children. */
  async readSubsession(parentSessionId: string, sessionId: string, query: SubsessionReadQuery, parentSessionFile?: string): Promise<SubsessionReadResult> {
    const session = await this.openSubsession(parentSessionId, sessionId, parentSessionFile);
    const view = buildTranscriptView(historyMessages(session), query);
    return {
      sessionId,
      cwd: session.sessionManager.getCwd(),
      status: this.subsessionStatus(session),
      ...view,
    };
  }

  /** Open a session after verifying it is one of the caller's tracked children. */
  private async openSubsession(parentSessionId: string, sessionId: string, parentSessionFile?: string): Promise<PiAgentSession> {
    const parentFile = nonEmptyString(parentSessionFile);
    await this.hydrateSubsessionsForParent(parentSessionId, parentFile);
    if (this.subsessionParents.get(sessionId) !== parentSessionId || !this.subsessionLinkBelongsToParent(parentSessionId, parentFile, sessionId)) {
      throw new Error(`Session ${sessionId} is not one of your subsessions`);
    }
    return this.getOrOpenTrackedSubsession(sessionId);
  }

  private subsessionLinkBelongsToParent(parentSessionId: string, parentSessionFile: string | undefined, childSessionId: string): boolean {
    const link = this.subsessionLinks.get(childSessionId);
    if (link?.parentSessionId !== parentSessionId) return false;
    return parentSessionFile === undefined || trackedLinkParentFileMatches(link, parentSessionFile);
  }

  private activeChildForSubsessionLink(link: TrackedSubsessionLink): ActiveSession<PiSessionRuntime> | undefined {
    const active = this.active.get(link.childSessionId);
    if (active === undefined) return undefined;
    return activeSessionFileMatches(active, link.childSessionFile) ? active : undefined;
  }

  private activeParentForSubsessionLink(link: TrackedSubsessionLink): ActiveSession<PiSessionRuntime> | undefined {
    const active = this.active.get(link.parentSessionId);
    if (active === undefined) return undefined;
    return activeSessionFileMatches(active, link.parentSessionFile) ? active : undefined;
  }

  private subsessionLinkForActiveChild(session: PiAgentSession): TrackedSubsessionLink | undefined {
    const childId = session.sessionId;
    const parentId = this.subsessionParents.get(childId);
    const link = this.subsessionLinks.get(childId);
    if (parentId === undefined || link?.parentSessionId !== parentId) return undefined;
    return sessionFileMatches(session, link.childSessionFile) ? link : undefined;
  }

  private async registerVerifiedSubsession(link: TrackedSubsessionLink): Promise<void> {
    const { childSessionId, parentSessionId } = link;
    const previousParentId = this.subsessionParents.get(childSessionId);
    if (previousParentId !== undefined && previousParentId !== parentSessionId) {
      const previousChildren = this.subsessionChildren.get(previousParentId);
      previousChildren?.delete(childSessionId);
      if (previousChildren?.size === 0) this.subsessionChildren.delete(previousParentId);
    }

    this.subsessionParents.set(childSessionId, parentSessionId);
    const children = this.subsessionChildren.get(parentSessionId) ?? new Set<string>();
    children.add(childSessionId);
    this.subsessionChildren.set(parentSessionId, children);

    this.subsessionLinks.set(childSessionId, link);
    if (!this.subsessionNotifyArmed.has(childSessionId)) this.subsessionNotifyArmed.set(childSessionId, false);

    const cwd = this.cwdForVerifiedSubsession(link);
    await this.publishUnreadMutations(this.unreadStore.excludeSession(childSessionId, cwd));
  }

  private cwdForVerifiedSubsession(link: TrackedSubsessionLink): string {
    const activeCwd = this.activeChildForSubsessionLink(link)?.runtime.session.sessionManager.getCwd();
    const linkedCwd = nonEmptyString(activeCwd) ?? nonEmptyString(link.cwd);
    if (linkedCwd !== undefined) return canonicalizeStoredCwd(linkedCwd);

    const childSessionFile = link.childSessionFile;
    if (childSessionFile !== undefined) {
      try {
        return canonicalizeStoredCwd(this.sessionManager.open(childSessionFile).getCwd());
      } catch (error: unknown) {
        throw new Error("Could not resolve cwd for verified tracked sub-session", { cause: error });
      }
    }
    throw new Error("Could not resolve cwd for verified tracked sub-session");
  }

  private unregisterSubsession(childSessionId: string): void {
    const parentSessionId = this.subsessionParents.get(childSessionId);
    this.subsessionParents.delete(childSessionId);
    this.subsessionLinks.delete(childSessionId);
    this.subsessionNotifyArmed.delete(childSessionId);
    if (parentSessionId === undefined) return;
    const children = this.subsessionChildren.get(parentSessionId);
    children?.delete(childSessionId);
    if (children?.size === 0) this.subsessionChildren.delete(parentSessionId);
  }

  private persistSubsessionLink(link: TrackedSubsessionLink): void {
    const parent = this.activeParentForSubsessionLink(link)?.runtime.session;
    if (parent === undefined) return;
    if (parent.sessionManager.appendCustomEntry === undefined) return;
    try {
      parent.sessionManager.appendCustomEntry(SUBSESSION_LINK_CUSTOM_TYPE, persistedParentSubsessionLinkData(link));
    } catch (error: unknown) {
      this.logger.info(
        { parentSessionId: link.parentSessionId, sessionId: link.childSessionId, error: error instanceof Error ? error.message : String(error) },
        "failed to persist subsession link",
      );
    }
  }

  private persistSubsessionChildMarker(parentSessionId: string, childSessionId: string): void {
    const child = this.active.get(childSessionId)?.runtime.session;
    if (child === undefined) return;
    if (child.sessionManager.appendCustomEntry === undefined) return;
    try {
      child.sessionManager.appendCustomEntry(SUBSESSION_CHILD_LINK_CUSTOM_TYPE, persistedChildSubsessionLinkData(parentSessionId, childSessionId));
    } catch (error: unknown) {
      this.logger.info(
        { parentSessionId, sessionId: childSessionId, error: error instanceof Error ? error.message : String(error) },
        "failed to persist subsession child marker",
      );
    }
  }

  private async hydrateSubsessionsForParent(parentSessionId: string, parentSessionFile?: string): Promise<void> {
    const hydrationKey = subsessionHydratedParentKey(parentSessionId, parentSessionFile);
    if (this.subsessionHydratedParents.has(hydrationKey)) return;

    const activeParent = this.active.get(parentSessionId);
    if (activeParent !== undefined && (parentSessionFile === undefined || activeSessionFileMatches(activeParent, parentSessionFile))) {
      const activeParentFile = nonEmptyString(activeParent.runtime.session.sessionFile);
      const complete = await this.registerPersistedSubsessionLinks(
        parentSessionId,
        activeParent.runtime.session.sessionManager,
        activeParentFile,
      );
      if (complete) this.subsessionHydratedParents.add(hydrationKey);
      return;
    }

    if (parentSessionFile === undefined) return;
    if ((await readSessionHeaderSummary(parentSessionFile))?.id !== parentSessionId) return;

    let parentManager: PiSessionManager;
    try {
      parentManager = this.sessionManager.open(parentSessionFile);
    } catch {
      return;
    }
    const complete = await this.registerPersistedSubsessionLinks(parentSessionId, parentManager, parentSessionFile);
    if (complete) this.subsessionHydratedParents.add(hydrationKey);
  }

  private async registerPersistedSubsessionLinks(parentSessionId: string, parentManager: PiSessionManager, parentSessionFile: string | undefined): Promise<boolean> {
    // Parent custom links are the authoritative recovery record: verify the
    // exact live child file/header before tracking. Do not negatively cache a
    // scan while a candidate child is temporarily unavailable.
    const entries = parentManager.getEntries?.() ?? parentManager.getBranch();
    let complete = true;
    for (const entry of entries) {
      const link = parsePersistedParentSubsessionLink(entry);
      if (link?.spawnedBySessionId !== parentSessionId) continue;
      const verified = await this.verifiedSubsessionLinkFromParentLink(parentSessionId, parentSessionFile, link);
      if (verified === undefined) {
        complete = false;
        continue;
      }
      await this.registerVerifiedSubsession(verified);
    }
    return complete;
  }

  private async verifiedSubsessionLinkFromParentLink(parentSessionId: string, parentSessionFile: string | undefined, link: PersistedParentSubsessionLink): Promise<TrackedSubsessionLink | undefined> {
    if (parentSessionFile === undefined) return undefined;
    if (link.spawnedBySessionId !== parentSessionId) return undefined;
    if (!(await this.parentLinkHasValidChildTarget(parentSessionFile, link))) return undefined;
    return trackedSubsessionLinkFromParentLink(parentSessionId, link, parentSessionFile);
  }

  private async parentLinkHasValidChildTarget(parentSessionFile: string, link: PersistedParentSubsessionLink): Promise<boolean> {
    return link.spawnedSessionFile !== undefined
      && await sessionFileHeaderMatches(link.spawnedSessionFile, { sessionId: link.spawnedSessionId, parentSessionFile });
  }

  private async recoverSubsessionTrackingForOpenedSession(session: PiAgentSession): Promise<void> {
    const link = await this.verifiedSubsessionLinkFromOpenedChild(session);
    if (link === undefined) return;
    await this.registerVerifiedSubsession(link);
  }

  private verifiedSubsessionLinkFromOpenedChild(session: PiAgentSession): Promise<TrackedSubsessionLink | undefined> {
    return verifiedTrackedSubsessionLink(this.sessionManager, {
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      sessionManager: session.sessionManager,
      cwd: session.sessionManager.getCwd(),
    });
  }

  private async getOrOpenTrackedSubsession(sessionId: string): Promise<PiAgentSession> {
    const link = this.subsessionLinks.get(sessionId);
    if (link === undefined) throw new SessionNotFoundError();

    const active = this.activeChildForSubsessionLink(link);
    if (active !== undefined) return active.runtime.session;

    if (link.childSessionFile !== undefined) {
      if (!(await sessionFileHeaderMatches(link.childSessionFile, { sessionId, parentSessionFile: link.parentSessionFile }))) throw new SessionNotFoundError();
      const sessionManager = this.sessionManager.open(link.childSessionFile);
      return (await this.create(sessionManager, link.cwd ?? sessionManager.getCwd())).runtime.session;
    }

    throw new SessionNotFoundError();
  }

  private async subsessionSummaryFields(childSessionId: string): Promise<{ cwd: string; status: SubsessionStatus }> {
    const link = this.subsessionLinks.get(childSessionId);
    const active = link === undefined ? undefined : this.activeChildForSubsessionLink(link);
    if (active !== undefined) {
      return { cwd: active.runtime.cwd, status: this.subsessionStatus(active.runtime.session) };
    }
    if (link?.childSessionFile !== undefined && (await sessionFileHeaderMatches(link.childSessionFile, { sessionId: childSessionId, parentSessionFile: link.parentSessionFile }))) {
      return { cwd: link.cwd ?? "", status: "idle" };
    }
    if (link?.cwd !== undefined) return { cwd: link.cwd, status: "unknown" };
    return { cwd: "", status: "unknown" };
  }

  private subsessionStatus(session: PiAgentSession): SubsessionStatus {
    if (this.hasActiveWork(session)) return "working";
    if (this.activities.get(session.sessionId)?.phase === "error") return "error";
    return "idle";
  }

  private workingSubsessionIds(parentSessionId: string): string[] {
    const childIds = this.subsessionChildren.get(parentSessionId);
    if (childIds === undefined) return [];
    return [...childIds].filter((childId) => {
      const link = this.subsessionLinks.get(childId);
      const active = link === undefined ? undefined : this.activeChildForSubsessionLink(link);
      return active !== undefined && this.hasActiveWork(active.runtime.session);
    });
  }

  /**
   * Drive parent notifications from a tracked child's status. Arms a pending
   * notification while the child is working, and when it stops fires a single
   * follow-up message to the parent via {@link prompt} (which queues if the
   * parent is busy and delivers immediately when it is idle).
   */
  private updateSubsessionTracking(session: PiAgentSession): void {
    const link = this.subsessionLinkForActiveChild(session);
    if (link === undefined) return;
    const childId = link.childSessionId;
    if (this.hasActiveWork(session)) {
      this.subsessionNotifyArmed.set(childId, true);
      return;
    }
    if (this.subsessionNotifyArmed.get(childId) !== true) return;
    this.subsessionNotifyArmed.set(childId, false);
    const status: SubsessionStatus = this.activities.get(childId)?.phase === "error" ? "error" : "idle";
    const finalText = finalAssistantText(historyMessages(session));
    const outputSection = formatSubsessionNotificationOutput(childId, finalText);
    const workingIds = this.workingSubsessionIds(link.parentSessionId);
    const next = workingIds.length === 0
      ? "No other tracked subsessions are working."
      : `Still working: ${workingIds.join(", ")}. Further completion notices arrive automatically; do not poll.`;
    const text = `Subsession ${childId} stopped working (${status}).\n${next}\n\n${outputSection}`;
    void this.notifyParentOfSubsession(link.parentSessionId, childId, text);
  }

  private async getOrOpenParentForSubsession(parentSessionId: string, childSessionId: string): Promise<PiAgentSession> {
    const link = this.subsessionLinks.get(childSessionId);
    if (link?.parentSessionId !== parentSessionId) throw new Error(`Parent session ${parentSessionId} is not available for subsession notification`);

    const active = this.activeParentForSubsessionLink(link);
    if (active !== undefined) return active.runtime.session;

    const parentSessionFile = link.parentSessionFile;
    if (parentSessionFile === undefined) throw new Error(`Parent session ${parentSessionId} is not available for subsession notification`);
    if ((await readSessionHeaderSummary(parentSessionFile))?.id !== parentSessionId) {
      throw new Error(`Parent session ${parentSessionId} is not available for subsession notification`);
    }
    const sessionManager = this.sessionManager.open(parentSessionFile);
    return (await this.create(sessionManager, sessionManager.getCwd())).runtime.session;
  }

  /**
   * Deliver a subsession-completion notice to the parent as a system-authored
   * custom message rather than a user message, so it is not attributed to the
   * human in the transcript. It wakes an idle parent and reaches a running one
   * at its next injection point (`AGENT_NOTICE_DELIVERY`, B26).
   */
  private async notifyParentOfSubsession(parentId: string, childId: string, text: string): Promise<void> {
    try {
      const session = await this.getOrOpenParentForSubsession(parentId, childId);
      if (this.treeNavigations.has(session)) {
        const pending = this.deferredSubsessionNotifications.get(session) ?? [];
        pending.push({ parentId, childId, text });
        this.deferredSubsessionNotifications.set(session, pending);
        return;
      }
      await this.deliverSubsessionNotification(session, { parentId, childId, text });
    } catch (error: unknown) {
      this.logSubsessionNotificationFailure(parentId, childId, error);
    }
  }

  private async deliverSubsessionNotification(session: PiAgentSession, notification: DeferredSubsessionNotification): Promise<void> {
    await this.runSessionEntryMutation(session, "deliver a subsession notification", () => session.sendCustomMessage(
      { customType: SUBSESSION_NOTIFICATION_CUSTOM_TYPE, content: notification.text, display: true, details: { sessionId: notification.childId } },
      AGENT_NOTICE_DELIVERY,
    ));
    this.publishStatus(session);
  }

  private logSubsessionNotificationFailure(parentId: string, childId: string, error: unknown): void {
    this.logger.info(
      { parentSessionId: parentId, sessionId: childId, error: error instanceof Error ? error.message : String(error) },
      "failed to notify parent of subsession completion",
    );
  }

  async messages(ref: PiSessionRef, page?: { before?: number; limit?: number }): Promise<ClientMessagePage> {
    const open = this.activeForRef(ref)?.runtime.session;
    if (open !== undefined) return transcriptPage(open.sessionManager.getBranch(), page);
    const closed = await this.closedSessionFile(ref);
    const branch = closed === undefined ? undefined : await closedBranch(closed.path);
    if (branch !== undefined) return transcriptPage(branch, page);
    const session = await this.getOrOpen(ref);
    return transcriptPage(session.sessionManager.getBranch(), page);
  }

  /**
   * The file a closed session is read from (state-diagram D5, "Reading a closed session never
   * opens it"): its archive file when it is archived in this directory, else its session file
   * there, in the order `getActive` would open them. Undefined: neither holds it. A runtime still
   * closing can write its last entries (steers it took back, the aborted reply) after it has left
   * the active map, so the read waits for that close to finish first.
   */
  private async closedSessionFile(ref: PiSessionRef): Promise<{ readonly id: string; readonly path: string } | undefined> {
    await this.closingSessions.get(ref.id)?.catch(() => undefined);
    const archived = await this.getArchived(ref);
    if (archived?.archivePath !== undefined) return { id: archived.sessionId, path: archived.archivePath };
    const file = await this.sessionManager.resolveSessionFile(ref.cwd, ref.id);
    return file === undefined ? undefined : { id: file.id, path: file.path };
  }

  /**
   * A status read, stamped with the session stream's position in the same tick it is computed,
   * so a browser can tell it from a status frame published after it.
   */
  async status(ref: PiSessionRef): Promise<ClientSessionStatus> {
    const session = await this.sessionForStatusOrDialogClose(ref);
    return { ...this.statusFromSession(session), streamPosition: this.streamPosition(session.sessionId) };
  }

  /**
   * Where a session's stream stands now. A status read carries it, and so does the machine-wide
   * copy of a status frame - that socket has no per-session seq, and without the position its
   * copy could land after a newer read and overwrite it.
   */
  /**
   * Where a held session's transcript stands, for the heartbeat (docs/design/sync-convergence.md).
   *
   * Only an appended entry changes the projection, and every append moves pi's leaf, so the head
   * is cached by leaf: a heartbeat on a 69k-entry branch does not walk it again. Keyed by the
   * session manager, so a reopened session starts a fresh entry. Undefined when the daemon does
   * not hold the session: a head it cannot see is unknown, not empty.
   */
  transcriptHeadFor(sessionId: string): TranscriptHead | undefined {
    const manager = this.active.get(sessionId)?.runtime.session.sessionManager;
    if (manager === undefined) return undefined;
    const leafId = manager.getLeafId();
    const cached = this.transcriptHeads.get(manager);
    if (cached?.leafId === leafId) return cached.head;
    const head = transcriptHead(branchTranscript(manager.getBranch()));
    this.transcriptHeads.set(manager, { leafId, head });
    return head;
  }

  private streamPosition(sessionId: string): { seq: number; epoch: string } {
    return { seq: this.events.currentSeq(sessionId), epoch: this.events.currentEpoch(sessionId) };
  }

  /**
   * The passive listing a plugin reads through the transcript port: the same
   * scanner rows the browser listing starts from, with none of its
   * reconciliation. Listing for a browser is an attended act and may retire
   * stale unread and activity rows; a plugin scanning on a timer must not.
   */
  async listPassive(cwd: string): Promise<ClientSession[]> {
    const [sessions, archivedRecords] = await Promise.all([this.sessionManager.list(cwd), this.archiveStore.list()]);
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const archivedForCwd = archivedRecords.filter((record) => record.cwd === cwd);
    const archivedById = new Map(archivedForCwd.map((record) => [record.sessionId, record]));
    const unarchived = sessions.filter((session) => !archivedById.has(session.id)).map(clientSessionFromListEntry);
    const archived = archivedForCwd.sort(compareArchivedRecords).map((record) => clientSessionFromArchivedRecord(record, sessionsById.get(record.sessionId)));
    return [...unarchived, ...archived.filter((session): session is ClientSession => session !== undefined)];
  }

  /**
   * A transcript page read from the session file without opening the
   * session: no runtime, no extensions, no activity. An open session answers
   * from its live entries so a plugin sees what the browser sees; a closed
   * one is read from disk. Undefined means the file is unreadable or gone -
   * not an empty session.
   */
  async messagesPassive(ref: PiSessionRef, page?: { before?: number; limit?: number }): Promise<ClientMessagePage | undefined> {
    const active = this.activeForRef(ref);
    if (active !== undefined) return transcriptPage(active.runtime.session.sessionManager.getBranch(), page);
    const listed = await this.sessionManager.findSession(ref.cwd, ref.id);
    if (listed === undefined) return undefined;
    const entries = await readSessionFileEntries(listed.path);
    if (entries === undefined) return undefined;
    migrateSessionEntries(entries);
    return transcriptPage(branchFromFileEntries(entries), page);
  }

  /**
   * The last transcript page and the stream position it is current through,
   * without waiting for the runtime (object model §1.7, P2 slice c).
   *
   * Opening the runtime of a 17.8 MB session takes 1.2-1.8 s; reading and
   * parsing its file takes about 60 ms. An open runtime answers from memory in
   * one tick, like `streamSnapshot`. A closed session is read from its file on
   * the branch the runtime would load, with the stream position taken before
   * the read, so every later frame replays on top. A session whose file is not
   * in its cwd's store (archived, or recorded elsewhere) takes the runtime
   * path, which answers the typed error for a missing one.
   */
  async transcriptTail(ref: PiSessionRef, page?: { limit?: number }): Promise<SessionTranscriptTail> {
    const open = this.activeForRef(ref)?.runtime.session;
    if (open !== undefined) return { page: transcriptPage(open.sessionManager.getBranch(), page), stream: this.streamSnapshotOf(open) };
    const file = await this.closedSessionFile(ref);
    const stream = file === undefined ? undefined : { ...this.streamPosition(file.id), partial: null };
    const branch = file === undefined ? undefined : await closedBranch(file.path);
    if (stream === undefined || branch === undefined) return { page: await this.messages(ref, page), stream: await this.streamSnapshot(ref) };
    return { page: transcriptPage(branch, page), stream };
  }

  /** The bytes behind a deferred tool-result image, read from the session file on demand. */
  async toolResultImage(ref: PiSessionRef, toolCallId: string, index: number): Promise<{ mimeType: string; data: string } | undefined> {
    const session = await this.getOrOpen(ref);
    const entries = session.sessionManager.getEntries?.() ?? session.sessionManager.getBranch();
    return findToolResultImage(entries, toolCallId, index);
  }

  /**
   * Join-time snapshot of the in-flight assistant stream. The `seq` watermark and
   * the partial are read together in one synchronous tick (no await between the
   * `currentSeq` read and the `state.streamingMessage` read) so a joining client
   * can seed the partial and then apply only buffered live events with
   * `seq > snapshot.seq`. The partial is browser-projected to strip thinking
   * signatures; it is `null` when no assistant message is mid-stream.
   */
  async streamSnapshot(ref: PiSessionRef): Promise<SessionStreamSnapshot> {
    return this.streamSnapshotOf(await this.getOrOpen(ref));
  }

  private streamSnapshotOf(session: PiAgentSession): SessionStreamSnapshot {
    // Single consistent tick: capture the watermark and the partial together so
    // the seq matches the partial the client seeds against.
    const seq = this.events.currentSeq(session.sessionId);
    const epoch = this.events.currentEpoch(session.sessionId);
    const streamingMessage = session.state.streamingMessage;
    const partial = streamingMessage === undefined || streamingMessage === null
      ? null
      : annotateAssistantThinkingLevel(projectBrowserMessage(streamingMessage), session.thinkingLevel);
    return { seq, epoch, partial };
  }

  /**
   * Gap repair for a client that last saw `sinceSeq`. The hub's replay state
   * decides: frames it still holds come back exactly as live; anything else
   * answers resync and the client falls back to the full snapshot read.
   * `getOrOpen` precedes the ring read, so the verdict can never describe a
   * session other than the one the ref named.
   */
  async streamSync(ref: PiSessionRef, sinceSeq: number, epoch?: string): Promise<SessionStreamSync> {
    const session = await this.getOrOpen(ref);
    const missed = this.events.replaySince(session.sessionId, sinceSeq, epoch);
    if (missed.verdict === "resync") return { kind: "resync", sinceSeq };
    return { kind: "replay", sinceSeq, frames: missed.frames };
  }

  async availableModels(ref: PiSessionRef): Promise<ClientSessionModel[]> {
    const session = await this.getOrOpen(ref);
    const models = await this.sessionModelCandidates(session);
    // Account aliases are not synthesised here. The multi-account extension
    // registers each `anthropic-<account>` as a real provider, so they arrive
    // with the runtime's own models; fabricating them from pi-accounts.json as
    // well would offer entries that cannot resolve when the extension is absent.
    return models.map(modelToClientModel);
  }

  async modelCatalog(ref: PiSessionRef): Promise<ClientSessionModelCatalogEntry[]> {
    const session = await this.getOrOpen(ref);
    return (await this.enabledModelCatalog(session)).map(catalogEntryToClientModel);
  }

  /**
   * Add/remove one model to/from pi's `enabledModels` scope, the way pi's own
   * models selector does: the checkbox edit applies to the effective enabled
   * ids (live scope, else configured patterns, else all), persists through the
   * session's `SettingsManager` with pi's "everything enabled" → `undefined`
   * normalization, and updates the live session's cycling scope so the change
   * takes effect without a session restart. Scope is selection UX only — never
   * an authorization boundary. Returns the updated full catalog.
   */
  async setModelEnabled(ref: PiSessionRef, provider: string, modelId: string, enabled: boolean): Promise<ClientSessionModelCatalogEntry[]> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertTreeNavigationInactive(session, "change enabled models");
    await session.modelRuntime.refresh({ allowNetwork: false });
    const currentIds = await resolveEnabledModelIds(sessionScopeSource(session));
    const available = session.modelRuntime.getAvailableSnapshot();
    const availableIds = available.map(modelScopeId);
    const targetId = `${provider}/${modelId}`;
    if (!availableIds.includes(targetId)) throw new Error(`Model not found: ${targetId}`);
    const nextIds = applyEnabledModelToggle(currentIds, availableIds, targetId, enabled);
    this.assertTreeNavigationInactive(session, "change enabled models");
    if (nextIds !== currentIds) {
      // Decide the live scope before writing so a failure cannot leave the
      // persisted patterns and the session scope disagreeing about the edit.
      const scopeIds = liveScopedModelIds(nextIds, availableIds);
      const modelsById = new Map(available.map((model) => [modelScopeId(model), model]));
      // nextIds holds canonical `provider/id` keys plus possibly stale patterns
      // that matched nothing on this same catalog, so exact lookup resolves the
      // scope exactly the way pi's resolver would (unknown ids drop out).
      const scoped = scopeIds === null
        ? []
        : scopeIds.flatMap((id) => {
          const model = modelsById.get(id);
          return model === undefined ? [] : [{ model }];
        });
      session.settingsManager.setEnabledModels(persistedEnabledModelPatterns(nextIds, availableIds));
      session.setScopedModels(scoped);
    }
    // Respond from a fresh post-edit read (settings + live scope) so the
    // response is exactly what GET models/catalog returns after the edit,
    // including pi's normalizations (re-enabling everything collapses the
    // scope, and an emptied list reads back as "all enabled").
    return (await this.enabledModelCatalog(session)).map(catalogEntryToClientModel);
  }

  async setModel(ref: PiSessionRef, provider: string, modelId: string): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertTreeNavigationInactive(session, "change models");
    // An `anthropic-<account>` provider is kept as the session's provider
    // rather than being rewritten to the canonical one. The extension registers
    // each alias as a real provider bound to exactly that account, so keeping it
    // pins this session to that account.
    //
    // This used to rewrite the global active account instead. That made the
    // choice machine-wide: every other session silently followed, and a session
    // used whichever account happened to be active when its request went out,
    // so a concurrent switch could fail an unrelated session with a 401.
    const candidates = await this.sessionModelCandidates(session);
    this.assertTreeNavigationInactive(session, "change models");
    const model = candidates.find((candidate) => candidate.provider === provider && candidate.id === modelId)
      ?? session.modelRuntime.getModel(provider, modelId);
    if (model === undefined) throw new Error(`Model not found: ${provider}/${modelId}`);
    await this.runSessionEntryMutation(session, "change models", () => session.setModel(model));
    this.publishActivity(session, `model: ${model.id}`, "idle", model.provider);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async cycleModel(ref: PiSessionRef, direction: "forward" | "backward"): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    const result = await this.runSessionEntryMutation(session, "change models", () => session.cycleModel(direction));
    if (result === undefined) throw new Error(session.scopedModels.length > 0 ? "Only one model in scope" : "Only one model available");
    this.publishActivity(session, `model: ${result.model.id}`, "idle", result.model.provider);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async availableThinkingLevels(ref: PiSessionRef): Promise<ClientThinkingLevel[]> {
    const session = await this.getOrOpen(ref);
    return session.getAvailableThinkingLevels();
  }

  async setThinkingLevel(ref: PiSessionRef, level: string): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertTreeNavigationInactive(session, "change the thinking level");
    // pi owns the valid set; validate against the session's live levels rather
    // than a hardcoded union so this stays correct if pi changes the set.
    const available = session.getAvailableThinkingLevels();
    const match = available.find((candidate) => candidate === level);
    if (match === undefined) throw new Error(`Invalid thinking level: ${level}`);
    session.setThinkingLevel(match);
    this.publishActivity(session, `thinking: ${session.thinkingLevel}`, "idle");
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  async cycleThinkingLevel(ref: PiSessionRef): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertTreeNavigationInactive(session, "change the thinking level");
    const level = session.cycleThinkingLevel();
    if (level === undefined) throw new Error("Current model does not support thinking");
    this.publishActivity(session, `thinking: ${level}`, "idle");
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  /**
   * Web-facing view of the subsessions this session spawned.
   *
   * The agent tools get list/check/read keyed by parent file; the browser only
   * has the parent's ref, so it is resolved here first. A session whose
   * subsessions are not tracked simply has none to show, which also covers a
   * deployment where the feature is disabled.
   */
  async subsessions(ref: PiSessionRef): Promise<SubsessionSummary[]> {
    const session = await this.getOrOpen(ref);
    return this.listSubsessions(session.sessionId, session.sessionManager.getSessionFile());
  }

  /**
   * Start an independent session from this one: the spawn route. The new session
   * inherits this session's model and thinking level unless a `provider/model-id`
   * is requested, exactly as the retired `spawn_session` tool read them.
   */
  async spawnFromSession(ref: PiSessionRef, request: DelegationRequest & { cwd?: string }): Promise<SpawnSessionResult> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    return this.spawnSession({
      spawningCwd: session.sessionManager.getCwd(),
      spawningSessionId: session.sessionId,
      prompt: request.prompt,
      cwd: request.cwd,
      ...inheritedModelFields(session, request.model),
    });
  }

  /** Start a tracked child of this session in its own workspace: the subsession route. */
  async spawnSubsessionFromSession(ref: PiSessionRef, request: DelegationRequest): Promise<SpawnSubsessionResult> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    return this.spawnSubsession({
      spawningCwd: session.sessionManager.getCwd(),
      parentSessionId: session.sessionId,
      parentSessionFile: session.sessionManager.getSessionFile(),
      prompt: request.prompt,
      ...inheritedModelFields(session, request.model),
    });
  }

  /** One tracked child's status and last reply, scoped to this session's children. */
  async subsessionCheck(ref: PiSessionRef, childSessionId: string): Promise<SubsessionCheckResult> {
    const session = await this.getOrOpen(ref);
    return this.checkSubsession(session.sessionId, childSessionId, session.sessionManager.getSessionFile());
  }

  /** One tracked child's filtered, paged transcript, scoped to this session's children. */
  async subsessionTranscript(ref: PiSessionRef, childSessionId: string, query: SubsessionReadQuery): Promise<SubsessionReadResult> {
    const session = await this.getOrOpen(ref);
    return this.readSubsession(session.sessionId, childSessionId, query, session.sessionManager.getSessionFile());
  }

  async subagentRunOutput(ref: PiSessionRef, runId: string): Promise<string | undefined> {
    const session = await this.getOrOpen(ref);
    const sessionFile = session.sessionManager.getSessionFile();
    if (sessionFile === undefined) return undefined;
    // The run directories sit next to the session file, under a directory named
    // after it, so a run with no artifact can still be read from its transcript.
    return readSubagentRunOutput(dirname(sessionFile), runId, { parentSessionId: basename(sessionFile, ".jsonl") });
  }

  /**
   * A child run's conversation, in the shape the chat view already renders.
   *
   * The transcript is an ordinary session file, so it is projected with the
   * same walk as a live session rather than a second projection written for
   * children. Pi does not hold the child open - the run may still be writing,
   * and its process is owned by the subagent tool - so this reads the file
   * rather than registering a session.
   */
  async subagentRunMessages(ref: PiSessionRef, runId: string, page?: { before?: number; limit?: number }): Promise<ClientMessagePage | undefined> {
    const session = await this.getOrOpen(ref);
    const sessionFile = session.sessionManager.getSessionFile();
    if (sessionFile === undefined) return undefined;
    const transcript = await findSubagentRunTranscript(dirname(sessionFile), runId, { parentSessionId: basename(sessionFile, ".jsonl") });
    if (transcript === undefined) return undefined;
    const entries = await readSessionEntries(transcript);
    if (entries === undefined) return undefined;
    // Two kinds of child write two different files under names that look alike;
    // the records say which this is. See subagentRunTranscript.ts.
    return pageMessagesAtSafeBoundary(runTranscriptMessages(entries, historyMessagesFromEntries), page);
  }

  /**
   * Subagent-tool runs for this session. The directory they live in is the one
   * holding the session file, so it is derived from the session rather than
   * recomputed from the cwd - the encoding of a cwd into a directory name
   * belongs to the agent, not here.
   */
  async subagentRuns(ref: PiSessionRef): Promise<SessionSubagentRunInfo[]> {
    const session = await this.getOrOpen(ref);
    const sessionFile = session.sessionManager.getSessionFile();
    if (sessionFile === undefined) return [];
    // Keyed on the session *file* name, not the session id. The subagent tool
    // names its run directory after the transcript file - the timestamped form,
    // "2026-08-20T17-27-53-830Z_01a0...". Looking it up by the bare id found
    // nothing on every real session, and the unit tests missed it because they
    // built the fixture with the same key they read it back with: self
    // consistent, and wrong about the disk.
    // The parent's own state settles what a silent child means: while the turn
    // that spawned them is still running, a run without a result is still
    // running too, however long it has been thinking.
    return listSubagentRuns(dirname(sessionFile), basename(sessionFile, ".jsonl"), Date.now(), { parentActive: session.isStreaming });
  }

  /**
   * Background-task runs for this session.
   *
   * Keyed on the transcript rather than the task tool's own directory: that
   * directory is named after the server process, so every session in this
   * server shares it and the records carry no session field. The transcript
   * records each task's output path when it starts, which is what makes the
   * answer per session rather than per server.
   */
  async backgroundTasks(ref: PiSessionRef): Promise<SessionBackgroundTaskInfo[]> {
    const open = this.activeForRef(ref)?.runtime.session;
    if (open !== undefined) {
      const sessionFile = open.sessionManager.getSessionFile();
      return sessionFile === undefined ? [] : listBackgroundTasks(ref.cwd, sessionFile);
    }
    const closed = await this.closedSessionFile(ref);
    if (closed === undefined) throw new SessionNotFoundError();
    return listBackgroundTasks(ref.cwd, closed.path);
  }

  async backgroundTaskOutput(ref: PiSessionRef, taskId: string): Promise<string | undefined> {
    return readTaskOutput(ref.cwd, taskId);
  }

  async commands(ref: PiSessionRef): Promise<ClientCommand[]> {
    const session = await this.getOrOpen(ref);
    const commands: ClientCommand[] = [...BUILTIN_COMMANDS];
    for (const command of session.extensionRunner.getRegisteredCommands()) {
      commands.push({ name: command.invocationName, ...(command.description === undefined ? {} : { description: command.description }), source: "extension" });
    }
    for (const template of session.promptTemplates) {
      commands.push({ name: template.name, ...(template.description === undefined ? {} : { description: template.description }), source: "prompt" });
    }
    for (const skill of session.resourceLoader.getSkills().skills) {
      commands.push({ name: `skill:${skill.name}`, ...(skill.description === undefined ? {} : { description: skill.description }), source: "skill" });
    }
    return commands.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Accept a prompt into the session's inbox. Nothing here hands it to the runtime: the inbox
   * consumer does, in acceptance order (`pumpInbox`).
   *
   * Acceptance runs on a per-session chain joined synchronously at call time, so two requests
   * are accepted in the order they reached the daemon even when the first carries a photo that
   * takes longer to decode.
   */
  /**
   * Open every session whose inbox still holds prompts, so they reach the agent without waiting
   * for someone to open the session in a browser (ordering F8). Opening restores the inbox and
   * nudges its consumer; a session that cannot be opened keeps its file for the next attempt.
   */
  async resumeWaitingInboxes(): Promise<string[]> {
    if (this.inboxDataDir === undefined) return [];
    const resumed: string[] = [];
    for (const { sessionId, cwd } of await listWaitingInboxes(this.inboxDataDir)) {
      try {
        if (await this.getArchived({ id: sessionId, cwd }) !== undefined) {
          this.logger.info({ sessionId, cwd }, "messages wait for an archived session; they are handed once it is restored and opened");
          continue;
        }
        await this.getOrOpen({ id: sessionId, cwd });
        resumed.push(sessionId);
      } catch (error: unknown) {
        this.logger.info({ sessionId, cwd, error: error instanceof Error ? error.message : String(error) }, "waiting inbox could not be resumed");
      }
    }
    if (resumed.length > 0) this.logger.info({ sessionIds: resumed }, "resumed sessions with waiting messages");
    return resumed;
  }

  prompt(ref: PiSessionRef, text: unknown, streamingBehavior?: unknown, attachments?: unknown, options?: { echoUserMessage?: boolean; clientMessageId?: unknown; sentAt?: unknown }): Promise<void> {
    return this.inArrivalOrder(ref.id, () => this.acceptPrompt(ref, text, streamingBehavior, attachments, options));
  }

  private inArrivalOrder<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.arrivalChains.get(sessionId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.arrivalChains.set(sessionId, next.catch(() => undefined));
    return next;
  }

  private async acceptPrompt(ref: PiSessionRef, text: unknown, streamingBehavior: unknown, attachments: unknown, options: { echoUserMessage?: boolean; clientMessageId?: unknown; sentAt?: unknown } | undefined): Promise<void> {
    const promptText = requirePromptText(text);
    const clientMessageId = parseClientMessageId(options?.clientMessageId);
    // Command-forwarded prompts (e.g. /skill:*) are expanded by the agent, which
    // streams the canonical message back. The client doesn't render the raw
    // command text, so the server must not echo it either, or it would show up
    // as a transient line that vanishes on reload.
    const echoUserMessage = options?.echoUserMessage !== false;
    parsePromptStreamingBehavior(streamingBehavior);
    const parsedAttachments = parsePromptAttachments(attachments, { enforceInlineSizeLimit: false });
    const images = (await attachmentsToInlineImages(parsedAttachments)).map((entry) => entry.image);
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    this.assertTreeNavigationInactive(session, "send a prompt");
    this.maybeGenerateSessionName(session, promptText);
    const sessionId = session.sessionId;
    // A repeat of an identity this daemon already accepted is the sender
    // recovering a lost answer, not a second message: the composer mints a
    // fresh id for every deliberate send. Answer with what became of it - the
    // frame rides the ring, so the outbox settles - and run nothing twice.
    if (clientMessageId !== undefined && this.acceptanceLedger.has(sessionId, clientMessageId)) {
      this.events.publish(sessionId, { type: this.acceptanceLedger.outcomesFor(sessionId, [clientMessageId])[clientMessageId] === "withdrawn" ? "prompt.withdrawn" : "prompt.accepted", clientMessageId });
      this.publishActivity(session, "duplicate message ignored", "active");
      this.publishStatus(session);
      return;
    }
    const busy = session.isStreaming || session.isCompacting || this.ownedQueue.entries(sessionId).length > 0;
    if (busy && clientMessageId === undefined && images.length === 0 && this.hasQueuedMessageText(session, promptText)) {
      this.publishActivity(session, "duplicate queued message ignored", "active");
      this.publishStatus(session);
      return;
    }
    // Accepted only after the inbox file commits. Otherwise a full disk or a
    // read-only workspace would make the browser settle its outbox for a
    // message the daemon forgets at its next restart.
    const acceptedAt = new Date().toISOString();
    const sentAt = messageSentAt(options?.sentAt, acceptedAt);
    await this.ownedQueue.push(sessionId, session.sessionManager.getCwd(), {
      ...(clientMessageId === undefined ? {} : { clientMessageId }),
      lane: "steer",
      text: promptText,
      images: images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType })),
      acceptedAt,
      sentAt,
      echoUserMessage,
    });
    if (clientMessageId !== undefined) {
      this.acceptanceLedger.record(sessionId, clientMessageId);
      this.events.publish(sessionId, { type: "prompt.accepted", clientMessageId });
    }
    // Echoed at acceptance, whether or not it waits: a waiting message that
    // shows nothing until the agent reads it reads as "message disappeared".
    const echoed = clientMessageId === undefined ? userMessage(promptText, images) : { ...userMessage(promptText, images), timestamp: Date.parse(sentAt) };
    if (echoUserMessage) this.events.publish(sessionId, { type: "message.append", message: echoed, echo: true, ...(clientMessageId === undefined ? {} : { clientMessageId }) });
    this.publishActivity(session, busy ? "message queued" : "prompt accepted", "active");
    this.publishStatus(session);
    this.pumpInbox(session);
  }

  /**
   * Re-decide what the inbox hands to the runtime. One decision at a time per session, so a
   * handoff never interleaves with another and acceptance order is handoff order. It holds the
   * queue lock too: a recall empties the runtime's queue and replays the survivors, and a
   * handoff landing in the middle of that would put a newer message ahead of older ones.
   */
  private pumpInbox(session: PiAgentSession): void {
    const sessionId = session.sessionId;
    const previous = this.handoffChains.get(sessionId) ?? Promise.resolve();
    const next = previous.then(() => this.withQueueLock(session, () => this.handOff(session))).catch((error: unknown) => {
      console.warn(`[inbox] handoff for ${sessionId} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.handoffChains.set(sessionId, next);
  }

  private async handOff(session: PiAgentSession): Promise<void> {
    const sessionId = session.sessionId;
    if (this.active.get(sessionId)?.runtime.session !== session) return;
    if (this.emptying.has(sessionId) || this.archivedRuntimes.has(session)) return;
    const run = this.runStateFor(session);
    if (run === "idle") await this.takeBackHeldMessages(session);
    const decision = nextHandoff({ waiting: this.ownedQueue.entries(sessionId).length, run });
    if (decision.kind === "wait") return;
    if (decision.kind === "steer") {
      await this.handSteerBatch(session, decision.count);
      return;
    }
    await this.handIdleBatch(session);
  }

  /**
   * The idle injection point (D1, B33): everything waiting up to the first extension command
   * reaches the model in one request. pi's run polls its steering queue once it has emitted the
   * prompt's own entry, so the later messages are queued with `session.steer` before the oldest
   * starts the run, and that first poll takes them all. Measured before: three messages that
   * waited through a restart became three runs.
   */
  private async handIdleBatch(session: PiAgentSession): Promise<void> {
    const sessionId = session.sessionId;
    const size = idleBatchSize(this.ownedQueue.entries(sessionId).map((entry) => this.isExtensionCommand(session, entry.text)));
    if (size <= 1) {
      await this.handDirect(session);
      return;
    }
    const [head, ...rest] = await this.ownedQueue.take(sessionId, size);
    if (head === undefined) return;
    this.handing.add(sessionId);
    session.agent.steeringMode = "all";
    let verdict: HandoffVerdict;
    try {
      await this.steerAheadOf(session, rest);
      verdict = await this.handToRuntime(session, head, undefined);
    } catch (error: unknown) {
      await this.takeBackHeldMessages(session);
      await this.ownedQueue.restoreFront(sessionId, [head]);
      throw error;
    } finally {
      this.handing.delete(sessionId);
    }
    if (verdict !== "handed") await this.takeBackHeldMessages(session);
    if (verdict === "transient") await this.ownedQueue.restoreFront(sessionId, [head]);
    this.publishStatus(session);
    if (verdict !== "transient") this.pumpInbox(session);
  }

  /**
   * Queue the rest of an idle batch in pi's lane, oldest first, as a steer batch: Stop and Clear
   * wait for it, so none of them lands after they emptied the queues. What pi refuses goes back
   * to the inbox with everything after it.
   */
  private async steerAheadOf(session: PiAgentSession, entries: readonly OwnedQueueEntry[]): Promise<void> {
    const sessionId = session.sessionId;
    await this.asSteerBatch(sessionId, async () => {
      for (const [index, entry] of entries.entries()) {
        if (await this.steerAhead(session, entry)) continue;
        await this.ownedQueue.restoreFront(sessionId, entries.slice(index));
        return;
      }
    });
  }

  /**
   * Queue one message of an idle batch ahead of the run that will read it. It lands like a
   * running steer: in pi's lane (held, so recall and take-back find it), or taken by an input
   * handler. False when pi refused it; it and the rest of the batch then wait.
   */
  private async steerAhead(session: PiAgentSession, entry: OwnedQueueEntry): Promise<boolean> {
    const sessionId = session.sessionId;
    if (!this.servesSessionId(session)) return false;
    const images: ImageContent[] = entry.images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
    const { clientMessageId } = entry;
    if (clientMessageId !== undefined) this.committedExpectations.expect(sessionId, { clientMessageId, text: entry.text, imageCount: images.length, ...(entry.sentAt === undefined ? {} : { sentAt: entry.sentAt }) });
    const growthAtCall = this.laneGrowth.get(sessionId) ?? 0;
    try {
      await session.steer(entry.text, images);
    } catch {
      if (clientMessageId !== undefined) this.committedExpectations.withdraw(sessionId, clientMessageId);
      return false;
    }
    if ((this.laneGrowth.get(sessionId) ?? 0) > growthAtCall) {
      if (this.ownsSessionId(session)) this.holdSteer(sessionId, entry, images);
      return true;
    }
    if (clientMessageId !== undefined) this.committedExpectations.withdraw(sessionId, clientMessageId);
    this.settleSucceeded(sessionId, entryKey(entry));
    return true;
  }

  /**
   * What the runtime is doing, for the handoff decision.
   *
   * "Running" reads the agent's own loop flag as well as the session's: a prompt refused
   * because another run is active still clears the session flag and emits `agent_settled` on
   * its way out (the SDK's `_runAgentPrompt` finally), while the other run streams on.
   */
  private runStateFor(session: PiAgentSession): RunState {
    const sessionId = session.sessionId;
    const emittingSettled = isEmittingAgentSettled(session);
    const running = !emittingSettled && (session.isStreaming || session.agent.state?.isStreaming === true);
    const open = this.openRuns.get(sessionId);
    if (open !== undefined) open.quietSince = running ? undefined : open.quietSince ?? Date.now();
    const settling = isSettling(open, Date.now()) || emittingSettled;
    return runStateOf({ isCompacting: session.isCompacting, isStreaming: running, handing: this.handing.has(sessionId), settling });
  }

  /**
   * Hand everything waiting to the running agent as steers, in order. Stop and Clear wait for
   * a batch in flight, so a message is never between the inbox and pi's queue when they look.
   */
  private async handSteerBatch(session: PiAgentSession, count: number): Promise<void> {
    const sessionId = session.sessionId;
    session.agent.steeringMode = "all";
    try {
      await this.asSteerBatch(sessionId, async () => {
        const entries = await this.ownedQueue.take(sessionId, count);
        for (const [index, entry] of entries.entries()) {
          if (await this.handToRuntime(session, entry, "steer") !== "transient") continue;
          await this.ownedQueue.restoreFront(sessionId, entries.slice(index));
          return;
        }
      });
    } finally {
      this.publishStatus(session);
    }
  }

  /**
   * Run `work` as the session's steer batch. Stop and Clear wait for it before they empty the
   * queues, so no message is between the inbox and pi's lane when they look.
   */
  private async asSteerBatch(sessionId: string, work: () => Promise<void>): Promise<void> {
    let finished = (): void => undefined;
    const batch = new Promise<void>((resolve) => { finished = resolve; });
    this.steerBatches.set(sessionId, batch);
    try {
      await work();
    } finally {
      if (this.steerBatches.get(sessionId) === batch) this.steerBatches.delete(sessionId);
      finished();
    }
  }

  /** Start a run with the oldest waiting message. A momentary refusal leaves it at the head. */
  private async handDirect(session: PiAgentSession): Promise<void> {
    const sessionId = session.sessionId;
    const [entry] = await this.ownedQueue.take(sessionId, 1);
    if (entry === undefined) return;
    this.handing.add(sessionId);
    if (this.isExtensionCommand(session, entry.text)) this.handingCommands.add(sessionId);
    let verdict: HandoffVerdict;
    try {
      verdict = await this.handToRuntime(session, entry, undefined);
    } finally {
      this.handing.delete(sessionId);
      this.handingCommands.delete(sessionId);
    }
    if (verdict === "transient") {
      await this.ownedQueue.restoreFront(sessionId, [entry]);
      return;
    }
    this.publishStatus(session);
    this.pumpInbox(session);
  }

  /**
   * Hand one inbox entry to the runtime and say when it has it.
   *
   * A direct prompt is the runtime's once its own user message starts after preflight: the
   * SDK can pass preflight and still refuse the prompt when another run began meanwhile, so
   * preflight alone is not the handoff. A slash command counts once any run starts, because
   * the command's own run starts before its preflight. A steer is the runtime's when pi has
   * queued it. Anything that never reaches those points is the runtime's when the prompt
   * settles.
   *
   * An extension command leaves the inbox file's handed list before it runs. It writes no user
   * entry, so a restart could not tell a command that ran from one that did not, and returning it
   * would run its handler a second time (review of 8550ee13). A daemon that dies while the handler
   * runs loses the command instead: at most once, as before the handed list existed.
   */
  private async handToRuntime(session: PiAgentSession, entry: OwnedQueueEntry, behavior: "steer" | undefined): Promise<HandoffVerdict> {
    const sessionId = session.sessionId;
    const { clientMessageId, text } = entry;
    const images: ImageContent[] = entry.images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }));
    if (!this.servesSessionId(session) || this.liveRunState(session) !== HANDOFF_RUN_STATE[behavior ?? "direct"]) return "transient";
    const isCommand = this.isExtensionCommand(session, text);
    if (isCommand) this.settleHanded(sessionId, entryKey(entry));
    if (clientMessageId !== undefined) this.committedExpectations.expect(sessionId, { clientMessageId, text, imageCount: images.length, ...(entry.sentAt === undefined ? {} : { sentAt: entry.sentAt }) });
    if (behavior === "steer") this.publishActivity(session, "steering queued", "active");
    let committed = false;
    let landed: HandoffLanding | undefined;
    let markHanded = (): void => undefined;
    const handed = new Promise<"handed">((resolve) => { markHanded = () => { resolve("handed"); }; });
    const onCommit = (): void => {
      committed = true;
      markHanded();
      this.settleSucceeded(sessionId, entryKey(entry));
    };
    const preflightResult = (disposition: PromptDisposition): void => {
      landed = PREFLIGHT_LANDING[disposition];
      if (landed === "lane" && this.ownsSessionId(session)) this.holdSteer(sessionId, entry, images);
      if (landed === "handled" && clientMessageId !== undefined) this.committedExpectations.withdraw(sessionId, clientMessageId);
      if (landed !== "run") {
        markHanded();
        return;
      }
      if (session.agent.state?.isStreaming !== true && this.ownsSessionId(session)) this.directCommitWatchers.set(sessionId, onCommit);
    };
    if (behavior === undefined && isCommand) this.runStartWatchers.set(sessionId, markHanded);
    const send = (): Promise<void> => session.prompt(text, { ...buildPromptOptions(behavior, images), preflightResult });
    const settled = this.runSessionEntryMutation(session, "send a prompt", isCommand ? () => this.commandHandlers.run(send) : send).then(
      () => ({ verdict: "handed" as const, message: "" }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return { verdict: refusalKind(message), message };
      },
    );
    if (behavior === "steer" && isCommand) markHanded();
    const verdict = await Promise.race([handed, settled.then((result) => result.verdict)]);
    if (verdict === "handed") {
      void settled.then((result) => { this.afterHandoff(session, entry, { ...result, committed, landed }, { onCommit, markHanded }); });
      return "handed";
    }
    this.forgetHandoffWatchers(sessionId, { onCommit, markHanded });
    const { message } = await settled;
    this.releaseHandoff(sessionId, entry, landed);
    if (verdict === "transient") return "transient";
    this.refuse(session, entryKey(entry), message);
    return "terminal";
  }

  /**
   * The runtime refused a message the inbox had accepted. The ledger records it failed, and the
   * sender's row hears it per identity (`prompt.refused`) - a session-wide error alone left the
   * row reading "Queued" for good. A message the agent already read keeps its outcome: a run
   * failing after the read is the run's error, not the message's refusal.
   */
  private refuse(session: PiAgentSession, key: string, message: string): void {
    const sessionId = session.sessionId;
    this.settleHanded(sessionId, key);
    const clientMessageId = publishedId(key);
    if (clientMessageId !== undefined) {
      this.acceptanceLedger.settle(sessionId, clientMessageId, "failed");
      if (this.acceptanceLedger.outcomesFor(sessionId, [clientMessageId])[clientMessageId] === "failed") {
        this.events.publish(sessionId, { type: "prompt.refused", clientMessageId, message });
      }
    }
    this.publishActivity(session, "error", "error", message);
    this.events.publish(sessionId, { type: "session.error", message });
  }

  /**
   * The run state as it is at this instant, ignoring the consumer's own handoff. Read right
   * before `session.prompt`, whose entry up to the SDK's deferral check is synchronous, so a
   * decision made before an await (the inbox write) cannot hand a steer into a finished run or
   * a direct prompt into a running one.
   */
  private liveRunState(session: PiAgentSession): RunState {
    const sessionId = session.sessionId;
    const handing = this.handing.delete(sessionId);
    try {
      return this.runStateFor(session);
    } finally {
      if (handing) this.handing.add(sessionId);
    }
  }

  /** Parsed exactly as the SDK's `_tryExecuteExtensionCommand`: the name ends at the first space. */
  private isExtensionCommand(session: PiAgentSession, text: string): boolean {
    if (!text.startsWith("/")) return false;
    const spaceIndex = text.indexOf(" ");
    const name = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    return session.extensionRunner.getRegisteredCommands().some((command) => command.invocationName === name);
  }

  /**
   * What a handed prompt's promise says once it settles. A message the agent has read is never
   * put back: its promise can still reject later, for a failure of the run or of something the
   * SDK ran after it, and restoring it then would run it twice.
   */
  private afterHandoff(session: PiAgentSession, entry: OwnedQueueEntry, result: { verdict: HandoffVerdict; message: string; committed: boolean; landed: HandoffLanding | undefined }, watchers: HandoffWatchers): void {
    const sessionId = session.sessionId;
    this.forgetHandoffWatchers(sessionId, watchers);
    if (result.verdict === "handed") {
      if (result.landed !== undefined && READ_WHEN_RESOLVED[result.landed]) this.settleSucceeded(sessionId, entryKey(entry));
      return;
    }
    if (result.verdict === "transient" && !result.committed) {
      this.releaseHandoff(sessionId, entry, result.landed);
      void this.ownedQueue.restoreFront(sessionId, [entry]).then(() => { this.publishStatus(session); });
      return;
    }
    this.refuse(session, entryKey(entry), result.message);
  }

  private forgetHandoffWatchers(sessionId: string, watchers: HandoffWatchers): void {
    if (this.directCommitWatchers.get(sessionId) === watchers.onCommit) this.directCommitWatchers.delete(sessionId);
    if (this.runStartWatchers.get(sessionId) === watchers.markHanded) this.runStartWatchers.delete(sessionId);
  }

  /**
   * Whether this runtime still owns its session id. Steer records, lane accounting and take-back
   * are kept per session id; a runtime closed and replaced (its bounded teardown gave up, and the
   * id reopened) must not touch the new runtime's with late work of its own.
   */
  private ownsSessionId(session: PiAgentSession): boolean {
    const current = this.active.get(session.sessionId)?.runtime.session;
    return current === undefined || current === session;
  }

  /**
   * Whether this runtime is still the one serving its session id - the check a handoff makes
   * right before `session.prompt`. A runtime being closed or shut down is no longer active; a
   * message handed to it would run on a torn-down runtime, unseen and unpersisted, so it goes
   * back to the inbox instead, where the next runtime hands it.
   */
  private servesSessionId(session: PiAgentSession): boolean {
    return this.active.get(session.sessionId)?.runtime.session === session;
  }

  /** A steer is pi's once `_queueSteer` has pushed it, which is when the SDK calls its preflight. */
  private holdSteer(sessionId: string, entry: OwnedQueueEntry, images: ImageContent[]): void {
    this.recordQueuedPromptClientId(sessionId, entryKey(entry), entry.text, "steer", entry);
    if (images.length > 0) this.recordQueuedPromptImages(sessionId, entry.text, images);
  }

  /** `key` is the message's sender id, or its local hold id (`entryKey`) when it was sent without one. */
  private settleSucceeded(sessionId: string, key: string | undefined): void {
    this.settleHanded(sessionId, key);
    const id = publishedId(key);
    if (id !== undefined) this.acceptanceLedger.settle(sessionId, id, "succeeded");
  }

  /**
   * The message is no longer in pi's hands as an unread message - read, refused or withdrawn - so
   * the inbox file stops keeping it for a restart (D1, B33). Every path that ends a handed message
   * comes through here: `settleSucceeded`, `refuse` and `withdraw`; a take-back moves it with
   * `restoreFront` instead.
   */
  private settleHanded(sessionId: string, key: string | undefined): void {
    if (key === undefined) return;
    void this.ownedQueue.settleHanded(sessionId, key).catch((error: unknown) => {
      console.warn(`[inbox] could not settle a handed message for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /** Undo the bookkeeping of a handoff the runtime did not take. */
  private releaseHandoff(sessionId: string, entry: OwnedQueueEntry, landed: HandoffLanding | undefined): void {
    if (entry.clientMessageId !== undefined) this.committedExpectations.withdraw(sessionId, entry.clientMessageId);
    if (landed !== "lane") return;
    this.forgetQueuedPromptClientId(sessionId, entry.text, entry.clientMessageId, "steer");
    this.takeQueuedPromptImages(sessionId, entry.text);
  }

  /**
   * The runtime facts the inbox consumer and the ledger follow: when a run opens and settles,
   * and when the agent reads a user message.
   */
  private observeInboxFacts(session: PiAgentSession, event: unknown): void {
    const sessionId = session.sessionId;
    const eventType = getString(event, "type");
    if (eventType === "agent_start") {
      this.openRuns.set(sessionId, { quietSince: undefined });
      const onRunStart = this.runStartWatchers.get(sessionId);
      this.runStartWatchers.delete(sessionId);
      onRunStart?.();
    }
    if (eventType === "agent_settled") this.openRuns.delete(sessionId);
    if (eventType === "queue_update") {
      const size = queueUpdateSize(event);
      if (size > (this.laneSizes.get(sessionId) ?? 0)) this.laneGrowth.set(sessionId, (this.laneGrowth.get(sessionId) ?? 0) + 1);
      this.laneSizes.set(sessionId, size);
    }
    if (eventType !== "message_start" || getProperty(getProperty(event, "message"), "role") !== "user") return;
    dropReadEmptyLaneEntry(session, getProperty(event, "message"));
    const onCommit = this.directCommitWatchers.get(sessionId);
    this.directCommitWatchers.delete(sessionId);
    onCommit?.();
    this.settleConsumedSteers(session);
  }

  /**
   * Settle the steers the agent has read. pi removes a steer from its lane just before the
   * user message starts, and keeps each lane first-in first-out, so a record the lanes no
   * longer account for was read - whatever text it was committed under.
   */
  private settleConsumedSteers(session: PiAgentSession): void {
    const sessionId = session.sessionId;
    if (this.replayingLanes.has(sessionId) || !this.ownsSessionId(session)) return;
    const records = this.queuedPromptClientIds.get(sessionId);
    if (records === undefined || records.length === 0) return;
    const held = new Set(correlateQueuedPromptIds(runtimeLanes(session), records).map((entry) => entry.clientMessageId));
    const stillHeld = records.filter((record) => held.has(record.clientMessageId));
    for (const record of records) if (!held.has(record.clientMessageId)) this.settleSucceeded(sessionId, record.clientMessageId);
    if (stillHeld.length === 0) this.queuedPromptClientIds.delete(sessionId);
    else this.queuedPromptClientIds.set(sessionId, stillHeld);
  }

  /**
   * Take back what the runtime still holds, to the head of the inbox, with each message's
   * identity and images.
   *
   * At idle, a steer handed at the run's last gap can have landed after pi's final look at its
   * queue; nothing would read it until some later prompt, which it would then follow. When a
   * session closes, whatever pi holds dies with the runtime. Either way the messages were
   * accepted and never read, so they wait again, first. Messages the agent loop has already
   * taken are the exception: the loop commits them even if the run is aborted, so they stay.
   */
  private async takeBackHeldMessages(session: PiAgentSession): Promise<void> {
    const sessionId = session.sessionId;
    if (!this.ownsSessionId(session)) return;
    this.settleConsumedSteers(session);
    const records = this.queuedPromptClientIds.get(sessionId) ?? [];
    const { loopHeld, waiting } = partitionLanes(session, records);
    this.settleLoopHeld(sessionId, loopHeld);
    if (waiting.length === 0) return;
    this.notices.clearLanesKeepingNotices(session);
    const entries = waiting.map((held): OwnedQueueEntry => {
      const original = records.find((record) => record.clientMessageId === held.clientMessageId)?.entry;
      if (original !== undefined) return original;
      const images = this.takeQueuedPromptImages(sessionId, held.text);
      const id = publishedId(held.clientMessageId);
      const acceptedAt = new Date().toISOString();
      return {
        ...(id === undefined ? {} : { clientMessageId: id }),
        lane: "steer",
        text: held.text,
        images: images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType })),
        acceptedAt,
        sentAt: acceptedAt,
        echoUserMessage: false,
      };
    });
    for (const entry of waiting) if (entry.clientMessageId !== undefined) this.committedExpectations.withdraw(sessionId, entry.clientMessageId);
    this.queuedPromptClientIds.delete(sessionId);
    this.queuedPromptImages.delete(sessionId);
    await this.ownedQueue.restoreFront(sessionId, entries);
  }

  /**
   * The inbox as this runtime finds it. A message handed to pi before a restart, and not on the
   * transcript as a user entry with its id, was never read: it waits again, first. One that is was
   * read and is settled (D1, B33). The id is on the stored entry because the daemon stamps it at
   * `message_start`, before pi appends the entry.
   *
   * One whose ledger row had already settled - withdrawn, refused, or read - ended before the
   * restart too. The ledger is written synchronously and the inbox file after it, so a daemon that
   * died between the two left a recalled message in the handed list; returning it ran a message its
   * sender had taken back (review of 8550ee13). It is dropped, and its row keeps its outcome.
   */
  private async restoreOwnedQueue(session: PiAgentSession, cwd: string): Promise<OwnedQueueEntry[]> {
    const sessionId = session.sessionId;
    await this.ownedQueue.open(sessionId, cwd);
    const onTranscript = committedClientMessageIds(session.sessionManager.getBranch());
    const read = (entry: OwnedQueueEntry): boolean => entry.clientMessageId !== undefined && onTranscript.has(entry.clientMessageId);
    const settledBefore = (entry: OwnedQueueEntry): boolean => {
      const id = entry.clientMessageId;
      if (id === undefined) return false;
      const outcome = this.acceptanceLedger.outcomesFor(sessionId, [id])[id];
      return outcome !== undefined && !SETTLEABLE[outcome];
    };
    const { ended } = await this.ownedQueue.returnHanded(sessionId, (entry) => read(entry) || settledBefore(entry));
    const committed = ended.filter(read);
    const entries = this.ownedQueue.entries(sessionId);
    this.publishStatus(session);
    // The queue survived the restart; its acceptances must too, or the
    // sender's outbox retry of a parked id is accepted a second time and the
    // prompt runs twice.
    for (const entry of [...entries, ...committed]) {
      if (entry.clientMessageId !== undefined) this.acceptanceLedger.record(sessionId, entry.clientMessageId);
    }
    for (const entry of committed) {
      if (entry.clientMessageId !== undefined) this.acceptanceLedger.settle(sessionId, entry.clientMessageId, "succeeded");
    }
    return entries;
  }

  /** The latest activity the session published, with the step it is in now (B25). */
  private currentActivity(sessionId: string): SessionActivity | undefined {
    const stored = this.activities.get(sessionId);
    if (stored === undefined) return undefined;
    const current = this.steps.get(sessionId);
    return current === undefined ? { sessionId, ...stored } : { sessionId, ...stored, step: current.step, stepSince: current.since };
  }

  /** The answers records still waiting in pi's queues (B26): what the transcript shows as queued answers. */
  private queuedAnswers(session: PiAgentSession): AskUserOutcome[] {
    return this.notices.queued(session).flatMap((notice) => {
      if (notice.customType !== ASK_USER_ANSWERS_CUSTOM_TYPE || typeof notice.details !== "object" || notice.details === null) return [];
      const outcome = this.sentAnswers.get(notice.details);
      return outcome === undefined ? [] : [outcome];
    });
  }

  /**
   * What waits for the agent, as the status lists it (see `queuedMessagesFromSession`).
   */
  private queuedMessages(session: PiAgentSession): QueuedSessionMessage[] {
    return queuedMessagesFromSession(session, this.ownedQueue.entries(session.sessionId), this.queuedPromptClientIds.get(session.sessionId) ?? []);
  }

  /**
   * Give each queued prompt back the id its sender minted.
   *
   * This used to pair them by comparing text, which is not identity: the
   * runtime expands /skill and prompt templates before queueing, and an
   * attachment-only prompt carries no text to compare. Either way the entry
   * lost its id, the browser could not claim its own bubble, and a duplicate
   * row appeared for a message already on screen - reported five times.
   * Submission order is the correlation the queue does preserve.
   */
  private recordQueuedPromptImages(sessionId: string, text: string, images: ImageContent[]): void {
    const records = this.queuedPromptImages.get(sessionId) ?? [];
    records.push({ text, images });
    this.queuedPromptImages.set(sessionId, records);
  }

  /**
   * Take back the images recorded for one queued prompt.
   *
   * Matching on text is what this file has already been bitten by: the runtime
   * expands prompts before queueing, so the text a prompt is replayed under is
   * not always the text it was recorded under, and the images are then dropped
   * from a message that had them. Position is checked first because a replay
   * walks the queue in order; the text match remains as a fallback for a queue
   * this process did not record in order.
   */
  private takeQueuedPromptImages(sessionId: string, text: string): ImageContent[] {
    const records = this.queuedPromptImages.get(sessionId);
    if (records === undefined || records.length === 0) return [];
    const index = records[0]?.text === text ? 0 : records.findIndex((record) => record.text === text);
    if (index === -1) return [];
    const [record] = records.splice(index, 1);
    if (records.length === 0) this.queuedPromptImages.delete(sessionId);
    return record?.images ?? [];
  }

  /**
   * Remember which browser message a queued prompt came from, and which lane it
   * went into. The lane matters because the status lists the queue lane by lane
   * while submissions arrive interleaved, so correlating without it hands a
   * steer the id of a follow-up.
   */
  private recordQueuedPromptClientId(sessionId: string, clientMessageId: string, text: string, kind?: string, entry?: OwnedQueueEntry): void {
    const records = this.queuedPromptClientIds.get(sessionId) ?? [];
    records.push({ clientMessageId, text, ...(kind === undefined ? {} : { kind }), ...(entry === undefined ? {} : { entry }) });
    this.queuedPromptClientIds.set(sessionId, records);
  }

  /**
   * Stamp the runtime's committed copy of a user prompt with the id its
   * sender minted and the time it was sent. The message object is mutated in
   * place before the event is converted and published: the runtime persists
   * the same object, so both survive into the stored transcript, and every
   * client - the sender, other devices, a reload - receives a committed copy it
   * can claim by identity and that keeps the time its sender saw (B5). pi's
   * own stamp is the moment the daemon handed the message over. The
   * acceptance echo carries the same time only for a message with a sender
   * id, the only kind this stamp can claim; one without keeps pi's time.
   */
  private stampCommittedUserMessage(session: PiAgentSession, event: unknown): void {
    // Both boundary events: the void gate listens to message_start too, and an
    // unstamped start would judge the message by its text - the guessing this
    // stamp exists to end. The claim consumes on first sight; the end event
    // finds the id already present and returns early.
    const eventType = getString(event, "type");
    if (eventType !== "message_start" && eventType !== "message_end") return;
    const message = getProperty(event, "message");
    if (!isRecord(message) || message["role"] !== "user") return;
    if (typeof message["clientMessageId"] === "string") return;
    const shape = committedMessageShape(message["content"]);
    const commit = this.committedExpectations.claim(session.sessionId, shape);
    if (commit === undefined) return;
    message["clientMessageId"] = commit.clientMessageId;
    if (commit.sentAt !== undefined) message["timestamp"] = Date.parse(commit.sentAt);
  }

  /**
   * Remember that the reader stopped this turn, durably and once. The custom entry is what
   * history reads after a reload (`branchMessages`); the map marks the live reply.
   */
  private recordStopByReader(session: PiAgentSession): void {
    if (this.stoppedByReader.has(session.sessionId)) return;
    const at = new Date().toISOString();
    this.stoppedByReader.set(session.sessionId, at);
    try {
      session.sessionManager.appendCustomEntry?.(TURN_STOPPED_CUSTOM_TYPE, { by: "you", at });
    } catch (error) {
      console.error("[stop] could not record the reader's stop", String(error));
    }
  }

  /**
   * Settle the reader's Stop live, by the rule history reads (`stopOutcomes`): the first reply it
   * cut carries the mark; a user message or the end of the work it stopped, reached first, settles
   * it on its own, returned here as the message_end the transcript and the command watch both
   * receive. pi schedules a retry after the failed run's `agent_end`, so a Stop during that wait
   * is ended by `auto_retry_end`.
   */
  private settleStopByReader(session: PiAgentSession, event: unknown): unknown {
    const at = this.stoppedByReader.get(session.sessionId);
    if (at === undefined) return undefined;
    const eventType = getString(event, "type");
    const message = getProperty(event, "message");
    if (eventType === "message_end" && isRecord(message) && isCutAssistant(message)) {
      message["stoppedBy"] = "you";
      this.stoppedByReader.delete(session.sessionId);
      return undefined;
    }
    const reachedFirst = STOP_SETTLING_EVENTS.has(eventType ?? "") || (eventType === "message_end" && getString(message, "role") === "user");
    if (!reachedFirst) return undefined;
    this.stoppedByReader.delete(session.sessionId);
    return { type: "message_end", message: stoppedTurnMessage(at) };
  }

  private publishActivityChangeForToolEvent(session: PiAgentSession, event: unknown): void {
    const eventType = getString(event, "type");
    if (eventType !== "tool_execution_start" && eventType !== "tool_execution_end") return;
    const toolName = getString(event, "toolName") ?? "";
    if (!ACTIVITY_TOOL_NAMES.has(toolName)) return;
    this.events.publish(session.sessionId, { type: "activity.changed" });
  }

  async saveAttachments(ref: PiSessionRef, attachments: unknown, folder?: string): Promise<SavedPromptAttachment[]> {
    const parsed = parsePromptAttachments(attachments, { enforceInlineSizeLimit: false, allowFileAttachments: true });
    if (parsed.length === 0) return [];
    await this.assertWritable(ref);
    const active = await this.getActive(ref);
    return saveAttachmentsToWorkspace(active.runtime.cwd, parsed, folder === undefined ? {} : { folder });
  }

  async shell(ref: PiSessionRef, text: string): Promise<void> {
    await this.assertWritable(ref);
    const active = await this.getActive(ref);
    const { session } = active.runtime;
    this.assertTreeNavigationInactive(session, "run a shell command");
    const isExcluded = text.startsWith("!!");
    const command = (isExcluded ? text.slice(2) : text.slice(1)).trim();
    if (!command) throw new Error("Usage: !<shell command>");
    if (session.isBashRunning) throw new Error("A bash command is already running");

    this.publishActivityForEvent(session, { type: "bash_execution_start", command });
    this.events.publish(session.sessionId, { type: "shell.start", command, excludeFromContext: isExcluded });
    void this.runSessionEntryMutation(session, "run a shell command", () => session.executeBash(command, (chunk) => {
      this.events.publish(session.sessionId, { type: "shell.chunk", chunk });
      this.publishStatus(session);
    }, { excludeFromContext: isExcluded })).then((result) => {
      this.events.publish(session.sessionId, {
        type: "shell.end",
        output: result.output,
        ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
        cancelled: result.cancelled,
        truncated: result.truncated,
        ...(result.fullOutputPath === undefined ? {} : { fullOutputPath: result.fullOutputPath }),
      });
      this.publishActivityForEvent(session, { type: "bash_execution_end" });
      this.publishActivity(session, "bash complete", result.exitCode === 0 ? "idle" : "error", command);
      this.publishStatus(session);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.events.publish(session.sessionId, { type: "shell.end", output: message, isError: true });
      this.events.publish(session.sessionId, { type: "session.error", message });
      this.publishActivityForEvent(session, { type: "bash_execution_end" });
      this.publishActivity(session, "bash failed", "error", message);
      this.publishStatus(session);
    });
  }

  async runCommand(ref: PiSessionRef, text: string): Promise<ClientCommandResult> {
    await this.assertWritable(ref);
    const active = await this.getActive(ref);
    return this.commandService.run(active.runtime.session.sessionId, text);
  }

  async respondToCommand(ref: PiSessionRef, requestId: string, value: string): Promise<ClientCommandResult> {
    await this.assertWritable(ref);
    const active = await this.getActive(ref);
    return this.commandService.respond(active.runtime.session.sessionId, requestId, value);
  }

  async navigateTree(ref: PiSessionRef, request: ClientSessionTreeNavigateRequest): Promise<ClientSessionTreeNavigateResult> {
    if (request.targetId.trim() === "") throw new Error("Session tree target is required");
    if (this.isTreeExclusiveSessionIdentityActive(ref.id)) {
      throw new Error("Stop current session activity before navigating the session tree");
    }
    await this.assertWritable(ref);
    const options = sessionTreeNavigationOptions(request);
    const session = await this.getOrOpen(ref);
    if (typeof session.navigateTree !== "function") throw new Error("Session tree navigation is not supported by this Pi runtime");
    if (this.hasActiveWork(session)) throw new Error("Stop current session activity before navigating the session tree");

    // Acquire synchronously after the active-work check. No leaf-producing work
    // may enter this runtime until Pi's potentially asynchronous summary settles.
    this.treeNavigations.add(session);
    try {
      if (session.sessionManager.getLeafId() !== request.expectedLeafId) {
        throw new Error("The session changed since /tree was opened. Reopen /tree and try again.");
      }

      this.publishActivity(session, options.summarize ? "summarizing branch" : "navigating session tree", "active");
      this.publishStatus(session);
      const result = await session.navigateTree(request.targetId, options);
      if (result.cancelled) {
        if (this.isCurrentActiveSession(session)) {
          this.publishActivity(session, result.aborted === true ? "branch summary aborted" : "tree navigation cancelled", "idle");
        }
        return { cancelled: true, ...(result.aborted === undefined ? {} : { aborted: result.aborted }) };
      }

      if (this.isCurrentActiveSession(session)) this.publishActivity(session, "session tree navigated", "idle");
      return { cancelled: false, ...(result.editorText === undefined ? {} : { editorText: result.editorText }) };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isCurrentActiveSession(session)) {
        this.publishActivity(session, "tree navigation failed", "error", message);
        this.events.publish(session.sessionId, { type: "session.error", message });
      }
      throw error;
    } finally {
      this.treeNavigations.delete(session);
      if (this.isCurrentActiveSession(session)) {
        this.flushDeferredTreeNavigationWork(session);
        this.publishStatus(session);
      } else {
        this.deferredGeneratedSessionNames.delete(session);
        this.deferredSubsessionNotifications.delete(session);
      }
    }
  }

  /**
   * Fork the session from one entry of its tree into a new session file,
   * leaving the original session untouched. The forked runtime replaces the
   * current one, so the outcome is reported for the session the client is
   * about to join rather than the forked-from record.
   */
  async forkFromTree(ref: PiSessionRef, request: ClientSessionTreeForkRequest): Promise<ClientSessionTreeForkResult> {
    if (request.entryId.trim() === "") throw new Error("Session tree entry is required");
    if (this.isTreeExclusiveSessionIdentityActive(ref.id)) {
      throw new Error("Stop current session activity before forking the session tree");
    }
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    if (this.hasActiveWork(session)) throw new Error("Stop current session activity before forking the session tree");
    if (session.sessionManager.getLeafId() !== request.expectedLeafId) {
      throw new Error("The session changed since /tree was opened. Reopen /tree and try again.");
    }

    this.publishActivity(session, "forking session from entry", "active");
    this.publishStatus(session);
    try {
      const result = await this.commandService.forkEntry(session.sessionId, request.entryId, {
        expectedLeafId: request.expectedLeafId,
      });
      if (result.type === "unsupported") throw new Error(result.message);
      if (result.type !== "done") throw new Error("Session fork is unavailable");
      if (result.session === undefined) {
        if (this.isCurrentActiveSession(session)) {
          this.publishActivity(session, "fork cancelled", "idle");
          this.publishStatus(session);
        }
        return { cancelled: true };
      }

      const forkedSession = this.active.get(result.session.id)?.runtime.session;
      if (forkedSession !== undefined && this.isCurrentActiveSession(forkedSession)) {
        this.publishActivity(forkedSession, "session forked", "idle");
        this.publishStatus(forkedSession);
      }
      if (result.session.id !== session.sessionId) this.clearSupersededSessionActivity(session);
      return {
        cancelled: false,
        session: result.session,
        ...(result.promptDraft === undefined ? {} : { promptDraft: result.promptDraft }),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isCurrentActiveSession(session)) {
        this.publishActivity(session, "fork failed", "error", message);
        this.events.publish(session.sessionId, { type: "session.error", message });
        this.publishStatus(session);
      }
      throw error;
    }
  }

  /**
   * A changed-id fork can rebind its runtime after a heartbeat published the
   * prior identity as active. Clear every observable owner before forgetting
   * that identity's local activity record.
   */
  private clearSupersededSessionActivity(session: PiAgentSession): void {
    const sessionId = session.sessionId;
    if (this.activities.get(sessionId)?.phase === "active") {
      const at = new Date().toISOString();
      const stored = { phase: "idle" as const, label: "idle", at };
      this.activities.set(sessionId, stored);
      const activity = { sessionId, ...stored };
      this.events.publish(sessionId, { type: "activity.update", activity });
      this.events.publishGlobal({ type: "activity.update", activity });
    }
    this.workspaceActivity?.removeSession(sessionId, session.sessionManager.getCwd());
    this.activities.delete(sessionId);
    this.steps.delete(sessionId);
  }

  private async reloadSessionRuntime(session: PiAgentSession): Promise<void> {
    if (this.hasActiveWork(session)) throw new Error("Stop current session activity before reloading");
    await this.runTreeExclusiveOperation(
      [{ sessionId: session.sessionId, session }],
      "Stop current session activity before reloading",
      async () => {
        this.publishActivity(session, "reloading resources", "active");
        const priorGeneration = this.notificationGenerationBySession.get(session);
        let candidateGeneration: SessionNotificationGeneration | undefined;
        try {
          await session.reload(priorGeneration === undefined ? undefined : {
            beforeSessionStart: () => {
              candidateGeneration = this.notificationStore.beginReplacement(priorGeneration, notificationIdentityForSession(session));
              this.notificationGenerationBySession.set(session, candidateGeneration);
              this.replaceSessionNotificationContext(session, candidateGeneration);
            },
          });
          applyProviderSafeToolSchemas(session);
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.commitReplacement(candidateGeneration));
          }
          this.publishActivity(session, "resources reloaded", "idle");
          this.publishStatus(session);
        } catch (error: unknown) {
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.abortReplacement(candidateGeneration, "candidate"));
            this.notificationGenerationBySession.set(session, candidateGeneration);
          }
          const message = error instanceof Error ? error.message : String(error);
          this.publishActivity(session, "reload failed", "error", message);
          this.events.publish(session.sessionId, { type: "session.error", message });
          this.publishStatus(session);
          throw error;
        }
      },
    );
  }

  async archive(ref: PiSessionRef): Promise<void> {
    const session = await this.getOrOpen(ref);
    if (this.hasActiveWork(session)) throw new Error("Stop current session activity before archiving");
    await this.runTreeExclusiveOperation(
      [{ sessionId: session.sessionId, session }],
      "Stop current session activity before archiving",
      async () => {
        const archiveInput = await this.archiveInputForSession(session);
        await this.closeActive(session.sessionId, { kind: "clear", reason: "archive" });
        await this.archiveStore.archive(archiveInput);
        await this.forgetUnreadSessions([archiveInput]);
      },
    );
  }

  async archiveMany(refs: readonly SessionBulkMutationRef[]): Promise<SessionBulkArchiveResponse> {
    const uniqueRefs = uniqueBulkSessionRefs(refs);
    const [archivedRecords, sessionContext] = await Promise.all([
      this.archiveStore.list(),
      this.bulkSessionRefContext(uniqueRefs),
    ]);
    const failures: SessionBulkFailure[] = [];
    const alreadyArchivedSessionIds: string[] = [];
    const unreadArchivedIdentities: { sessionId: string; cwd: string }[] = [];
    const planItems: BulkArchivePlanItem[] = [];

    for (const ref of uniqueRefs) {
      const archived = findArchivedRecordForBulkRef(archivedRecords, ref);
      if (archived !== undefined) {
        this.publishNotificationMutations(this.notificationStore.clearSession(archived.sessionId, "archive"));
        alreadyArchivedSessionIds.push(archived.sessionId);
        unreadArchivedIdentities.push(archived);
        continue;
      }

      const active = this.activeForRef(bulkRefToSessionRef(ref));
      const listed = findListedSessionForBulkRef(sessionContext, ref);
      const resolvedSessionId = active?.runtime.session.sessionId ?? listed?.id ?? ref.id;
      if (active !== undefined && this.hasActiveWork(active.runtime.session)) {
        failures.push({ sessionId: resolvedSessionId, error: "Stop current session activity before archiving" });
        continue;
      }

      try {
        if (listed !== undefined) {
          planItems.push({ input: archiveInputFromListEntry(listed) });
        } else if (active !== undefined) {
          planItems.push({ input: archiveInputFromActiveSession(active.runtime.session) });
        } else {
          failures.push({ sessionId: ref.id, error: "Session not found" });
        }
      } catch (error: unknown) {
        failures.push({ sessionId: resolvedSessionId, error: errorMessage(error) });
      }
    }

    const readyPlanItems: { input: ArchiveSessionInput; active?: ActiveSession<PiSessionRuntime> }[] = [];
    for (const item of planItems) {
      const active = this.activeForRef({ id: item.input.sessionId, cwd: item.input.cwd });
      if (active !== undefined && this.hasActiveWork(active.runtime.session)) {
        failures.push({ sessionId: item.input.sessionId, error: "Stop current session activity before archiving" });
        continue;
      }
      if (await this.closedSessionHasWaiting(item.input.sessionId, item.input.cwd)) {
        failures.push({ sessionId: item.input.sessionId, error: WAITING_MESSAGES_BLOCK_ARCHIVE });
        continue;
      }
      readyPlanItems.push(active === undefined ? item : { ...item, active });
    }

    const readyInputs: ArchiveSessionInput[] = [];
    const archivedSessionIds = [...alreadyArchivedSessionIds];
    await this.runTreeExclusiveOperation(
      readyPlanItems.map(({ input, active }) => ({
        sessionId: input.sessionId,
        ...(active === undefined ? {} : { session: active.runtime.session, runtime: active.runtime }),
      })),
      "Stop current session activity before archiving",
      async () => {
        for (const item of readyPlanItems) {
          try {
            await this.closeActive(item.input.sessionId, { kind: "clear", reason: "archive" });
            readyInputs.push(item.input);
          } catch (error: unknown) {
            failures.push({ sessionId: item.input.sessionId, error: errorMessage(error) });
          }
        }

        try {
          const archived = await this.archiveStoreArchiveMany(readyInputs);
          archivedSessionIds.push(...archived.map((record) => record.sessionId));
          unreadArchivedIdentities.push(...archived);
        } catch (error: unknown) {
          for (const input of readyInputs) failures.push({ sessionId: input.sessionId, error: errorMessage(error) });
        }
      },
    );
    await this.forgetUnreadSessions(unreadArchivedIdentities);

    return {
      archived: true,
      archivedSessionIds: uniqueStrings(archivedSessionIds),
      failures,
      generatedAt: new Date().toISOString(),
    };
  }

  async archiveTree(ref: PiSessionRef): Promise<ClientArchiveSessionsResponse> {
    const session = await this.getOrOpen(ref);
    const catalog = await this.workspaceArchiveCandidates(session.sessionManager.getCwd());
    const root = findArchiveCandidateByIdOrPrefix(catalog, session.sessionId) ?? archiveCandidateFromActiveSession(session, false);
    const plan = planSessionArchiveTree(root, catalog);
    const busy = plan.targets.map((target) => target.activeSession).find((target) => target !== undefined && this.hasActiveWork(target));
    if (busy !== undefined) throw new Error(`Stop current session activity before archiving ${sessionDisplayName(busy)}`);

    const archiveInputs = plan.unarchivedTargets.map((target) => archiveInputFromCandidate(target));
    await this.runTreeExclusiveOperation(
      plan.unarchivedTargets.map((target) => ({
        sessionId: target.id,
        ...(target.activeSession === undefined ? {} : { session: target.activeSession }),
      })),
      `Stop current session activity before archiving ${sessionDisplayName(session)}`,
      async () => {
        for (const target of plan.targets) {
          if (target.archived) this.publishNotificationMutations(this.notificationStore.clearSession(target.id, "archive"));
        }
        for (const input of archiveInputs) await this.closeActive(input.sessionId, { kind: "clear", reason: "archive" });
        await this.archiveStoreArchiveMany(archiveInputs);
      },
    );
    await this.forgetUnreadSessions(plan.targets.map((target) => ({ sessionId: target.id, cwd: target.cwd })));

    return {
      archived: true,
      sessionIds: archiveInputs.map((input) => input.sessionId),
      archivedCount: archiveInputs.length,
      skippedAlreadyArchivedCount: plan.skippedAlreadyArchivedCount,
    };
  }

  async restore(ref: PiSessionRef): Promise<void> {
    const archived = await this.getArchived(ref);
    if (archived === undefined) throw new SessionNotFoundError({ archived: true });
    await this.closeActive(archived.sessionId, { kind: "clear", reason: "restore" });
    await this.archiveStore.restore(archived.sessionId);
    await this.forgetUnreadSessions([archived]);
  }

  async deleteArchivedMany(refs: readonly SessionBulkMutationRef[]): Promise<SessionBulkDeleteArchivedResponse> {
    if (this.archiveStore.deleteArchived === undefined && this.archiveStore.deleteArchivedMany === undefined) throw new Error("Archive store does not support deletion");

    const uniqueRefs = uniqueBulkSessionRefs(refs);
    const archivedRecords = await this.archiveStore.list();
    const failures: SessionBulkFailure[] = [];
    const planItems: BulkDeletePlanItem[] = [];

    for (const ref of uniqueRefs) {
      const record = findArchivedRecordForBulkRef(archivedRecords, ref);
      if (record === undefined) {
        failures.push({ sessionId: ref.id, error: "Archived session not found" });
        continue;
      }

      const active = this.activeForRef({ id: record.sessionId, cwd: record.cwd });
      if (active !== undefined && this.hasActiveWork(active.runtime.session)) {
        failures.push({ sessionId: record.sessionId, error: "Stop current session activity before deleting archived session" });
        continue;
      }
      if (await this.closedSessionHasWaiting(record.sessionId, record.cwd)) {
        failures.push({ sessionId: record.sessionId, error: WAITING_MESSAGES_BLOCK_DELETE });
        continue;
      }
      planItems.push({ record });
    }

    const readyRecords: ArchivedSessionRecord[] = [];
    for (const item of planItems) {
      try {
        await this.closeActive(item.record.sessionId, { kind: "clear", reason: "delete" });
        readyRecords.push(item.record);
      } catch (error: unknown) {
        failures.push({ sessionId: item.record.sessionId, error: errorMessage(error) });
      }
    }

    const deleteIds = readyRecords.map((record) => record.sessionId);

    let deletedSessionIds: string[] = [];
    try {
      deletedSessionIds = await this.archiveStoreDeleteArchivedMany(deleteIds);
    } catch (error: unknown) {
      for (const sessionId of deleteIds) failures.push({ sessionId, error: errorMessage(error) });
    }
    const deletedIdSet = new Set(deletedSessionIds);
    await this.forgetUnreadSessions(readyRecords.filter((record) => deletedIdSet.has(record.sessionId)));

    return {
      deleted: true,
      deletedSessionIds,
      failures,
      generatedAt: new Date().toISOString(),
    };
  }

  async reload(ref: PiSessionRef): Promise<void> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    if (this.hasActiveWork(session)) throw new Error("Stop current session activity before reloading");

    const reopenedSession = await this.runTreeExclusiveOperation(
      [{ sessionId: session.sessionId, session }],
      "Stop current session activity before reloading",
      async () => {
        const priorGeneration = this.notificationGenerationBySession.get(session);
        const { sessionId, cwd } = notificationIdentityForSession(session);
        let candidateGeneration: SessionNotificationGeneration | undefined;
        try {
          await this.closeActive(
            sessionId,
            priorGeneration === undefined ? CLEAR_RUNTIME_NOTIFICATIONS : DEFER_RUNTIME_NOTIFICATIONS,
          );
          candidateGeneration = priorGeneration === undefined
            ? undefined
            : this.notificationStore.beginReplacement(priorGeneration, { sessionId, cwd });
          const reopened = await this.getActive(ref, candidateGeneration === undefined ? {} : { notificationGeneration: candidateGeneration });
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.commitReplacement(candidateGeneration));
          }
          return reopened.runtime.session;
        } catch (error: unknown) {
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.abortReplacement(candidateGeneration));
          }
          throw error;
        }
      },
    );
    this.publishStatus(reopenedSession);
  }

  async detachParent(ref: PiSessionRef): Promise<void> {
    const session = await this.getOrOpen(ref);
    const sessionFile = session.sessionFile;
    if (sessionFile === undefined || sessionFile === "") throw new Error("Session is not persisted");
    await clearParentSession(sessionFile);
    // The header rewrite keeps the inode, and whenever it leaves the file's
    // size unchanged it is invisible to the gateway's summary memo, which
    // cannot detect such rewrites from identity + size alone and would keep
    // listing the old parent link until restart.
    this.sessionManager.invalidateSessionFile(sessionFile);
    clearParentSessionHeader(session.sessionManager);
    this.unregisterSubsession(session.sessionId);
    await this.forgetUnreadSessions([{ sessionId: session.sessionId, cwd: session.sessionManager.getCwd() }]);
  }

  async clearQueue(ref: PiSessionRef): Promise<ClientSessionStatus> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);
    await this.emptyQueues(session);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  /**
   * Take one message back out of the queue, leaving the rest of it alone.
   *
   * The runtime has no such operation - `clearQueue()` empties both lanes and
   * hands them back (agent-session.d.ts: "Clear all queued messages and return
   * them") - so the only way to remove one entry is to empty the queue and put
   * the survivors back. That is why this reaches past `prompt()` to
   * `session.prompt()` directly: the wrapper drops a message whose text is
   * already queued as a double-send, which is exactly what a replay looks like,
   * so going through it would silently discard everything being restored.
   *
   * Matching is by text within a lane, first occurrence, because
   * `clientMessageId` is optional (other clients and older ones never mint
   * one) and the runtime itself keys its queue on text. Two identical queued
   * texts are therefore indistinguishable; taking the first keeps the visible
   * order stable and the caller re-renders from the returned status either way.
   */
  async recallQueuedMessage(ref: PiSessionRef, target: { kind?: QueuedPromptKind; text: string; clientMessageId?: string }): Promise<{ recalled: boolean; status: ClientSessionStatus }> {
    await this.assertWritable(ref);
    const session = await this.getOrOpen(ref);

    const owned = await this.ownedQueue.recall(session.sessionId, { ...(target.clientMessageId === undefined ? {} : { clientMessageId: target.clientMessageId }), ...(target.kind === undefined ? {} : { lane: target.kind }), text: target.text });
    if (owned !== undefined) {
      this.withdraw(session.sessionId, owned.clientMessageId);
      this.publishStatus(session);
      return { recalled: true, status: this.statusFromSession(session) };
    }

    // Inside the session-entry mutation, because the queue is empty in the
    // middle of this: a prompt that arrives between the clear and the last
    // replay would either be pushed behind messages that were queued before it
    // or be dropped by the replay's own writes. Everything else that touches
    // session entries is serialized the same way.
    const recalled = await this.withQueueLock(session, () => this.recallFromRuntime(session, target));
    const removed = recalled.removed;
    if (removed) this.withdraw(session.sessionId, recalled.clientMessageId);
    this.settleConsumedSteers(session);
    this.publishActivity(session, removed ? "queued message recalled" : "queued message already gone", "active");
    this.publishStatus(session);
    this.pumpInbox(session);
    // Whether anything was actually taken back is the caller's business: the
    // agent can read a message between the click and this request, and a client
    // that assumes success would delete a bubble the conversation already
    // contains - the message would vanish from the transcript and reappear in
    // the composer, ready to be sent a second time.
    return { recalled: removed, status: this.statusFromSession(session) };
  }

  /**
   * Take one message out of what pi holds. Messages the agent loop has already taken are about
   * to be read and cannot be recalled. While the agent runs, pi's lanes are rewritten
   * without it. Once the run is over, replaying the survivors would start each as a new run
   * under the queue lock, so everything pi holds goes back to the inbox first and the message
   * is recalled from there.
   */
  private async recallFromRuntime(session: PiAgentSession, target: { kind?: QueuedPromptKind; text: string; clientMessageId?: string }): Promise<{ removed: boolean; clientMessageId?: string }> {
    const sessionId = session.sessionId;
    const { loopHeld } = partitionLanes(session, this.queuedPromptClientIds.get(sessionId) ?? []);
    if (loopHeld.some((entry) => target.clientMessageId === undefined ? entry.text === target.text : entry.clientMessageId === target.clientMessageId)) return { removed: false };
    if (loopHeld.length > 0 || this.runStateFor(session) !== "running") {
      await this.takeBackHeldMessages(session);
      const owned = await this.ownedQueue.recall(sessionId, { ...(target.clientMessageId === undefined ? {} : { clientMessageId: target.clientMessageId }), text: target.text });
      return owned === undefined ? { removed: false } : { removed: true, ...(owned.clientMessageId === undefined ? {} : { clientMessageId: owned.clientMessageId }) };
    }
    this.replayingLanes.add(sessionId);
    try {
      if (!await this.replayLanesWithout(session, target)) return { removed: false };
      const clientMessageId = this.forgetQueuedPromptClientId(sessionId, target.text, target.clientMessageId, target.kind) ?? target.clientMessageId;
      return { removed: true, ...(clientMessageId === undefined ? {} : { clientMessageId }) };
    } finally {
      this.replayingLanes.delete(sessionId);
    }
  }

  /**
   * Empty pi's lanes and put back everything but the recalled message, in order. Consumed
   * steers are not settled meanwhile: the lanes are briefly short of what pi holds, and
   * settling then would mark messages still waiting as read.
   */
  private async replayLanesWithout(session: PiAgentSession, target: { kind?: QueuedPromptKind; text: string }): Promise<boolean> {
    const { steering, followUp } = this.notices.clearLanesKeepingNotices(session);
    const lanes: { kind: QueuedPromptKind; texts: string[] }[] = [
      { kind: "steer", texts: [...steering] },
      { kind: "followUp", texts: [...followUp] },
    ];
    let found = false;
    for (const lane of lanes) {
      if (found) break;
      if (target.kind !== undefined && target.kind !== lane.kind) continue;
      const index = lane.texts.indexOf(target.text);
      if (index === -1) continue;
      lane.texts.splice(index, 1);
      found = true;
    }
    // Order matters more than speed here: the survivors go back one at a
    // time, in the order the runtime handed them over, so a queue of three
    // that loses its middle entry still runs first-then-third.
    for (const lane of lanes) {
      for (const text of lane.texts) {
        // Survivors go back with whatever they arrived with. Replaying them
        // as bare text is how someone else's recall used to strip your
        // screenshot out of a message you had already sent.
        const images = this.takeQueuedPromptImages(session.sessionId, text);
        const behavior = promptDeliveryBehavior({ requestedBehavior: lane.kind, busyAtSubmit: session.isStreaming || session.isCompacting });
        await session.prompt(text, buildPromptOptions(behavior, images));
        if (images.length > 0) this.recordQueuedPromptImages(session.sessionId, text, images);
      }
    }
    if (found) this.takeQueuedPromptImages(session.sessionId, target.text);
    return found;
  }

  /**
   * Drop the correlation record for a recalled message so the sender's bubble
   * is not later re-stamped as still queued. Without an id, the first record
   * with matching text goes, mirroring how the queue itself is matched.
   */
  private forgetQueuedPromptClientId(sessionId: string, text: string, clientMessageId?: string, kind?: string): string | undefined {
    const records = this.queuedPromptClientIds.get(sessionId);
    if (records === undefined) return undefined;
    const index = clientMessageId === undefined
      ? records.findIndex((record) => record.text === text && (kind === undefined || record.kind === undefined || record.kind === kind))
      : records.findIndex((record) => record.clientMessageId === clientMessageId);
    if (index === -1) return undefined;
    const [forgotten] = records.splice(index, 1);
    if (records.length === 0) this.queuedPromptClientIds.delete(sessionId);
    else this.queuedPromptClientIds.set(sessionId, records);
    return forgotten?.clientMessageId;
  }

  /**
   * Tell every device the reader took this message back.
   *
   * Without the frame, another browser's bubble waits on a transcript claim
   * that will never come - the daemon deleted the entry, so absence is all the
   * other device would ever see, and its row would sit at "Queued" forever.
   */
  /**
   * Empty the inbox and pi's lanes, withdrawing every message in them, and return what was
   * waiting so the caller can hand it back.
   *
   * Nothing is handed while it runs, and it waits for a steer batch already in flight, so no
   * message is between the inbox and pi's queue when it looks: one would otherwise land after
   * the clear and run as a message every device was told was withdrawn. A batch that met a
   * finished run puts its rest back into the inbox, so the inbox is cleared again after it. Consumed steers are settled first, so a message the agent
   * already read is never announced withdrawn. Stop and Clear are confirmed removals like a
   * recall and announce the same way: the pressing device cleans its rows from the answer,
   * every other device needs the frame.
   */
  private async emptyQueues(session: PiAgentSession): Promise<QueuedSessionMessage[]> {
    const sessionId = session.sessionId;
    this.emptying.add(sessionId);
    try {
      const inbox = await this.ownedQueue.clear(sessionId);
      await this.steerBatches.get(sessionId);
      const restoredMeanwhile = await this.ownedQueue.clear(sessionId);
      this.settleConsumedSteers(session);
      const discarded = this.takeRuntimeLanes(session);
      for (const entry of [...restoredMeanwhile, ...inbox]) discarded.push({ kind: entry.lane, text: entry.text, ...(entry.clientMessageId === undefined ? {} : { clientMessageId: entry.clientMessageId }) });
      for (const entry of discarded) this.withdraw(sessionId, entry.clientMessageId);
      return discarded;
    } finally {
      this.emptying.delete(sessionId);
    }
  }

  /**
   * Empty pi's lanes and return what still waited there, with identities. Messages the agent
   * loop has already taken are neither handed back nor withdrawn: the loop commits them even
   * when the run is aborted, so handing them back would have them read twice. Clearing pi's
   * copy of them is harmless, since the loop holds its own.
   */
  private takeRuntimeLanes(session: PiAgentSession): QueuedSessionMessage[] {
    const sessionId = session.sessionId;
    const records = this.queuedPromptClientIds.get(sessionId) ?? [];
    const { loopHeld, waiting } = partitionLanes(session, records);
    this.settleLoopHeld(sessionId, loopHeld);
    for (const entry of waiting) this.settleHanded(sessionId, entry.clientMessageId);
    this.notices.clearLanesKeepingNotices(session);
    this.queuedPromptClientIds.delete(sessionId);
    this.queuedPromptImages.delete(sessionId);
    return waiting.map((entry) => {
      const original = records.find((record) => record.clientMessageId === entry.clientMessageId)?.entry;
      const id = publishedId(entry.clientMessageId);
      return { kind: entry.kind, text: original?.text ?? entry.text, ...(id === undefined ? {} : { clientMessageId: id }) };
    });
  }

  /**
   * Settle messages the agent loop holds as read. Their commit expectation stays, so the commit
   * that follows is still stamped with its sender's id - at close too, where a stamp-only
   * listener stays attached through the abort that lets the loop commit them.
   */
  private settleLoopHeld(sessionId: string, loopHeld: readonly LaneEntry[]): void {
    for (const entry of loopHeld) this.settleSucceeded(sessionId, entry.clientMessageId);
  }

  private withdraw(sessionId: string, candidate: string | undefined): void {
    const clientMessageId = publishedId(candidate);
    this.settleHanded(sessionId, candidate);
    if (clientMessageId === undefined) return;
    this.acceptanceLedger.settle(sessionId, clientMessageId, "withdrawn");
    this.committedExpectations.withdraw(sessionId, clientMessageId);
    this.events.publish(sessionId, { type: "prompt.withdrawn", clientMessageId });
  }

  async dismissWarning(ref: PiSessionRef, dismissId: string): Promise<ClientSessionStatus> {
    const session = await this.getOrOpen(ref);
    dismissSessionWarning(session, dismissId);
    this.publishStatus(session);
    return this.statusFromSession(session);
  }

  /**
   * Stop the current work and hand back anything that was waiting.
   *
   * Aborting has to empty the queue - those messages were written for a turn
   * that is being cancelled - but emptying it used to destroy them outright, so
   * pressing stop silently deleted work the user had already typed and could
   * not get back. The texts are returned instead, and the caller puts them in
   * the composer: same transition as a recall, different trigger.
   *
   * A session with no runtime has nothing to stop, which is an answer only when the session
   * exists: one no store holds answers `session-not-found`, so a Stop on a session deleted
   * elsewhere is not a quiet success (P2 slice b part 2, G5).
   */
  async abort(ref: PiSessionRef): Promise<{ discarded: QueuedSessionMessage[] }> {
    const active = this.activeForRef(ref);
    if (active === undefined) {
      await this.locate(ref);
      return { discarded: [] };
    }
    const sessionId = active.runtime.session.sessionId;
    const discarded = await this.emptyQueues(active.runtime.session);
    // Settle run-scoped dialogs now, at abort-request time: pi's agent loop
    // waits for a parked `tool_call` dialog handler before it can emit
    // `agent_end`, so leaving settlement to the `agent_end` observer would
    // strand the dialog until its timeout. Settling before the runtime abort
    // also means a failing or hung abort cannot strand the parked waiter.
    this.abortRunScopedExtensionDialogs(sessionId);
    this.events.publish(sessionId, { type: "session.stopped", cause: "user" });
    if (active.runtime.session.isStreaming) this.recordStopByReader(active.runtime.session);
    try {
      await this.abortSessionOperations(active.runtime.session);
      await this.stopHandoffInFlight(active.runtime.session);
      await this.notices.commit(active.runtime.session);
      this.publishActivity(active.runtime.session, "stopped", "idle");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.publishActivity(active.runtime.session, "stop failed", "error", message);
      throw error;
    } finally {
      this.publishStatus(active.runtime.session);
    }
    return { discarded };
  }

  async stop(ref: PiSessionRef): Promise<void> {
    const active = this.activeForRef(ref);
    if (active !== undefined) {
      await this.closeActive(active.runtime.session.sessionId);
      return;
    }
    // A session whose open is parked (e.g. on a session_start dialog) is not
    // active yet; close it through the same path so stopping cannot block
    // behind the dialog timeout.
    const startup = this.startupSessionForRef(ref);
    if (startup !== undefined) {
      await this.closeActive(startup.sessionId);
      return;
    }
    await this.locate(ref);
    this.publishNotificationMutations(this.notificationStore.clearSessionIdentity(ref.id, canonicalizeStoredCwd(ref.cwd), "runtime-close"));
  }

  private async bulkSessionRefContext(refs: readonly SessionBulkMutationRef[]): Promise<BulkSessionRefContext> {
    const cwdSet = new Set<string>();
    for (const ref of refs) cwdSet.add(ref.cwd);
    return { sessionsByCwd: await this.listSessionsByCwd([...cwdSet]) };
  }

  private async listSessionsByCwd(cwds: readonly string[]): Promise<Map<string, PiSessionListEntry[]>> {
    const uniqueCwds = uniqueStrings(cwds);
    const entries = await Promise.all(uniqueCwds.map(async (cwd) => [cwd, await this.sessionManager.list(cwd)] as const));
    return new Map(entries);
  }

  private async archiveStoreArchiveMany(inputs: readonly ArchiveSessionInput[]): Promise<ArchivedSessionRecord[]> {
    if (inputs.length === 0) return [];
    if (this.archiveStore.archiveMany !== undefined) return this.archiveStore.archiveMany(inputs);
    const records: ArchivedSessionRecord[] = [];
    for (const input of inputs) records.push(await this.archiveStore.archive(input));
    return records;
  }

  private async archiveStoreDeleteArchivedMany(sessionIds: readonly string[]): Promise<string[]> {
    if (sessionIds.length === 0) return [];
    if (this.archiveStore.deleteArchivedMany !== undefined) return this.archiveStore.deleteArchivedMany(sessionIds);
    if (this.archiveStore.deleteArchived === undefined) throw new Error("Archive store does not support deletion");
    for (const sessionId of sessionIds) await this.archiveStore.deleteArchived(sessionId);
    return [...sessionIds];
  }

  private async cleanupPlan(request: NormalizedSessionCleanupRequest) {
    const [sessions, archivedRecords] = await Promise.all([this.sessionManager.listAll(), this.archiveStore.list()]);
    return planSessionCleanup({
      sessions,
      archivedRecords,
      activeSessions: this.cleanupActiveSessionStatuses(),
      thresholds: request.thresholds,
      ...(request.projectCwds === undefined ? {} : { projectCwds: request.projectCwds }),
      directoryExists: (path) => existsSync(path),
      now: this.now(),
    });
  }

  /**
   * Sessions whose work should not be interrupted by a restart.
   *
   * Used by the shutdown drain, which is why it reports only genuinely active
   * work rather than every loaded session: a restart should wait for a running
   * turn, not for every session that happens to be open.
   */
  /**
   * Sessions with work in flight, with the cwd needed to reopen them.
   *
   * Used when a shutdown has to interrupt work: an id alone is not enough to
   * find the session again, and the record is written when the daemon is
   * already past its drain deadline.
   */
  activeWorkSessions(): { sessionId: string; cwd: string }[] {
    return [...new Set(this.active.values())]
      .filter((active) => this.hasActiveWork(active.runtime.session))
      .map((active) => ({
        sessionId: active.runtime.session.sessionId,
        cwd: canonicalizeStoredCwd(active.runtime.session.sessionManager.getCwd()),
      }));
  }

  activeWorkSessionIds(): string[] {
    return [...new Set(this.active.values())]
      .filter((active) => this.hasActiveWork(active.runtime.session))
      .map((active) => active.runtime.session.sessionId);
  }

  private cleanupActiveSessionStatuses(): { sessionId: string; hasActiveWork: boolean }[] {
    return [...new Set(this.active.values())].map((active) => ({
      sessionId: active.runtime.session.sessionId,
      hasActiveWork: this.hasActiveWork(active.runtime.session),
    }));
  }

  private activeSessionHasWork(sessionId: string): boolean {
    const active = this.active.get(sessionId);
    return active !== undefined && this.hasActiveWork(active.runtime.session);
  }

  /**
   * Messages waiting for a session that is not open keep it from being archived or deleted, as
   * they keep an open one: archived, they would wait for a read-only session; deleted, they would
   * never be delivered nor handed back. Opening the session delivers them.
   */
  private async closedSessionHasWaiting(sessionId: string, cwd: string): Promise<boolean> {
    return this.active.get(sessionId) === undefined && await this.ownedQueue.hasWaiting(sessionId, cwd);
  }

  private reconcilableSessionIds(cwd: string, listedSessionIds: string[], archivedById: Map<string, ArchivedSessionRecord>): string[] {
    const sessionIds = new Set(listedSessionIds);
    for (const active of new Set(this.active.values())) {
      const session = active.runtime.session;
      if (session.sessionManager.getCwd() === cwd && !archivedById.has(session.sessionId)) sessionIds.add(session.sessionId);
    }
    return [...sessionIds];
  }

  private async archiveInputForSession(session: PiAgentSession): Promise<ArchiveSessionInput> {
    const cwd = session.sessionManager.getCwd();
    const sessionFile = session.sessionFile;
    if (sessionFile === undefined || sessionFile === "") throw new Error("Session is not persisted");
    const listed = (await this.sessionManager.list(cwd)).find((candidate) => candidate.id === session.sessionId);
    if (listed !== undefined) return archiveInputFromListEntry(listed);
    return archiveInputFromActiveSession(session);
  }

  private async workspaceArchiveCandidates(cwd: string): Promise<WorkspaceArchiveCandidate[]> {
    const [sessions, archivedRecords] = await Promise.all([this.sessionManager.list(cwd), this.archiveStore.list()]);
    const candidates = new Map<string, WorkspaceArchiveCandidate>();
    const archivedById = new Map<string, ArchivedSessionRecord>();

    for (const record of archivedRecords) {
      if (record.cwd === cwd) archivedById.set(record.sessionId, record);
    }

    for (const session of sessions) {
      const archived = archivedById.get(session.id);
      if (archived === undefined) candidates.set(session.id, archiveCandidateFromListEntry(session));
      else {
        const candidate = archiveCandidateFromArchivedRecord(archived, session);
        if (candidate !== undefined) candidates.set(candidate.id, candidate);
      }
    }

    for (const record of archivedById.values()) {
      if (candidates.has(record.sessionId)) continue;
      const candidate = archiveCandidateFromArchivedRecord(record, undefined);
      if (candidate !== undefined) candidates.set(candidate.id, candidate);
    }

    for (const active of new Set(this.active.values())) {
      const session = active.runtime.session;
      if (session.sessionManager.getCwd() !== cwd || archivedById.has(session.sessionId)) continue;
      const existing = candidates.get(session.sessionId);
      candidates.set(session.sessionId, { ...(existing ?? archiveCandidateFromActiveSession(session, false)), activeSession: session });
    }

    return [...candidates.values()];
  }

  private async listSessionNames(cwd: string): Promise<string[]> {
    const [sessions, archivedRecords] = await Promise.all([this.sessionManager.list(cwd), this.archiveStore.list()]);
    const names = new Set<string>();
    for (const session of sessions) addSessionName(names, session.name);
    for (const record of archivedRecords) {
      if (record.cwd === cwd) addSessionName(names, record.name);
    }
    for (const active of new Set(this.active.values())) {
      const session = active.runtime.session;
      if (session.sessionManager.getCwd() === cwd) addSessionName(names, session.sessionName);
    }
    return [...names];
  }

  private async closeActive(sessionId: string, notificationPolicy: NotificationClosePolicy = CLEAR_RUNTIME_NOTIFICATIONS): Promise<void> {
    // A session whose open is parked on a `session_start` dialog holds its
    // pending open until the dialog settles; settle it first so closing cannot
    // block behind the dialog timeout (which `0` makes infinite).
    if (this.startupSessions.has(sessionId)) this.endSessionExtensionDialogs(sessionId);
    const pendingOpens = this.pendingSessionOpenPromises(sessionId);
    const closed = this.markClosing(sessionId);
    try {
      await this.closeActiveRuntime(sessionId, notificationPolicy, pendingOpens);
    } finally {
      closed();
    }
  }

  /**
   * Hold back any reopen of this session id until its close finishes. Everything the inbox keeps
   * per session - lane accounting, handoff watchers, commit expectations, the queue's memory - is
   * keyed by session id, and a runtime reopened while the old one aborts would share it: the old
   * close would forget the new runtime's state, or leave its own stale state for the new one.
   * Opens already pending when the close began are awaited by the close, not held back.
   */
  private markClosing(sessionId: string): () => void {
    let finish = (): void => undefined;
    const closing = new Promise<void>((resolve) => { finish = resolve; });
    const earlier = this.closingSessions.get(sessionId);
    const pending = earlier === undefined ? closing : Promise.all([earlier, closing]).then(() => undefined);
    this.closingSessions.set(sessionId, pending);
    const release = (): void => {
      clearTimeout(ceiling);
      finish();
      if (this.closingSessions.get(sessionId) === pending) this.closingSessions.delete(sessionId);
    };
    const ceiling = setTimeout(release, CLOSE_LOCK_MAX_MS);
    return release;
  }

  private async closeActiveRuntime(sessionId: string, notificationPolicy: NotificationClosePolicy, pendingOpens: readonly Promise<unknown>[]): Promise<void> {
    if (pendingOpens.length > 0) await Promise.allSettled(pendingOpens);
    const active = this.active.get(sessionId);
    if (notificationPolicy.kind === "clear") {
      const generation = active === undefined ? undefined : this.notificationGenerationBySession.get(active.runtime.session);
      const mutations = generation === undefined
        ? this.notificationStore.clearSession(sessionId, notificationPolicy.reason)
        : this.notificationStore.clearGeneration(generation, notificationPolicy.reason);
      this.publishNotificationMutations(mutations);
    }
    if (!active) return;
    this.forgetUnreadActivity(active.runtime.session);
    // An open ask is meaningful only while the runtime that posted it exists: no
    // one is left to receive the answers, so it is dropped without an outcome.
    this.pendingAskStore.forgetSession(sessionId);
    // Open dialogs share that stance, but their extension waiters are parked
    // Promises inside the dying runtime: settle them rather than dropping them.
    this.endSessionExtensionDialogs(sessionId);
    this.active.delete(sessionId);
    this.backgroundWorkWatcher.forget(sessionId);
    this.releaseWorkspaceWatch(active.runtime.session);
    this.activities.delete(sessionId);
    this.steps.delete(sessionId);
    this.workspaceActivity?.removeSession(sessionId, active.runtime.session.sessionManager.getCwd());
    this.clearAuthLossWarningsForSession(sessionId);
    await this.keepWhatThePiHolds(active.runtime.session);
    this.forgetInboxState(sessionId);
    // A reload queued against a session that is going away has nothing left to
    // reload; saying so beats leaving the person waiting for it.
    this.commandService.cancelQueuedReload(sessionId);
    // Disarm subsession notification before teardown so the abort below cannot
    // emit a "stopped working" event that notifies the parent (e.g. on archive).
    // The parent/children link is kept so the parent can still see the child.
    if (this.subsessionLinkForActiveChild(active.runtime.session) !== undefined) this.subsessionNotifyArmed.delete(sessionId);
    this.notices.clearLanesKeepingNotices(active.runtime.session);
    active.unsubscribe();
    active.runtime.setRebindSession(undefined);
    try {
      this.events.publish(sessionId, { type: "session.stopped", cause: "closed" });
      await this.abortStampingCommits(active.runtime.session);
      await this.notices.commit(active.runtime.session);
    } finally {
      await active.runtime.dispose();
    }
  }

  /**
   * Before a runtime goes away: let the handoff in flight finish (a message it no longer may
   * hand goes back to the inbox, see `servesSessionId`), then take back what pi holds
   * unread into the inbox file, where the next runtime - or the next daemon - hands it again.
   * Steers the agent loop already holds stay; the abort lets the loop commit them.
   *
   * A handoff that does not settle within the bound (an idle batch whose oldest message is in a
   * long pre-prompt compaction) does not delay the take-back: the close empties pi's lanes next,
   * and a take-back after that would read the messages missing from them as read (review of the
   * idle batch, B33).
   */
  private async keepWhatThePiHolds(session: PiAgentSession): Promise<void> {
    try {
      const outcome = await withinHandoffBound((async () => {
        await this.handoffChains.get(session.sessionId);
        await this.takeBackHeldMessages(session);
      })());
      if (outcome === "timed out") {
        console.warn(`[inbox] ${session.sessionId}: a handoff did not settle within ${String(TEARDOWN_TAKE_BACK_MS)} ms; taking back what pi holds without it`);
        await this.takeBackHeldMessages(session);
      }
    } catch (error: unknown) {
      console.warn(`[inbox] ${session.sessionId}: keeping pi's unread messages failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * A Stop while a direct handoff is before its run - a pre-prompt compaction, extension input
   * handlers, image preparation - aborts nothing the SDK then starts: the message has left the
   * inbox and is in no lane, and the run it starts after the abort would ignore the Stop. Wait,
   * bounded, for that handoff to land (the chain ends at the message's commit), and stop the run.
   * Not for a slash command: its handler may wait on anything, and Stop does not wait for it, as
   * it does not inside a steer batch.
   */
  private async stopHandoffInFlight(session: PiAgentSession): Promise<void> {
    if (!this.handing.has(session.sessionId) || this.handingCommands.has(session.sessionId)) return;
    const outcome = await withinHandoffBound(this.handoffChains.get(session.sessionId) ?? Promise.resolve());
    if (outcome !== "done" || !session.isStreaming) return;
    this.recordStopByReader(session);
    await this.abortSessionOperations(session);
  }

  /** Per-session inbox state. Safe to drop at close: no runtime can reopen the id until the close ends. */
  private forgetInboxState(sessionId: string): void {
    this.openRuns.delete(sessionId);
    this.laneSizes.delete(sessionId);
    this.laneGrowth.delete(sessionId);
    this.directCommitWatchers.delete(sessionId);
    this.runStartWatchers.delete(sessionId);
  }

  /**
   * Abort a runtime whose main listener is already gone, still stamping the commits the abort
   * lets its loop make (steers it had drained), then forget the commit expectations this runtime
   * left - and only those: a runtime reopened under the same session id meanwhile has its own.
   */
  private async abortStampingCommits(session: PiAgentSession): Promise<void> {
    const sessionId = session.sessionId;
    const leftBehind = this.committedExpectations.expectedIds(sessionId);
    const stampOnly = session.subscribe((event) => { this.stampCommittedUserMessage(session, event); });
    try {
      await this.abortSessionOperations(session);
    } finally {
      stampOnly();
      for (const clientMessageId of leftBehind) this.committedExpectations.withdraw(sessionId, clientMessageId);
    }
  }

  private async abortSessionOperations(session: PiAgentSession): Promise<void> {
    let branchSummaryAbortFailed = false;
    let branchSummaryAbortError: unknown;
    try {
      session.abortBranchSummary?.();
    } catch (error: unknown) {
      branchSummaryAbortFailed = true;
      branchSummaryAbortError = error;
    }

    try {
      await session.abort();
    } catch (abortError: unknown) {
      if (branchSummaryAbortFailed) {
        throw new AggregateError([branchSummaryAbortError, abortError], "Failed to abort session operations", { cause: abortError });
      }
      throw abortError;
    }
    if (branchSummaryAbortFailed) throw branchSummaryAbortError;
  }

  private async assertWritable(ref: PiSessionRef): Promise<void> {
    if (await this.getArchived(ref) !== undefined) throw new Error("Archived sessions are read-only. Restore the session to continue.");
  }

  private async getOrOpen(ref: PiSessionRef): Promise<PiAgentSession> {
    return (await this.getActive(ref)).runtime.session;
  }

  private async getActive(ref: PiSessionRef, options: Pick<CreateSessionRuntimeOptions, "notificationGeneration"> = {}): Promise<ActiveSession<PiSessionRuntime>> {
    const active = this.activeForRef(ref);
    if (active !== undefined) return active;

    const archived = await this.getArchived(ref);
    if (archived?.archivePath !== undefined) {
      const { archivePath } = archived;
      return this.openExistingSession(
        archived.sessionId,
        archived.cwd,
        () => this.sessionManager.open(archivePath),
        { notifications: "disabled" },
      );
    }

    // Resolve the session file directly by id: opening one known session must
    // not depend on — or wait behind — a full transcript listing of its whole
    // workspace. `getActive` routes prompt/shell/runCommand, so coupling it to
    // the listing would let an in-flight listing serialize unrelated sends.
    const match = await this.sessionManager.resolveSessionFile(ref.cwd, ref.id);
    if (!match) throw new SessionNotFoundError();
    return this.openExistingSession(match.id, match.cwd, () => this.sessionManager.open(match.path), options);
  }

  private openExistingSession(
    sessionId: string,
    cwd: string,
    openSessionManager: () => PiSessionManager,
    options: Pick<CreateSessionRuntimeOptions, "notificationGeneration" | "notifications"> = {},
  ): Promise<ActiveSession<PiSessionRuntime>> {
    const active = this.activeForRef({ id: sessionId, cwd });
    if (active !== undefined) return Promise.resolve(active);

    const key = JSON.stringify([canonicalizeStoredCwd(cwd), sessionId]);
    const existing = this.pendingSessionOpens.get(key);
    if (existing !== undefined) return existing.promise;

    const closing = this.closingSessions.get(sessionId);
    const pending: PendingSessionOpen = {
      sessionId,
      promise: closing === undefined
        ? this.createUnlocked(openSessionManager(), cwd, options)
        : closing.then(() => this.createUnlocked(openSessionManager(), cwd, options)),
    };
    pending.promise = pending.promise.finally(() => {
      if (this.pendingSessionOpens.get(key) === pending) this.pendingSessionOpens.delete(key);
    });
    this.pendingSessionOpens.set(key, pending);
    return pending.promise;
  }

  private pendingSessionOpenPromises(sessionId?: string): Promise<ActiveSession<PiSessionRuntime>>[] {
    return [...this.pendingSessionOpens.values()]
      .filter((pending) => sessionId === undefined || pending.sessionId === sessionId)
      .map((pending) => pending.promise);
  }

  private async getArchived(ref: PiSessionRef): Promise<ArchivedSessionRecord | undefined> {
    const archived = await this.archiveStore.get(ref.id);
    if (archived === undefined) return undefined;
    if (archived.cwd !== ref.cwd) return undefined;
    return archived;
  }

  private isCurrentActiveSession(session: PiAgentSession): boolean {
    return this.active.get(session.sessionId)?.runtime.session === session;
  }

  /**
   * The command service tracks sessions by id alone; its callbacks only ever
   * run against a session the caller just resolved as active, so the cwd
   * needed for a full ref comes from that active runtime.
   */
  private activeSessionRef(sessionId: string): PiSessionRef {
    const active = this.active.get(sessionId);
    if (active === undefined) throw new SessionNotFoundError();
    return { id: sessionId, cwd: active.runtime.cwd };
  }

  /**
   * Debug-only capture of the exact model surface an active session was
   * constructed with (match-tui-prompt 4.1). Returns undefined when the
   * session is not active or its runtime does not carry the capture (light
   * test runtimes) — absence is "unavailable", never an empty claim.
   */
  captureModelSurface(sessionId: string): { systemPrompt: string; tools: readonly { name: string; description: string }[] } | undefined {
    const active = this.active.get(sessionId);
    if (active === undefined) return undefined;
    const session = active.runtime.session;
    if (session.captureModelSurface === undefined) return undefined;
    return session.captureModelSurface();
  }

  private activeForRef(ref: PiSessionRef): ActiveSession<PiSessionRuntime> | undefined {
    const sessionId = ref.id;
    const exact = this.active.get(sessionId);
    if (exact !== undefined && refMatchesActiveSession(ref, exact)) return exact;
    for (const [candidateId, active] of this.active.entries()) {
      if (candidateId.startsWith(sessionId) && refMatchesActiveSession(ref, active)) return active;
    }
    return undefined;
  }

  private startupSessionForRef(ref: PiSessionRef): PiAgentSession | undefined {
    const sessionId = ref.id;
    const exact = this.startupSessions.get(sessionId);
    if (exact !== undefined && refMatchesStartupSession(ref, exact)) return exact;
    for (const [candidateId, session] of this.startupSessions.entries()) {
      if (candidateId.startsWith(sessionId) && refMatchesStartupSession(ref, session)) return session;
    }
    return undefined;
  }

  /**
   * The session to serve a read-only status or a dialog close for, while it
   * can still be found: active first, then still starting up, and only then
   * the on-demand open path (which a stale close on an idle session needs for
   * its status projection).
   */
  private async sessionForStatusOrDialogClose(ref: PiSessionRef): Promise<PiAgentSession> {
    const reachable = this.activeForRef(ref)?.runtime.session ?? this.startupSessionForRef(ref);
    if (reachable !== undefined) return reachable;
    return this.getOrOpen(ref);
  }

  /**
   * Construct a session while telling waiting browsers which phase of startup
   * they are waiting on. The reporting wraps the *whole* construction rather
   * than the inner bookkeeping `try`, because the runtime construction that runs
   * first is both the slowest phase and one that can fail on its own; a clear
   * that only ran for the later phases would leave a stale label behind.
   */
  private async create(
    sessionManager: PiSessionManager,
    cwd: string,
    options: CreateSessionRuntimeOptions = {},
  ): Promise<ActiveSession<PiSessionRuntime>> {
    const closing = this.closingSessions.get(sessionManager.getSessionId());
    if (closing !== undefined) await closing;
    return this.createUnlocked(sessionManager, cwd, options);
  }

  /**
   * Create a runtime without consulting the closing lock. An open waits only for the close it
   * saw when it was requested: re-reading the lock later could find it combined with a newer
   * close that is itself waiting for this open, and neither would ever finish.
   */
  private async createUnlocked(
    sessionManager: PiSessionManager,
    cwd: string,
    options: CreateSessionRuntimeOptions = {},
  ): Promise<ActiveSession<PiSessionRuntime>> {
    const startup = this.startupProgress(sessionManager, options.startupIntent ?? "open", options.startupToken);
    try {
      return await this.createSessionRuntime(sessionManager, cwd, options, startup);
    } finally {
      startup.end();
    }
  }

  private async createSessionRuntime(
    sessionManager: PiSessionManager,
    cwd: string,
    options: CreateSessionRuntimeOptions,
    startup: SessionStartupProgressReporter,
  ): Promise<ActiveSession<PiSessionRuntime>> {
    startup.report(STARTUP_PHASE_RUNTIME);
    const runtime = await this.createAgentRuntime(this.createRuntime, {
      cwd,
      agentDir: this.agentDir,
      sessionManager,
      ...(options.initialModel === undefined ? {} : { initialModel: options.initialModel }),
      ...(options.initialThinkingLevel === undefined ? {} : { initialThinkingLevel: options.initialThinkingLevel }),
    });
    const active: ActiveSession<PiSessionRuntime> = { runtime, unsubscribe: noop };
    if (options.notifications === "disabled") this.archivedRuntimes.add(runtime.session);
    let boundSession = runtime.session;
    let notificationGeneration = options.notificationGeneration;
    let notificationOwnership: "disabled" | "external" | "registered" | "replacement" = options.notifications === "disabled"
      ? "disabled"
      : notificationGeneration === undefined
        ? "registered"
        : "external";

    if (notificationOwnership === "registered") {
      const notificationIdentity = notificationIdentityForSession(runtime.session);
      const existingCandidate = this.notificationStore.beginReplacementForSession(
        notificationIdentity.sessionId,
        notificationIdentity.cwd,
      );
      if (existingCandidate !== undefined) {
        notificationGeneration = existingCandidate;
        notificationOwnership = "replacement";
      } else {
        const registration = this.notificationStore.registerSession(
          notificationIdentity.sessionId,
          notificationIdentity.cwd,
        );
        notificationGeneration = registration.generation;
        this.publishNotificationMutations(registration.mutations);
      }
    }
    if (notificationGeneration !== undefined) this.notificationGenerationBySession.set(runtime.session, notificationGeneration);

    try {
      if (options.creationProvenance === "tracked-subsession") {
        await this.publishUnreadMutations(this.unreadStore.excludeSession(
          runtime.session.sessionId,
          canonicalizeStoredCwd(runtime.session.sessionManager.getCwd()),
        ));
      } else {
        await this.recoverSubsessionTrackingForOpenedSession(runtime.session);
      }
      startup.report(STARTUP_PHASE_EXTENSIONS);
      await this.bindSessionExtensions(runtime.session, notificationGeneration);
      await this.bindRuntime(active);
      runtime.setRebindSession(async (session) => {
        const priorGeneration = notificationGeneration;
        let candidateGeneration: SessionNotificationGeneration | undefined;
        try {
          await this.prepareUnreadRuntimeRebind(boundSession, session);
          await this.recoverSubsessionTrackingForOpenedSession(session);
          if (priorGeneration !== undefined) {
            candidateGeneration = this.notificationStore.beginReplacement(priorGeneration, notificationIdentityForSession(session));
            this.notificationGenerationBySession.set(session, candidateGeneration);
          }
          this.releaseWorkspaceWatch(boundSession);
          if (this.archivedRuntimes.has(boundSession)) this.archivedRuntimes.add(session);
          await this.bindRuntime(active, session);
          this.holdWorkspaceWatch(session);
          // The runtime being replaced parked every dialog the store still
          // holds for this session; settle those waits before the new
          // runtime's extensions can open fresh dialogs under the same id.
          this.endSessionExtensionDialogs(boundSession.sessionId);
          boundSession = session;
          await this.bindSessionExtensions(session, candidateGeneration);
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.commitReplacement(candidateGeneration));
            notificationGeneration = candidateGeneration;
          }
        } catch (error: unknown) {
          if (candidateGeneration !== undefined) {
            this.publishNotificationMutations(this.notificationStore.abortReplacement(candidateGeneration, "candidate"));
            notificationGeneration = candidateGeneration;
            this.notificationGenerationBySession.set(session, candidateGeneration);
          }
          throw error;
        }
      });
      this.active.set(runtime.session.sessionId, active);
      this.watchBackgroundWork(runtime.session);
      this.holdWorkspaceWatch(runtime.session);
      this.backgroundRunRefreshRequested = true;
      void this.refreshBackgroundRunCounts();
      if (notificationOwnership === "replacement" && notificationGeneration !== undefined) {
        this.publishNotificationMutations(this.notificationStore.commitReplacement(notificationGeneration));
        notificationOwnership = "external";
      }
      this.publishStatus(runtime.session);
      return active;
    } catch (error: unknown) {
      if (notificationGeneration !== undefined) {
        if (notificationOwnership === "registered") {
          this.publishNotificationMutations(this.notificationStore.clearSession(runtime.session.sessionId, "initialization-failed"));
        } else if (notificationOwnership === "replacement") {
          this.publishNotificationMutations(this.notificationStore.abortReplacement(notificationGeneration));
        }
      }
      active.unsubscribe();
      this.forgetUnreadActivity(boundSession);
      // A session_start dialog may already be parked when a later startup
      // step fails; its waiter dies with the runtime being torn down here.
      this.endSessionExtensionDialogs(boundSession.sessionId);
      let removedActive = false;
      for (const [sessionId, candidate] of this.active.entries()) {
        if (candidate !== active) continue;
        this.active.delete(sessionId);
        this.activities.delete(sessionId);
        this.steps.delete(sessionId);
        this.clearAuthLossWarningsForSession(sessionId);
        this.commandService.cancelQueuedReload(sessionId);
        removedActive = true;
      }
      if (removedActive) {
        this.workspaceActivity?.removeSession(runtime.session.sessionId, runtime.session.sessionManager.getCwd());
        this.releaseWorkspaceWatch(runtime.session);
      }
      try {
        await runtime.session.abort();
      } finally {
        await runtime.dispose();
      }
      throw error;
    }
  }

  private async bindSessionExtensions(
    session: PiAgentSession,
    generation: SessionNotificationGeneration | undefined,
  ): Promise<void> {
    const uiContext = this.sessionUiContext(session, generation);
    // A `session_start` hook can park this bind on a dialog the browser has
    // not answered yet. On the initial create/open path the session becomes
    // active only after this returns, so register it for the duration: the
    // answer that unblocks startup has to be reachable while it waits.
    this.startupSessions.set(session.sessionId, session);
    try {
      await session.bindExtensions({
        uiContext,
        mode: "rpc",
        onError: (error) => {
          const message = `${error.extensionPath}: ${error.error}`;
          this.publishActivity(session, "extension error", "error", message);
          this.events.publish(session.sessionId, { type: "session.error", message });
        },
      });
    } finally {
      this.startupSessions.delete(session.sessionId);
    }
  }

  private replaceSessionNotificationContext(session: PiAgentSession, generation: SessionNotificationGeneration): void {
    session.extensionRunner.setUIContext(this.sessionUiContext(session, generation), "rpc");
  }

  private sessionUiContext(
    session: PiAgentSession,
    generation: SessionNotificationGeneration | undefined,
  ): ExtensionUIContext {
    const baseUiContext = session.extensionRunner.getUIContext();
    // A notification is written twice on purpose: into the transcript, where a
    // reader sees it, and into the notification store, which carries the unread
    // state. Only the store used to be written, and nothing reads it - the
    // client never calls `notificationInbox` - so `/goal-list` answered into a
    // surface that is not rendered and read as "the command ignores me".
    const notify: ExtensionUIContext["notify"] = (message, type) => {
      this.events.publish(session.sessionId, {
        type: "command.output",
        level: type === "error" ? "error" : "info",
        message,
      });
      if (generation === undefined) return;
      const added = this.notificationStore.addNotification(generation, message, type);
      this.publishNotificationMutations(added.mutations);
    };
    // PI WEB owns the browser-facing dialog, notification, and text-formatting
    // boundaries: the three dialog primitives park daemon-held Promises that
    // the browser answers, while every other UI method delegates to Pi's
    // headless defaults so unsupported surfaces cancel safely instead of
    // hanging.
    return new Proxy(baseUiContext, {
      get: (target, property, receiver): unknown => {
        if (property === "notify") return notify;
        if (property === "theme") return plainTextTheme;
        if (property === "piWebScreens") return DECLARABLE_SCREENS;
        // The headless default resolves `custom` to undefined without a word,
        // so an extension waiting on an answer - the updater's version prompt,
        // for instance - believed the user chose nothing and asked again next
        // session. The cancellation stays; the silence goes.
        if (property === "custom") {
          // Rendered, not cancelled. Pi's headless default resolves this promise
          // without running the factory, so a screen the extension meant to show
          // was an immediate no-op; here the factory runs, its component draws
          // into lines, and the browser shows them.
          console.error(`[custom-trap] hit for ${session.sessionId}`);
          return (factory: unknown, opts?: unknown) => this.openCustomScreen(session, factory, opts);
        }
        if (property === "confirm") {
          return (title: string, message: string, opts?: ExtensionUIDialogOptions) =>
            this.openExtensionDialog(session, { kind: "confirm", title, message }, opts);
        }
        if (property === "select") {
          return (title: string, options: string[], opts?: ExtensionUIDialogOptions) =>
            this.openExtensionDialog(session, { kind: "select", title, options }, opts);
        }
        if (property === "input") {
          return (title: string, placeholder: string | undefined, opts?: ExtensionUIDialogOptions) =>
            this.openExtensionDialog(session, { kind: "input", title, placeholder }, opts);
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      },
    });
  }

  private publishNotificationMutations(mutations: readonly SessionNotificationMutation[]): void {
    for (const mutation of mutations) {
      this.events.publish(mutation.sessionId, mutation.inboxEvent);
      this.events.publishNotificationSummary(mutation.summaryEvent);
    }
  }

  private async prepareUnreadRuntimeRebind(previous: PiAgentSession, next: PiAgentSession): Promise<void> {
    const previousCwd = canonicalizeStoredCwd(previous.sessionManager.getCwd());
    this.unreadStore.forgetActivity(previous.sessionId, previousCwd);
    const nextCwd = canonicalizeStoredCwd(next.sessionManager.getCwd());
    if (previous.sessionId === next.sessionId && cwdPathsEqual(previousCwd, nextCwd)) return;
    await this.publishUnreadMutations(this.unreadStore.forgetSession(previous.sessionId, previousCwd));
  }

  private forgetUnreadActivity(session: PiAgentSession): void {
    this.unreadStore.forgetActivity(
      session.sessionId,
      canonicalizeStoredCwd(session.sessionManager.getCwd()),
    );
  }

  private async forgetUnreadSessions(identities: readonly { sessionId: string; cwd: string }[]): Promise<void> {
    const mutations: SessionUnreadMutation[] = [];
    for (const identity of identities) {
      mutations.push(...this.unreadStore.forgetSession(
        identity.sessionId,
        canonicalizeStoredCwd(identity.cwd),
      ));
    }
    await this.publishUnreadMutations(mutations);
  }

  private observeUnreadActivityState(session: PiAgentSession): void {
    const mutations = this.unreadStore.observeActivityState(
      session.sessionId,
      canonicalizeStoredCwd(session.sessionManager.getCwd()),
      this.hasActiveWork(session),
    );
    if (mutations.length === 0) return;
    void this.publishUnreadMutations(mutations).catch(() => undefined);
  }

  private publishUnreadMutations(mutations: readonly SessionUnreadMutation[]): Promise<void> {
    // The store applied the mutations already, so the status projection is told
    // now rather than after the durable flush: it reads in-memory unread state
    // and must not lag behind the rows the browser is about to see.
    if (mutations.length > 0) this.onUnreadChanged?.();
    this.enqueueUnreadMutations(mutations);
    this.unreadPublicationFlushRequested = true;
    if (this.unreadPublication === undefined && this.unreadPublicationRetryTimer !== undefined) {
      const failure = this.unreadPublicationFailure;
      return Promise.reject(failure instanceof Error
        ? failure
        : new Error("Session unread publication is awaiting retry", { cause: failure }));
    }
    return this.ensureUnreadPublication();
  }

  private ensureUnreadPublication(): Promise<void> {
    const existing = this.unreadPublication;
    if (existing !== undefined) return existing;

    const publication = this.drainUnreadPublication();
    this.unreadPublication = publication;
    void publication.then(
      () => {
        if (this.unreadPublication === publication) this.unreadPublication = undefined;
      },
      (error: unknown) => {
        if (this.unreadPublication === publication) this.unreadPublication = undefined;
        this.unreadPublicationFailure = error;
        this.logger.info(
          { error: error instanceof Error ? error.message : String(error) },
          "failed to publish durable session unread mutations",
        );
        this.scheduleUnreadPublicationRetry();
      },
    );
    return publication;
  }

  private async drainUnreadPublication(): Promise<void> {
    while (this.unreadPublicationFlushRequested || this.pendingUnreadMutations.length > 0) {
      this.unreadPublicationFlushRequested = false;
      const batch = this.pendingUnreadMutations.splice(0);
      let publishedCount = 0;
      try {
        await this.unreadStore.flush();
        for (const mutation of batch) {
          this.events.publishGlobal(mutation.event);
          publishedCount += 1;
        }
      } catch (error: unknown) {
        this.prependUnreadMutations(batch.slice(publishedCount));
        this.unreadPublicationFlushRequested = true;
        throw error;
      }
      this.unreadPublicationFailure = undefined;
      this.clearUnreadPublicationRetry();
    }
  }

  private enqueueUnreadMutations(mutations: readonly SessionUnreadMutation[]): void {
    this.pendingUnreadMutations.push(...mutations);
    this.trimPendingUnreadMutations();
  }

  private prependUnreadMutations(mutations: readonly SessionUnreadMutation[]): void {
    this.pendingUnreadMutations.unshift(...mutations);
    this.trimPendingUnreadMutations();
  }

  private trimPendingUnreadMutations(): void {
    const excess = this.pendingUnreadMutations.length - MAX_PENDING_UNREAD_MUTATIONS;
    if (excess > 0) this.pendingUnreadMutations.splice(0, excess);
  }

  private scheduleUnreadPublicationRetry(): void {
    if (this.unreadPublicationStopped || this.unreadPublicationRetryTimer !== undefined) return;
    const delay = this.unreadPublicationRetryDelayMs;
    this.unreadPublicationRetryDelayMs = Math.min(
      Math.max(delay * 2, this.unreadPublicationRetryInitialMs),
      Math.max(MAX_UNREAD_PUBLICATION_RETRY_MS, this.unreadPublicationRetryInitialMs),
    );
    this.unreadPublicationRetryTimer = setTimeout(() => {
      this.unreadPublicationRetryTimer = undefined;
      void this.ensureUnreadPublication().catch(() => undefined);
    }, delay);
    this.unreadPublicationRetryTimer.unref();
  }

  private clearUnreadPublicationRetry(): void {
    if (this.unreadPublicationRetryTimer !== undefined) clearTimeout(this.unreadPublicationRetryTimer);
    this.unreadPublicationRetryTimer = undefined;
    this.unreadPublicationRetryDelayMs = this.unreadPublicationRetryInitialMs;
  }

  private async bindRuntime(active: ActiveSession<PiSessionRuntime>, session: PiAgentSession = active.runtime.session): Promise<void> {
    active.unsubscribe();
    for (const [sessionId, candidate] of this.active.entries()) {
      if (candidate === active) {
        this.active.delete(sessionId);
      }
    }
    // Accepting a retry before this finishes would miss an id restored from the
    // durable queue and execute the same prompt twice after a daemon restart.
    // Subscribe before draining so the first restored delivery cannot emit
    // runtime events before this session has a client event bridge.
    const restoredQueue = await this.restoreOwnedQueue(session, active.runtime.cwd);
    session.agent.steeringMode = "all";
    active.unsubscribe = session.subscribe((event) => { this.observeRuntimeEvent(session, event); });
    this.active.set(session.sessionId, active);
    if (restoredQueue.length > 0) this.pumpInbox(session);
  }

  /**
   * Everything pi-web does with a runtime event. A fault here is logged and contained: pi calls
   * its listeners inside the agent loop without a catch, so a throw would fail the run between
   * draining the waiting messages and committing them, and they would be lost.
   */
  private observeRuntimeEvent(session: PiAgentSession, event: unknown): void {
    try {
      this.handleRuntimeEvent(session, event);
    } catch (error: unknown) {
      console.warn(`[session ${session.sessionId}] runtime event ${getString(event, "type") ?? "unknown"} handling failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handleRuntimeEvent(session: PiAgentSession, event: unknown): void {
    this.stampCommittedUserMessage(session, event);
    const settledStop = this.settleStopByReader(session, event);
    if (settledStop !== undefined) {
      this.events.publish(session.sessionId, { type: "message.end", message: getProperty(settledStop, "message") });
      this.commandService.observeSessionEvent(session.sessionId, settledStop);
    }
    this.observeInboxFacts(session, event);
    this.publishActivityChangeForToolEvent(session, event);
    this.events.publish(session.sessionId, toClientEvent(event, session.thinkingLevel));
    this.publishActivityForEvent(session, event);
    const eventType = getString(event, "type");
    if (eventType === "agent_end") this.abortRunScopedExtensionDialogs(session.sessionId);
    if (isDeliveredUserMessageEvent(event)) this.voidOpenAskForDeliveredMessage(session, event);
    if (eventType !== undefined && HANDOFF_WAKE_EVENTS.has(eventType)) this.pumpInbox(session);
    // A /reload issued mid-turn waits here. agent_end can fire while the turn
    // is still winding down, so runQueuedReload re-checks for active work and
    // simply returns if it is early; the heartbeat below is what makes sure a
    // session that goes quiet without another event still gets its reload.
    if (eventType === "agent_end" || eventType === "turn_end") this.commandService.runQueuedReload(session);
    this.commandService.observeSessionEvent(session.sessionId, event);
    // Delta-only events (streaming text/thinking) carry no status change:
    // publishing the full status for every token would synchronously
    // re-serialize and broadcast the session state on the agent's own event
    // loop, which measurably slows streaming relative to the TUI. Status is
    // published on structural events below and on a trailing throttle timer
    // so a burst of deltas still settles into a fresh status.
    if (!isStreamingDeltaEvent(event)) this.publishStatus(session);
    this.updateSubsessionTracking(session);
  }

  private maybeGenerateSessionName(session: PiAgentSession, firstMessage: string): void {
    if (session.sessionName !== undefined || session.messages.length !== 0 || session.isStreaming || session.isCompacting) return;

    const deterministicName = deterministicSessionName(firstMessage);
    if (deterministicName !== undefined) {
      this.applyGeneratedSessionName(session, deterministicName);
      return;
    }

    const model = session.model;
    if (model === undefined) return;

    void generateShortSessionName(session.agent.streamFunction, model, firstMessage).then((name) => {
      this.applyGeneratedSessionName(session, name ?? fallbackSessionName(firstMessage));
    }).catch(() => {
      this.applyGeneratedSessionName(session, fallbackSessionName(firstMessage));
    });
  }

  private applyGeneratedSessionName(session: PiAgentSession, name: string | undefined): void {
    if (name === undefined || session.sessionName !== undefined) return;
    if (this.treeNavigations.has(session)) {
      this.deferredGeneratedSessionNames.set(session, name);
      return;
    }
    session.setSessionName(name);
    this.publishSessionName(session);
  }

  private flushDeferredTreeNavigationWork(session: PiAgentSession): void {
    const generatedName = this.deferredGeneratedSessionNames.get(session);
    this.deferredGeneratedSessionNames.delete(session);
    if (generatedName !== undefined) {
      try {
        this.applyGeneratedSessionName(session, generatedName);
      } catch (error: unknown) {
        this.logger.info(
          { sessionId: session.sessionId, error: error instanceof Error ? error.message : String(error) },
          "failed to apply deferred session name",
        );
      }
    }

    const notifications = this.deferredSubsessionNotifications.get(session) ?? [];
    this.deferredSubsessionNotifications.delete(session);
    for (const notification of notifications) {
      void this.deliverSubsessionNotification(session, notification).catch((error: unknown) => {
        this.logSubsessionNotificationFailure(notification.parentId, notification.childId, error);
      });
    }
  }

  applyAuthChange(change: AuthChange = {}): void {
    // ModelRuntime.login()/logout() refresh the shared runtime before AuthService
    // emits the change, so no refresh is needed here. Keeping this synchronous
    // also lets every active session observe the same committed auth snapshot.
    for (const active of this.active.values()) {
      const { session } = active.runtime;
      this.syncCurrentModelAuthWarning(session, change.removedProviderId);
      this.publishStatus(session);
    }
  }

  private syncCurrentModelAuthWarning(session: PiAgentSession, removedProviderId: string | undefined): void {
    const model = session.model;
    if (model === undefined) return;
    if (model.provider === "unknown" && model.id === "unknown") return;
    const warningKey = authLossWarningKey(session.sessionId, model.provider, model.id);
    const registered = session.modelRuntime.getModel(model.provider, model.id);
    if (registered === undefined) return;
    if (session.modelRuntime.hasConfiguredAuth(model.provider)) {
      this.authLossWarnings.delete(warningKey);
      return;
    }
    if (removedProviderId === undefined || model.provider !== removedProviderId || this.authLossWarnings.has(warningKey)) return;
    this.authLossWarnings.add(warningKey);
    this.events.publish(session.sessionId, {
      type: "command.output",
      level: "error",
      message: `Authentication for ${model.provider}/${model.id} was removed. Use /model to select another model.`,
    });
  }

  private clearAuthLossWarningsForSession(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of this.authLossWarnings) {
      if (key.startsWith(prefix)) this.authLossWarnings.delete(key);
    }
  }

  private publishSessionName(session: PiAgentSession): void {
    const event = session.sessionName === undefined
      ? { type: "session.name", sessionId: session.sessionId } as const
      : { type: "session.name", sessionId: session.sessionId, name: session.sessionName } as const;
    this.events.publish(session.sessionId, event);
    this.events.publishGlobal(event);
  }

  private publishHeartbeats(): void {
    void this.refreshBackgroundRunCounts();
    for (const active of this.active.values()) {
      const { session } = active.runtime;
      // Re-evaluate subsession completion here too: agent_end can arrive while
      // the session still reports active work transiently, so the event-driven
      // latch may not fire. The heartbeat re-checks once the session settles.
      this.updateSubsessionTracking(session);
      this.pumpInbox(session);
      const activity = this.activities.get(session.sessionId);
      if (!this.hasActiveWork(session)) {
        if (activity?.phase === "active") this.publishStatus(session);
        continue;
      }
      this.publishStatus(session);
      if (activity?.phase === "active") this.publishActivity(session, activity.label, "active", activity.detail);
      else this.publishActivity(session, this.activityLabelFromStatus(session), "active");
    }
  }

  private activityLabelFromStatus(session: PiAgentSession): string {
    return sessionActivityLabel({
      treeNavigationActive: this.treeNavigations.has(session),
      entryMutationActive: this.isSessionEntryMutationActive(session),
      isCompacting: session.isCompacting,
      isBashRunning: session.isBashRunning,
      isStreaming: session.isStreaming,
      pendingMessageCount: this.pendingMessageCount(session),
    });
  }

  private hasActiveWork(session: PiAgentSession): boolean {
    return this.treeNavigations.has(session)
      || this.isSessionEntryMutationActive(session)
      || this.isTreeExclusiveOperationActive(session)
      || sessionHasActiveWork(session, this.ownedQueue.entries(session.sessionId).length);
  }

  private async runTreeExclusiveOperation<T>(
    targets: readonly TreeExclusiveOperationTarget[],
    activeError: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const sessionIds = new Set<string>();
    const runtimes = new Set<PiSessionRuntime>();
    const sessions = new Set<PiAgentSession>();
    for (const target of targets) {
      const runtime = target.runtime ?? (target.session === undefined ? undefined : this.activeRuntimeForSession(target.session));
      const session = target.session ?? runtime?.session;
      if (session !== undefined && this.hasActiveWork(session)) throw new Error(activeError);
      sessionIds.add(target.sessionId);
      if (runtime !== undefined) runtimes.add(runtime);
      if (session !== undefined) sessions.add(session);
    }

    for (const sessionId of sessionIds) {
      this.treeExclusiveSessionOperationCounts.set(sessionId, (this.treeExclusiveSessionOperationCounts.get(sessionId) ?? 0) + 1);
    }
    for (const runtime of runtimes) {
      this.treeExclusiveRuntimeOperationCounts.set(runtime, (this.treeExclusiveRuntimeOperationCounts.get(runtime) ?? 0) + 1);
    }
    for (const session of sessions) this.observeUnreadActivityState(session);

    try {
      return await operation();
    } finally {
      for (const runtime of runtimes) decrementWeakCount(this.treeExclusiveRuntimeOperationCounts, runtime);
      for (const sessionId of sessionIds) decrementMapCount(this.treeExclusiveSessionOperationCounts, sessionId);
      for (const session of sessions) {
        if (this.isCurrentActiveSession(session)) this.observeUnreadActivityState(session);
      }
    }
  }

  private isTreeExclusiveSessionIdentityActive(sessionId: string): boolean {
    return (this.treeExclusiveSessionOperationCounts.get(sessionId) ?? 0) > 0;
  }

  private isTreeExclusiveOperationActive(session: PiAgentSession): boolean {
    if (this.isTreeExclusiveSessionIdentityActive(session.sessionId)) return true;
    const runtime = this.activeRuntimeForSession(session);
    return runtime !== undefined && (this.treeExclusiveRuntimeOperationCounts.get(runtime) ?? 0) > 0;
  }

  private activeRuntimeForSession(session: PiAgentSession): PiSessionRuntime | undefined {
    for (const active of new Set(this.active.values())) {
      if (active.runtime.session === session) return active.runtime;
    }
    return undefined;
  }

  private assertTreeNavigationInactive(session: PiAgentSession, action: string): void {
    if (this.treeNavigations.has(session)) throw new Error(`Cannot ${action} while session tree navigation is active`);
  }

  private async runSessionEntryMutation<T>(session: PiAgentSession, action: string, operation: () => Promise<T>): Promise<T> {
    this.beginSessionEntryMutation(session, action);
    try {
      return await operation();
    } finally {
      this.endSessionEntryMutation(session);
    }
  }

  private beginSessionEntryMutation(session: PiAgentSession, action: string): void {
    this.assertTreeNavigationInactive(session, action);
    this.sessionEntryMutationCounts.set(session, (this.sessionEntryMutationCounts.get(session) ?? 0) + 1);
    this.observeUnreadActivityState(session);
  }

  private endSessionEntryMutation(session: PiAgentSession): void {
    const remaining = (this.sessionEntryMutationCounts.get(session) ?? 1) - 1;
    if (remaining <= 0) this.sessionEntryMutationCounts.delete(session);
    else this.sessionEntryMutationCounts.set(session, remaining);
    this.observeUnreadActivityState(session);
  }

  private isSessionEntryMutationActive(session: PiAgentSession): boolean {
    return (this.sessionEntryMutationCounts.get(session) ?? 0) > 0;
  }

  /**
   * Move the session's step on pi's event (B25 and B15, `sessionStep.ts`) and publish it when it
   * changed. The turn boundaries also publish the status, and the run's end does once more a
   * moment later, after pi has settled.
   */
  private publishActivityForEvent(session: PiAgentSession, event: unknown): void {
    const eventType = getString(event, "type");
    if (eventType === undefined) return;
    const current = this.steps.get(session.sessionId) ?? { step: IDLE_STEP, since: new Date().toISOString() };
    const step = nextSessionStep(current.step, event, { running: session.agent.state?.isStreaming === true, describeArgs: summarizeToolArgs });
    if (step !== current.step) {
      this.steps.set(session.sessionId, { step, since: step.kind === current.step.kind ? current.since : new Date().toISOString() });
      const words = stepWords(step);
      this.publishActivity(session, words.label, stepPhase(step), words.detail);
    }
    if (eventType === "turn_start" || eventType === "turn_end") this.publishStatus(session);
    if (eventType === "agent_end") setTimeout(() => { this.publishStatus(session); }, 250);
  }

  /**
   * Build the reporter for one session construction.
   *
   * The session id is known before any await — a `SessionManager` has its id
   * from construction — so the daemon can name what it is starting even though
   * the `PiAgentSession` that {@link publishActivity} needs does not exist yet.
   * Without an id there is nothing to report against, so the reporter stays
   * silent and the browser keeps its own generic wording.
   */
  private startupProgress(sessionManager: PiSessionManager, intent: "create" | "open", startupToken: string | undefined): SessionStartupProgressReporter {
    const sessionId = sessionManager.getSessionId();
    if (sessionId === "") return { report: noop, end: noop };
    const label = intent === "create" ? "Creating session" : "Opening session";
    return {
      report: (phase) => { this.publishStartupProgress(sessionId, startupToken, label, "active", this.startupDetail(phase)); },
      end: () => {
        // A real activity published during the window (an extension error, say)
        // is the truth about this session and must survive the clear.
        if (this.activities.has(sessionId)) return;
        this.publishStartupProgress(sessionId, startupToken, "idle", "idle", undefined);
      },
    };
  }

  private startupDetail(phase: string): string {
    return this.catalogRefreshStatus?.isRefreshInFlight() === true
      ? `${phase} · ${STARTUP_CONCURRENT_CATALOG_REFRESH}`
      : phase;
  }

  /**
   * Report startup progress on the global channel only, echoing the caller's
   * correlation token so a waiting browser row recognises its own construction.
   *
   * Unlike {@link publishActivity} this deliberately records nothing: no
   * `activities` entry, no workspace activity, no unread observation. There is
   * no session to own that state, and a failed creation would leave it stranded.
   *
   * Every report is marked `startup`, which is what keeps a session that is
   * merely opening from counting as one doing work. This is the only publisher
   * that sets the marker, and because it writes no `activities` entry no later
   * heartbeat re-publication can carry it.
   */
  private publishStartupProgress(sessionId: string, startupToken: string | undefined, label: string, phase: "active" | "idle", detail: string | undefined): void {
    const at = new Date().toISOString();
    const activity = detail === undefined ? { sessionId, phase, label, at, startup: true } : { sessionId, phase, label, detail, at, startup: true };
    this.events.publishGlobal(startupToken === undefined ? { type: "session.startup", activity } : { type: "session.startup", startupToken, activity });
  }

  private readonly lastActivityKeyBySession = new Map<string, string>();

  /**
   * Publish an activity with the step the session is in. Deduped on what a
   * reader sees, so a repeat (the heartbeat's, or a producer re-stating its
   * words) sends nothing.
   */
  private publishActivity(session: PiAgentSession, label: string, phase: "active" | "idle" | "error", detail?: string): void {
    const current = this.steps.get(session.sessionId);
    const key = `${phase}\u0000${label}\u0000${detail ?? ""}\u0000${current === undefined ? "" : `${JSON.stringify(current.step)}@${current.since}`}`;
    if (this.lastActivityKeyBySession.get(session.sessionId) === key) return;
    this.lastActivityKeyBySession.set(session.sessionId, key);
    const at = new Date().toISOString();
    const stored = detail === undefined ? { phase, label, at } : { phase, label, detail, at };
    this.activities.set(session.sessionId, stored);
    const step = current === undefined ? {} : { step: current.step, stepSince: current.since };
    const activity = detail === undefined ? { sessionId: session.sessionId, phase, label, at, ...step } : { sessionId: session.sessionId, phase, label, detail, at, ...step };
    this.workspaceActivity?.applySessionActivity(session.sessionManager.getCwd(), activity);
    this.events.publish(session.sessionId, { type: "activity.update", activity });
    this.events.publishGlobal({ type: "activity.update", activity });
    this.observeUnreadActivityState(session);
  }

  private publishStatus(session: PiAgentSession): void {
    const status = this.statusFromSession(session);
    this.recordRunLifecycle(session);
    this.clearStaleActiveActivity(session);
    this.workspaceActivity?.applySessionStatus(session.sessionManager.getCwd(), status);
    this.events.publish(session.sessionId, { type: "status.update", status });
    this.events.publishGlobal({ type: "status.update", status: { ...status, streamPosition: this.streamPosition(session.sessionId) } });
    this.observeUnreadActivityState(session);
  }

  /**
   * Keep the on-disk in-flight record in step with this session's work.
   *
   * Written while the run is alive rather than at shutdown, because the daemon
   * is killed as a control group: its agent subprocesses receive SIGTERM at the
   * same instant it does, so by the time a shutdown hook runs there is no work
   * left to notice. Only transitions are written, so an idle daemon does no
   * disk I/O.
   */
  private recordRunLifecycle(session: PiAgentSession): void {
    const active = this.hasActiveWork(session);
    if (active === this.runInFlight.has(session.sessionId)) return;
    if (active) {
      this.runInFlight.add(session.sessionId);
      void markRunInFlight({
        sessionId: session.sessionId,
        cwd: canonicalizeStoredCwd(session.sessionManager.getCwd()),
      });
    } else {
      this.runInFlight.delete(session.sessionId);
      void clearRunInFlight(session.sessionId);
    }
  }

  private clearStaleActiveActivity(session: PiAgentSession): void {
    const step = this.steps.get(session.sessionId)?.step;
    const stale = this.activities.get(session.sessionId)?.phase === "active" || (step !== undefined && step.kind !== "idle");
    if (!stale || this.hasActiveWork(session)) return;
    // Same edge, second path: this runs off the heartbeat, so it also covers a
    // session that fell idle without emitting a terminal event (an aborted run,
    // a bash command that ended between beats).
    this.commandService.runQueuedReload(session);
    this.steps.set(session.sessionId, { step: IDLE_STEP, since: new Date().toISOString() });
    this.publishActivity(session, "idle", "idle");
  }

  private statusFromSession(session: PiAgentSession): ClientSessionStatus {
    const stats = session.getSessionStats();
    const model = session.model === undefined ? undefined : modelToClientModel(session.model);
    const contextUsage = session.getContextUsage();
    const warnings = this.warningsForSession(session);
    this.fileWarningNotifications(session, warnings);
    const pendingAsks = this.pendingAskStore.pendingAsks(session.sessionId);
    const pendingAsk = pendingAsks[0];
    const pendingDialogs = this.pendingExtensionDialogStore.pendingDialogs(session.sessionId);
    const visibleQueued = this.queuedMessages(session);
    const queuedAnswers = this.queuedAnswers(session);
    const activity = this.currentActivity(session.sessionId);
    const backgroundRunCount = this.backgroundRunCounts.get(session.sessionId) ?? 0;
    const working = session.isStreaming || session.isCompacting || session.isBashRunning;
    const turnStartedAt = working ? turnStartedAtFromBranch(session.sessionManager.getBranch()) : undefined;
    const surfaces = pluginSurfacePresence(session.resourceLoader);
    return {
      sessionId: session.sessionId,
      persisted: sessionFileExists(session.sessionFile),
      // Omitted when the runtime cannot answer, so a browser reads it as
      // unknown. Hiding a surface on no evidence is the fault this replaces.
      ...(surfaces === undefined ? {} : { pluginSurfaces: surfaces }),
      ...(model === undefined ? {} : { model }),
      thinkingLevel: session.thinkingLevel,
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      isBashRunning: session.isBashRunning,
      // The turn's own start, read off the transcript: a browser that joins a
      // working session mid-turn anchors its elapsed readout here instead of
      // re-clocking from the moment it happened to look.
      ...(turnStartedAt === undefined ? {} : { turnStartedAt }),
      pendingMessageCount: visibleQueued.length,
      queuedMessages: visibleQueued,
      ...(queuedAnswers.length === 0 ? {} : { queuedAnswers }),
      ...(activity === undefined ? {} : { activity }),
      messageCount: readableMessageCount(session.sessionManager.getBranch()),
      tokens: stats.tokens,
      cost: stats.cost,
      ...(contextUsage === undefined ? {} : { contextUsage }),
      ...(warnings.length === 0 ? {} : { warnings }),
      ...(pendingAsk === undefined ? {} : { pendingAsk }),
      ...(pendingAsks.length === 0 ? {} : { pendingAsks }),
      ...(pendingDialogs.length === 0 ? {} : { pendingDialogs }),
      // The dialog surface's revision and the process that stamped it: a client
      // comparing frame revisions must know when the revision space was
      // replaced (daemon restart) and must be able to detect a lost frame
      // against the authoritative open list.
      pendingDialogsRevision: this.currentDialogRevision(session.sessionId),
      daemonInstanceId: this.notificationStore.daemonInstanceId,
      ...(backgroundRunCount === 0 ? {} : { backgroundRunCount }),
    };
  }

  /**
   * Recount work that outlives each open session's turn, and publish the
   * sessions whose count moved.
   *
   * Driven off the heartbeat rather than events because nothing tells this
   * process when a detached child finishes: a subagent run and a background
   * shell task both report only by writing files. The counting itself is
   * written to be cheap when the answer is zero, which is the normal case, and
   * only one scan is ever in flight so a slow disk cannot pile them up.
   */
  private async refreshBackgroundRunCounts(): Promise<void> {
    if (this.backgroundRunScanInFlight) return;
    const open = [...this.active.values()].map((active) => active.runtime.session);
    for (const session of open) this.watchBackgroundWork(session);
    const needsFallback = open.some((session) => !this.backgroundWorkWatcher.isHealthy(this.backgroundWorkTarget(session)));
    const hasKnownRunningWork = open.some((session) => (this.backgroundRunCounts.get(session.sessionId) ?? 0) > 0);
    if (!this.backgroundRunRefreshRequested && !needsFallback && !hasKnownRunningWork) return;
    this.backgroundRunScanInFlight = true;
    this.backgroundRunRefreshRequested = false;
    try {
      const openIds = new Set(open.map((session) => session.sessionId));
      for (const sessionId of [...this.backgroundRunCounts.keys()]) {
        if (!openIds.has(sessionId)) this.backgroundRunCounts.delete(sessionId);
      }
      const counter = createBackgroundRunCountCycle();
      for (const session of open) {
        const count = await counter.count({
          cwd: session.sessionManager.getCwd(),
          sessionFile: session.sessionManager.getSessionFile(),
          parentActive: session.isStreaming,
          workingSubsessionCount: this.workingSubsessionIds(session.sessionId).length,
        }).catch(() => this.backgroundRunCounts.get(session.sessionId) ?? 0);
        if (count === (this.backgroundRunCounts.get(session.sessionId) ?? 0)) continue;
        this.backgroundRunCounts.set(session.sessionId, count);
        // The session may have been closed while the scan was reading disk.
        if (this.active.has(session.sessionId)) this.publishStatus(session);
      }
    } finally {
      this.backgroundRunScanInFlight = false;
    }
  }

  /**
   * The watch is keyed by the canonical working directory, the form every
   * listing row carries and the browser compares against: a session header
   * can record `~/repo` or an unresolved form, and a raw key would either
   * fail to watch or publish a directory no client recognizes.
   */
  private holdWorkspaceWatch(session: PiAgentSession): void {
    this.workspaceWatcher.hold(session.sessionId, canonicalizeStoredCwd(session.sessionManager.getCwd()));
  }

  private releaseWorkspaceWatch(session: PiAgentSession): void {
    this.workspaceWatcher.release(session.sessionId, canonicalizeStoredCwd(session.sessionManager.getCwd()));
  }

  private watchBackgroundWork(session: PiAgentSession): void {
    this.backgroundWorkWatcher.update(this.backgroundWorkTarget(session));
  }

  private backgroundWorkTarget(session: PiAgentSession) {
    return {
      sessionId: session.sessionId,
      cwd: session.sessionManager.getCwd(),
      sessionFile: session.sessionManager.getSessionFile(),
    };
  }

  /**
   * Compute the live warning set for a session: runtime/resource diagnostics from
   * the active runtime (if any) plus the Anthropic subscription-auth notice. Read
   * fresh on each status publish so a rebuilt runtime or an auth/model change is
   * reflected without caching a stale snapshot.
   */
  /**
   * File each warning occurrence in the session's drawer, once. Warnings used
   * to be cards over the transcript - five of them filled the owner's phone
   * and moved the layout as they came and went; the drawer already owns
   * information that arrives on its own. Skipping (no generation bound yet)
   * must not memoize: the next bound publish files what this pass could not.
   */
  private fileWarningNotifications(session: PiAgentSession, warnings: readonly SessionWarning[]): void {
    if (warnings.length === 0) return;
    const generation = this.notificationGenerationBySession.get(session);
    if (generation === undefined) return;
    let memo = this.filedWarningsBySession.get(session);
    if (memo === undefined) {
      memo = new Set<string>();
      this.filedWarningsBySession.set(session, memo);
    }
    for (const warning of takeUnfiledWarnings(memo, warnings)) {
      const added = this.notificationStore.addNotification(generation, warning.message, warning.severity, warning.dismiss === undefined ? undefined : { warningDismiss: warning.dismiss });
      this.publishNotificationMutations(added.mutations);
    }
  }

  private warningsForSession(session: PiAgentSession): SessionWarning[] {
    const runtime = this.active.get(session.sessionId)?.runtime;
    const warnings = runtime === undefined ? [] : collectRuntimeWarnings(runtime);
    const anthropic = anthropicSubscriptionWarning(session, join(this.agentDir, "auth.json"));
    if (anthropic !== undefined) warnings.push(anthropic);
    return warnings;
  }

  /**
   * Everything this session is holding, as the browser sees it: both queues
   * merged and stamped with the correlation ids their senders minted. One
   * reader for both callers that have to hand the queue back - the status
   * projection and abort - so a message can never be reported by one and
   * dropped by the other.
   */
  /**
   * Serialize the operations that rewrite the whole queue.
   *
   * Recall has to empty the queue and put the survivors back, because the
   * runtime only offers "clear all and return them". While that is in flight
   * the queue is empty, so a prompt landing in the middle is either overtaken
   * by messages queued minutes earlier or lost behind them - the browser sees
   * its newest message read first.
   *
   * This is a real serializer, unlike runSessionEntryMutation, which is a
   * reference count feeding the activity label and waits on nothing. It is
   * deliberately narrow: it may never be held across `session.prompt()` for a
   * fresh submission, because that promise resolves when the *turn* ends, so a
   * lock around it would block every later queue operation for minutes. What
   * it protects is the rewrite window, and the enqueue call itself - not the
   * turn that follows.
   */
  private async withQueueLock<T>(session: PiAgentSession, operation: () => Promise<T> | T): Promise<T> {
    const previous = this.queueLocks.get(session.sessionId) ?? Promise.resolve();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    this.queueLocks.set(session.sessionId, previous.then(() => held));
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private pendingMessageCount(session: PiAgentSession): number {
    return this.queuedMessages(session).length;
  }

  private hasQueuedMessageText(session: PiAgentSession, text: string): boolean {
    return this.queuedMessages(session).some((message) => message.text === text);
  }
}

function previewResponseFromPlan(plan: SessionCleanupPlan): ClientSessionCleanupPreviewResponse {
  return {
    generatedAt: plan.generatedAt,
    thresholds: plan.thresholds,
    projects: plan.projects,
    totals: plan.totals,
    ...(plan.skippedBusySessionIds.length === 0 ? {} : { skippedBusySessionIds: plan.skippedBusySessionIds }),
  };
}

function uniqueBulkSessionRefs(refs: readonly SessionBulkMutationRef[]): SessionBulkMutationRef[] {
  const seen = new Set<string>();
  const unique: SessionBulkMutationRef[] = [];
  for (const ref of refs) {
    const key = `${ref.cwd}\0${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function bulkRefToSessionRef(ref: SessionBulkMutationRef): PiSessionRef {
  return { id: ref.id, cwd: ref.cwd };
}

function findArchivedRecordForBulkRef(records: readonly ArchivedSessionRecord[], ref: SessionBulkMutationRef): ArchivedSessionRecord | undefined {
  return records.find((record) => record.cwd === ref.cwd && (record.sessionId === ref.id || record.sessionId.startsWith(ref.id)));
}

function findListedSessionForBulkRef(context: BulkSessionRefContext, ref: SessionBulkMutationRef): PiSessionListEntry | undefined {
  return findSessionByIdOrPrefix(context.sessionsByCwd.get(ref.cwd) ?? [], ref.id);
}

function findSessionByIdOrPrefix(sessions: readonly PiSessionListEntry[], sessionId: string): PiSessionListEntry | undefined {
  return sessions.find((session) => session.id === sessionId) ?? sessions.find((session) => session.id.startsWith(sessionId));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


function modelToClientModel(model: PiAgentSession["model"]): ClientSessionModel {
  if (model === undefined) return {};
  const name = getString(model, "name");
  const reasoning = getProperty(model, "reasoning");
  return {
    provider: model.provider,
    id: model.id,
    ...(name === undefined ? {} : { name }),
    contextWindow: model.contextWindow,
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}

/** The scope source pi's enabled-id precedence reads from: live scope, settings patterns, runtime catalog. */
function sessionScopeSource(session: PiAgentSession): { settingsManager: PiAgentSession["settingsManager"]; modelRuntime: PiAgentSession["modelRuntime"]; scopedModels: PiAgentSession["scopedModels"] } {
  return { settingsManager: session.settingsManager, modelRuntime: session.modelRuntime, scopedModels: session.scopedModels };
}

function catalogEntryToClientModel(entry: EnabledModelCatalogEntry<AgentModel>): ClientSessionModelCatalogEntry {
  return { ...modelToClientModel(entry.model), provider: entry.model.provider, id: entry.model.id, enabled: entry.enabled };
}
function notificationIdentityForSession(session: PiAgentSession): { sessionId: string; cwd: string } {
  return {
    sessionId: session.sessionId,
    cwd: canonicalizeStoredCwd(session.sessionManager.getCwd()),
  };
}

/** A session the daemon holds open, as a listing row, before its file says more about it. */
function freshClientSession(session: PiAgentSession, cwd: string): ClientSession {
  const now = new Date().toISOString();
  return {
    id: session.sessionId,
    path: session.sessionFile ?? "",
    cwd,
    persisted: sessionFileExists(session.sessionFile),
    created: now,
    modified: now,
    messageCount: readableMessageCount(session.sessionManager.getBranch()),
    firstMessage: "",
  };
}

function clientSessionFromListEntry(session: PiSessionListEntry): ClientSession {
  return {
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    persisted: true,
    ...(session.cwdMissing === true ? { cwdMissing: true } : {}),
    ...(session.name === undefined ? {} : { name: session.name }),
    created: session.created.toISOString(),
    modified: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
    ...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
  };
}

function archiveInputFromListEntry(session: PiSessionListEntry): ArchiveSessionInput {
  return {
    sessionId: session.id,
    cwd: session.cwd,
    path: session.path,
    created: session.created.toISOString(),
    modified: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
    ...(session.name === undefined ? {} : { name: session.name }),
    ...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
  };
}

function archiveInputFromActiveSession(session: PiAgentSession): ArchiveSessionInput {
  const sessionFile = session.sessionFile;
  if (sessionFile === undefined || sessionFile === "") throw new Error("Session is not persisted");
  const parentSessionPath = session.sessionManager.getHeader?.()?.parentSession;
  return {
    sessionId: session.sessionId,
    cwd: session.sessionManager.getCwd(),
    path: sessionFile,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    messageCount: readableMessageCount(session.sessionManager.getBranch()),
    firstMessage: "",
    ...(session.sessionName === undefined ? {} : { name: session.sessionName }),
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

function archiveCandidateFromListEntry(session: PiSessionListEntry): WorkspaceArchiveCandidate {
  return {
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    archived: false,
    listEntry: session,
    ...(session.parentSessionPath === undefined ? {} : { parentSessionPath: session.parentSessionPath }),
  };
}

function archiveCandidateFromArchivedRecord(record: ArchivedSessionRecord, fallback: PiSessionListEntry | undefined): WorkspaceArchiveCandidate | undefined {
  const path = record.originalPath ?? fallback?.path;
  if (path === undefined) return undefined;
  const parentSessionPath = record.parentSessionPath ?? fallback?.parentSessionPath;
  return {
    id: record.sessionId,
    path,
    cwd: record.cwd,
    archived: true,
    ...(fallback === undefined ? {} : { listEntry: fallback }),
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

function archiveCandidateFromActiveSession(session: PiAgentSession, archived: boolean): WorkspaceArchiveCandidate {
  const sessionFile = session.sessionFile;
  if (sessionFile === undefined || sessionFile === "") throw new Error("Session is not persisted");
  const parentSessionPath = session.sessionManager.getHeader?.()?.parentSession;
  return {
    id: session.sessionId,
    path: sessionFile,
    cwd: session.sessionManager.getCwd(),
    archived,
    activeSession: session,
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

function archiveInputFromCandidate(candidate: WorkspaceArchiveCandidate): ArchiveSessionInput {
  if (candidate.listEntry !== undefined) return archiveInputFromListEntry(candidate.listEntry);
  if (candidate.activeSession !== undefined) return archiveInputFromActiveSession(candidate.activeSession);
  throw new Error(`Session is not available for archiving: ${candidate.id}`);
}

function sessionHasActiveWork(session: PiAgentSession, extraQueuedMessageCount = 0): boolean {
  return session.isStreaming || session.isCompacting || session.isBashRunning || session.pendingMessageCount + extraQueuedMessageCount > 0;
}

function sessionDisplayName(session: PiAgentSession): string {
  return session.sessionName ?? session.sessionId;
}

function clientSessionFromArchivedRecord(record: ArchivedSessionRecord, fallback: PiSessionListEntry | undefined): ClientSession | undefined {
  const path = record.originalPath ?? fallback?.path;
  const created = record.created ?? fallback?.created.toISOString();
  const modified = record.modified ?? fallback?.modified.toISOString();
  const messageCount = record.messageCount ?? fallback?.messageCount;
  const firstMessage = record.firstMessage ?? fallback?.firstMessage;
  if (path === undefined || created === undefined || modified === undefined || messageCount === undefined || firstMessage === undefined) return undefined;
  const name = record.name ?? fallback?.name;
  const parentSessionPath = record.parentSessionPath ?? fallback?.parentSessionPath;
  return {
    id: record.sessionId,
    path,
    cwd: record.cwd,
    ...(name === undefined ? {} : { name }),
    created,
    modified,
    messageCount,
    firstMessage,
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
    archived: true,
    archivedAt: record.archivedAt,
  };
}

function addSessionName(names: Set<string>, name: string | undefined): void {
  const trimmed = name?.replace(/\s+/g, " ").trim();
  if (trimmed !== undefined && trimmed !== "") names.add(trimmed);
}

function compareArchivedRecords(a: ArchivedSessionRecord, b: ArchivedSessionRecord): number {
  return archivedTimestamp(b) - archivedTimestamp(a);
}

function archivedTimestamp(record: ArchivedSessionRecord): number {
  const time = Date.parse(record.archivedAt);
  return Number.isNaN(time) ? 0 : time;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

interface TrackedSubsessionSessionIdentity {
  sessionId: string;
  sessionFile: string | undefined;
  sessionManager: PiSessionManager;
  cwd: string;
}

async function verifiedTrackedSubsessionLink(
  managers: Pick<PiSessionManagerGateway, "open">,
  session: TrackedSubsessionSessionIdentity,
): Promise<TrackedSubsessionLink | undefined> {
  // Child markers are only hints; the current child header and reciprocal
  // parent custom link must agree on the exact ids and files before relinking.
  const entries = session.sessionManager.getEntries?.() ?? session.sessionManager.getBranch();
  let marker: PersistedChildSubsessionLink | undefined;
  for (const entry of entries) {
    const parsed = parsePersistedChildSubsessionLink(entry);
    if (parsed?.spawnedSessionId === session.sessionId) marker = parsed;
  }
  if (marker === undefined) return undefined;

  const childSessionFile = nonEmptyString(session.sessionFile);
  if (childSessionFile === undefined) return undefined;
  const childHeader = await readSessionHeaderSummary(childSessionFile);
  if (childHeader?.id !== session.sessionId) return undefined;
  const parentSessionFile = nonEmptyString(childHeader.parentSession);
  if (parentSessionFile === undefined) return undefined;
  const parentHeader = await readSessionHeaderSummary(parentSessionFile);
  if (parentHeader?.id !== marker.spawnedBySessionId) return undefined;

  const parentLink = findReciprocalParentSubsessionLink(
    managers,
    parentSessionFile,
    marker.spawnedBySessionId,
    session.sessionId,
    childSessionFile,
  );
  if (parentLink === undefined) return undefined;
  return {
    parentSessionId: marker.spawnedBySessionId,
    childSessionId: session.sessionId,
    childSessionFile,
    parentSessionFile,
    cwd: parentLink.cwd ?? session.cwd,
  };
}

function findReciprocalParentSubsessionLink(
  managers: Pick<PiSessionManagerGateway, "open">,
  parentSessionFile: string,
  parentSessionId: string,
  childSessionId: string,
  childSessionFile: string,
): PersistedParentSubsessionLink | undefined {
  let parentManager: PiSessionManager;
  try {
    parentManager = managers.open(parentSessionFile);
  } catch {
    return undefined;
  }
  const entries = parentManager.getEntries?.() ?? parentManager.getBranch();
  for (const entry of entries) {
    const link = parsePersistedParentSubsessionLink(entry);
    if (link === undefined) continue;
    if (link.spawnedBySessionId !== parentSessionId || link.spawnedSessionId !== childSessionId) continue;
    if (link.spawnedSessionFile === undefined || !sessionPathsEqual(link.spawnedSessionFile, childSessionFile)) continue;
    return link;
  }
  return undefined;
}

function trackedSubsessionLinkFromParentLink(parentSessionId: string, link: PersistedParentSubsessionLink, parentSessionFile: string): TrackedSubsessionLink {
  return {
    parentSessionId,
    childSessionId: link.spawnedSessionId,
    ...(link.spawnedSessionFile === undefined ? {} : { childSessionFile: link.spawnedSessionFile }),
    parentSessionFile,
    ...(link.cwd === undefined ? {} : { cwd: link.cwd }),
  };
}

function persistedParentSubsessionLinkData(link: TrackedSubsessionLink): Record<string, unknown> {
  return {
    version: 1,
    spawnedBySessionId: link.parentSessionId,
    spawnedSessionId: link.childSessionId,
    ...(link.childSessionFile === undefined ? {} : { spawnedSessionFile: link.childSessionFile }),
    ...(link.cwd === undefined ? {} : { cwd: link.cwd }),
  };
}

function persistedChildSubsessionLinkData(parentSessionId: string, childSessionId: string): Record<string, unknown> {
  return {
    version: 1,
    spawnedBySessionId: parentSessionId,
    spawnedSessionId: childSessionId,
  };
}

function parsePersistedParentSubsessionLink(entry: unknown): PersistedParentSubsessionLink | undefined {
  if (!isRecord(entry) || entry["type"] !== "custom" || entry["customType"] !== SUBSESSION_LINK_CUSTOM_TYPE) return undefined;
  const data = entry["data"];
  if (!isRecord(data)) return undefined;
  const spawnedBySessionId = getString(data, "spawnedBySessionId");
  const spawnedSessionId = getString(data, "spawnedSessionId");
  if (spawnedBySessionId === undefined || spawnedBySessionId === "" || spawnedSessionId === undefined || spawnedSessionId === "") return undefined;
  const spawnedSessionFile = getString(data, "spawnedSessionFile");
  const cwd = getString(data, "cwd");
  return {
    spawnedBySessionId,
    spawnedSessionId,
    ...(spawnedSessionFile === undefined || spawnedSessionFile === "" ? {} : { spawnedSessionFile }),
    ...(cwd === undefined || cwd === "" ? {} : { cwd }),
  };
}

function parsePersistedChildSubsessionLink(entry: unknown): PersistedChildSubsessionLink | undefined {
  if (!isRecord(entry) || entry["type"] !== "custom" || entry["customType"] !== SUBSESSION_CHILD_LINK_CUSTOM_TYPE) return undefined;
  const data = entry["data"];
  if (!isRecord(data)) return undefined;
  const spawnedBySessionId = getString(data, "spawnedBySessionId");
  const spawnedSessionId = getString(data, "spawnedSessionId");
  if (spawnedBySessionId === undefined || spawnedBySessionId === "" || spawnedSessionId === undefined || spawnedSessionId === "") return undefined;
  return { spawnedBySessionId, spawnedSessionId };
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function subsessionHydratedParentKey(parentSessionId: string, parentSessionFile: string | undefined): string {
  return `${parentSessionId}\0${parentSessionFile ?? ""}`;
}

function sessionPathsEqual(a: string, b: string): boolean {
  return cwdPathsEqual(a, b);
}

function sessionFileExists(sessionFile: string | undefined): sessionFile is string {
  if (sessionFile === undefined || sessionFile === "") return false;
  try {
    return statSync(sessionFile).isFile();
  } catch {
    return false;
  }
}

function sessionFileMatches(session: PiAgentSession, expectedSessionFile: string | undefined): boolean {
  const sessionFile = nonEmptyString(session.sessionFile);
  return sessionFile !== undefined && expectedSessionFile !== undefined && sessionPathsEqual(sessionFile, expectedSessionFile);
}

function activeSessionFileMatches(active: ActiveSession<PiSessionRuntime>, expectedSessionFile: string | undefined): boolean {
  return sessionFileMatches(active.runtime.session, expectedSessionFile);
}

function trackedLinkParentFileMatches(link: TrackedSubsessionLink, parentSessionFile: string): boolean {
  return link.parentSessionFile !== undefined && sessionPathsEqual(link.parentSessionFile, parentSessionFile);
}

async function sessionFileHeaderMatches(sessionFile: string, expected: { sessionId: string; parentSessionFile?: string | undefined }): Promise<boolean> {
  const header = await readSessionHeaderSummary(sessionFile);
  if (header?.id !== expected.sessionId) return false;
  if (expected.parentSessionFile === undefined) return true;
  return header.parentSession !== undefined && sessionPathsEqual(header.parentSession, expected.parentSessionFile);
}

async function clearParentSession(sessionFile: string): Promise<void> {
  const content = await readFile(sessionFile, "utf8");
  const newlineIndex = content.indexOf("\n");
  const firstLine = newlineIndex === -1 ? content : content.slice(0, newlineIndex);
  const rest = newlineIndex === -1 ? "" : content.slice(newlineIndex);
  const header: unknown = JSON.parse(firstLine);
  if (!isRecord(header) || header["type"] !== "session") throw new Error("Invalid session file header");
  if (header["parentSession"] === undefined) return;
  delete header["parentSession"];
  await writeFile(sessionFile, `${JSON.stringify(header)}${rest}`, "utf8");
}

function clearParentSessionHeader(sessionManager: PiSessionManager): void {
  const header = sessionManager.getHeader?.();
  if (header !== undefined && header !== null) delete header.parentSession;
}

/**
 * When the working turn began, read from the transcript itself.
 *
 * The turn's start is its last input boundary: the newest user message (a
 * submitted prompt, a steer, an answered question) or the newest custom entry
 * that triggered a turn. Scanning from the tail skips assistant and tool
 * entries so mid-turn activity cannot move the anchor; a branch with no input
 * at all yields undefined, and the client then clocks from when it first saw
 * the session working, which is at least an honest lower bound.
 */
export function turnStartedAtFromBranch(branch: readonly unknown[]): string | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!isRecord(entry)) continue;
    if (entry["type"] === "custom_message") {
      const details = entry["details"];
      if (isRecord(details) && typeof details["timestamp"] === "number") return new Date(details["timestamp"]).toISOString();
      continue;
    }
    if (entry["type"] !== "message") continue;
    const message = entry["message"];
    if (!isRecord(message) || message["role"] !== "user") continue;
    if (typeof entry["timestamp"] === "string") return entry["timestamp"];
    if (typeof message["timestamp"] === "string") return message["timestamp"];
    return undefined;
  }
  return undefined;
}

/**
 * What is waiting, oldest first: what the runtime already holds, then the daemon's inbox. Only
 * the runtime's lanes are checked against the transcript - they are bare texts, and a text the
 * transcript already shows was consumed in the moment before the lane was read. An inbox entry
 * has not been handed yet, so a transcript line with the same text is an earlier message,
 * and filtering on it hid a second "continue" from the queue it was waiting in.
 */
/** pi's own lanes, oldest first per lane, exactly as it holds them. */
/**
 * pi removes a read user message from the lanes it shows by matching the message's text
 * (`contentText(content, "")`), and skips a message without text: a photo-only steer stayed shown
 * after the agent read it, holding its own ledger row and every later one pending. The daemon
 * applies pi's own rule to the empty text - the same splice and queue update pi makes - on the
 * SDK's lane arrays, pinned by a real-SDK test. Only among the entries the agent loop already
 * took: an empty-text message from elsewhere (an extension's follow-up) must not remove a
 * photo-only steer that is still waiting to be read.
 */
function dropReadEmptyLaneEntry(session: PiAgentSession, message: unknown): void {
  if (laneText(message) !== "") return;
  const held = loopHeldCounts(session);
  for (const [kind, name] of SDK_LANE_ARRAYS) {
    const lane: unknown = Reflect.get(session, name);
    if (!Array.isArray(lane)) continue;
    const index = lane.indexOf("");
    if (index === -1 || index >= held[kind]) continue;
    lane.splice(index, 1);
    const emitQueueUpdate: unknown = Reflect.get(session, "_emitQueueUpdate");
    if (typeof emitQueueUpdate === "function") Reflect.apply(emitQueueUpdate, session, []);
    return;
  }
}

/** Work a teardown or a Stop waits for, bounded so a handoff that never lands cannot hold it. */
async function withinHandoffBound(work: Promise<unknown>): Promise<"done" | "timed out"> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"timed out">((resolve) => { timer = setTimeout(() => { resolve("timed out"); }, TEARDOWN_TAKE_BACK_MS); });
  try {
    return await Promise.race([work.then(() => "done" as const), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const SDK_LANE_ARRAYS: readonly (readonly [QueuedPromptKind, string])[] = [["steer", "_steeringMessages"], ["followUp", "_followUpMessages"]];

function laneText(message: unknown): string {
  const content = getProperty(message, "content");
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part: unknown) => getProperty(part, "type") === "text").map((part: unknown) => getString(part, "text") ?? "").join("");
}

function runtimeLanes(session: PiAgentSession): { kind: QueuedPromptKind; text: string; clientMessageId?: string }[] {
  return [
    ...session.getSteeringMessages().map((text) => ({ kind: "steer" as const, text })),
    ...session.getFollowUpMessages().map((text) => ({ kind: "followUp" as const, text })),
  ];
}

/**
 * What waits for the agent: pi's lanes, then the inbox, each message once.
 *
 * A lane entry the daemon handed is matched to its held-steer record by position, as everywhere
 * else the lanes are read (`partitionLanes`, `settleConsumedSteers`), and is listed while its
 * record is held. Only an entry no record accounts for - one an extension pushed - is checked
 * against the transcript's text, the old guard against an entry pi never removed. Deciding a
 * handed entry by text hid every repeat of an earlier message ("continue", "yes") for as long as
 * it waited in the lane, which since B33 is the rest of the run: no row, no position, no recall
 * (review of 8550ee13). Ids leave as their senders know them; a local hold id stays here.
 */
function queuedMessagesFromSession(session: PiAgentSession, inbox: readonly OwnedQueueEntry[], records: readonly HeldSteerRecord[]): QueuedSessionMessage[] {
  const lanes = correlateQueuedPromptIds(runtimeLanes(session), records);
  const consumed = lanes.some((entry) => entry.clientMessageId === undefined) ? consumedUserMessageTexts(session) : new Set<string>();
  const joined = [
    ...lanes.filter((entry) => entry.clientMessageId !== undefined || !consumed.has(entry.text)),
    ...inbox.map((entry) => ({ kind: entry.lane, text: entry.text, ...(entry.clientMessageId === undefined ? {} : { clientMessageId: entry.clientMessageId }) })),
  ];
  const seen = new Set<string>();
  return joined.flatMap((message): QueuedSessionMessage[] => {
    const key = message.clientMessageId;
    if (key !== undefined && seen.has(key)) return [];
    if (key !== undefined) seen.add(key);
    const id = publishedId(key);
    return [{ kind: message.kind, text: message.text, ...(id === undefined ? {} : { clientMessageId: id }) }];
  });
}

/**
 * Correlation ids come from a browser, so they are untrusted input: accept a
 * short opaque string and ignore anything else rather than letting an oversized
 * value into per-session state.
 */
function committedMessageShape(content: unknown): { text: string; imageCount: number } {
  if (typeof content === "string") return { text: content, imageCount: 0 };
  if (!Array.isArray(content)) return { text: "", imageCount: 0 };
  const texts: string[] = [];
  let imageCount = 0;
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (typeof part["text"] === "string") texts.push(part["text"]);
    if (part["type"] === "image") imageCount += 1;
  }
  return { text: texts.join("\n\n"), imageCount };
}

const ACTIVITY_TOOL_NAMES = new Set(["subagent", "bg_run", "bg_run_pi_attested", "bg_kill", "spawn_subsession", "fusion_reason", "fusion_investigate", "fusion_research", "fusion_validate"]);

function parseClientMessageId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 200) return undefined;
  return trimmed;
}

/**
 * pi drains a queued steer/follow-up when the agent emits the matching user
 * `message_start`; the queue entry is spliced by exact text. If the drained
 * text ever differs from what was queued (expansion, normalization, trailing
 * whitespace), the entry is never removed and the UI would show a consumed
 * message in the queue forever. Reconcile against the transcript: a queued
 * text that already appears as a user message has clearly been consumed, so
 * the status reports it as delivered instead of pending.
 */
function consumedUserMessageTexts(session: PiAgentSession): ReadonlySet<string> {
  const consumed = new Set<string>();
  for (const message of session.messages) {
    if (!isRecord(message) || message["role"] !== "user") continue;
    const content = message["content"];
    if (typeof content === "string") {
      consumed.add(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (isRecord(part) && typeof part["text"] === "string") consumed.add(part["text"]);
    }
  }
  return consumed;
}

/**
 * A user message entering the transcript, from any route: sent now, or drained
 * from the agent's queue when a run ended.
 */
function isDeliveredUserMessageEvent(event: unknown): boolean {
  const eventType = getString(event, "type");
  if (eventType !== "message_start" && eventType !== "message_end") return false;
  const message = getProperty(event, "message");
  return isRecord(message) && message["role"] === "user";
}

function userTextMessage(text: string): { role: "user"; content: string } {
  return { role: "user", content: text };
}

/**
 * Build the optimistic user message echoed to clients. When images are present
 * we mirror pi's content-array shape (`[{type:"text"}, {type:"image"}, ...]`) so
 * the local echo matches what pi persists in the session branch.
 */
function userMessage(text: string, images: ImageContent[]): { role: "user"; content: string | (ImageContent | { type: "text"; text: string })[] } {
  if (images.length === 0) return userTextMessage(text);
  const content: (ImageContent | { type: "text"; text: string })[] = [];
  if (text !== "") content.push({ type: "text", text });
  content.push(...images);
  return { role: "user", content };
}

function buildPromptOptions(behavior: QueuedPromptKind | undefined, images: ImageContent[]): { streamingBehavior?: "steer" | "followUp"; images?: ImageContent[] } | undefined {
  const options: { streamingBehavior?: "steer" | "followUp"; images?: ImageContent[] } = {};
  if (behavior !== undefined) options.streamingBehavior = behavior;
  if (images.length > 0) options.images = images;
  return Object.keys(options).length > 0 ? options : undefined;
}


/**
 * The transcript, as the browser receives it. What this pushes is what the
 * reader can see, so `readableMessageCount` counts exactly this set - the two
 * disagreed for as long as they were written from separate rules.
 */
function historyMessages(session: PiAgentSession): unknown[] {
  return historyMessagesFromEntries(session.sessionManager.getBranch());
}

/**
 * Bound a tool result on its way into a transcript page.
 *
 * The live path bounds each event as it is emitted, but a page is assembled
 * straight from the stored branch, and that is the path that answered a
 * hundred-message request with 15.6 MB - five results being two thirds of it.
 * Bounding only the live event left the page exactly as heavy as before.
 */
function historyMessagesFromEntries(entries: readonly unknown[]): unknown[] {
  return branchMessages(entries).map(boundToolResultMessage);
}

/**
 * A transcript page with the head it was read at, each message naming its entry.
 *
 * Ids are attached to the page's slice only: a 69k-message branch is not copied a second time
 * to label messages nobody asked for.
 */
/** A session file's entries as the SDK parses them, or undefined when it cannot be read. */
async function readSessionFileEntries(path: string): Promise<FileEntry[] | undefined> {
  try {
    return parseSessionEntries(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function transcriptPage(entries: readonly unknown[], page?: { before?: number; limit?: number }): ClientMessagePage {
  const rows = branchTranscript(entries);
  const paged = pageMessagesAtSafeBoundary(rows.map((row) => boundToolResultMessage(row.message)), page);
  const messages = paged.messages.map((message, index) => withEntryId(message, rows[paged.start + index]?.entryId));
  return { ...paged, messages, head: transcriptHead(rows) };
}

function withEntryId(message: unknown, entryId: string | undefined): unknown {
  return entryId === undefined || !isRecord(message) ? message : { ...message, entryId };
}

function boundToolResultMessage(message: unknown): unknown {
  if (!isRecord(message) || message["role"] !== "toolResult") return message;
  const content = message["content"];
  if (typeof content === "string") {
    const limited = boundToolResultText(content);
    return limited.truncated ? { ...message, content: [{ type: "text", text: limited.text, truncatedBytes: limited.totalBytes }] } : message;
  }
  if (!isUnknownArray(content)) return message;
  const bounded = deferToolResultImages(boundToolResultContent(content), getString(message, "toolCallId"));
  return bounded === content ? message : { ...message, content: bounded };
}

/** custom entry type used to persist parent -> child subsession links outside LLM context. */
const SUBSESSION_LINK_CUSTOM_TYPE = "pi-web.subsession.link";

/** custom entry type used to mark a child as created by the subsession route. */
const SUBSESSION_CHILD_LINK_CUSTOM_TYPE = "pi-web.subsession.spawned";

/** customType marking a parent-facing subsession-completion notice. */
const SUBSESSION_NOTIFICATION_CUSTOM_TYPE = "subsession.completion";

const SUBSESSION_NOTIFICATION_MAX_OUTPUT_CHARS = 2000;

/** Avoid duplicating a partial result in context when deliberate inspection can return the full output. */
function formatSubsessionNotificationOutput(childSessionId: string, text: string): string {
  if (text.length > SUBSESSION_NOTIFICATION_MAX_OUTPUT_CHARS) {
    return `Output from subsession ${childSessionId} was too long for this completion notice (${String(text.length)} characters) and was omitted. It is the child session's last reply.`;
  }
  return `--- SUBSESSION OUTPUT: ${childSessionId} ---\n${text === "" ? "(no output)" : text}`;
}

/** Most recent assistant text from a history message list, or "" if none. */
function finalAssistantText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isRecord(message) || message["role"] !== "assistant") continue;
    const content = message["content"];
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    const texts: string[] = [];
    for (const part of content) {
      if (isRecord(part) && part["type"] === "text" && typeof part["text"] === "string") texts.push(part["text"]);
    }
    if (texts.length > 0) return texts.join("\n").trim();
  }
  return "";
}

/**
 * Streaming text/thinking deltas that never change session status on their
 * own. Other `message_update` shapes (usage updates, completed parts) can
 * still affect status, so only the token-stream hotspots are skipped.
 */
function isStreamingDeltaEvent(event: unknown): boolean {
  if (getString(event, "type") !== "message_update") return false;
  const assistantMessageEvent = getProperty(event, "assistantMessageEvent");
  const deltaType = getString(assistantMessageEvent, "type");
  return deltaType === "text_delta" || deltaType === "thinking_delta";
}

/** The events that end work a reader's Stop can land in without a reply to carry it. */
const STOP_SETTLING_EVENTS: ReadonlySet<string> = new Set(["agent_end", "auto_retry_end"]);

function toClientEvent(event: unknown, thinkingLevel?: string): SessionUiEvent {
  const eventType = getString(event, "type");
  const assistantMessageEvent = getProperty(event, "assistantMessageEvent");
  if (eventType === "message_update" && getString(assistantMessageEvent, "type") === "text_delta") {
    return { type: "assistant.delta", text: getString(assistantMessageEvent, "delta") ?? "" };
  }
  if (eventType === "message_update" && getString(assistantMessageEvent, "type") === "thinking_delta") {
    return { type: "assistant.thinking.delta", text: getString(assistantMessageEvent, "delta") ?? "" };
  }
  if (eventType === "tool_execution_start") {
    const args = getProperty(event, "args");
    return { type: "tool.start", toolName: getString(event, "toolName") ?? "", toolCallId: getString(event, "toolCallId") ?? "", summary: summarizeToolArgs(args), args };
  }
  if (eventType === "tool_execution_update") {
    const partialResult = getProperty(event, "partialResult");
    return { type: "tool.update", toolName: getString(event, "toolName") ?? "", toolCallId: getString(event, "toolCallId") ?? "", text: boundToolResultText(stringifyToolResult(partialResult)).text, content: deferToolResultImages(toolResultContent(partialResult), getString(event, "toolCallId")), details: toolResultDetails(partialResult) };
  }
  if (eventType === "tool_execution_end") {
    const result = getProperty(event, "result");
    return { type: "tool.end", toolName: getString(event, "toolName") ?? "", toolCallId: getString(event, "toolCallId") ?? "", text: boundToolResultText(stringifyToolResult(result)).text, content: deferToolResultImages(toolResultContent(result), getString(event, "toolCallId")), details: toolResultDetails(result), isError: getBoolean(event, "isError") === true };
  }
  if (eventType === "agent_start") return { type: "agent.start" };
  if (eventType === "agent_end") return { type: "agent.end" };
  if (eventType === "message_end") {
    const message = getProperty(event, "message");
    if (message === undefined) return { type: "message.end" };
    return { type: "message.end", message: annotateAssistantThinkingLevel(message, thinkingLevel) };
  }
  return { type: "pi.event", eventType: eventType ?? "unknown" };
}

function summarizeToolArgs(args: unknown): string {
  if (!isRecord(args)) return stringifyPrimitive(args);
  const command = getString(args, "command");
  if (command !== undefined) return command;
  const path = getString(args, "path");
  if (path !== undefined) return path;
  if (typeof args["oldText"] === "string" && typeof args["newText"] === "string") return "edit text replacement";
  const edits = args["edits"];
  if (Array.isArray(edits)) return `${String(edits.length)} edit${edits.length === 1 ? "" : "s"}`;
  const entries = Object.entries(args).filter(([, value]) => value != null).slice(0, 3);
  return entries.map(([key, value]) => `${key}: ${shortToolValue(value)}`).join(" · ");
}

function shortToolValue(value: unknown): string {
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${String(value.length)} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object" && value !== null) return "object";
  return "";
}

/**
 * A tool result on its way to a browser, bounded.
 *
 * The session file keeps every byte; this is the wire. One page of a live
 * session answered a 100-message request with 15.6 MB because five results
 * were megabytes each, and a phone spends that on parsing before it can draw
 * anything. A cut result says how much it had, so its tail reads as missing
 * rather than as the end of the output.
 */
function boundToolResultContent(content: unknown): unknown {
  if (!isUnknownArray(content)) return content;
  const bounded: unknown[] = [];
  let changed = false;
  for (const part of content) {
    if (!isRecord(part) || part["type"] !== "text") { bounded.push(part); continue; }
    const text = part["text"];
    if (typeof text !== "string") { bounded.push(part); continue; }
    const limited = boundToolResultText(text);
    if (!limited.truncated) { bounded.push(part); continue; }
    changed = true;
    bounded.push({ ...part, text: limited.text, truncatedBytes: limited.totalBytes });
  }
  return changed ? bounded : content;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function toolResultContent(result: unknown): unknown {
  if (isRecord(result)) {
    const content = getProperty(result, "content");
    if (content !== undefined) return boundToolResultContent(content);
    const text = getString(result, "text") ?? getString(result, "output");
    if (text !== undefined) return boundToolResultContent([{ type: "text", text }]);
  }
  if (typeof result === "string") return boundToolResultContent([{ type: "text", text: result }]);
  return result;
}

function toolResultDetails(result: unknown): unknown {
  return isRecord(result) ? getProperty(result, "details") : undefined;
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result.map(stringifyToolResult).filter((text) => text !== "").join("\n");
  if (isRecord(result)) {
    if (getString(result, "type") === "image") return "[image]";
    const text = getString(result, "text") ?? getString(result, "content") ?? getString(result, "output");
    if (text !== undefined) return text;
    const content = getProperty(result, "content");
    if (Array.isArray(content)) return stringifyToolResult(content);
    return JSON.stringify(result);
  }
  return stringifyPrimitive(result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function getString(value: unknown, key: string): string | undefined {
  const property = getProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

function getBoolean(value: unknown, key: string): boolean | undefined {
  const property = getProperty(value, key);
  return typeof property === "boolean" ? property : undefined;
}

function stringifyPrimitive(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}

/**
 * A closed session's branch read from its file the way the SDK reads it, or undefined when the
 * file is unreadable or not a current-version file: an older one takes the runtime path, which
 * migrates it on disk (P2 slice c).
 */
async function closedBranch(path: string): Promise<ReturnType<typeof branchFromFileEntries> | undefined> {
  const entries = await readSessionFileEntries(path);
  return entries !== undefined && isCurrentVersionFile(entries, CURRENT_SESSION_VERSION) ? branchFromFileEntries(entries) : undefined;
}
