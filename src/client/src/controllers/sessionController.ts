import { withLaterActivity } from "../sync/sessionBoard";
import { api as defaultApi, type CommandResult, type ExtensionDialogAnswer, type ExtensionDialogCloseResponse, type ExtensionDialogOutcome, type PendingExtensionDialog, type PromptAttachment, type QueuedSessionMessage, type SessionActivity, type SessionBulkFailure, type SessionCleanupExecuteResponse, type SessionInfo, type SessionModelCatalogEntry, type SessionRef, type SessionStatus, type SessionTreeForkResult, type SessionTreeNavigateResult, type SessionTreeSummaryChoice, type Project, type Workspace } from "../api";
import { HttpError, projectsApi, workspacesApi } from "../api";
import { clearErrorPatch, errorNoticePatch, noticePatch } from "../errorNotice";
import { commandOutcomeFor, issueCommand, moveCommandRows, settleIdleAwaitingCommands, settleCommand, withdrawCommand, type CommandOutcome } from "../commandLedger";
import { lastLastingRowKey } from "../rowIdentity";
import { RevisionScope, type ProjectionSource, type ProjectionVerdict } from "../revisionScope";
import { SessionGapRepair, type GapReplayResult, type StreamFrontier } from "../sessionGapRepair";
import { nextTranscriptSync, transcriptRetryAction, type TranscriptSyncEvent } from "../transcriptSync";
import { describeError, noticeForReader } from "../notice";
import { ancestorsForSession } from "../sessionAncestors";
import { locateSessionWorkspace, type SessionPlace } from "../sessionAncestorLookup";
import { MACHINE_WIDE_LOCATE_START, targetInListing, type SessionTarget, type SessionTargetScope } from "../sessionTarget";
import { SessionTargetResolver, type SessionTargetOpenOptions } from "./sessionTargetResolver";
import { CREATION_UNKNOWN_CODE, type OperationAppliedOutcome, type SessionTranscriptTail } from "../../../shared/apiTypes";
import { isSessionNotFoundError, sendRefusalNotice, sendRefusalWords, sessionFailureRoute } from "../sessionNotFound";
import { sessionLocationVerdict } from "../sessionLocationVerdict";
import { refreshMayReplaceSelection } from "./sessionRefreshScope";
import { composerCwd, resetWorkspaceScopedState, type AppState } from "../appState";
import { forgetCachedNewSession, isCachedNewSessionInfo, markCachedNewSessionInfo, mergeCachedNewSessions, rememberCachedNewSession, stripCachedNewSessionMarker } from "../cachedNewSessions";
import { textMessage } from "../chatMessages";
import { readSavedScrollPosition } from "../chatScrollPosition";
import { carryUnsettledForward, withOutboxRows } from "../transcriptReconcile";
import { machineSessionKey } from "../machineKeys";
import { admissionRefusal, NOT_STORED_REFUSAL, PluginCommandWaiters, pluginCommandAdmission, pluginCommandText, type SessionOnMachine } from "../plugins/pluginSessionCommands";
import type { PluginSessionCommandOutcome, PluginSessionCommandRequest } from "../../../shared/pluginApiTypes";
import type { SlashCommand } from "../../../shared/apiTypes";
import { rememberWorkspaceSessions, cachedSessionsFor } from "../workspaceSessionsCache";
import { clearDraft, loadDraft, moveDraft, saveDraft } from "../promptDraftStorage";
import { heldPendingStartsOn, holdPendingStart, holdsPendingStart, releasePendingStart, releaseUnjoinedPendingStart } from "../heldPendingStarts";
import { carryComposer, renameComposerScope, renamedSessionId } from "../composerScope";
import { PI_WEB_CAPABILITIES, supportsPiWebCapability, type PiWebCapability } from "../../../shared/capabilities";
import { moveHeldComposerAttachments } from "../composerAttachmentHold";
import { clearCardDraft } from "../cardDrafts";
import { clearDialogAnswerDraft } from "../dialogAnswerDrafts";
import { ChatTranscriptStore, type ChatTranscriptView } from "../chatTranscriptStore";
import type { RawMessagePage } from "../chatHistoryCache";
import { acceptedDeliveryState, findDeliveryLineIndex, applyQueueToDelivery, endTakingBack, markDelivery, newClientMessageId, optimisticUserLine, restartDelivery, sessionWorking, withdrawDeliveryLine } from "../messageDelivery";
import type { AttachmentShortfall } from "../returnedAttachments";
import { lostAttachmentsFate, lostAttachmentsNotice, refusalNotice, type LostAttachmentsFate } from "../lostAttachments";
import { appendOperation, discardOutbox, findOperation, firstLoadedAttachments, forgetPendingPrompt, type AttachmentsMiss, heldWords, loadPayload, loadPendingPrompts, payloadInHand, moveOutbox, requeueLostMessage, reserveAcceptedPrompt, retireMessage, savesFilesFirst, type OperationKind, type OperationScope, type PayloadLoad, type PendingPrompt } from "../pendingOutbox";
import { OutboxEngine } from "../outboxEngine";
import { NOTE_SHOWN_MS, notesSeen, notesStillShowing } from "../messageNotes";
import { NetworkError } from "../api/requestDeadline";
import { claimAfterMiss, isClaimOf, provenRowStep, VERIFY_RETRY_MS, type VerificationStep } from "../sendVerification";
import { classifyReadError, QUIET_WINDOW_MS, retryDelayMs, type ReadMiss, type ReadOutcome } from "../sync/readPhase";
import { statusReadVerdict, type StatusPosition } from "../statusOrder";
import { activitiesAfterStatuses, activityOutlivesStatus, statusActivityToAdopt } from "../activityAfterStatus";
import type { ChatLine, MessageDeliveryState } from "../components/shared";
import { fileCompletionInsertText } from "../promptCompletions";
import { SessionSocket, parseSessionSocketEvent, revisionedFrameType, type GlobalSessionEvent, type SessionUiEvent } from "../sessionSocket";
import { isPersistedSessionInfo, isTransientNewSessionInfo } from "../sessionPersistence";
import { SelectionReadinessTracker, type SelectionPlace, type SelectionScope } from "../selectionReadiness";
import { sendRefusedForGood } from "../messageLifecycle";
import { isRequestTimeout } from "../api/requestDeadline";
import { isSessionActive } from "../../../shared/activity";
import type { ExtensionEditorTextMode, SessionStartupProgressEvent } from "../../../shared/apiTypes";
import { failedAnswer, mergedAnswers, withoutArchive, type InstantAnswer } from "../instantActions";
import { InMemorySessionSelectionMemory, markSessionsArchived, selectPreferredSession, type SessionSelectionMemory, isOpenableSession } from "./sessionSelection"
import { selectedMachineId, type GetState, type SetState, type UpdateUrl } from "./types";
import { TrailingRefreshCoordinator } from "./trailingRefreshCoordinator";
import { ParkedNotices } from "../parkedNotices";

/** What a start in a project whose folder is gone says, wherever it is refused. */
const MISSING_PROJECT_FOLDER = "This project's folder no longer exists, so a new session cannot start here.";

const MESSAGE_PAGE_SIZE = 100;
const TRANSCRIPT_RETRY_FIRST_MS = 5_000;
const TRANSCRIPT_RETRY_MAX_MS = 60_000;

/**
 * Hard deadline for applying buffered stream updates.
 *
 * Batching per animation frame keeps the prompt editor's DOM stable while
 * tokens stream, but `requestAnimationFrame` is throttled hard (or not run at
 * all) for background tabs and under heavy paint pressure on phones, which
 * shows up as a transcript that visibly stalls and then jumps. A timer running
 * alongside the frame request guarantees the buffer is applied on time even
 * when frames stop arriving; whichever fires first flushes and cancels the
 * other.
 */
const PENDING_FLUSH_DEADLINE_MS = 100;

/**
 * Every way this socket reports back, named and required.
 *
 * These were five optional positional parameters. A caller that skipped one got
 * silence rather than an error, and no search could prove a handler was wired -
 * which is how the activity list came to be refreshed by nothing at all.
 * Required fields make an omission a compile error.
 */
export interface SessionSocketHandlers {
  onEvent: (event: SessionUiEvent) => void;
  onReconnect: () => void;
  /** Fires once, on the first open of the connection; not every socket cares. */
  onInitialOpen?: () => void;
  /** A revisioned frame failed validation: a lost transition, needs resync. */
  onMalformed: (frameType: string) => void;
  /** The seq monitor saw a jump; `lastSeen` is the watermark before it. */
  onGap: (lastSeen: number) => void;
  /** An open connection went away; frames published until it reopens reach nobody here. */
  onDisconnect?: () => void;
  /** Nothing at all arrived for the page's quiet window T while the connection was open (B7). */
  onQuiet?: () => void;
}

export interface SessionEventSocket {
  /** Optional: implementations that own a real connection verify it here. */
  checkLiveness?(): void;
  reconnectNow?(): void;
  /** Optional: the position the page reached without the socket, which its heartbeat compares against. */
  noteApplied?(seq: number): void;
  connect(session: SessionRef, machineId: string, handlers: SessionSocketHandlers): void;
  setHandler(onEvent: (event: SessionUiEvent) => void): void;
  close(): void;
}

export interface PromptEditorTextReplacement {
  machineId: string;
  sessionId: string;
  text: string;
  /**
   * `paste` puts the text in at the caret instead of replacing the draft: an extension's
   * `pasteToEditor` (extension-ui-counterpart.md, Composer). Absent means replace.
   */
  mode?: ExtensionEditorTextMode;
}

export interface SelectedSessionReady {
  machineId: string;
  session: SessionInfo;
}

export interface SessionControllerDependencies {
  api?: typeof defaultApi;
  socket?: SessionEventSocket;
  transcripts?: ChatTranscriptStore;
  replacePromptEditorText?: (replacement: PromptEditorTextReplacement) => void | Promise<void>;
  /**
   * A message of this device that will not run - taken back, or refused for good - hands its words back to its session's composer.
   * `notice`: why they came back, the composer's one notice about them, said instead of the shortfall's.
   */
  returnToComposer?: (scope: ReturnScope, words: { text: string; attachments: PromptAttachment[]; shortfall?: AttachmentShortfall; notice?: string }) => void;
  /**
   * What a `/new` this device sent took from the queues when it stopped the session goes back to
   * that session's composer, as a Stop's answer does; `lines`: the session's rows, where the words of
   * another device's message are found.
   */
  returnQueuedToComposer?: (scope: ReturnScope, messages: readonly QueuedSessionMessage[], lines: readonly ChatLine[]) => Promise<void>;
  onSelectedSessionReady?: (selection: SelectedSessionReady) => void;
  /**
   * Called when the selected session stops working.
   *
   * A plugin's panel state changes inside a turn - a command the agent runs,
   * a task it completes - and none of that reaches this browser: such a panel
   * reads its files when a workspace is selected and when someone presses
   * refresh, so it kept showing a paused state for work that had finished.
   * The end of a turn is when the file has settled, so it is read then rather
   * than on a timer.
   */
  onSelectedSessionIdle?: () => void;
  /**
   * Where a session opened from another project is placed from: the host's
   * projects and workspaces listings, which keep reading until they answer
   * (B48). Without it the lookup reads the API once, as it did before.
   */
  catalogue?: SessionCatalogue;
  /**
   * The session the address names. A placement or a late correction rewrites only an entry that
   * names its session: a restore's caller (a machine switch, a terminal run) writes its own entry
   * after the restore, and a correction whose session the address no longer names arrives after
   * the reader went elsewhere (review ca45d6ed). Absent, every placement may correct.
   */
  urlSessionId?: () => string | undefined;
  /** Every frame of the selected session's stream, in order and once, with the session it belongs to (browser plugin facts, design 4.B). */
  onStreamFrame?: (scope: { readonly machineId: string; readonly sessionId: string }, event: SessionUiEvent) => void;
  /** The selected session's stream lost frames: its connection went away, or a gap could not be replayed. */
  onStreamLost?: (scope: { readonly machineId: string; readonly sessionId: string }) => void;
}

/**
 * The listings a session's location is looked up in. Each read waits for an
 * answer while `wanted` holds, and resolves undefined once it stops holding or
 * the machine refused.
 */
export interface SessionCatalogue {
  projects(machineId: string, wanted: () => boolean): Promise<readonly Project[] | undefined>;
  workspaces(machineId: string, projectId: string, wanted: () => boolean): Promise<readonly Workspace[] | undefined>;
}

const directCatalogue: SessionCatalogue = {
  projects: (machineId) => projectsApi.projects(machineId),
  workspaces: (machineId, projectId) => workspacesApi.workspaces(projectId, machineId),
};

/** What a session write may carry: a keepalive request outlives a page that is going away. */
type SessionMutationInit = Pick<RequestInit, "keepalive">;

type ClientPendingStartSessionInfo = SessionInfo & { clientPendingStart: true; machineId: string };

interface PendingSessionStart {
  tempId: string;
  cwd: string;
  machineId: string;
  session: ClientPendingStartSessionInfo;
  discarded: boolean;
  /** How it asks the machine; a page rebuilding a held start in the background only joins. */
  ask: PendingStartAsk;
  /** The create request, sent when the session opens (owner, 2026-10-14). */
  launched?: Promise<void>;
  /**
   * The real session id, learned from the daemon's `session.startup` events
   * long before the create request resolves. It is what lets the startup view
   * subscribe to the constructing session and answer its `session_start`
   * dialogs — the dialogs that gate the readiness the create request waits on.
   */
  backendSessionId?: string;
  /** Why the start ended without a session, once it did. */
  failure?: Error;
  /** Cuts the wait before the next ask short, while one runs. */
  wake?: (() => void) | undefined;
}

/**
 * How a pending start asks the machine. `create` is the reader's own intent (the click, a queued
 * message, the link they stand on, a tap on its row) and makes the session when the machine has no
 * creation for its token. `join` is a page rebuilding, in the background, a start it held across a
 * reload: it only answers a creation the machine still has, and never makes one (r44 round 2).
 */
type PendingStartAsk = "create" | "join";

/**
 * What a machine advertises before an ask may be repeated there. A daemon that advertised
 * `sessions.create-joins` before join-only existed ignores `joinOnly` and creates, so a join needs
 * its own capability (r44 round 3).
 */
const ASK_REPEATS_SAFELY: Readonly<Record<PendingStartAsk, PiWebCapability>> = {
  create: PI_WEB_CAPABILITIES.sessionCreateJoins,
  join: PI_WEB_CAPABILITIES.sessionCreateJoinOnly,
};

/** Join requests a page keeps in flight at once: each may be parked up to the create deadline, and they share the browser's few connections to the machine. */
const JOINS_AT_ONCE = 2;

/**
 * What a pending start does after its create request failed (r44). A refusal the machine stated,
 * or a fact a read takes as final too (signed out, forbidden, gone), ends it with the machine's
 * reason. Anything else - a deadline, a dropped link, a gateway's 5xx - says nothing about whether
 * the session is being made: a machine that joins a repeated create (`sessions.create-joins`) is
 * asked again under the same token; on any other, or while that is unknown, a repeat could make a
 * second session, so the start fails as it did before. A discarded start or a closed page stops.
 * A start asked to create that the machine answers with no such creation asks again, now creating.
 * A join was the page's own doing, not the reader's: the machine holding no such creation (a
 * restart dropped it), a refusal, or a machine that no longer joins forgets the start quietly, and
 * the reader can start again; anything else asks again, as a join never makes a session.
 */
type PendingStartAfterFailure = "fail" | "retry" | "forget";

interface CreateFailureFacts {
  final: boolean;
  stopped: boolean;
  /** The machine advertises that this ask may be repeated (`ASK_REPEATS_SAFELY`). */
  repeatsSafely: boolean;
  creationUnknown: boolean;
  ask: PendingStartAsk;
}

const AFTER_FAILURE_BY_ASK: Readonly<Record<PendingStartAsk, (facts: CreateFailureFacts) => PendingStartAfterFailure>> = {
  create: (facts) => (facts.creationUnknown || (!facts.final && facts.repeatsSafely) ? "retry" : "fail"),
  join: (facts) => (facts.creationUnknown || facts.final || !facts.repeatsSafely ? "forget" : "retry"),
};

function pendingStartAfterFailure(facts: CreateFailureFacts): PendingStartAfterFailure {
  return facts.stopped ? "fail" : AFTER_FAILURE_BY_ASK[facts.ask](facts);
}

function isCreationUnknown(error: unknown): boolean {
  return error instanceof HttpError && error.code === CREATION_UNKNOWN_CODE;
}

function createAnswerIsFinal(error: unknown): boolean {
  return sendRefusedForGood(error) || classifyReadError(error).kind === "fact";
}

interface SuppressedCreatedSession {
  session: SessionInfo;
  machineId: string;
}

interface SelectedSessionRefreshTarget {
  session: SessionInfo;
  machineId: string;
  selectionSeq: number;
}

/** Last raw-listing revision per machine|workspace, echoed by background refreshes. */
const sessionsListRevisionByWorkspace = new Map<string, string>();

/** Transient failures retry themselves with backoff; a permanent one stops. */
const REFRESH_RETRY_BASE_MS = 3000;
const REFRESH_RETRY_MAX = 4;

/** 5xx and transport-level failures heal themselves; 4xx are the reader's to fix. */
/**
 * The id of a message the agent took, when this line proves it: a delivered row, or a committed
 * user line stamped with its sender's id. An echo is a queued copy, not a taken one.
 */
function takenMessageId(line: ChatLine): string | undefined {
  const delivery = line.meta?.delivery;
  if (delivery !== undefined) return delivery.state === "delivered" ? delivery.clientMessageId : undefined;
  if (line.role !== "user" || line.meta?.echo === true) return undefined;
  return line.meta?.clientMessageId;
}

/**
 * A session got another id while staying the same session (a pending start answered, a cached new
 * session started again): its draft, held attachments and outbox move to the new id, and the rename
 * is recorded so composer writes bound to the old id follow it. The controller moves its command
 * rows with them (`SessionController.moveComposerState`).
 */
function moveSessionComposerState(machineId: string, fromSessionId: string, toSessionId: string): void {
  const fromKey = machineSessionKey(machineId, fromSessionId);
  const toKey = machineSessionKey(machineId, toSessionId);
  moveDraft(fromKey, toKey);
  renameComposerScope(machineId, fromSessionId, toSessionId);
  moveHeldComposerAttachments(fromKey, toKey);
  moveOutbox(fromKey, toKey, toSessionId);
}

function isTransientRefreshError(error: unknown): boolean {
  if (!(error instanceof HttpError)) return true;
  return error.status >= 500;
}

/**
 * Whether an ask of the ledger failed because the link could not carry it. A body that would not
 * parse is an answer the link carried: counted as unreachable it kept the chain asking every
 * 15 s, and the banner up, for as long as the session stayed on screen.
 */
function ledgerUnreachable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 0 || error.status >= 500;
  return error instanceof NetworkError || isRequestTimeout(error);
}

/** The scope a message's words go back to. */
interface ReturnScope {
  readonly machineId: string;
  readonly sessionId: string;
}

/** How many operations wait in a new session's outbox for it to be created. */
function waitingToStart(pending: Pick<PendingSessionStart, "machineId" | "tempId">): number {
  return loadPendingPrompts(machineSessionKey(pending.machineId, pending.tempId)).length;
}

/** How long the frames an answer names may take to arrive on the stream before the page fetches them. */
const STREAM_HEAD_GRACE_MS = 1500;

/** A new session's id in this browser until the machine has created it. */
const PENDING_SESSION_PREFIX = "pending-session-";

/** The note's account of `count` attachments no copy could give: gone from this browser, or unreadable just now. */
const MISSED_SHORTFALL: Readonly<Record<AttachmentsMiss, (count: number) => AttachmentShortfall>> = {
  absent: (count) => ({ missing: count, unknown: false }),
  unreadable: (count) => ({ missing: 0, unreadable: count, unknown: false }),
};

/** What an ask of the daemon's ledger came back with: an answer (or nothing left to ask about), or no answer and why. */
type LedgerAsk = { readonly kind: "answered" } | { readonly kind: "unreachable"; readonly miss: ReadMiss };

const LEDGER_ANSWERED: LedgerAsk = { kind: "answered" };

/** Why an unreachable ask got no answer, in the row's terms; a stated refusal is not one of them. */
function ledgerMiss(error: unknown): ReadMiss {
  const outcome = classifyReadError(error);
  return outcome.kind === "miss" ? outcome.miss : { kind: "link-down" };
}

export class SessionController {
  private readonly socket: SessionEventSocket;
  private readonly api: typeof defaultApi;
  private readonly targets: SessionTargetResolver;
  /** The session the open-session seam asked the machine about, until the resolver opens what it found. */
  private seamLocating: string | undefined;
  /** A session the resolver opened after that locate, until its open answers with anything but the code. */
  private locatedAfterGone: string | undefined;
  /** The latest machine-wide locate a session-not-found answer started (`locateAnsweredGone`). */
  private goneLocate: Promise<void> | undefined;
  private readonly transcripts: ChatTranscriptStore;
  private readonly parkedNotices = new ParkedNotices();
  private readonly replacePromptEditorText: SessionControllerDependencies["replacePromptEditorText"];
  private readonly returnToComposer: SessionControllerDependencies["returnToComposer"];
  private readonly returnQueuedToComposer: SessionControllerDependencies["returnQueuedToComposer"];
  private readonly onSelectedSessionReady: SessionControllerDependencies["onSelectedSessionReady"];
  private readonly onSelectedSessionIdle: SessionControllerDependencies["onSelectedSessionIdle"];
  private readonly onStreamFrame: SessionControllerDependencies["onStreamFrame"];
  private readonly onStreamLost: SessionControllerDependencies["onStreamLost"];
  private readonly catalogue: SessionCatalogue;
  private selectionSeq = 0;
  /** The selection whose opening transcript read has not landed yet, and how it lands (`openingRead`, `resyncLanding`). */
  private openingReadOwed: { readonly seq: number; readonly read: TailRead } | undefined;
  /**
   * The open session (machine-scoped) whose opening read has landed. Selecting it again, as a retry
   * after a failed status read does, is not an opening: its next tail read is a resync, which keeps
   * the window of a reader in history.
   */
  private openedSessionKey: string | undefined;
  /** Join requests in flight (`JOINS_AT_ONCE`), and the joins waiting for one of them to settle. */
  private joinsAsking = 0;
  private joinTurns: (() => void)[] = [];
  private readonly readiness = new SelectionReadinessTracker((opening) => {
    if (this.getState().isOpeningSession !== opening) this.setState({ isOpeningSession: opening });
  });
  /**
   * Who writes the URL for the current selection's place. The selection's own write comes at the
   * end of its first read when its caller left the push to it (`write`); otherwise the caller wrote
   * it. A placement, or a reopen that corrects the entry naming this session (`correctsUrl`, the
   * locate after a not-found read), marks the place moved (`placed`): before the first read settles
   * it leaves the write to the settle, after it replaces that same entry, so the address and the
   * history always name the place the page shows. A restore that opens a session in another
   * workspace is not a correction: its caller writes the entry (a machine switch, a terminal run),
   * and replacing would take the reader's previous place out of Back (review 1c0cb377).
   */
  private selectionUrl: { seq: number; sessionId: string; settled: boolean; placed: boolean; write: boolean } | undefined;
  private readonly urlSessionId: (() => string | undefined) | undefined;
  private disposed = false;
  private refreshRetryCount = 0;
  private selectionReadAttempt = 0;
  private selectionReadTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshRetryTimer: ReturnType<typeof setTimeout> | undefined;
  // Join-time stream watermark for the selected session. `seq` is the
  // `SessionEventHub` sequence captured together with the seeded partial by the
  // stream snapshot: buffered/live events with `seq <= seq` are already reflected
  // in the committed history + seeded partial and must be dropped, so every event
  // applies exactly once. Reset whenever the selection changes.
  private streamWatermark: { sessionId: string; seq: number; epoch?: string } | undefined;
  /**
   * Loss detection and repair for the selected session's dialog surface. A
   * dialog frame carries the surface's monotonic revision; a skipped one means
   * a frame was lost in transit, and applying the survivors blind is what kept
   * a stale card beside the replacement until an unrelated refetch - the
   * owner's stuck-card report. The scope resyncs through the authoritative
   * status read instead. Recreated per selection: a new session's surface
   * starts its revision space over, so the old scope's counter must not judge
   * it.
   */
  private dialogScope = new RevisionScope({ resync: () => { void this.refreshSelectedSession(); } });
  /** Holds live frames while a counted gap is replayed; rebuilt per selection. */
  private gapRepair: SessionGapRepair | undefined;
  private pendingTranscriptEvents: SessionUiEvent[] = [];
  private pendingStatusBySession = new Map<string, SessionStatus>();
  private readonly pendingStatusPositions = new Map<string, StatusPosition>();
  /** The stream position of the last status applied for the selected session, frame or read. */
  private statusPosition: (StatusPosition & { sessionId: string }) | undefined;
  /**
   * When each session's last status frame and activity frame was applied, on one clock: a read
   * answered after a frame keeps the frame, which is the later fact.
   */
  private readonly statusFrameMarks = new Map<string, number>();
  private readonly activityFrameMarks = new Map<string, number>();
  private frameClock = 0;
  private pendingActivityBySession = new Map<string, SessionActivity>();
  private pendingFrame: number | undefined;
  private pendingFlushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingSessionStarts = new Map<string, PendingSessionStart>();
  /** The waits before a pending start asks again; a closing page ends them. */
  private readonly askAgainWakes = new Set<() => void>();
  private readonly commandDialogRows = new Map<string, string>();
  private readonly suppressedCreatedSessions = new Map<string, SuppressedCreatedSession>();
  private readonly selectedSessionRefreshes = new TrailingRefreshCoordinator<string>();
  /**
   * Frames that reached the page by replay rather than live. A composer write among them missed its
   * moment: applied late it could land over what the reader typed since (extension-ui-counterpart.md,
   * "the frame is momentary"), so it keeps its place in seq order and is not applied.
   */
  private readonly framesFromReplay = new WeakSet<SessionUiEvent>();
  /** The pending retry of an unreachable transcript, with the delay it waited (scheduleTranscriptRetry). */
  private transcriptRetry: { key: string; delayMs: number; timer: ReturnType<typeof setTimeout> | undefined } | undefined;
  // The daemon instance each machine's last status catalog came from. Session
  // ids are the daemon's runtime handles, so a changed id means the entries in
  // `sessionStatuses` were minted by a process that no longer exists.
  private readonly statusCatalogEpochs = new Map<string, string>();

  private readonly setState: SetState;

  constructor(
    private readonly getState: GetState,
    writeState: SetState,
    private readonly updateUrl: UpdateUrl,
    private readonly sessionSelection: SessionSelectionMemory = new InMemorySessionSelectionMemory(),
    deps: SessionControllerDependencies = {},
  ) {
    this.setState = (patch) => {
      if (patch.selectedSession !== undefined) this.targets.drop();
      writeState(patch);
      if (patch.messages !== undefined) this.retireTakenRecords(this.getState().messages);
    };
    this.socket = deps.socket ?? new SessionSocket();
    this.api = deps.api ?? defaultApi;
    this.transcripts = deps.transcripts ?? new ChatTranscriptStore();
    this.replacePromptEditorText = deps.replacePromptEditorText;
    this.returnToComposer = deps.returnToComposer;
    this.returnQueuedToComposer = deps.returnQueuedToComposer;
    this.onSelectedSessionReady = deps.onSelectedSessionReady;
    this.onSelectedSessionIdle = deps.onSelectedSessionIdle;
    this.onStreamFrame = deps.onStreamFrame;
    this.onStreamLost = deps.onStreamLost;
    this.catalogue = deps.catalogue ?? directCatalogue;
    this.urlSessionId = deps.urlSessionId;
    this.targets = new SessionTargetResolver({
      locate: (ref, machineId) => this.api.locateSession(ref, machineId),
      publish: (sessionTarget) => { this.setState({ sessionTarget }); },
      open: (session, openOptions, scope) => {
        if (!this.mayOpenFollowed(session.id, openOptions, scope)) {
          this.targets.drop();
          return Promise.resolve();
        }
        this.locatedAfterGone = this.seamLocating === session.id ? session.id : undefined;
        this.seamLocating = undefined;
        return this.selectSession(session, openOptions);
      },
      reportError: (error) => { this.setState(errorNoticePatch(error)); },
    });
  }

  applyGlobalEvent(event: GlobalSessionEvent): void {
    if (event.type === "status.update") this.queueStatusUpdate(event.status);
    else if (event.type === "activity.update") this.queueActivityUpdate(event.activity);
    else if (event.type === "session.created") this.applyCreatedSession(event.session);
    else if (event.type === "session.name") this.applySessionName(event.sessionId, event.name);
    else if (event.type === "session.startup") this.queueStartupProgress(event);
  }

  dispose() {
    this.disposed = true;
    for (const wake of [...this.askAgainWakes]) wake();
    this.targets.dispose();
    this.selectionSeq += 1;
    this.readiness.clear();
    this.socket.close();
    this.clearPendingUpdates();
    for (const timer of this.verificationRetries.values()) clearTimeout(timer);
    this.verificationRetries.clear();
    this.cancelTranscriptRetry();
  }

  clearActiveSession() {
    clearTimeout(this.selectionReadTimer);
    this.targets.drop();
    this.selectionSeq += 1;
    this.readiness.clear();
    this.socket.close();
    this.streamWatermark = undefined;
    this.gapRepair = undefined;
    this.cancelTranscriptRetry();
    this.clearPendingUpdates();
    this.openedSessionKey = undefined;
    // Note: sendingPrompts is intentionally NOT cleared here. Deselecting a
    // session must not cancel the in-flight upload indicator of the session
    // that is still sending; the per-session entry is cleared by send()'s
    // finally block when the request settles.
    this.setState({ selectedSession: undefined, transcriptSync: undefined, streamBehind: undefined, messages: [], messagePageStart: 0, messagePageEnd: 0, messagePageTotal: 0, newerPendingCount: 0, pageReadEnd: undefined, status: undefined, activity: undefined, pendingDialogs: [], settledDialogIds: [], availableThinkingLevels: [], treeDialog: undefined });
  }

  deselectSession(options?: { forgetRememberedSelection?: boolean | undefined; updateUrl?: boolean | undefined }) {
    const state = this.getState();
    const cwd = state.selectedSession?.cwd ?? state.selectedWorkspace?.path;
    if (options?.forgetRememberedSelection === true && cwd !== undefined) this.sessionSelection.forgetWorkspace(this.workspaceSelectionKey(cwd));
    this.clearActiveSession();
    if (options?.updateUrl !== false) this.updateUrl();
  }

  /**
   * Open a new, empty session in the selected workspace and create it on the machine at once
   * (owner, 2026-10-14: a session left uncreated had no model, thinking level or commands to offer; an empty
   * session left behind is listed "not started" and archived like any other). It reads
   * "Creating…" until the machine answers; what the reader writes meanwhile waits in the outbox.
   */
  startSession(): void {
    const workspace = this.getState().selectedWorkspace;
    if (!workspace) return;
    // A dead workspace can never host a session: failing fast keeps the
    // phantom "New session" row from existing at all, instead of creating a
    // pending start whose every retry repeats the daemon's folder error.
    if (workspace.cwdMissing === true) {
      this.setState(noticePatch(noticeForReader(MISSING_PROJECT_FOLDER)));
      return;
    }
    const machineId = selectedMachineId(this.getState());
    const pending = this.createPendingSessionStart(workspace.path, machineId);
    this.pendingSessionStarts.set(pending.tempId, pending);
    this.selectClientPendingStartSession(pending.session);
    void this.launchPendingStart(pending);
  }

  /**
   * Show a pending start a link named, after a reload or from history, and ask the machine for its
   * creation: the machine answers with the creation still running (its startup dialog comes back
   * with its progress), the session it made, or its refusal.
   */
  private reopenPendingStart(pending: PendingSessionStart, options: SessionTargetOpenOptions): void {
    this.askToCreate(pending);
    const sessions = [pending.session, ...this.getState().sessions.filter((candidate) => candidate.id !== pending.tempId)];
    this.selectClientPendingStartSession(pending.session, { updateUrl: options.updateUrl, sessions });
    void this.launchPendingStart(pending);
  }

  /** Wait until the new session on screen exists, for a choice that needs it (its model or thinking level). */
  async untilStarted(): Promise<void> {
    const session = this.getState().selectedSession;
    const pending = session === undefined ? undefined : this.pendingSessionStarts.get(session.id);
    if (pending !== undefined) await this.launchPendingStart(pending);
  }

  /**
   * Ask the machine to create a new session: its row is listed, and it reads "Creating…" until the
   * machine answers. Every creation this browser makes goes through here, under its pending start's
   * token; the promise settles once the machine created the session or refused it.
   */
  private launchPendingStart(pending: PendingSessionStart): Promise<void> {
    if (pending.launched !== undefined) return pending.launched;
    holdPendingStart({ machineId: pending.machineId, cwd: pending.cwd, token: pending.tempId });
    const state = this.getState();
    const activity = creatingPendingSessionActivity(pending.tempId, waitingToStart(pending));
    const current = this.isCurrentPendingStart(pending);
    this.setState({
      ...(current ? { sessions: [pending.session, ...state.sessions.filter((candidate) => candidate.id !== pending.tempId)] } : {}),
      sessionActivities: { ...state.sessionActivities, [pending.tempId]: activity },
      ...(current && state.selectedSession?.id === pending.tempId ? { activity, statusArrival: "on-its-way" as const } : {}),
    });
    pending.launched = this.createPendingSession(pending);
    return pending.launched;
  }

  private async createPendingSession(pending: PendingSessionStart): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      let session: SessionInfo;
      try {
        session = await this.askFor[pending.ask](pending);
      } catch (error) {
        const verdict = await this.createFailureVerdict(pending, error);
        if (await this.afterCreateFailure[verdict](pending, error, attempt)) continue;
        return;
      }
      await this.resolvePendingSessionStart(pending.tempId, session);
      return;
    }
  }

  private readonly askFor: Readonly<Record<PendingStartAsk, (pending: PendingSessionStart) => Promise<SessionInfo>>> = {
    create: (pending) => this.api.startSession(pending.cwd, pending.machineId, pending.tempId),
    join: (pending) => this.askToJoin(pending),
  };

  /** A join waits its turn among `JOINS_AT_ONCE`; a start the reader asked to create meanwhile goes ahead and creates. */
  private async askToJoin(pending: PendingSessionStart): Promise<SessionInfo> {
    while (this.joinsAsking >= JOINS_AT_ONCE && pending.ask === "join") await new Promise<void>((resolve) => { this.joinTurns.push(resolve); });
    if (pending.ask === "create") return this.askFor.create(pending);
    this.joinsAsking += 1;
    try {
      return await this.api.joinSessionCreation(pending.cwd, pending.machineId, pending.tempId);
    } finally {
      this.joinsAsking -= 1;
      this.joinTurns.shift()?.();
    }
  }

  /** The reader means this start: it creates from now on, and a join waiting its turn stops waiting. */
  private askToCreate(pending: PendingSessionStart): void {
    if (pending.ask === "create") return;
    pending.ask = "create";
    for (const turn of this.joinTurns.splice(0)) turn();
  }

  private async createFailureVerdict(pending: PendingSessionStart, error: unknown): Promise<PendingStartAfterFailure> {
    const final = createAnswerIsFinal(error);
    const stopped = this.stopsAsking(pending);
    const ask = pending.ask;
    const repeatsSafely = final || stopped ? false : await this.machineSupports(pending.machineId, ASK_REPEATS_SAFELY[ask]);
    return pendingStartAfterFailure({ final, stopped, repeatsSafely, creationUnknown: isCreationUnknown(error), ask });
  }

  /** Each executor says whether to ask again. */
  private readonly afterCreateFailure: Readonly<Record<PendingStartAfterFailure, (pending: PendingSessionStart, error: unknown, attempt: number) => Promise<boolean>>> = {
    fail: (pending, error) => {
      this.endPendingStart(pending, error);
      return Promise.resolve(false);
    },
    retry: async (pending, error, attempt) => {
      await this.waitToAskAgain(pending, retryDelayMs(attempt, QUIET_WINDOW_MS));
      if (!this.stopsAsking(pending)) return true;
      this.endPendingStart(pending, error);
      return false;
    },
    forget: (pending, error) => {
      this.forgetPendingStart(pending, error);
      return Promise.resolve(false);
    },
  };

  /**
   * A start rebuilt in the background whose creation the machine no longer has: its row goes, as
   * the start does. Shown to the reader, it says why instead, as a failed start does. Its record
   * stays while young, for another tab whose create may not have reached the machine yet.
   */
  private forgetPendingStart(pending: PendingSessionStart, error: unknown): void {
    if (this.disposed) return;
    const shown = this.getState().selectedSession?.id === pending.tempId;
    if (!shown) pending.discarded = true;
    this.failPendingSessionStart(pending.tempId, error, releaseUnjoinedPendingStart);
    if (shown) return;
    const state = this.getState();
    this.setState({ sessions: state.sessions.filter((session) => session.id !== pending.tempId), sessionActivities: omitSessionActivity(state.sessionActivities, pending.tempId) });
  }

  private endPendingStart(pending: PendingSessionStart, error: unknown): void {
    if (!this.disposed) this.failPendingSessionStart(pending.tempId, error);
  }

  private stopsAsking(pending: PendingSessionStart): boolean {
    return pending.discarded || this.disposed;
  }

  /** Whether the machine advertises a capability; a runtime this page has not read yet is read now, and unknown is no. */
  private async machineSupports(machineId: string, capability: PiWebCapability): Promise<boolean> {
    const runtime = this.getState().machineRuntimes[machineId] ?? await this.api.runtime(machineId).catch(() => undefined);
    return supportsPiWebCapability(runtime, capability);
  }

  /** The wait before asking again; the start's session reported created, its startup reported idle, or the page closing ends it early. */
  private waitToAskAgain(pending: PendingSessionStart, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = (): void => {
        clearTimeout(timer);
        this.askAgainWakes.delete(wake);
        if (pending.wake === wake) pending.wake = undefined;
        resolve();
      };
      const timer = setTimeout(wake, ms);
      pending.wake = wake;
      this.askAgainWakes.add(wake);
    });
  }

  /**
   * Ask again, once, for each creation on this machine whose session this page has not heard
   * named, now that its realtime socket is open. A page reloaded mid-creation sent its first ask
   * before that socket was up and missed the machine naming the session, so the startup dialog came
   * back only after the next 25 s round (r44 live). Each start asks as it asks (a join stays a
   * join), and only on a machine that advertises that ask may be repeated.
   *
   * A start this browser holds but this page has not rebuilt (a reload while the reader stood
   * elsewhere) is rebuilt here, only joining: its row comes back, its startup dialog with it, or it
   * is forgotten when the machine no longer has it. One with queued messages is the outbox's to
   * start.
   */
  async askAgainForUnnamedStarts(machineId: string): Promise<void> {
    const unnamed = [...this.pendingSessionStarts.values()].filter((pending) => pending.machineId === machineId && pending.launched !== undefined && pending.backendSessionId === undefined && !pending.discarded);
    const held = heldPendingStartsOn(machineId).filter((record) => !this.pendingSessionStarts.has(record.token) && loadPendingPrompts(machineSessionKey(machineId, record.token)).length === 0);
    if (unnamed.length === 0 && held.length === 0) return;
    const repeats: Record<PendingStartAsk, boolean> = {
      create: await this.machineSupports(machineId, ASK_REPEATS_SAFELY.create),
      join: await this.machineSupports(machineId, ASK_REPEATS_SAFELY.join),
    };
    for (const record of held) {
      if (!repeats.join || this.disposed || this.pendingSessionStarts.has(record.token)) continue;
      void this.launchPendingStart(this.pendingStartFor(machineId, record.cwd, record.token, "join"));
    }
    for (const pending of unnamed) {
      if (!repeats[pending.ask]) continue;
      void this.askFor[pending.ask](pending).then(
        (session) => this.resolvePendingSessionStart(pending.tempId, session),
        () => undefined,
      );
    }
  }

  /**
   * The pending start for a creation token: the live one, or one rebuilt for a creation this browser
   * asked for before a reload or in another tab. The machine answers its create with that same
   * creation, so rebuilding never makes a second session. A reader's own intent (`create`) turns a
   * start rebuilt only to join into one that creates.
   */
  private pendingStartFor(machineId: string, cwd: string, tempId: string, ask: PendingStartAsk = "create"): PendingSessionStart {
    const live = this.pendingSessionStarts.get(tempId);
    if (live !== undefined) {
      if (ask === "create") this.askToCreate(live);
      return live;
    }
    const rebuilt = this.createPendingSessionStart(cwd, machineId, tempId, ask);
    this.pendingSessionStarts.set(tempId, rebuilt);
    return rebuilt;
  }

  /**
   * The directory of the start this browser holds under a pending-start id on a machine: the live
   * start's or its record's, whatever place the link names (a link written before the start was
   * placed names the place the reader tapped it from).
   */
  private heldStartCwd(machineId: string, tempId: string): string | undefined {
    const live = this.pendingSessionStarts.get(tempId);
    if (live !== undefined) return live.machineId === machineId ? live.cwd : undefined;
    return heldPendingStartsOn(machineId).find((record) => record.token === tempId)?.cwd;
  }

  /** Whether this browser still means to create, in this directory, the session a pending-start id names: it holds its words or its outbox. */
  private holdsCreationWords(machineId: string, cwd: string, tempId: string): boolean {
    const key = machineSessionKey(machineId, tempId);
    return loadDraft(key) !== "" || loadPendingPrompts(key).some((record) => record.scope.cwd === cwd);
  }

  /** Rebuild the start this browser holds under a pending id a link names, in its own place, and ask for it again. */
  private async reopenHeldPendingStart(machineId: string, tempId: string, cwd: string, options: SessionTargetOpenOptions): Promise<void> {
    const seq = this.selectionSeq;
    const placed = await this.placeStart(machineId, cwd, () => seq === this.selectionSeq);
    if (seq !== this.selectionSeq || selectedMachineId(this.getState()) !== machineId) return;
    this.reopenPendingStart(this.pendingStartFor(machineId, cwd, tempId), options);
    if (placed) this.updateUrl({ replace: true });
  }

  preferredSession(cwd: string, sessions: SessionInfo[]): SessionInfo | undefined {
    return selectPreferredSession(sessions, { latestSessionId: this.sessionSelection.latestSessionId(this.workspaceSelectionKey(cwd)) });
  }

  /** The reader took the way back from a named session that cannot be shown: forget it, and the URL stops naming it. */
  forgetNamedSession(): void {
    this.targets.drop();
    this.updateUrl();
  }

  /**
   * Open the session a link or a restore named in this workspace, or say why
   * it cannot be opened (P2 slice b). Never another session in its place: the
   * fallback to the latest session is only for a workspace opened without a
   * named session (B31). A new session's pending id this page is not starting
   * is not asked about: no machine knows a browser's pending id, so its absence
   * would read as a session that no longer exists.
   */
  async openNamedSession(namedSessionId: string, workspace: Workspace, sessions: readonly SessionInfo[], options: SessionTargetOpenOptions = {}): Promise<void> {
    const machineId = selectedMachineId(this.getState());
    const sessionId = namedSessionId.startsWith(PENDING_SESSION_PREFIX) ? renamedSessionId(machineId, namedSessionId) : namedSessionId;
    const pendingId = sessionId.startsWith(PENDING_SESSION_PREFIX);
    const heldCwd = pendingId ? this.heldStartCwd(machineId, sessionId) ?? (this.holdsCreationWords(machineId, workspace.path, sessionId) ? workspace.path : undefined) : undefined;
    if (heldCwd !== undefined) {
      await this.reopenHeldPendingStart(machineId, sessionId, heldCwd, options);
      return;
    }
    const scope = { machineId, workspaceId: workspace.id, cwd: workspace.path, sessionId };
    const listed = targetInListing(sessions, sessionId);
    const target: SessionTarget = pendingId && listed.kind === "asking" ? { kind: "not-started-here", sessionId } : listed;
    await this.targets.follow(scope, target, options);
  }

  /**
   * The live listing's row for the open session replaces the remembered row it was opened from. A
   * session archived or restored since it was remembered opens again: an archived session is read
   * once and keeps no live stream, so swapping the row alone left a live composer with no stream.
   */
  async adoptListedSession(session: SessionInfo): Promise<void> {
    const shown = this.getState().selectedSession;
    if (shown?.id !== session.id) return;
    if ((shown.archived === true) !== (session.archived === true)) {
      await this.selectSession(session, { updateUrl: false });
      return;
    }
    this.setState({ selectedSession: session });
  }

  /**
   * Open the session a route names with no project (B49): one outside every
   * open project, or a link written that way. Before, such a route opened
   * nothing on a reload. The daemon locates it machine-wide, starting from the
   * root; the open then places it among the open projects, or outside them.
   * Deleted, refused or unanswered, it says so as any named session does (D8).
   */
  async openSessionAlone(namedSessionId: string, options: SessionTargetOpenOptions = {}): Promise<void> {
    const machineId = selectedMachineId(this.getState());
    const sessionId = namedSessionId.startsWith(PENDING_SESSION_PREFIX) ? renamedSessionId(machineId, namedSessionId) : namedSessionId;
    const pendingId = sessionId.startsWith(PENDING_SESSION_PREFIX);
    const heldCwd = pendingId ? this.heldStartCwd(machineId, sessionId) : undefined;
    if (heldCwd !== undefined) {
      await this.reopenHeldPendingStart(machineId, sessionId, heldCwd, options);
      return;
    }
    const scope = { machineId, workspaceId: undefined, cwd: MACHINE_WIDE_LOCATE_START, sessionId };
    await this.targets.follow(scope, pendingId ? { kind: "not-started-here", sessionId } : { kind: "asking", sessionId }, options);
  }

  async selectSession(session: SessionInfo, options?: { updateUrl?: boolean | undefined; correctsUrl?: boolean | undefined; preserveTreeDialog?: boolean | undefined; propagateRefreshError?: boolean | undefined }) {
    if (this.disposed) return;
    this.targets.drop();
    // The row refuses to open when its folder is gone (the list stamps it);
    // keyboard and deep-link paths route through here, so the guard lives
    // where every path converges. The reader gets the fact, not a red
    // banner after a navigation.
    if (session.cwdMissing === true) {
      this.setState(noticePatch(noticeForReader("This session's folder no longer exists, so it cannot be opened.")));
      return;
    }
    if (isClientPendingStartSessionInfo(session)) {
      const pending = this.pendingSessionStarts.get(session.id);
      if (pending !== undefined) this.askToCreate(pending);
      this.selectClientPendingStartSession(session, options);
      return;
    }
    this.sessionSelection.rememberSession({ ...session, cwd: this.workspaceSelectionKey(session.cwd) });
    const seq = ++this.selectionSeq;
    const sessionKey = machineSessionKey(selectedMachineId(this.getState()), session.id);
    const opening: TailRead = this.openedSessionKey === sessionKey ? "resync" : openingRead(sessionKey);
    this.openingReadOwed = opening === "resync" ? undefined : { seq, read: opening };
    this.selectionUrl = { seq, sessionId: session.id, settled: false, placed: options?.correctsUrl === true, write: options?.updateUrl !== false };
    this.socket.close();
    this.streamWatermark = undefined;
    this.gapRepair = undefined;
    this.clearBehind();
    this.cancelTranscriptRetry();
    // A new selection is a new dialog surface with its own revision space; the
    // previous scope's counter must not judge it, and its freshness must not
    // vouch for it.
    this.dialogScope = new RevisionScope({ resync: () => { void this.refreshSelectedSession(); } });
    this.clearPendingUpdates();
    const machineId = selectedMachineId(this.getState());
    const transcriptKey = this.sessionCacheKey(session.id);
    const cached = this.transcripts.cachedView(transcriptKey);
    // Choosing a session moves where you are, not just what you are reading:
    // the lists beside the conversation have to describe the same place.
    const state = this.getState();
    const ancestors = ancestorsForSession(session, { workspaces: state.workspaces, projects: state.projects });
    const workspaceMoved = ancestors !== undefined
      && (ancestors.workspace.id !== state.selectedWorkspace?.id || ancestors.workspace.projectId !== state.selectedProject?.id);
    const scope: SelectionScope = { machineId, cwd: session.cwd, sessionId: session.id, selectionSeq: seq };
    this.readiness.begin(scope, session.archived === true ? ["transcript"] : ["transcript", "status", "thinkingLevels"]);
    this.setState({
      ...(workspaceMoved ? resetWorkspaceScopedState() : {}),
      selectedSession: session,
      ...(ancestors === undefined ? {} : { selectedWorkspace: ancestors.workspace, selectedProject: ancestors.project }),
      // A workspace move must not carry the previous workspace's session list
      // under the new one. Seed from the keyed cache and refresh below.
      ...(workspaceMoved
        ? { sessions: [...(cachedSessionsFor(machineId, ancestors.workspace.path) ?? [])], sessionsLoad: "loading" as const }
        : {}),
      ...cached,
      messages: withOutboxRows(cached.messages, loadPendingPrompts(machineSessionKey(machineId, session.id))),
      pageReadEnd: undefined,
      transcriptFailed: undefined,
      statusReadFailed: undefined,
      ...(options?.preserveTreeDialog === true ? {} : { treeDialog: undefined }),
      status: session.archived === true ? undefined : this.getState().sessionStatuses[session.id],
      statusArrival: session.archived === true ? "none" : "on-its-way",
      activity: session.archived === true ? undefined : this.getState().sessionActivities[session.id],
      // A dialog list this same session already had stays until a status replaces
      // it: the transcript load runs after the select and reset it to empty when
      // the connection's status catalog knew nothing about the session yet, so a
      // dialog the daemon held open vanished a moment after it appeared.
      pendingDialogs: pendingDialogsForSelection(this.getState(), session),
      settledDialogIds: [],
      availableThinkingLevels: [],
      newerPendingCount: 0,
    });
    this.restoreOutboxAttachmentRows();
    if (ancestors === undefined && sessionLocationVerdict(session.cwd, state.selectedWorkspace?.path) === "unknown" && session.cwd !== "") {
      void this.locateAndApplySessionWorkspace(session, machineId, seq);
    }
    // The seeded list is the cache's best guess; the workspace's own listing
    // replaces it. Race-guarded inside against a newer selection.
    if (workspaceMoved) void this.refreshCurrentWorkspaceSessions(machineId);
    let buffered: SessionUiEvent[] | undefined;
    try {
      if (session.archived === true) {
        this.setState({ transcriptSync: undefined });
        const page = await this.api.messages(session, { limit: MESSAGE_PAGE_SIZE }, selectedMachineId(this.getState()));
        if (seq !== this.selectionSeq || this.getState().selectedSession?.id !== session.id) {
          this.readiness.abandon(scope);
          return;
        }
        const history = this.landArchivedPage(transcriptKey, page, opening);
        if (opening !== "resync") {
          this.openingReadOwed = undefined;
          this.openedSessionKey = transcriptKey;
        }
        this.setState({ ...history, pageReadEnd: undefined, status: undefined, activity: undefined, pendingDialogs: [], settledDialogIds: [] });
        this.readiness.settle(scope, "transcript", "answered");
        this.locatedAfterGone = undefined;
        this.applyHeldCommandResults(machineId, session.id);
        this.notesOnOpen(machineId, session.id);
        this.onSelectedSessionReady?.({ machineId, session });
        this.settleSelectionUrl(seq, options?.updateUrl !== false);
        return;
      }
      const socketBuffer: SessionUiEvent[] = [];
      buffered = socketBuffer;
      // Gap repair holds live frames while the daemon's ring replays the
      // missed range in front of them; a resync verdict or failed request
      // falls back to the same full refresh a reconnect takes. A replay that
      // lands after the reader chose another session belongs to this machine
      // only: applied, it put session A's frames into session B's view.
      const repair: SessionGapRepair = new SessionGapRepair({
        apply: (event) => { if (this.gapRepair === repair) this.applyEvent(event); },
        reflectedBySnapshot: (event) => revisionedFrameType(event) === undefined,
        request: async (sinceSeq, epoch) => {
          const replay = replayedFrames(await this.api.streamSync(session, sinceSeq, machineId, epoch ?? this.streamWatermark?.epoch));
          if (replay.ok) for (const frame of replay.frames) this.framesFromReplay.add(frame);
          return replay;
        },
        resync: () => {
          if (this.gapRepair !== repair) return;
          this.onStreamLost?.({ machineId, sessionId: session.id });
          this.markBehind(machineId);
          void this.refreshSelectedSession(session.id).finally(() => { if (this.gapRepair === repair) this.clearBehind(); });
        },
        caughtUp: () => { if (this.gapRepair === repair) this.confirmCaughtUp(repair, transcriptKey); },
      });
      this.gapRepair = repair;
      this.syncTranscript({ type: "check", key: transcriptKey });
      this.socket.connect(session, machineId, {
        onEvent: (event) => socketBuffer.push(event),
        onReconnect: () => {
          // Ask, do not resend. Every row the link left unverifiable is an
          // identity the daemon can answer for; sending again without asking is
          // how one message becomes two.
          this.syncTranscript({ type: "check", key: transcriptKey });
          void this.catchUp().then(() => this.askLedgerAbout(session, machineId));
        },
        onDisconnect: () => {
          if (this.gapRepair !== repair) return;
          this.onStreamLost?.({ machineId, sessionId: session.id });
          void this.recheckTranscript();
        },
        onQuiet: () => { if (this.gapRepair === repair) void this.recheckTranscript(); },
        onMalformed: () => {
          this.syncTranscript({ type: "check", key: transcriptKey });
          this.dialogScope.requestResync();
        },
        onGap: () => {
          if (this.gapRepair !== repair) return;
          this.markBehind(machineId);
          this.catchUpFromFrontier(repair, transcriptKey);
        },
      });
      const target: SelectedSessionRefreshTarget = { session, machineId, selectionSeq: seq };
      await this.requestSelectedSessionRefresh(target);
      if (!this.isCurrentRefreshTarget(target)) {
        this.readiness.abandon(scope);
        return;
      }
      this.locatedAfterGone = undefined;
      const thinkingLevels = this.readThinkingLevels(target).then((read) => { this.readiness.settle(scope, "thinkingLevels", read); });
      for (const event of socketBuffer) this.routeLiveEvent(event);
      this.socket.setHandler((event) => { this.routeLiveEvent(event); });
      void this.askLedgerAbout(session, machineId);
      this.applyHeldCommandResults(machineId, session.id);
      this.notesOnOpen(machineId, session.id);
      this.onSelectedSessionReady?.({ machineId, session });
      this.settleSelectionUrl(seq, options?.updateUrl !== false);
      await thinkingLevels;
    } catch (error) {
      this.readiness.settle(scope, "transcript", "failed");
      this.readiness.settle(scope, "thinkingLevels", "failed");
      this.readiness.settle(scope, "status", "failed");
      if (seq !== this.selectionSeq || this.getState().selectedSession?.id !== session.id) {
        this.readiness.abandon(scope);
        // Tree navigation still needs to know when a same-session reselection's
        // shared trailing refresh failed, even though this selection is stale.
        if (options?.propagateRefreshError === true && this.isSelectedSessionIdentity(session.id, machineId)) throw error;
        return;
      }
      if (isCachedNewSessionInfo(session) && isSessionNotFoundError(error)) {
        this.recreateCachedNewSession(session, options);
        return;
      }
      // A failed join refresh must not strand the socket on its temporary
      // buffering callback. Apply what arrived and keep live events flowing so
      // reconnect/trailing refresh can recover authoritatively.
      if (buffered !== undefined) {
        for (const event of buffered) this.routeLiveEvent(event);
        this.socket.setHandler((event) => { this.routeLiveEvent(event); });
      }
      if (isSessionNotFoundError(error) && this.getState().selectedWorkspace !== undefined) this.failedFor(session, error);
      else {
        this.locatedAfterGone = undefined;
        this.setState({ ...errorNoticePatch(error), transcriptFailed: describeError(error) });
        this.readSelectionAgain(session, machineId, error);
      }
      if (options?.propagateRefreshError === true) throw error;
    }
  }

  /**
   * Wait until the selection of this session is no longer opening (selectionReadiness.ts): its
   * first reads each answered or failed, or the selection moved to another session.
   */
  untilSelectionSettles(place: SelectionPlace): Promise<void> {
    return this.readiness.untilSettled(place);
  }

  /**
   * Read one page back from the start of the window and merge it as its neighbour. The window can
   * move while the page is on its way (a resync that replaced it with the newest page), and a page
   * read for where the window was lies beside it rather than
   * under it: merged, it left a hole the store answered by keeping only the newcomer, so the
   * transcript collapsed to one page away from the reader. The read is asked once more for the
   * window as it stands, and a page that still does not fit is dropped. Both reads go to the
   * machine the reader asked on, and the second, like the merge, only while the reader still has
   * that session open on that machine. A page whose total is below the window's end means rows
   * the window holds are gone from the session (`shrankUnder`).
   */
  async loadEarlierMessages() {
    const state = this.getState();
    const session = state.selectedSession;
    if (!session || state.pageReadEnd !== undefined || state.messagePageStart <= 0) return;
    const machineId = selectedMachineId(state);
    this.setState({ pageReadEnd: "earlier" });
    try {
      let before = state.messagePageStart;
      let page = await this.readEarlierPage(session, machineId, before);
      const moved = this.getState();
      if (this.readsFor(session.id, machineId) && moved.messagePageStart !== before && moved.messagePageStart > 0) {
        before = moved.messagePageStart;
        page = await this.readEarlierPage(session, machineId, before);
      }
      if (!this.readsFor(session.id, machineId) || this.getState().messagePageStart !== before) return;
      if (this.shrankUnder(page)) {
        void this.refreshSelectedSession();
        return;
      }
      const merged = this.transcripts.mergeHistory(this.sessionCacheKey(session.id), page, "neighbour");
      this.setState({ ...merged, newerPendingCount: this.pendingAfter(merged) });
    } catch (error) {
      this.failedFor(session, error);
    } finally {
      if (this.getState().selectedSession?.id === session.id) this.setState({ pageReadEnd: undefined });
    }
  }

  private readEarlierPage(session: SessionInfo, machineId: string, before: number): Promise<RawMessagePage> {
    return this.api.messages(session, { before, limit: MESSAGE_PAGE_SIZE }, machineId);
  }

  /** Whether the reader still has the session a page was read for open on the machine it was read from. */
  private readsFor(sessionId: string, machineId: string): boolean {
    const now = this.getState();
    return now.selectedSession?.id === sessionId && selectedMachineId(now) === machineId;
  }

  /**
   * A page whose total fell below the window's end: rows the window holds are gone from the session
   * (retry attempts hidden, another client moving the branch). Merged, the window's higher total
   * won, and the forward end read the same clamped page again and again without moving. Such a page
   * is not merged; a resync takes the newest page in place of the window (`resyncLanding`).
   */
  private shrankUnder(page: RawMessagePage): boolean {
    return page.total < this.getState().messagePageEnd;
  }

  /**
   * The count below is `total - end + newerPendingCount`, and `newerPendingCount` holds the messages
   * committed since the window's total was read. A page that brings a larger total has counted
   * those already, so they leave the parked count; kept, every page read counted them twice.
   */
  private pendingAfter(merged: Pick<ChatTranscriptView, "messagePageTotal">): number {
    const now = this.getState();
    return Math.max(0, now.newerPendingCount - (merged.messagePageTotal - now.messagePageTotal));
  }

  /**
   * The window with the daemon's total written onto it, for a read that shows the window already
   * reaches the daemon's tail: a merge keeps the larger of the two totals, so a total that went down
   * without going below the window's end left newer messages that did not exist, and the forward end
   * read the same page again and again.
   */
  private notedTotalView(key: string, total: number): ChatTranscriptView {
    this.transcripts.noteTotal(key, total);
    return this.transcripts.cachedView(key);
  }

  /**
   * An archived session's opening page lands by the rule a live session's tail read lands by
   * (`resyncLanding`, with how the selection opens): a reader who left it at a spot in history keeps
   * that window, with the total noted. Merged as the newest page, it replaced that window, and the
   * reader came back to the newest messages.
   */
  private landArchivedPage(key: string, page: RawMessagePage, read: TailRead): ChatTranscriptView {
    const held = this.getState();
    const lands: Record<ResyncLanding, () => ChatTranscriptView> = {
      noteTotal: () => this.notedTotalView(key, page.total),
      mergeTail: () => this.transcripts.mergeHistory(key, page),
      replaceWithTail: () => {
        this.transcripts.discard(key);
        return this.transcripts.mergeHistory(key, page);
      },
    };
    return lands[resyncLanding({ kind: read, total: page.total }, { end: held.messagePageEnd, total: held.messagePageTotal })]();
  }

  /** Notices held while the tail was trimmed (`ParkedNotices`; the daemon keeps no copy), shown once the window reaches the tail. */
  private withParkedNotices(key: string, messages: ChatLine[]): ChatLine[] {
    return this.parkedNotices.take(key).reduce((lines, event) => this.transcripts.applyLiveEvent(lines, event) ?? lines, messages);
  }

  /**
   * Read one page forward from the end of the window - the forward twin of loadEarlierMessages,
   * with the same second read and drop when the window moves meanwhile (the jump to the newest, a
   * resync). The reader is walking into the newer side, so the page extends the span instead of
   * replacing it with the tail: a forward prefetch that replaced the window is what threw a reader
   * scrolling down out of a bottom-trimmed span to the newest messages, and with the earlier read
   * they met there, back again (#68). A page that reaches the tail ends the count of messages below
   * and applies the notices held while the tail was trimmed.
   */
  async loadNewerMessages() {
    const state = this.getState();
    const session = state.selectedSession;
    if (!session || state.pageReadEnd !== undefined || state.messagePageEnd >= state.messagePageTotal) return;
    const machineId = selectedMachineId(state);
    this.setState({ pageReadEnd: "newer" });
    try {
      let after = state.messagePageEnd;
      let page = await this.readNewerPage(session, machineId, after);
      const moved = this.getState();
      if (this.readsFor(session.id, machineId) && moved.messagePageEnd !== after && moved.messagePageEnd < moved.messagePageTotal) {
        after = moved.messagePageEnd;
        page = await this.readNewerPage(session, machineId, after);
      }
      const now = this.getState();
      if (!this.readsFor(session.id, machineId) || now.messagePageEnd !== after || after >= now.messagePageTotal) return;
      if (this.shrankUnder(page)) {
        void this.refreshSelectedSession();
        return;
      }
      const key = this.sessionCacheKey(session.id);
      const merged = page.total === after ? this.notedTotalView(key, page.total) : this.transcripts.mergeHistory(key, page, "neighbour");
      if (merged.messagePageEnd < merged.messagePageTotal) {
        this.setState({ ...merged, newerPendingCount: this.pendingAfter(merged) });
        return;
      }
      this.setState({ ...merged, messages: this.withParkedNotices(key, merged.messages), newerPendingCount: 0 });
    } catch (error) {
      this.failedFor(session, error);
    } finally {
      if (this.getState().selectedSession?.id === session.id) this.setState({ pageReadEnd: undefined });
    }
  }

  private readNewerPage(session: SessionInfo, machineId: string, after: number): Promise<RawMessagePage> {
    const upto = Math.min(after + MESSAGE_PAGE_SIZE, this.getState().messagePageTotal);
    return this.api.messages(session, { before: upto, limit: MESSAGE_PAGE_SIZE }, machineId);
  }

  /**
   * Load the live tail: the newest page replaces the window, because the reader
   * asked for the tail itself (the jump control, the back-to-newest key) and
   * everything between their span and it is what they said they wanted. The top
   * rows they had are read again if they scroll back up.
   */
  async jumpToNewestMessages() {
    const state = this.getState();
    const session = state.selectedSession;
    if (!session || state.pageReadEnd !== undefined || state.messagePageEnd >= state.messagePageTotal) return;
    const machineId = selectedMachineId(state);
    this.setState({ pageReadEnd: "newer" });
    try {
      const page = await this.api.messages(session, { limit: MESSAGE_PAGE_SIZE }, machineId);
      if (!this.readsFor(session.id, machineId)) return;
      const key = this.sessionCacheKey(session.id);
      const merged = this.transcripts.mergeHistory(key, page, "newest");
      this.setState({ ...merged, messages: this.withParkedNotices(key, merged.messages), newerPendingCount: 0 });
    } catch (error) {
      this.failedFor(session, error);
    } finally {
      if (this.getState().selectedSession?.id === session.id) this.setState({ pageReadEnd: undefined });
    }
  }

  private readonly pluginCommands = new PluginCommandWaiters();

  /**
   * A plugin page runs one of the extension commands its package declared, in the session on screen
   * (design B3/S3 v2, 4.2). Admitted, it goes through this device's outbox like a typed command -
   * at most once, kept sending while the machine is unreachable - but draws no command row and,
   * while the machine holds it, no queued message: the page shows the outcome on its own row, and
   * the extension's notices still reach the chat.
   */
  async runPluginCommand(pageMachineId: string, declared: readonly string[], request: PluginSessionCommandRequest): Promise<PluginSessionCommandOutcome> {
    const before = this.pluginCommandScope();
    const commands = before?.machineId === pageMachineId && before.sessionId === request.sessionId
      ? await this.api.commands({ id: before.sessionId, cwd: before.cwd }, pageMachineId).then((list): readonly SlashCommand[] | "unknown" => list, (): "unknown" => "unknown")
      : "unknown";
    const scope = this.pluginCommandScope();
    const admission = pluginCommandAdmission({ declared, pageMachineId, request, commands, onScreen: scope });
    if (admission !== "admit") return admissionRefusal(admission, request.name);
    if (scope === undefined) return admissionRefusal("no-session", request.name);
    const sessionKey = machineSessionKey(scope.machineId, scope.sessionId);
    const written = appendOperation(sessionKey, { kind: "command", scope, text: pluginCommandText(request), clientMessageId: newClientMessageId(), at: new Date().toISOString() });
    if (written === undefined) return NOT_STORED_REFUSAL;
    return this.pluginCommands.wait(written.clientMessageId, () => findOperation(sessionKey, written.clientMessageId) !== undefined);
  }

  /** Whether a queued command is one this page sent for a plugin: the reader neither sees it as their queued message nor gets it back in their composer. */
  isPluginCommand(commandClientMessageId: string | undefined): boolean {
    return this.pluginCommands.sentForPlugin(commandClientMessageId);
  }

  /** The session on screen as an outbox scope, unless there is none or it is still starting. */
  private pluginCommandScope(): (SessionOnMachine & OperationScope) | undefined {
    const state = this.getState();
    const session = state.selectedSession;
    const cwd = composerCwd(state);
    if (session === undefined || isClientPendingStartSessionInfo(session) || cwd === undefined) return undefined;
    return { machineId: selectedMachineId(state), sessionId: session.id, cwd };
  }

  /**
   * A command run from the page itself rather than the composer (the tree button): sent at once
   * and unnumbered, because its answer drives the page directly. A session still being created has nothing to run it on.
   */
  async runCommand(text: string) {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true || isClientPendingStartSessionInfo(session)) return;
    const machineId = selectedMachineId(this.getState());
    const ledgerId = this.issueCommandRow(machineId, session.id, text, undefined);
    await this.deliverCommandToSession(session, text, machineId, ledgerId);
  }

  private markSendingPrompt(sessionId: string, sending: boolean): void {
    const current = this.getState().sendingPrompts;
    if (sending) {
      if (current[sessionId] !== true) this.setState({ sendingPrompts: { ...current, [sessionId]: true } });
    } else if (sessionId in current) {
      this.setState({ sendingPrompts: omitKey(current, sessionId) });
    }
  }

  /** A command's row in the transcript: the receipt, shown before the machine is even asked. */
  private issueCommandRow(machineId: string, sessionId: string, text: string, id: string | undefined): string {
    const state = this.getState();
    const onScreen = this.isSelectedSessionIdentity(sessionId, machineId);
    const issued = issueCommand(state.commandLedger, {
      ...(id === undefined ? {} : { id }),
      sessionKey: machineSessionKey(machineId, sessionId),
      text,
      now: Date.now(),
      afterRowKey: onScreen ? lastLastingRowKey(state.messages) : undefined,
    });
    this.setState({ commandLedger: issued.entries });
    return issued.id;
  }

  /**
   * This browser's outboxes, sent in the background wherever the reader is (outboxEngine.ts);
   * what each answer means for the page is decided here.
   */
  private readonly outbox = new OutboxEngine({
    apply: async (scope, batch) => {
      const answer = await this.api.applyOperations({ id: scope.sessionId, cwd: scope.cwd }, batch, scope.machineId);
      this.noteStreamHead(scope, answer.standing.head);
      return answer;
    },
    startPending: (scope) => this.startPending(scope),
    prepare: (record) => this.prepareOperation(record),
    applied: (sessionKey, record, outcome) => { this.operationApplied[record.kind](sessionKey, record, outcome); },
    refused: (sessionKey, record, reason) => { this.operationRefused[record.kind](sessionKey, record, reason); },
    changed: () => { this.outboxChanged(); },
  });

  /**
   * A note under one message (messageNotes.ts), replacing any earlier note about it. It starts its
   * time on screen now when its session is open, else when the reader opens it.
   */
  private noteUnder(scope: ReturnScope, clientMessageId: string, text: string): void {
    const sessionKey = machineSessionKey(scope.machineId, scope.sessionId);
    const shownAt = this.isSelectedSessionIdentity(scope.sessionId, scope.machineId) ? Date.now() : undefined;
    const others = this.getState().messageNotes.filter((note) => note.clientMessageId !== clientMessageId);
    this.setState({ messageNotes: [...others, { sessionKey, clientMessageId, text, shownAt }] });
    if (shownAt !== undefined) this.dropNotesLater();
  }

  private dropNotesLater(): void {
    setTimeout(() => {
      const notes = this.getState().messageNotes;
      const showing = notesStillShowing(notes, Date.now());
      if (showing.length !== notes.length) this.setState({ messageNotes: showing });
    }, NOTE_SHOWN_MS + 50);
  }

  /** The reader opened a session, or sent to it again: its notes start their time, or go. */
  private notesOnOpen(machineId: string, sessionId: string): void {
    const sessionKey = machineSessionKey(machineId, sessionId);
    const notes = this.getState().messageNotes;
    if (!notes.some((note) => note.sessionKey === sessionKey && note.shownAt === undefined)) return;
    this.setState({ messageNotes: notesSeen(notes, sessionKey, Date.now()) });
    this.dropNotesLater();
  }

  private clearNotes(machineId: string, sessionId: string): void {
    const sessionKey = machineSessionKey(machineId, sessionId);
    const notes = this.getState().messageNotes;
    if (notes.some((note) => note.sessionKey === sessionKey)) this.setState({ messageNotes: notes.filter((note) => note.sessionKey !== sessionKey) });
  }

  /**
   * The open session's stream is known to be behind its machine: a frame number skipped, a read
   * again after "resync", or an answer naming a head this page has not reached (the row's
   * "Syncing with", owner 2026-10-14).
   */
  private markBehind(machineId: string): void {
    if (this.getState().streamBehind === undefined) this.setState({ streamBehind: { machineId, since: Date.now() } });
  }

  private clearBehind(): void {
    if (this.getState().streamBehind !== undefined) this.setState({ streamBehind: undefined });
  }

  /**
   * A batch's answer names the stream's head. The frames up to it are usually already on their
   * way; still short of it a moment later, the page has missed something and fetches it - the
   * answer's half of the acknowledgement, checking the stream as the stream checks the answer.
   */
  private noteStreamHead(scope: OperationScope, head: { seq: number; epoch: string }): void {
    const repair = this.gapRepair;
    if (repair === undefined || !this.onScreen(scope) || repair.space !== head.epoch) return;
    const short = (): boolean => this.gapRepair === repair && (repair.position ?? 0) < head.seq;
    if (!short()) return;
    setTimeout(() => {
      if (!short()) return;
      this.markBehind(scope.machineId);
      this.catchUpFromFrontier(repair, this.sessionCacheKey(scope.sessionId));
    }, STREAM_HEAD_GRACE_MS);
  }

  startOutbox(): void {
    this.outbox.start();
    this.outboxChanged();
  }

  stopOutbox(): void {
    this.outbox.stop();
  }

  /** The link may be back or the page came into view: every outbox sends now. */
  kickOutbox(): void {
    this.outbox.kickAll();
  }

  /** The machines with a batch nobody has answered, for the app row's "Trying to sync". */
  private readonly attachmentReads = new Set<string>();

  private restoreOutboxAttachmentRows(): void {
    const current = this.getState();
    const session = current.selectedSession;
    if (session === undefined) return;
    const machineId = selectedMachineId(current);
    const key = machineSessionKey(machineId, session.id);
    for (const record of loadPendingPrompts(key)) {
      const ref = record.attachmentRef;
      if (ref === undefined || payloadInHand(record) || this.attachmentReads.has(ref.id)) continue;
      this.attachmentReads.add(ref.id);
      void loadPayload(record).then(loaded => {
        if (loaded.kind !== "ready") {
          console.warn("PI WEB pending attachment not restored", { outcome: loaded.kind, machineId: record.scope.machineId, sessionId: record.scope.sessionId, clientMessageId: record.clientMessageId });
          return;
        }
        if (!this.isSelectedSessionIdentity(session.id, machineId)) return;
        const records = loadPendingPrompts(key);
        const latest = records.find(candidate => candidate.clientMessageId === record.clientMessageId);
        if (latest?.kind !== record.kind || latest.attachmentRef?.id !== ref.id) return;
        const hydrated = records.map(candidate => candidate.clientMessageId === loaded.record.clientMessageId ? loaded.record : candidate);
        this.setState({ messages: withOutboxRows(this.getState().messages, hydrated) });
      }).finally(() => { this.attachmentReads.delete(ref.id); });
    }
  }

  private outboxChanged(): void {
    this.restoreOutboxAttachmentRows();
    const unanswered = this.outbox.unanswered();
    const current = this.getState().outboxUnanswered;
    if (unanswered.length === current.length && unanswered.every((entry, index) => entry.machineId === current[index]?.machineId && entry.since === current[index].since && entry.miss.kind === current[index].miss.kind)) return;
    this.setState({ outboxUnanswered: unanswered });
  }

  /**
   * An operation written while its session is being created waits for the creation, and makes it
   * through the same pending start, under the same startup token, when this page has none (a reload,
   * another tab); the composer state (outbox, draft, held attachments) then moves to the session's own
   * id, as a rename of the same composer. A failed creation throws its failure, so a refusal returns
   * the words; throws while the session has not started, so the batch waits.
   */
  private async startPending(scope: OperationScope): Promise<boolean> {
    if (!scope.sessionId.startsWith(PENDING_SESSION_PREFIX)) return false;
    const draftKey = machineSessionKey(scope.machineId, scope.sessionId);
    const pending = this.pendingStartFor(scope.machineId, scope.cwd, scope.sessionId);
    await this.launchPendingStart(pending);
    if (pending.failure !== undefined) throw pending.failure;
    if (loadPendingPrompts(draftKey).length > 0) throw new Error("The new session has not started yet.");
    return true;
  }

  /** A message whose files go to the workspace travels with their paths, saved once before its first batch. */
  private async prepareOperation(record: PendingPrompt): Promise<PendingPrompt> {
    if (!savesFilesFirst(record)) return record;
    const saved = await this.api.saveAttachments({ id: record.scope.sessionId, cwd: record.scope.cwd }, record.attachments ?? [], record.scope.machineId);
    const references = saved.map((file) => fileCompletionInsertText(file.path, false)).join(" ");
    const prepared: PendingPrompt = { ...record, text: record.text === "" ? references : `${record.text}\n\n${references}` };
    Reflect.deleteProperty(prepared, "attachments");
    Reflect.deleteProperty(prepared, "attachmentRef");
    Reflect.deleteProperty(prepared, "delivery");
    return prepared;
  }

  private onScreen(scope: OperationScope): boolean {
    return this.isSelectedSessionIdentity(scope.sessionId, scope.machineId);
  }

  /** What each kind of operation's acceptance does to the page; called once per operation, whichever path confirmed it. */
  private readonly operationApplied: Readonly<Record<OperationKind, (sessionKey: string, record: PendingPrompt, outcome: OperationAppliedOutcome) => void>> = {
    message: (_sessionKey, record) => { this.messageAccepted(record); },
    takeBack: (sessionKey, record, outcome) => {
      forgetPendingPrompt(sessionKey, record.clientMessageId);
      if (record.attachmentsLost !== undefined) {
        this.lostAttachmentsSettled[lostAttachmentsFate(outcome)](sessionKey, record, undefined);
        return;
      }
      this.takeBackOutcomes[outcome](sessionKey, record, this.onScreen(record.scope));
    },
    command: (sessionKey, record) => {
      forgetPendingPrompt(sessionKey, record.clientMessageId);
      this.pluginCommands.taken(record.clientMessageId);
      this.readCommandResult(record, 0);
    },
    shell: (sessionKey, record) => {
      forgetPendingPrompt(sessionKey, record.clientMessageId);
      this.dropSendingRow(record);
    },
  };

  /** The machine took the message: its row reads received, and its words are kept aside until the agent takes it. */
  private messageAccepted(record: PendingPrompt): void {
    this.settleAnsweredSend({ id: record.scope.sessionId, cwd: record.scope.cwd }, record.scope.machineId, record.clientMessageId);
    const listed = this.getState().sessions.find((candidate) => candidate.id === record.scope.sessionId);
    if (listed !== undefined) this.markCachedNewSessionPersisted(listed);
  }

  /** A take-back's answer: the message is gone and its words come back, or the agent already has it. */
  private readonly takeBackOutcomes: Readonly<Record<OperationAppliedOutcome, (sessionKey: string, record: PendingPrompt, onScreen: boolean) => void>> = {
    takenBack: (sessionKey, record, onScreen) => {
      const target = record.takeBackOf ?? "";
      const words = retireMessage(sessionKey, target);
      if (onScreen) this.setState({ messages: withdrawDeliveryLine(this.getState().messages, target) });
      if (record.wordsReturned === true) return;
      const first = words ?? record;
      if (payloadInHand(first)) {
        this.returnTakenBack(record, words, first.attachments ?? []);
        return;
      }
      void firstLoadedAttachments(words === undefined ? [record] : [words, record]).then(attachments => { this.returnTakenBack(record, words, attachments); });
    },
    tooLate: (_sessionKey, record, onScreen) => {
      if (onScreen) this.setState({ messages: endTakingBack(this.getState().messages, record.takeBackOf ?? "") });
      this.noteUnder(record.scope, record.takeBackOf ?? "", "Already with the agent; it could not be taken back.");
    },
    accepted: (_sessionKey, record, onScreen) => {
      if (onScreen) this.setState({ messages: endTakingBack(this.getState().messages, record.takeBackOf ?? "") });
    },
  };

  /**
   * The machine answered the take-back that asked about a message whose attachments this browser
   * lost (lostAttachments.ts). Not sent: its row goes and its words come back, the composer saying
   * why - the one place that says it. Delivered: it stays, nothing comes back, and nothing is said:
   * the reader never asked for it back. A reader who pressed Take back meanwhile gave the take-back
   * the copy the row still had (appendTakeBack): it comes back with the words, and nothing says the
   * attachments are gone.
   */
  private readonly lostAttachmentsSettled: Readonly<Record<LostAttachmentsFate, (sessionKey: string, takeBack: PendingPrompt, refusal: string | undefined) => void>> = {
    notSent: (sessionKey, takeBack, refusal) => {
      const target = takeBack.takeBackOf ?? "";
      retireMessage(sessionKey, target);
      if (this.onScreen(takeBack.scope)) this.setState({ messages: withdrawDeliveryLine(this.getState().messages, target) });
      if (payloadInHand(takeBack)) {
        this.returnLostAttachmentsWords(takeBack, refusal, takeBack.attachments ?? []);
        return;
      }
      void firstLoadedAttachments([takeBack]).then((copy) => { this.returnLostAttachmentsWords(takeBack, refusal, copy); });
    },
    delivered: (_sessionKey, takeBack) => {
      if (this.onScreen(takeBack.scope)) this.setState({ messages: markDelivery(this.getState().messages, takeBack.takeBackOf ?? "", "delivered") });
    },
  };

  private returnLostAttachmentsWords(takeBack: PendingPrompt, refusal: string | undefined, attachments: PromptAttachment[] | AttachmentsMiss): void {
    if (typeof attachments === "string") {
      this.lostAttachmentsMissed[attachments](takeBack, refusal);
      return;
    }
    const notice = attachments.length === 0 ? lostAttachmentsNotice(takeBack.attachmentsLost ?? 0, refusal) : refusalNotice(refusal);
    this.returnToComposer?.(takeBack.scope, { text: takeBack.text, attachments, ...(notice === undefined ? {} : { notice }) });
  }

  /**
   * The lost-attachments take-back's words when its own copy gave nothing: no copy is the loss the
   * notice already names; a copy unreadable just now is said as such, not as gone from this browser.
   */
  private readonly lostAttachmentsMissed: Readonly<Record<AttachmentsMiss, (takeBack: PendingPrompt, refusal: string | undefined) => void>> = {
    absent: (takeBack, refusal) => { this.returnLostAttachmentsWords(takeBack, refusal, []); },
    unreadable: (takeBack, refusal) => {
      const notice = refusalNotice(refusal);
      this.returnToComposer?.(takeBack.scope, { text: takeBack.text, attachments: [], shortfall: MISSED_SHORTFALL.unreadable(takeBack.attachmentsLost ?? 0), ...(notice === undefined ? {} : { notice }) });
    },
  };

  /**
   * A taken-back message's words go back to the composer with its attachments: from the message's
   * own copy, else the take-back's. When neither can be had, the note says how many did not come
   * back, and whether this browser has no copy or could not read it just now.
   */
  private returnTakenBack(takeBack: PendingPrompt, words: PendingPrompt | undefined, attachments: PromptAttachment[] | AttachmentsMiss): void {
    const count = (words ?? takeBack).attachmentRef?.count ?? 0;
    const shortfall = typeof attachments === "string" ? MISSED_SHORTFALL[attachments](count) : words === undefined ? takeBack.shortfall : undefined;
    this.returnToComposer?.(takeBack.scope, { text: words?.text ?? takeBack.text, attachments: typeof attachments === "string" ? [] : attachments, ...(shortfall === undefined ? {} : { shortfall }) });
  }

  /** What each kind of operation refused for good does: it is cancelled, and the reader is told why. */
  private readonly operationRefused: Readonly<Record<OperationKind, (sessionKey: string, record: PendingPrompt, reason: string) => void>> = {
    message: (_sessionKey, record, reason) => { this.cancelMessage(record.scope, record.clientMessageId, reason); },
    takeBack: (sessionKey, record, reason) => {
      forgetPendingPrompt(sessionKey, record.clientMessageId);
      if (record.attachmentsLost !== undefined) {
        this.lostAttachmentsSettled[lostAttachmentsFate("refused")](sessionKey, record, reason);
        return;
      }
      if (this.onScreen(record.scope)) this.setState({ messages: endTakingBack(this.getState().messages, record.takeBackOf ?? "") });
      this.noteUnder(record.scope, record.takeBackOf ?? "", `It could not be taken back: ${reason}`);
    },
    command: (sessionKey, record, reason) => {
      forgetPendingPrompt(sessionKey, record.clientMessageId);
      this.settleLedgerRow(record.clientMessageId, { state: "failed", resultText: reason });
      this.pluginCommands.refused(record.clientMessageId, reason);
    },
    shell: (sessionKey, record, reason) => {
      forgetPendingPrompt(sessionKey, record.clientMessageId);
      this.dropSendingRow(record);
      this.noteUnder(record.scope, record.clientMessageId, `${record.text} was not run: ${reason}`);
    },
  };

  /**
   * A command the machine accepted is read for its result, by identity, until it answers; a read
   * nobody answered is read again by itself. A result that needs the page, for a session the
   * reader left, waits until the reader returns to it (owner, 2026-10-14).
   */
  private readCommandResult(record: PendingPrompt, attempt: number): void {
    if (this.disposed) return;
    const session = { id: record.scope.sessionId, cwd: record.scope.cwd };
    void this.api.commandResult(session, record.clientMessageId, record.scope.machineId).then((answer) => {
      if (answer.state === "running") {
        this.readCommandResult(record, 0);
        return;
      }
      if (answer.state === "failed") {
        this.settleLedgerRow(record.clientMessageId, { state: "failed", resultText: answer.error });
        this.pluginCommands.refused(record.clientMessageId, answer.error);
        return;
      }
      this.commandResultArrived(record, answer.result);
    }, (error: unknown) => {
      if (sendRefusedForGood(error)) {
        this.settleLedgerRow(record.clientMessageId, { state: "failed", resultText: describeError(error) });
        this.pluginCommands.lost(record.clientMessageId, describeError(error));
        return;
      }
      setTimeout(() => { this.readCommandResult(record, attempt + 1); }, retryDelayMs(attempt, QUIET_WINDOW_MS));
    });
  }

  private readonly heldCommandResults = new Map<string, { ledgerId: string; result: CommandResult }[]>();

  private commandResultArrived(record: PendingPrompt, result: CommandResult): void {
    this.settleCommandRow(record.clientMessageId, result);
    this.pluginCommands.answered(record.clientMessageId, result);
    if (this.onScreen(record.scope)) {
      this.applyCommandResult(result);
      return;
    }
    const key = machineSessionKey(record.scope.machineId, record.scope.sessionId);
    this.heldCommandResults.set(key, [...(this.heldCommandResults.get(key) ?? []), { ledgerId: record.clientMessageId, result }]);
  }

  private settleCommandRow(ledgerId: string, result: CommandResult): void {
    const outcome = commandOutcomeFor(result);
    if (outcome !== undefined) this.settleLedgerRow(ledgerId, outcome);
    else if (result.type === "select") this.commandDialogRows.set(result.requestId, ledgerId);
    else this.setState({ commandLedger: withdrawCommand(this.getState().commandLedger, ledgerId) });
  }

  /** The reader came back to a session: results of its commands that arrived meanwhile take effect now. */
  private applyHeldCommandResults(machineId: string, sessionId: string): void {
    const key = machineSessionKey(machineId, sessionId);
    const held = this.heldCommandResults.get(key);
    if (held === undefined) return;
    this.heldCommandResults.delete(key);
    for (const entry of held) this.applyCommandResult(entry.result);
  }

  /**
   * A read of the open session nobody answered is read again by itself, sooner first and then no
   * longer than the quiet window apart, for as long as the session stays open (B48: the reader never
   * presses Retry). A fact - the session is gone, the reader signed out - ends it.
   */
  private readSelectionAgain(session: SessionInfo, machineId: string, error: unknown): void {
    this.selectionReadAfter[classifyReadError(error).kind](session, machineId);
  }

  private readonly selectionReadAfter: Readonly<Record<ReadOutcome["kind"], (session: SessionInfo, machineId: string) => void>> = {
    fact: () => {
      this.selectionReadAttempt = 0;
      this.setState({ statusArrival: "none" });
    },
    miss: (session, machineId) => {
      clearTimeout(this.selectionReadTimer);
      const delay = retryDelayMs(this.selectionReadAttempt, QUIET_WINDOW_MS);
      this.selectionReadAttempt += 1;
      this.selectionReadTimer = setTimeout(() => {
        if (this.disposed || !this.isSelectedSessionIdentity(session.id, machineId)) return;
        void this.selectSession(this.getState().selectedSession ?? session, { updateUrl: false });
      }, delay);
    },
  };

  /** The composer state and the command rows of a session that got another id while staying the same session. */
  private moveComposerState(machineId: string, fromSessionId: string, toSessionId: string): void {
    moveSessionComposerState(machineId, fromSessionId, toSessionId);
    this.setState({ commandLedger: moveCommandRows(this.getState().commandLedger, machineSessionKey(machineId, fromSessionId), machineSessionKey(machineId, toSessionId)) });
  }

  private settleLedgerRow(id: string, outcome: CommandOutcome): void {
    const now = Date.now();
    this.setState({ commandLedger: settleCommand(this.getState().commandLedger, id, { ...outcome, now }) });
  }

  /**
   * A send nobody answered is the first unanswered moment of its session's message status (P1
   * slice 6): the row says "Sending…" (sent, still checking) and the app's one row says reconnecting after the grace,
   * until a ledger ask gets through. It used to raise the transport error as a notice of its own,
   * which read as a second, red "reconnecting" (owner screenshot, 2026-10-01). A send the bytes
   * never left marks its row not sent instead, and claims nothing: nothing will ask about it.
   */
  private claimUnansweredMessageStatus(session: SessionRef, machineId: string, miss: ReadMiss): void {
    this.setState({ messageStatusUnanswered: claimAfterMiss(this.getState().messageStatusUnanswered, { machineId, sessionId: session.id }, miss, Date.now()) });
  }

  /**
   * Render the outgoing message immediately and return the id it is tracked by.
   * Only the session on screen gets a bubble: a send to a background session
   * has nothing to attach a mark to, and the id would never be resolved.
   */
  private beginTrackedSend(session: SessionInfo, text: string, attachments: readonly PromptAttachment[] = [], suppliedId?: string, sentAt?: string, shell = false): string | undefined {
    if (text.trim() === "" && attachments.length === 0) return suppliedId;
    if (this.getState().selectedSession?.id !== session.id) return suppliedId;
    const clientMessageId = suppliedId ?? newClientMessageId();
    if (findDeliveryLineIndex(this.getState().messages, clientMessageId) !== -1) return clientMessageId;
    this.setState({ messages: [...this.getState().messages, optimisticUserLine(text, clientMessageId, attachments, sentAt, shell)] });
    return clientMessageId;
  }

  /**
   * Commands are not inserted into the transcript optimistically: a built-in command produces its
   * own result line, and a runtime or skill command is forwarded to the agent, which streams back
   * the canonical (expanded) message. The raw text would leave a line that never converges with the
   * machine's history and disappears on reload.
   */
  private async deliverCommandToSession(session: SessionInfo, text: string, machineId: string, ledgerId: string): Promise<void> {
    this.markSendingPrompt(session.id, true);
    try {
      const result = await this.api.runCommand(session, text, machineId);
      if (this.isSelectedSessionIdentity(session.id, machineId)) this.applyCommandResult(result);
      else if (result.type === "select" || result.type === "tree") this.setState(noticePatch(noticeForReader(`Command “${text}” is asking a question; open the session and run it again.`)));
      this.markCachedNewSessionPersisted(session);
      this.settleCommandRow(ledgerId, result);
    } catch (error) {
      if (this.getState().selectedSession?.id === session.id) this.setState({ messages: [...this.getState().messages, textMessage("system", sendRefusalWords(error))], ...noticePatch(sendRefusalNotice(error, machineId)) });
      this.settleLedgerRow(ledgerId, { state: "failed", resultText: sendRefusalWords(error) });
    } finally {
      this.markSendingPrompt(session.id, false);
    }
  }

  async respondToCommand(requestId: string, value: string) {
    const session = this.getState().selectedSession;
    if (!session) return;
    this.setState({ commandDialog: undefined });
    const ledgerId = this.commandDialogRows.get(requestId);
    this.commandDialogRows.delete(requestId);
    try {
      const result = await this.api.respondToCommand(session, requestId, value, selectedMachineId(this.getState()));
      this.applyCommandResult(result);
      const outcome = commandOutcomeFor(result);
      if (ledgerId !== undefined && outcome !== undefined) this.settleLedgerRow(ledgerId, outcome);
      else if (ledgerId !== undefined && result.type === "select") this.commandDialogRows.set(result.requestId, ledgerId);
    } catch (error) {
      if (ledgerId !== undefined) this.settleLedgerRow(ledgerId, { state: "failed", resultText: describeError(error) });
      this.failedFor(session, error);
    }
  }

  /** Closing the dialog unanswered ends the command: its row says so instead of waiting forever. */
  cancelCommand() {
    const requestId = this.getState().commandDialog?.requestId;
    this.setState({ commandDialog: undefined });
    if (requestId === undefined) return;
    const ledgerId = this.commandDialogRows.get(requestId);
    this.commandDialogRows.delete(requestId);
    if (ledgerId !== undefined) this.settleLedgerRow(ledgerId, { state: "failed", resultText: "Cancelled without an answer." });
  }

  async navigateTree(targetId: string, summary: SessionTreeSummaryChoice): Promise<SessionTreeNavigateResult> {
    const state = this.getState();
    const session = state.selectedSession;
    const tree = state.treeDialog;
    if (session === undefined || tree === undefined || session.archived === true || isClientPendingStartSessionInfo(session)) {
      throw new Error("The session tree navigator is no longer available");
    }

    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    const cacheKey = machineSessionKey(machineId, session.id);
    let result: SessionTreeNavigateResult;
    try {
      result = await this.api.navigateTree(session, { targetId, expectedLeafId: tree.activeLeafId, summary }, machineId);
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.failedFor(session, error);
      throw error;
    }

    if (result.cancelled) return result;

    const editorText = result.editorText ?? "";
    saveDraft(cacheKey, editorText);
    this.transcripts.discard(cacheKey);

    // A user can reselect the same session while the request is in flight. Its
    // sequence changes, but the server mutation still belongs to the selected
    // identity and requires a fresh authoritative branch read.
    if (!this.isSelectedSessionIdentity(session.id, machineId)) return result;
    this.clearPendingUpdates();
    let authoritativeRefreshFailure: { error: unknown } | undefined;
    try {
      await this.selectSession(session, { updateUrl: false, preserveTreeDialog: true, propagateRefreshError: true });
    } catch (error) {
      authoritativeRefreshFailure = { error };
    }
    if (!this.isSelectedSessionIdentity(session.id, machineId)) return result;

    try {
      await this.replacePromptEditorText?.({ machineId, sessionId: session.id, text: editorText });
    } catch (error) {
      if (this.isSelectedSessionIdentity(session.id, machineId)) this.setState(errorNoticePatch(error));
      throw error;
    }
    if (authoritativeRefreshFailure !== undefined) {
      if (this.isSelectedSessionIdentity(session.id, machineId)) this.setState(errorNoticePatch(authoritativeRefreshFailure.error));
      throw authoritativeRefreshFailure.error;
    }
    if (this.isSelectedSessionIdentity(session.id, machineId) && this.getState().treeDialog === tree) this.setState({ treeDialog: undefined });
    return result;
  }

  async forkFromTree(entryId: string): Promise<SessionTreeForkResult> {
    const state = this.getState();
    const session = state.selectedSession;
    const tree = state.treeDialog;
    if (session === undefined || tree === undefined || session.archived === true || isClientPendingStartSessionInfo(session)) {
      throw new Error("The session tree navigator is no longer available");
    }

    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    const originalCacheKey = machineSessionKey(machineId, session.id);
    let result: SessionTreeForkResult;
    try {
      result = await this.api.forkTree(session, { entryId, expectedLeafId: tree.activeLeafId }, machineId);
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.failedFor(session, error);
      throw error;
    }

    if (result.cancelled) return result;

    const forked = result.session;
    // The draft belongs to the forked session file; the original keeps its own.
    if (result.promptDraft !== undefined) saveDraft(machineSessionKey(machineId, forked.id), result.promptDraft);
    // The daemon replaced the runtime behind the original session identity with
    // the fork while the request was in flight, so any cached projection of the
    // original transcript is suspect; drop it so a later reselection reads the
    // untouched original file authoritatively.
    this.transcripts.discard(originalCacheKey);

    // The fork happened regardless, but the list/selection update belongs to
    // whoever owns the selection now; a changed selection may already reflect it.
    if (!this.isSelectedSessionIdentity(session.id, machineId)) return result;
    const sessions = [forked, ...this.getState().sessions.filter((candidate) => candidate.id !== forked.id)];
    this.setState({ sessions, treeDialog: undefined });
    void this.selectSession(forked);
    return result;
  }

  /**
   * Continue a session in a new one (owner, 2026-10-08, ask c74272fa): the daemon forks it at its
   * newest entry, so the new session carries the whole history and the source stays as it is. The
   * new session joins the listed sessions of its machine; the caller opens it. undefined when the
   * fork did not happen: a failed request sets an error notice, and a fork cancelled by a session hook returns silently.
   */
  async continueInNewSession(session: SessionInfo, machineId: string): Promise<SessionInfo | undefined> {
    let result: SessionTreeForkResult;
    try {
      result = await this.api.continueInNewSession(session, machineId);
    } catch (error) {
      this.setState(errorNoticePatch(error));
      return undefined;
    }
    if (result.cancelled) return undefined;
    const forked = result.session;
    if (result.promptDraft !== undefined) saveDraft(machineSessionKey(machineId, forked.id), result.promptDraft);
    this.transcripts.discard(machineSessionKey(machineId, session.id));
    if (selectedMachineId(this.getState()) === machineId) this.setState({ sessions: [forked, ...this.getState().sessions.filter((candidate) => candidate.id !== forked.id)] });
    return forked;
  }

  /** Abort a tree navigation; the abort empties the queue too, and what it held is answered for the composer. */
  async abortTreeNavigation(): Promise<QueuedSessionMessage[]> {
    const state = this.getState();
    const session = state.selectedSession;
    if (session === undefined || state.treeDialog === undefined || isClientPendingStartSessionInfo(session)) return [];
    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    try {
      return (await this.api.abort(session, machineId)).discarded;
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.failedFor(session, error);
      throw error;
    }
  }

  closeTreeDialog(): void {
    this.setState({ treeDialog: undefined });
  }

  applySessionStatus(status: SessionStatus): void {
    this.applyStatus(status, "response");
  }

  /** Ask the machine to archive sessions: its answer for each. Throws when it gave none, or refused the whole request. */
  async archiveSessions(sessions: readonly SessionRef[], machineId: string, init?: SessionMutationInit): Promise<InstantAnswer> {
    const response = await this.api.archiveMany(sessions, machineId, init);
    return bulkAnswer(response.archivedSessionIds, response.failures);
  }

  /**
   * Carry sessions the machine archived into the list. The open one stays open, read-only, with its
   * Restore strip (owner, 2026-10-21): before, archiving the session being read jumped to another.
   */
  async applyArchivedSessions(ids: readonly string[], machineId: string, archivedAt: string): Promise<void> {
    for (const id of ids) forgetCachedNewSession(id, machineId);
    if (selectedMachineId(this.getState()) !== machineId) return;
    const state = this.getState();
    this.setState({ sessions: markSessionsArchived(state.sessions, ids, archivedAt) });
    const selected = state.selectedSession;
    if (selected !== undefined && ids.includes(selected.id) && selected.archived !== true) await this.adoptListedSession({ ...selected, archived: true, archivedAt });
  }

  /** Ask the machine to delete archived sessions for good: its answer for each. Throws when it gave none, or refused the whole request. */
  async deleteArchivedSessions(sessions: readonly SessionRef[], machineId: string, init?: SessionMutationInit): Promise<InstantAnswer> {
    const response = await this.api.deleteArchivedMany(sessions, machineId, init);
    return bulkAnswer(response.deletedSessionIds, response.failures);
  }

  /** Carry sessions the machine deleted into the list; the open one gives way to the next one there is. */
  async applyDeletedSessions(ids: readonly string[], machineId: string): Promise<void> {
    if (selectedMachineId(this.getState()) !== machineId) return;
    const deleted = new Set(ids);
    const state = this.getState();
    const nextSessions = state.sessions.filter((session) => !deleted.has(session.id));
    this.setState({ sessions: nextSessions });
    if (state.selectedSession === undefined || !deleted.has(state.selectedSession.id)) return;
    const next = nextSessions.find((session) => session.archived !== true && isOpenableSession(session)) ?? nextSessions.find(isOpenableSession);
    if (next !== undefined) await this.selectSession(next);
    else this.deselectSession({ forgetRememberedSelection: true });
  }

  /** Ask the machine to restore archived sessions, one request each: its answer for each. A request with no answer leaves its session unanswered. */
  async restoreSessions(sessions: readonly SessionRef[], machineId: string): Promise<InstantAnswer> {
    const answers = await Promise.all(sessions.map(async (session): Promise<InstantAnswer> => {
      try {
        await this.api.restore(session, machineId);
        return { doneIds: [session.id], refused: [], unansweredIds: [] };
      } catch (error) {
        return failedAnswer([session.id], error, describeError(error));
      }
    }));
    return mergedAnswers(answers);
  }

  /** Carry sessions the machine restored into the list; the open one opens live again. */
  async applyRestoredSessions(ids: readonly string[], machineId: string): Promise<void> {
    if (selectedMachineId(this.getState()) !== machineId) return;
    const restored = new Set(ids);
    this.setState({ sessions: this.getState().sessions.map((session) => (restored.has(session.id) ? withoutArchive(session) : session)) });
    const selected = this.getState().selectedSession;
    if (selected !== undefined && restored.has(selected.id) && selected.archived === true) await this.adoptListedSession(withoutArchive(selected));
  }

  /**
   * Carry a cleanup the machine ran into the list. The open session it archived stays open,
   * read-only with its Restore strip, as a direct archive keeps it; one it deleted gives way to the
   * next one there is.
   */
  async applySessionCleanupResult(result: SessionCleanupExecuteResponse, machineId = selectedMachineId(this.getState())): Promise<void> {
    if (selectedMachineId(this.getState()) !== machineId) return;
    const archivedIds = result.archivedSessionIds;
    const deletedIds = result.deletedSessionIds;
    if (archivedIds.length > 0 || deletedIds.length > 0) {
      const state = this.getState();
      const deletedIdSet = new Set(deletedIds);
      const affectedIds = [...archivedIds, ...deletedIds];
      const nextSessions = markSessionsArchived(state.sessions, archivedIds, result.generatedAt).filter((session) => !deletedIdSet.has(session.id));
      const selected = state.selectedSession;
      const selectedDeleted = selected !== undefined && deletedIdSet.has(selected.id);
      this.setState({
        sessions: nextSessions,
        sessionStatuses: omitKeys(state.sessionStatuses, affectedIds),
        sessionActivities: omitKeys(state.sessionActivities, affectedIds),
        ...(selectedDeleted ? { status: undefined, activity: undefined, pendingDialogs: [], settledDialogIds: [] } : {}),
      });

      if (selectedDeleted) {
        const next = nextSessions.find((session) => session.archived !== true && isOpenableSession(session)) ?? nextSessions.find(isOpenableSession);
        if (next !== undefined) await this.selectSession(next);
        else this.deselectSession({ forgetRememberedSelection: true });
      } else if (selected !== undefined && selected.archived !== true && archivedIds.includes(selected.id)) {
        await this.adoptListedSession({ ...selected, archived: true, archivedAt: result.generatedAt });
      }
    }
    await this.refreshCurrentWorkspaceSessions(machineId);
  }

  async refreshCurrentWorkspaceSessions(machineId = selectedMachineId(this.getState())): Promise<void> {
    const workspace = this.getState().selectedWorkspace;
    if (workspace === undefined) return;
    try {
      const revisionKey = `${machineId}|${workspace.path}`;
      // "init" never matches a payload hash, so a first load pays one request
      // and learns the revision alongside the payload; later refreshes echo it.
      const revisionResponse = await this.api.sessionsIfChanged(workspace.path, sessionsListRevisionByWorkspace.get(revisionKey) ?? "init", machineId);
      if (revisionResponse.unchanged === true) {
        // The raw listing behind the stored revision is byte-identical: the
        // rows already on screen (with their client-side merges and stamps)
        // remain the truth. Only a dropped load state comes back.
        if (this.getState().selectedWorkspace?.id === workspace.id && this.getState().sessionsLoad !== "loaded") this.setState({ sessionsLoad: "loaded" });
        return;
      }
      this.refreshRetryCount = 0;
      sessionsListRevisionByWorkspace.set(revisionKey, revisionResponse.revision);
      const listedSessions = mergeCachedNewSessions(workspace.path, revisionResponse.sessions, machineId)
        .filter((session) => !this.isSuppressedCreatedSession(session, machineId));
      if (selectedMachineId(this.getState()) !== machineId || this.getState().selectedWorkspace?.id !== workspace.id) return;
      const sessions = this.withPendingStartRows(workspace.path, listedSessions, machineId);
      const selectedSession = this.getState().selectedSession;
      rememberWorkspaceSessions(machineId, workspace.path, sessions);
      this.setState({ sessions, sessionsLoad: "loaded" });
      if (selectedSession === undefined) return;
      const refreshedSelected = sessions.find((session) => session.id === selectedSession.id);
      if (refreshedSelected !== undefined) {
        if (refreshedSelected !== selectedSession) this.setState({ selectedSession: refreshedSelected });
        if (refreshedSelected.archived === true && selectedSession.archived !== true) this.dropLiveTranscript();
        // A remembered selection restored at boot carries no list stamp: the
        // first listing is where the app learns the folder is gone. Deselect
        // into the fact instead of leaving a session on screen that can never
        // load - the red-banner-after-restore is the shape the owner rejected.
        if (refreshedSelected.cwdMissing === true) {
          this.deselectSession({ forgetRememberedSelection: true });
          if (selectedMachineId(this.getState()) === machineId) {
            this.setState(noticePatch(noticeForReader("This session's folder no longer exists, so it cannot be opened.")));
          }
          return;
        }
        return;
      }
      if (!refreshMayReplaceSelection({ refreshedWorkspacePath: workspace.path, selectedSessionCwd: selectedSession.cwd })) return;
      const next = sessions.find((session) => session.archived !== true && isOpenableSession(session)) ?? sessions.find(isOpenableSession);
      if (next !== undefined) await this.selectSession(next);
      else this.deselectSession({ forgetRememberedSelection: true });
    } catch (error) {
      if (selectedMachineId(this.getState()) === machineId && this.getState().selectedWorkspace?.id === workspace.id) {
        // A transient failure never sits as a dead banner: the refresh retries
        // itself with backoff, and the banner says so. Permanent errors
        // (4xx) keep their message without a retry loop.
        if (isTransientRefreshError(error) && this.refreshRetryCount < REFRESH_RETRY_MAX) {
          this.refreshRetryCount += 1;
          const delay = REFRESH_RETRY_BASE_MS * this.refreshRetryCount;
          if (this.refreshRetryTimer !== undefined) clearTimeout(this.refreshRetryTimer);
          this.refreshRetryTimer = setTimeout(() => {
            this.refreshRetryTimer = undefined;
            void this.refreshCurrentWorkspaceSessions(machineId);
          }, delay);
          this.setState({ ...errorNoticePatch(error), error: `${describeError(error)} — retrying…` });
        } else {
          this.refreshRetryCount = 0;
          this.setState(errorNoticePatch(error));
        }
      }
    } finally {
      // Independent of the listing outcome: a listing failure is exactly when a
      // stale work indicator is most misleading.
      void this.hydrateSessionStatuses(machineId);
    }
  }

  /**
   * Fill `sessionStatuses` from the daemon's snapshot of every loaded session.
   *
   * Status otherwise arrives only as `status.update` broadcasts, so a browser
   * that loads (or reconnects) while a session is mid-stream shows no work
   * indicator until that session publishes again. Live events stay
   * authoritative: the snapshot only fills sessions the browser has no status
   * for, so a fresher event is never overwritten by an older snapshot.
   *
   * Best-effort by design — a hydration failure leaves the list exactly as the
   * live events left it, so it is not surfaced as a session error.
   */
  /**
   * Session ids whose run the daemon's last restart cut off.
   *
   * Reading the record clears it on the daemon, so this is called once per
   * connection rather than polled: it answers "what did the last restart
   * interrupt", not a state that keeps changing while the app is open.
   *
   * Best-effort: no record is the common case, and failing to read one must not
   * disturb reconnecting.
   */
  /**
   * `undefined` means the read failed - deliberately not the empty set, which
   * is what the daemon returns when it genuinely holds nothing. A caller that
   * adopted a failure as an empty record would retract interruption markers
   * the daemon still holds.
   */
  async loadInterruptedRuns(machineId = selectedMachineId(this.getState())): Promise<ReadonlySet<string> | undefined> {
    try {
      const snapshot = await this.api.interruptedRuns(machineId);
      return new Set(snapshot.runs.map((run) => run.sessionId));
    } catch {
      return undefined;
    }
  }

  /**
   * Fill in session statuses from the daemon's catalog.
   *
   * `replaceKnown` decides what happens to statuses the browser already has.
   * Filling only the gaps is right on a first load, where a live event may
   * already have delivered something newer than the catalog. It is wrong after
   * a reconnect: the status.update that moved a session from working to idle
   * was published while the socket was down, so the browser keeps a value that
   * is not stale by a moment but permanently wrong - the session list showed a
   * finished session as still working until the page was reloaded, which is a
   * large part of what "you have to refresh it" meant.
   *
   * Replacing also has to be able to RETRACT: the catalog is the daemon's
   * statement of every session it still holds, so a session it no longer
   * mentions must lose its indicator, not keep it forever. And a catalog from
   * a different daemon instance (the id the notifications catalog also
   * carries) replaces the map wholesale even on a fill-only read: the entries
   * already held were minted by a process that no longer exists, and its
   * session ids say nothing about the current one.
   */
  async hydrateSessionStatuses(machineId = selectedMachineId(this.getState()), options?: { replaceKnown?: boolean }): Promise<void> {
    const framesAtRequest = this.frameClock;
    let snapshot;
    try {
      snapshot = await this.api.statusCatalog(machineId);
    } catch {
      return;
    }
    if (selectedMachineId(this.getState()) !== machineId) return;
    const state = this.getState();
    const replaceKnown = options?.replaceKnown === true;
    const previousEpoch = this.statusCatalogEpochs.get(machineId);
    const daemonReplaced = snapshot.daemonInstanceId !== undefined && previousEpoch !== snapshot.daemonInstanceId;
    if (snapshot.daemonInstanceId !== undefined) this.statusCatalogEpochs.set(machineId, snapshot.daemonInstanceId);
    // The status map is machine-scoped in practice (switching machines clears
    // it, and live events arrive only from the selected machine's sockets), so
    // a catalog replace cannot drop another machine's entries.
    const previous = state.sessionStatuses;
    let next = previous;
    if (replaceKnown || daemonReplaced) {
      // The snapshot wins for the ids it covers. Uncovered sessions retract —
      // that is what retired a stuck amber circle — except the session on
      // screen: its truth comes from live frames and the direct status
      // endpoint, so a catalog that is transiently narrower than reality must
      // not blank the indicator row the user is looking at.
      next = {};
      for (const status of snapshot.statuses) next[status.sessionId] = status;
      const selectedId = state.selectedSession?.id;
      if (selectedId !== undefined && next[selectedId] === undefined && previous[selectedId] !== undefined) {
        next[selectedId] = previous[selectedId];
      }
      for (const [sessionId, mark] of this.statusFrameMarks) {
        if (mark > framesAtRequest && previous[sessionId] !== undefined) next[sessionId] = previous[sessionId];
      }
    } else {
      for (const status of snapshot.statuses) {
        if (previous[status.sessionId] !== undefined) continue;
        next = { ...next, [status.sessionId]: status };
      }
    }
    if (next === previous) return;
    // A status snapshot that lands after the reader selected a session has to reach
    // the *selected* state too: the selection ran against whatever the catalog held
    // at that moment, and a dialog opened before this browser connected lives only
    // in these snapshots. Without this a reload during an open dialog showed no
    // dialog at all - the daemon reported it, the page did not.
    const selectedId = this.getState().selectedSession?.id;
    const selectedDialogs = selectedId === undefined ? [] : next[selectedId]?.pendingDialogs ?? [];
    this.setState({
      sessionStatuses: next,
      sessionActivities: activitiesAfterStatuses(this.getState().sessionActivities, next, {
        retractsMissing: replaceKnown || daemonReplaced,
        keeps: (sessionId) => this.pendingSessionStarts.has(sessionId) || (this.activityFrameMarks.get(sessionId) ?? 0) > framesAtRequest,
        adopts: (sessionId) => sessionId !== selectedId,
      }),
      ...(selectedId === undefined || selectedDialogs.length === 0 ? {} : { pendingDialogs: openDialogsAfterDismissals(selectedDialogs, this.getState().settledDialogIds) }),
    });
  }

  async deleteCachedNewSession(session = this.getState().selectedSession) {
    if (session === undefined || !isTransientNewSessionInfo(session, this.statusForSession(session))) return;
    const machineId = isClientPendingStartSessionInfo(session) ? session.machineId : selectedMachineId(this.getState());
    const pendingStart = isClientPendingStartSessionInfo(session) ? this.pendingSessionStarts.get(session.id) : undefined;
    if (pendingStart !== undefined) {
      pendingStart.discarded = true;
      releasePendingStart(pendingStart.machineId, pendingStart.tempId);
    }
    else {
      void this.api.stop(session, machineId).catch(() => {
        // Best-effort cleanup for transient sessions that may not exist server-side anymore.
      });
    }
    forgetCachedNewSession(session.id, machineId);
    clearDraft(machineSessionKey(machineId, session.id));
    discardOutbox(machineSessionKey(machineId, session.id));
    const state = this.getState();
    const sessions = state.sessions.filter((candidate) => candidate.id !== session.id);
    this.setState({
      sessions,
      sessionStatuses: omitKey(state.sessionStatuses, session.id),
      sessionActivities: omitSessionActivity(state.sessionActivities, session.id),
      sendingPrompts: omitKey(state.sendingPrompts, session.id),
    });
    if (this.getState().selectedSession?.id !== session.id) return;
    const next = sessions.find((candidate) => candidate.archived !== true && isOpenableSession(candidate)) ?? sessions.find(isOpenableSession);
    if (next !== undefined) await this.selectSession(next);
    else {
      this.clearActiveSession();
      this.updateUrl();
    }
  }

  async reloadSession(session = this.getState().selectedSession) {
    if (session === undefined || !isPersistedSessionInfo(session, this.statusForSession(session))) return;
    const machineId = selectedMachineId(this.getState());
    try {
      await this.api.reloadSession(session, machineId);
      this.transcripts.discard(this.sessionCacheKey(session.id));
      if (this.getState().selectedSession?.id === session.id) {
        await this.selectSession(session, { updateUrl: false });
      }
    } catch (error) {
      this.failedFor(session, error);
    }
  }

  async listModels() {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return [];
    try {
      return (await this.api.models(session, selectedMachineId(this.getState()))).models;
    } catch (error) {
      this.failedFor(session, error);
      return [];
    }
  }

  async listModelCatalog() {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return [];
    try {
      return (await this.api.modelCatalog(session, selectedMachineId(this.getState()))).models;
    } catch (error) {
      this.failedFor(session, error);
      return [];
    }
  }

  /**
   * Toggle one model's membership in pi's enabled-models scope. Returns the
   * updated catalog on success and `undefined` on failure, so the caller can
   * leave (or revert) the row's control when the edit did not apply.
   */
  async setModelEnabled(provider: string, modelId: string, enabled: boolean): Promise<SessionModelCatalogEntry[] | undefined> {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return undefined;
    try {
      return (await this.api.setModelEnabled(session, provider, modelId, enabled, selectedMachineId(this.getState()))).models;
    } catch (error) {
      this.failedFor(session, error);
      return undefined;
    }
  }

  async setModel(provider: string, modelId: string) {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return;
    const machineId = selectedMachineId(this.getState());
    try {
      const status = await this.api.setModel(session, provider, modelId, machineId);
      this.applyStatus(status, "response");
      await this.refreshAvailableThinkingLevels();
    } catch (error) {
      this.failedFor(session, error);
    }
  }

  async listThinkingLevels() {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return [];
    try {
      return (await this.api.thinkingLevels(session, selectedMachineId(this.getState()))).levels;
    } catch (error) {
      this.failedFor(session, error);
      return [];
    }
  }

  /** Refresh the available thinking levels for the selected session's model. */
  async refreshAvailableThinkingLevels() {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) {
      if (this.getState().availableThinkingLevels.length > 0) this.setState({ availableThinkingLevels: [] });
      return;
    }
    await this.readThinkingLevels({ session, machineId: selectedMachineId(this.getState()), selectionSeq: this.selectionSeq });
  }

  /** Read the levels the selection's model offers; only the selection that asked shows them, or the failure. */
  private async readThinkingLevels(target: SelectedSessionRefreshTarget): Promise<Settled<unknown>["kind"]> {
    const read = await settled(this.api.thinkingLevels(target.session, target.machineId));
    if (!this.isCurrentRefreshTarget(target)) return read.kind;
    if (read.kind === "failed") this.failedFor(target.session, read.error);
    this.setState({ availableThinkingLevels: read.kind === "answered" ? read.value.levels : [] });
    return read.kind;
  }

  async setThinkingLevel(level: string) {
    const session = this.getState().selectedSession;
    if (!session || session.archived === true) return;
    try {
      this.applyStatus(await this.api.setThinkingLevel(session, level, selectedMachineId(this.getState())), "response");
    } catch (error) {
      this.failedFor(session, error);
    }
  }

  /** Ask the session socket to verify it is still alive; see SessionSocket. */
  checkSocketLiveness(): void {
    this.socket.checkLiveness?.();
  }

  /** Retry the session socket at once, for when the network comes back. */
  reconnectSocketNow(): void {
    this.socket.reconnectNow?.();
  }

  async clearServerQueue() {
    const state = this.getState();
    const session = state.selectedSession;
    if (session === undefined || session.archived === true || isClientPendingStartSessionInfo(session)) return;
    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    try {
      const status = await this.api.clearQueue(session, machineId);
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.applyStatus(status, "response");
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.failedFor(session, error);
    }
  }

  /**
   * A message just written to this browser's outbox shows its row at once, before anything ahead
   * of it is answered; a command shows its receipt row, and a shell command its line.
   */
  showOutgoing(record: PendingPrompt): void {
    this.clearNotes(record.scope.machineId, record.scope.sessionId);
    this.outgoingRows[record.kind](record);
  }

  private readonly outgoingRows: Readonly<Record<OperationKind, (record: PendingPrompt) => void>> = {
    message: (record) => { this.showSendingRow(record); },
    takeBack: () => undefined,
    command: (record) => { this.issueCommandRow(record.scope.machineId, record.scope.sessionId, record.text.trim(), record.clientMessageId); },
    shell: (record) => { this.showSendingRow(record); },
  };

  /** A "Sending…" row in the pending block, in the order it was written; a shell command's row gives way to its run once the machine starts it. */
  private showSendingRow(record: PendingPrompt): void {
    const session = this.getState().selectedSession;
    if (session === undefined || !this.onScreen(record.scope)) return;
    this.beginTrackedSend(session, record.text, record.attachments ?? [], record.clientMessageId, record.at, record.kind === "shell");
  }

  private dropSendingRow(record: PendingPrompt): void {
    if (!this.onScreen(record.scope)) return;
    const messages = withdrawDeliveryLine(this.getState().messages, record.clientMessageId);
    if (messages.length !== this.getState().messages.length) this.setState({ messages });
  }

  /** A message withdrawn on this device before it was ever sent leaves the transcript at once. */
  withdrawRow(clientMessageId: string): void {
    const messages = withdrawDeliveryLine(this.getState().messages, clientMessageId);
    if (messages.length !== this.getState().messages.length) this.setState({ messages });
  }

  /** The reader asked for a message back: its row reads "Taking back…" until the machine answers. */
  markTakingBack(clientMessageId: string): void {
    const messages = markDelivery(this.getState().messages, clientMessageId, "takingBack");
    if (messages !== this.getState().messages) this.setState({ messages });
  }

  /** Send the value the user gave for one of the session's open extension dialogs. */
  answerDialog(dialogId: string, value: ExtensionDialogAnswer): Promise<void> {
    return this.closeOpenDialog(dialogId, (session, machineId) => this.api.answerDialog(session, dialogId, value, machineId));
  }

  /**
   * Forward a keypress to an open extension screen.
   *
   * Not `closeOpenDialog`: the screen stays open across keys, it only redraws. A
   * keystroke that lands after the component finished is answered `false`, which
   * is a race and not an error.
   */
  sendDialogKey(dialogId: string, key: string): Promise<void> {
    const session = this.getState().selectedSession;
    if (session === undefined) return Promise.resolve();
    return this.api.sendDialogKey(session, dialogId, key, selectedMachineId(this.getState())).then(() => undefined);
  }

  /** Select the tapped line of an open drawn screen; the daemon walks the screen's cursor there. */
  selectDialogLine(dialogId: string, line: number, text: string): Promise<void> {
    const session = this.getState().selectedSession;
    if (session === undefined) return Promise.resolve();
    return this.api.selectDialogLine(session, dialogId, line, text, selectedMachineId(this.getState())).then(() => undefined);
  }

  /** Ask the daemon to draw an open drawn screen at the columns this page's card has room for. */
  resizeDialogScreen(dialogId: string, width: number): Promise<void> {
    const session = this.getState().selectedSession;
    if (session === undefined) return Promise.resolve();
    return this.api.resizeDialogScreen(session, dialogId, width, selectedMachineId(this.getState())).then(() => undefined);
  }

  /** Close one of the session's open extension dialogs without answering it. */
  cancelDialog(dialogId: string): Promise<void> {
    return this.closeOpenDialog(dialogId, (session, machineId) => this.api.cancelDialog(session, dialogId, machineId));
  }

  private async closeOpenDialog(dialogId: string, close: (session: SessionInfo, machineId: string) => Promise<ExtensionDialogCloseResponse>): Promise<void> {
    const state = this.getState();
    const session = state.selectedSession;
    if (session === undefined || session.archived === true) return;
    if (isClientPendingStartSessionInfo(session)) {
      await this.closePendingStartDialog(session, dialogId, close);
      return;
    }
    const machineId = selectedMachineId(state);
    const selectionSeq = this.selectionSeq;
    try {
      const response = await close(session, machineId);
      if (!this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) {
        // The close is a statement about the session it was asked in, not
        // about wherever the user has navigated to meanwhile: its fresh
        // status still goes to the map the rows and the next selection read.
        // The card state on screen belongs to the other session and stays
        // untouched.
        this.applyStatusToMap(response.sessionStatus);
        return;
      }
      // When this call closed the dialog, it is settled right away; the
      // daemon's dialog.closed event then finds it already closed here and
      // stays a no-op.
      const outcome: ExtensionDialogOutcome | undefined = response.outcome;
      if (outcome !== undefined) {
        const dialog = this.getState().pendingDialogs.find((pending) => pending.dialogId === outcome.dialogId);
        if (dialog !== undefined) this.settleClosedDialog(dialog);
      }
      // Both outcomes carry the recomputed status, so no follow-up status
      // request is needed to learn what the session's open dialogs are now.
      this.applyStatus(response.sessionStatus, "response");
    } catch (error) {
      if (this.isCurrentSessionSelection(session.id, machineId, selectionSeq)) this.failedFor(session, error);
    }
  }

  /**
   * Answer or cancel a `session_start` dialog from the startup view. The row
   * is still the pending start, but the dialog belongs to the constructing
   * backend session the startup events named, so the close goes out under the
   * real id — the only route the daemon can serve before readiness.
   */
  private async closePendingStartDialog(session: ClientPendingStartSessionInfo, dialogId: string, close: (session: SessionInfo, machineId: string) => Promise<ExtensionDialogCloseResponse>): Promise<void> {
    const pending = this.pendingSessionStarts.get(session.id);
    const backendSessionId = pending?.backendSessionId;
    // Without the real id there is no route to answer through — and no way a
    // dialog card could be on screen yet either.
    if (pending === undefined || backendSessionId === undefined) return;
    const selectionSeq = this.selectionSeq;
    try {
      const response = await close({ ...session, id: backendSessionId }, pending.machineId);
      if (selectionSeq !== this.selectionSeq || this.getState().selectedSession?.id !== session.id) return;
      // Same ordering as the ready-session path: settled at once, and the
      // daemon's dialog.closed frame then finds it already closed here.
      const outcome: ExtensionDialogOutcome | undefined = response.outcome;
      if (outcome !== undefined) {
        const dialog = this.getState().pendingDialogs.find((candidate) => candidate.dialogId === outcome.dialogId);
        if (dialog !== undefined) this.settleClosedDialog(dialog);
      }
      this.applyPendingStartStatus(pending, response.sessionStatus, "response");
    } catch (error) {
      if (selectionSeq === this.selectionSeq && this.getState().selectedSession?.id === session.id) this.setState(errorNoticePatch(error));
    }
  }

  /** Write one session's fresh status into the shared map without touching the selected session's card state. */
  private applyStatusToMap(status: SessionStatus): void {
    const state = this.getState();
    this.setState({ sessionStatuses: { ...state.sessionStatuses, [status.sessionId]: status } });
  }

  /**
   * Stop the current work. Anything that was queued comes back rather than
   * being deleted: those messages were typed for the turn being cancelled, so
   * the sender gets them back the same way a recall returns one.
   */
  async stopActiveWork(): Promise<QueuedSessionMessage[]> {
    const session = this.getState().selectedSession;
    if (!session) return [];
    try {
      const result = await this.api.abort(session, selectedMachineId(this.getState()));
      for (const message of result.discarded) {
        if (message.clientMessageId === undefined) continue;
        this.setState({ messages: withdrawDeliveryLine(this.getState().messages, message.clientMessageId) });
      }
      return result.discarded;
    } catch (error) {
      this.failedFor(session, error);
      return [];
    }
  }

  /**
   * The page may have missed frames of the selected session: it came back from the background, the
   * browser is online again, a connection was lost, a turn ended. Checks quietly; a check that
   * fails is retried, and a link that does not answer is the top row's to say.
   */
  recheckTranscript(): Promise<void> {
    const key = this.liveTranscriptKey();
    if (key === undefined) return Promise.resolve();
    this.syncTranscript({ type: "check", key });
    return this.catchUp();
  }

  /**
   * Bring the selected transcript level with the daemon: the frames after the highest seq applied in
   * order, which this page never applied, so nothing can be applied twice, and they carry what
   * happened meanwhile in order, a message taken back included. Without a frontier yet, the full
   * read; a resync verdict falls back to it too. Settles once the frames are applied or the read
   * that replaced them is registered, so a ledger ask after a reconnect waits for it: asked before
   * the daemon reopened the session, a waiting message read "not received".
   */
  catchUp(): Promise<void> {
    const key = this.liveTranscriptKey();
    const pending = key === undefined ? undefined : this.gapRepair?.catchUp();
    return pending ?? this.refreshSelectedSession();
  }

  /**
   * A gap the socket saw, a heartbeat's head among them: the frames after the frontier are owed.
   * Before the join seeded a frontier the join's own read is under way and answers it, and the
   * page is not behind.
   */
  private catchUpFromFrontier(repair: SessionGapRepair, key: string): void {
    const pending = repair.catchUp();
    if (pending === undefined) {
      this.clearBehind();
      return;
    }
    this.syncTranscript({ type: "check", key });
  }

  /**
   * A replay landed. Its status frames wait for the next animation frame, so they are applied
   * first: confirming before them showed the replay's older status for one frame after the catch-up.
   * The socket learns the position, so its next heartbeat is compared with what the page holds.
   */
  private confirmCaughtUp(repair: SessionGapRepair, key: string): void {
    this.clearBehind();
    this.flushPendingUpdates();
    const position = repair.position;
    if (position !== undefined) this.socket.noteApplied?.(position);
    this.syncTranscript({ type: "checked", key });
  }

  /**
   * The selection stopped having a live stream (archived from another device while open): its repair,
   * retry and sync state go, so nothing keeps checking a stream that is not there.
   */
  private dropLiveTranscript(): void {
    this.gapRepair = undefined;
    this.cancelTranscriptRetry();
    if (this.getState().transcriptSync !== undefined) this.setState({ transcriptSync: undefined });
  }

  /** The selected session's key when it has a live transcript to fall behind on. */
  private liveTranscriptKey(): string | undefined {
    const session = this.getState().selectedSession;
    if (session === undefined || session.archived === true || isClientPendingStartSessionInfo(session)) return undefined;
    return this.sessionCacheKey(session.id);
  }

  /** Feed the page's hold on the selected transcript one event (transcriptSync.ts). */
  private syncTranscript(event: TranscriptSyncEvent): void {
    const current = this.getState().transcriptSync;
    const next = nextTranscriptSync(current, event);
    if (next !== current) this.setState({ transcriptSync: next });
    const action = transcriptRetryAction(next, this.transcriptRetry?.key);
    if (action === "cancel") this.cancelTranscriptRetry();
    if (action === "arm") this.scheduleTranscriptRetry(next.key);
  }

  /**
   * A check that failed keeps being retried (owner: keep trying), backing off from 5 s to a
   * minute so a page left offline does not ask every few seconds. Only the same key is retried.
   */
  private scheduleTranscriptRetry(key: string): void {
    const armed = this.transcriptRetry;
    if (armed?.key === key && armed.timer !== undefined) return;
    if (armed?.key !== key) this.cancelTranscriptRetry();
    const delayMs = armed?.key === key ? Math.min(armed.delayMs * 2, TRANSCRIPT_RETRY_MAX_MS) : TRANSCRIPT_RETRY_FIRST_MS;
    const timer = setTimeout(() => {
      if (this.transcriptRetry?.key !== key) return;
      this.transcriptRetry = { key, delayMs, timer: undefined };
      if (this.getState().transcriptSync?.kind === "retrying" && this.liveTranscriptKey() === key) void this.recheckTranscript();
    }, delayMs);
    this.transcriptRetry = { key, delayMs, timer };
  }

  private cancelTranscriptRetry(): void {
    if (this.transcriptRetry?.timer !== undefined) clearTimeout(this.transcriptRetry.timer);
    this.transcriptRetry = undefined;
  }

  refreshSelectedSession(sessionId = this.getState().selectedSession?.id): Promise<void> {
    const session = this.getState().selectedSession;
    if (sessionId === undefined || session?.id !== sessionId || session.archived === true || isClientPendingStartSessionInfo(session)) return Promise.resolve();
    const target: SelectedSessionRefreshTarget = {
      session,
      machineId: selectedMachineId(this.getState()),
      selectionSeq: this.selectionSeq,
    };
    return this.requestSelectedSessionRefresh(target).catch((error: unknown) => {
      if (this.isCurrentRefreshTarget(target)) this.failedFor(target.session, error);
    });
  }

  /**
   * Say what went wrong with a read or change of `session`. The daemon's session-not-found code
   * about the session the reader has open is not a notice: the session becomes a named target
   * and the machine-wide locate decides what the reader sees (`sessionFailureRoute`). Session
   * ids are UUIDv7, so the id alone names the session across machines.
   */
  private failedFor(session: { readonly id: string }, error: unknown): void {
    const state = this.getState();
    const route = sessionFailureRoute(error, session.id, state.selectedSession?.id, state.sessionTarget?.sessionId);
    if (route === "notice") this.setState(errorNoticePatch(error));
    if (route === "locate") this.goneLocate = this.locateAnsweredGone(session.id, error);
  }

  /**
   * Wait for the machine-wide locates a session-not-found answer started to settle, including one
   * the located session's own open started: then the selection or the published target is the
   * app's verdict on the session.
   */
  async untilGoneLocated(): Promise<void> {
    let following = this.goneLocate;
    while (following !== undefined) {
      await following;
      following = this.goneLocate === following ? undefined : this.goneLocate;
    }
  }

  /**
   * The open session answered the code. Its own directory no longer holds it, which does not
   * prove it is gone from the machine, so the machine-wide locate decides (state-diagram D8), and
   * the URL keeps naming it so a reload shows the same answer. A session the resolver opened
   * after that locate and that answers the code as it opens is gone: asking again would only
   * loop. A locate that got no answer, or an open that failed for another reason, arms nothing.
   */
  private async locateAnsweredGone(sessionId: string, error: unknown): Promise<void> {
    const state = this.getState();
    const workspace = state.selectedWorkspace;
    if (workspace === undefined) {
      this.setState(errorNoticePatch(error));
      return;
    }
    const scope = { machineId: selectedMachineId(state), workspaceId: workspace.id, cwd: workspace.path, sessionId };
    const target: SessionTarget = this.locatedAfterGone === sessionId ? { kind: "gone", sessionId } : { kind: "asking", sessionId };
    const owed = this.selectionUrl;
    const owesPush = owed?.seq === this.selectionSeq && !owed.settled && owed.write;
    this.locatedAfterGone = undefined;
    this.seamLocating = target.kind === "asking" ? sessionId : undefined;
    this.clearActiveSession();
    const following = this.targets.follow(scope, target, { updateUrl: false, correctsUrl: true });
    this.updateUrl(owesPush ? undefined : { replace: true });
    await following;
  }

  private requestSelectedSessionRefresh(target: SelectedSessionRefreshTarget): Promise<void> {
    const key = machineSessionKey(target.machineId, target.session.id);
    return this.selectedSessionRefreshes.request(key, async () => {
      if (!this.isCurrentRefreshTarget(target)) return;
      this.flushPendingUpdates();
      const framesAtRequest = this.frameClock;
      const tailRead = this.readTranscriptTail(target);
      const statusRead = settled(this.api.status(target.session, target.machineId));
      let tail: SessionTranscriptTail;
      try {
        tail = await tailRead;
      } catch (error) {
        this.readiness.settle(selectionScope(target), "transcript", "failed");
        void statusRead.then((status) => {
          this.readiness.settle(selectionScope(target), "status", status.kind);
          this.settleDialogSurface(target, status, framesAtRequest);
        });
        if (this.isCurrentRefreshTarget(target)) this.syncTranscript({ type: "checkFailed", key });
        throw error;
      }
      const { page, stream: streamSnapshot } = tail;
      if (!this.isCurrentRefreshTarget(target)) return;
      const snapshotWatermark = { seq: streamSnapshot.seq, ...(streamSnapshot.epoch === undefined ? {} : { epoch: streamSnapshot.epoch }) };
      this.streamWatermark = { sessionId: target.session.id, ...snapshotWatermark };
      this.reseedLiveStream(snapshotWatermark);
      const activity = this.getState().sessionActivities[target.session.id];
      const owed = this.openingReadOwed;
      const read: TailRead = owed?.seq === target.selectionSeq ? owed.read : "resync";
      const held = this.getState();
      const lands: Record<ResyncLanding, () => void> = {
        noteTotal: () => {
          this.transcripts.noteTotal(key, page.total);
          this.setState({ messagePageTotal: page.total, newerPendingCount: 0, activity });
        },
        mergeTail: () => { this.landTail(key, tail, activity); },
        replaceWithTail: () => {
          this.transcripts.discard(key);
          this.landTail(key, tail, activity);
        },
      };
      lands[resyncLanding({ kind: read, total: page.total }, { end: held.messagePageEnd, total: held.messagePageTotal })]();
      if (read !== "resync") {
        this.openingReadOwed = undefined;
        this.openedSessionKey = key;
      }
      this.readiness.settle(selectionScope(target), "transcript", "answered");
      this.settleStatusRead(target, await statusRead, framesAtRequest);
      if (this.isCurrentRefreshTarget(target) && this.gapRepair?.holding !== true) this.syncTranscript({ type: "checked", key });
    });
  }

  /**
   * Merge a transcript tail into the window. The in-flight partial assistant message is seeded on
   * top of committed history once the caller has recorded the snapshot's sequence as the
   * watermark: buffered or live events with `seq <= watermark` are already reflected here and are
   * dropped by `applyEvent`, later ones stream in on top. The partial is seeded into the in-memory
   * transcript only, never the raw history cache, so it never persists. A send still waiting for
   * confirmation is not on disk yet; rebuilding from the page alone made it vanish with no failure
   * anywhere, so it is carried forward. The window ends at the tail, so the notices held while it
   * was trimmed show, and the tail's total holds every message the count below had counted, so the
   * count starts again. The tail's total is the daemon's: one below the merged total is written onto
   * the window.
   */
  private landTail(key: string, tail: SessionTranscriptTail, activity: SessionActivity | undefined): void {
    const merged = this.transcripts.mergeHistory(key, tail.page);
    const history = merged.messagePageTotal > tail.page.total ? this.notedTotalView(key, tail.page.total) : merged;
    const carried = carryUnsettledForward(this.getState().messages, history.messages);
    const messages = this.withParkedNotices(key, this.transcripts.seedStreamingPartial(carried, tail.stream.partial));
    this.setState({ ...history, messages, newerPendingCount: 0, activity });
  }

  /**
   * Settle the selected session's status read and report its failure (state-diagram D5, "An open
   * reads the session once").
   */
  private settleStatusRead(target: SelectedSessionRefreshTarget, status: Settled<SessionStatus>, framesAtRequest: number): void {
    this.readiness.settle(selectionScope(target), "status", status.kind);
    if (!this.isCurrentRefreshTarget(target)) return;
    if (status.kind === "failed" && isSessionNotFoundError(status.error)) {
      this.setState({ statusArrival: "none" });
      this.failedFor(target.session, status.error);
      return;
    }
    if (status.kind === "failed") {
      this.setState({ statusReadFailed: describeError(status.error), ...errorNoticePatch(status.error) });
      this.readSelectionAgain(target.session, selectedMachineId(this.getState()), status.error);
    }
    this.settleDialogSurface(target, status, framesAtRequest);
  }

  /**
   * Settle the dialog surface's full read with a status read, without reporting anything. Every
   * outcome settles it: a fresh read marks it fresh; a failed or stale read leaves it no read on
   * its way, so a frame that waited for it, or comes after it, asks for another. When the
   * transcript read beside it failed, that failure is the one report: the status read still
   * shows its dialogs, and never runs the open-session seam inside the refresh, where a
   * relocated selection of the same session would join the failing refresh.
   */
  private settleDialogSurface(target: SelectedSessionRefreshTarget, status: Settled<SessionStatus>, framesAtRequest: number): void {
    if (!this.isCurrentRefreshTarget(target)) return;
    if (status.kind === "answered" && !this.statusReadIsStale(status.value, framesAtRequest)) {
      this.setState({ status: status.value, statusReadFailed: undefined });
      this.selectionReadAttempt = 0;
      this.applyStatusRead(status.value);
      return;
    }
    this.dialogScope.readFailed();
  }

  /**
   * The last transcript page and the stream position it is current through
   * (object model §1.7, P2 slice c). The tail route reads a closed session
   * from its file instead of waiting 1.2-1.8 s for the runtime to open; a
   * daemon older than the route answers the two reads it always had.
   */
  private async readTranscriptTail(target: SelectedSessionRefreshTarget): Promise<SessionTranscriptTail> {
    const read = await this.api.transcriptTail(target.session, { limit: MESSAGE_PAGE_SIZE }, target.machineId);
    if (read.kind === "answered") return read.value;
    const [page, stream] = await Promise.all([
      this.api.messages(target.session, { limit: MESSAGE_PAGE_SIZE }, target.machineId),
      this.api.streamSnapshot(target.session, target.machineId),
    ]);
    return { page, stream };
  }

  private isCurrentRefreshTarget(target: SelectedSessionRefreshTarget): boolean {
    return this.isCurrentSessionSelection(target.session.id, target.machineId, target.selectionSeq);
  }

  private isCurrentSessionSelection(sessionId: string, machineId: string, selectionSeq: number): boolean {
    return selectionSeq === this.selectionSeq && this.isSelectedSessionIdentity(sessionId, machineId);
  }

  private isSelectedSessionIdentity(sessionId: string, machineId: string): boolean {
    if (this.disposed) return false;
    const state = this.getState();
    const selected = state.selectedSession;
    return selectedMachineId(state) === machineId
      && selected?.id === sessionId
      && selected.archived !== true
      && !isClientPendingStartSessionInfo(selected);
  }

  /** The machine a composed failure belongs to: the error's own stamp when
   * the transport named one, else the machine the action ran against. */
  private machineIdFromError(error: unknown): string | undefined {
    return error instanceof HttpError ? error.machineId : undefined;
  }

  private sessionCacheKey(sessionId: string): string {
    return machineSessionKey(selectedMachineId(this.getState()), sessionId);
  }

  private statusForSession(session: SessionInfo | undefined): SessionStatus | undefined {
    if (session === undefined) return undefined;
    const state = this.getState();
    if (state.status?.sessionId === session.id && state.selectedSession?.id === session.id) return state.status;
    return state.sessionStatuses[session.id];
  }

  private workspaceSelectionKey(cwd: string): string {
    return `${selectedMachineId(this.getState())}:${cwd}`;
  }

  private replaceSession(session: SessionInfo) {
    const current = this.getState().selectedSession;
    this.setState({
      sessions: this.getState().sessions.map((candidate) => candidate.id === session.id ? session : candidate),
      selectedSession: current?.id === session.id ? session : current,
    });
  }

  /** The token is the machine's key for this creation, so it is unique across tabs and devices, not a per-page counter. */
  private createPendingSessionStart(cwd: string, machineId: string, tempId = `${PENDING_SESSION_PREFIX}${newClientMessageId()}`, ask: PendingStartAsk = "create"): PendingSessionStart {
    const now = new Date().toISOString();
    const session: ClientPendingStartSessionInfo = {
      id: tempId,
      path: `pi-web://pending-session/${tempId}`,
      cwd,
      persisted: false,
      name: "New session",
      created: now,
      modified: now,
      messageCount: 0,
      firstMessage: "",
      clientPendingStart: true,
      machineId,
    };
    return { tempId, cwd, machineId, session, discarded: false, ask };
  }

  private selectClientPendingStartSession(session: ClientPendingStartSessionInfo, options?: { updateUrl?: boolean | undefined; activity?: SessionActivity | undefined; sessions?: SessionInfo[] | undefined }): void {
    this.sessionSelection.rememberSession({ ...session, cwd: this.workspaceSelectionKey(session.cwd) });
    this.selectionSeq += 1;
    this.readiness.clear();
    this.socket.close();
    this.streamWatermark = undefined;
    this.gapRepair = undefined;
    this.cancelTranscriptRetry();
    this.clearPendingUpdates();
    const state = this.getState();
    const pendingStart = this.pendingSessionStarts.get(session.id);
    const activity = options?.activity ?? state.sessionActivities[session.id] ?? (pendingStart?.launched !== undefined ? creatingPendingSessionActivity(session.id, waitingToStart(pendingStart)) : undefined);
    this.setState({
      ...(options?.sessions === undefined ? {} : { sessions: options.sessions }),
      selectedSession: session,
      messages: [],
      messagePageStart: 0,
      messagePageEnd: 0,
      messagePageTotal: 0,
      newerPendingCount: 0,
      pageReadEnd: undefined,
      transcriptFailed: undefined,
      statusReadFailed: undefined,
      status: undefined,
      statusArrival: pendingStart === undefined ? "none" : "on-its-way",
      activity,
      pendingDialogs: [],
      settledDialogIds: [],
      availableThinkingLevels: [],
      treeDialog: undefined,
      ...(activity === undefined ? {} : { sessionActivities: { ...state.sessionActivities, [session.id]: activity } }),
      ...clearErrorPatch(),
    });
    // Re-selecting the row mid-startup re-establishes the constructing
    // session's subscription; the close above dropped it with the old selection.
    this.restoreOutboxAttachmentRows();
    if (pendingStart?.backendSessionId !== undefined) this.connectPendingStartSocket(pendingStart);
    if (options?.updateUrl !== false) this.updateUrl();
  }

  private async resolvePendingSessionStart(tempId: string, session: SessionInfo): Promise<void> {
    const pending = this.pendingSessionStarts.get(tempId);
    if (pending === undefined) return;
    this.pendingSessionStarts.delete(tempId);
    const stillHeld = holdsPendingStart(pending.machineId, pending.cwd, tempId);
    releasePendingStart(pending.machineId, tempId);
    const releasedCreatedSessions = this.takeSuppressedCreatedSessionsFor(pending.cwd, pending.machineId, session.id);
    if (pending.discarded) {
      clearDraft(machineSessionKey(pending.machineId, tempId));
      discardOutbox(machineSessionKey(pending.machineId, tempId));
      this.applyReleasedCreatedSessions(releasedCreatedSessions, pending.machineId);
      void this.api.stop(session, pending.machineId).catch(() => {
        // Best-effort cleanup for a backend session whose temporary UI row was discarded before creation finished.
      });
      return;
    }

    if (pending.ask === "create" || stillHeld) rememberCachedNewSession(session, pending.machineId);
    this.moveComposerState(pending.machineId, tempId, session.id);
    const cachedSession = markCachedNewSessionInfo(session, pending.machineId);
    const state = this.getState();
    const current = this.isCurrentPendingStart(pending);
    const wasSelected = state.selectedSession?.id === tempId;
    this.setState({
      ...(current ? { sessions: replacePendingSessionInList(state.sessions, tempId, cachedSession) } : {}),
      sessionActivities: omitSessionActivity(state.sessionActivities, tempId),
      sendingPrompts: moveRecordKey(state.sendingPrompts, tempId, cachedSession.id),
      ...(wasSelected ? { selectedSession: cachedSession, status: state.sessionStatuses[cachedSession.id], activity: state.sessionActivities[cachedSession.id], pendingDialogs: state.sessionStatuses[cachedSession.id]?.pendingDialogs ?? [], settledDialogIds: [] } : {}),
      ...(current || wasSelected ? clearErrorPatch() : {}),
    });
    if (current) this.applyReleasedCreatedSessions(releasedCreatedSessions, pending.machineId);
    if (wasSelected) {
      this.updateUrl({ replace: true });
      await this.selectSession(cachedSession, { updateUrl: false });
    }
  }

  private failPendingSessionStart(tempId: string, error: unknown, releaseRecord: (machineId: string, token: string) => void = releasePendingStart): void {
    const pending = this.pendingSessionStarts.get(tempId);
    if (pending === undefined) return;
    this.pendingSessionStarts.delete(tempId);
    releaseRecord(pending.machineId, tempId);
    pending.failure = error instanceof Error ? error : new Error(String(error));
    const wasDiscarded = pending.discarded;
    // The pending start is dead: stop routing its dialog frames (a card on the
    // failed row could never be answered) and drop the early-subscribed socket
    // so it stops reconnecting against a session that may not exist.
    pending.discarded = true;
    const shown = this.getState().selectedSession?.id === tempId;
    if (shown) this.socket.close();
    const releasedCreatedSessions = this.takeSuppressedCreatedSessionsFor(pending.cwd, pending.machineId);
    const isCurrentPendingStart = this.isCurrentPendingStart(pending);
    if (wasDiscarded || (!isCurrentPendingStart && !shown)) {
      this.setState({ sessionActivities: omitSessionActivity(this.getState().sessionActivities, tempId) });
      if (isCurrentPendingStart) this.applyReleasedCreatedSessions(releasedCreatedSessions, pending.machineId);
      return;
    }
    const state = this.getState();
    const message = describeError(error);
    const activity = failedPendingSessionActivity(tempId, message, waitingToStart(pending));
    const listsRow = isCurrentPendingStart && !state.sessions.some((session) => session.id === tempId);
    this.setState({
      ...(listsRow ? { sessions: [pending.session, ...state.sessions] } : {}),
      sessionActivities: { ...state.sessionActivities, [tempId]: activity },
      activity: shown ? activity : state.activity,
      // Open cards on the failed row are dead: the create is gone, so no
      // answer could ever reach the daemon. Settled outcomes stay as history.
      ...(shown ? { pendingDialogs: [], statusArrival: "none" as const } : {}),
      ...noticePatch(noticeForReader(`Failed to start session: ${message}`, pending.machineId)),
    });
    if (isCurrentPendingStart) this.applyReleasedCreatedSessions(releasedCreatedSessions, pending.machineId);
  }

  /** Whether a start belongs to the place the page shows: its machine and directory, as its row is listed (r44 round 3: a start rebuilt before its workspace was known had no workspace id, and was never current). */
  private isCurrentPendingStart(pending: PendingSessionStart): boolean {
    const state = this.getState();
    return selectedMachineId(state) === pending.machineId && state.selectedWorkspace?.path === pending.cwd;
  }

  /** Whether a created session could be a pending start's own: same machine and directory, and its session not yet named otherwise. */
  private mayBePendingStartsOwn(session: Pick<SessionInfo, "id" | "cwd">, machineId: string): boolean {
    return Array.from(this.pendingSessionStarts.values()).some((pending) => pending.cwd === session.cwd && pending.machineId === machineId
      && (pending.backendSessionId === undefined || pending.backendSessionId === session.id));
  }

  private isSuppressedCreatedSession(session: SessionInfo, machineId: string): boolean {
    const suppressed = this.suppressedCreatedSessions.get(session.id);
    return suppressed?.session.cwd === session.cwd && suppressed.machineId === machineId;
  }

  private takeSuppressedCreatedSessionsFor(cwd: string, machineId: string, resolvedSessionId?: string): SessionInfo[] {
    if (resolvedSessionId !== undefined) this.suppressedCreatedSessions.delete(resolvedSessionId);
    const released: SessionInfo[] = [];
    for (const [sessionId, suppressed] of this.suppressedCreatedSessions) {
      if (suppressed.session.cwd !== cwd || suppressed.machineId !== machineId || this.mayBePendingStartsOwn(suppressed.session, machineId)) continue;
      this.suppressedCreatedSessions.delete(sessionId);
      released.push(suppressed.session);
    }
    return released;
  }

  /**
   * Fetch the project that owns a session directory the loaded catalogue could
   * not place, then adopt it as the selection. A session outside every open
   * project - a pin whose project was closed (B49) - leaves the project and
   * workspace selection empty: the page must not go on naming, and answering
   * for, the project the reader was in. While a project has not answered,
   * nothing moves.
   *
   * It is asked for once the selection names the session: the catalogue
   * answers only while this session is the one selected, so asked earlier it
   * found none selected and gave up without a read - which is how placement
   * never ran before B49. The place it lands reaches the URL through
   * `placedSelectionUrl`.
   *
   * Guarded on the selection counter and on the session still being selected:
   * a lookup that lands after the user has moved on must not drag the view back.
   */
  private async locateAndApplySessionWorkspace(session: SessionInfo, machineId: string, seq: number): Promise<void> {
    const cwd = session.cwd;
    if (cwd === "") return;
    const stillSelected = () => seq === this.selectionSeq && this.selectionUrl?.seq === seq && this.getState().selectedSession?.id === session.id;
    let placed = false;
    const wanted = () => !placed && stillSelected();
    const found = await locateSessionWorkspace(cwd, {
      projects: () => this.catalogue.projects(machineId, wanted),
      workspaces: (projectId: string) => this.catalogue.workspaces(machineId, projectId, wanted),
    });
    placed = true;
    if (!stillSelected()) return;
    if (found.kind === "outside") {
      if (this.leaveOpenProjects()) this.placedSelectionUrl(seq);
      return;
    }
    if (found.kind !== "found") return;
    const state = this.getState();
    const workspaceMoved = found.workspace.id !== state.selectedWorkspace?.id || found.project.id !== state.selectedProject?.id;
    this.setState({
      ...(workspaceMoved ? resetWorkspaceScopedState() : {}),
      projects: state.projects.some((project) => project.id === found.project.id) ? state.projects : [...state.projects, found.project],
      selectedProject: found.project,
      selectedWorkspace: found.workspace,
      workspaces: [...found.workspaces],
      workspacesByProjectId: { ...state.workspacesByProjectId, [found.project.id]: [...found.workspaces] },
      // The move that takes the chip must take the session list with it, as
      // the exact-match path does: rows from the workspace being left,
      // rendered under the located one, are another workspace's data on the
      // wrong surface.
      ...(workspaceMoved
        ? { sessions: [...(cachedSessionsFor(machineId, found.workspace.path) ?? [])], sessionsLoad: "loading" as const }
        : {}),
    });
    if (workspaceMoved) {
      void this.refreshCurrentWorkspaceSessions(machineId);
      this.placedSelectionUrl(seq);
    }
  }

  /** Empty the project and workspace selection; whether there was one to leave. */
  private leaveOpenProjects(): boolean {
    const state = this.getState();
    if (state.selectedProject === undefined && state.selectedWorkspace === undefined) return false;
    this.setState({ ...resetWorkspaceScopedState(), selectedProject: undefined, selectedWorkspace: undefined, workspaces: [], isLoadingWorkspaces: false });
    return true;
  }

  /**
   * The reader asked for another place (back, forward, a restore): a placement
   * still on its way for the current selection stops, so it never moves the page
   * or rewrites the URL the reader went to (D8).
   */
  yieldPlacement(): void {
    this.selectionUrl = undefined;
  }

  /** The selection's first read settled: write its place, or replace it when a placement moved it and the caller writes no URL. */
  private settleSelectionUrl(seq: number, write: boolean): void {
    const url = this.selectionUrl?.seq === seq ? this.selectionUrl : undefined;
    if (url !== undefined) url.settled = true;
    if (write) this.updateUrl();
    else if (url?.placed === true && this.urlNames(url.sessionId)) this.updateUrl({ replace: true });
  }

  /**
   * Whether a session the resolver found may open: only on the machine it was followed on (a
   * machine switch whose route names no session leaves a pending retry behind), and a correction
   * only while the address still names it (review ca45d6ed).
   */
  private mayOpenFollowed(sessionId: string, options: SessionTargetOpenOptions, scope: SessionTargetScope): boolean {
    if (scope.machineId !== selectedMachineId(this.getState())) return false;
    return options.correctsUrl !== true || this.urlNames(sessionId);
  }

  /** Whether the address names this session, so rewriting its entry corrects the reader's own place. */
  private urlNames(sessionId: string): boolean {
    return this.urlSessionId === undefined || this.urlSessionId() === sessionId;
  }

  /** A placement moved the selection's place: replace the URL the selection wrote, or leave the write to it if it has not written yet. */
  private placedSelectionUrl(seq: number): void {
    const url = this.selectionUrl;
    if (url?.seq !== seq) return;
    if (!url.settled) url.placed = true;
    else if (this.urlNames(url.sessionId)) this.updateUrl({ replace: true });
  }

  private applyReleasedCreatedSessions(sessions: readonly SessionInfo[], machineId: string): void {
    if (sessions.length === 0 || selectedMachineId(this.getState()) !== machineId) return;
    const state = this.getState();
    if (state.selectedWorkspace === undefined) return;
    const existingIds = new Set(state.sessions.map((session) => session.id));
    const released = sessions.filter((session) => session.cwd === state.selectedWorkspace?.path && !existingIds.has(session.id));
    if (released.length === 0) return;
    this.setState({ sessions: [...released.reverse(), ...state.sessions] });
  }

  /**
   * A listing with this page's pending-start rows for its machine and directory on top: the live
   * starts (a creation outlives a workspace switch now that it outlasts its request), and a failed
   * row still on screen.
   */
  withPendingStartRows(cwd: string, sessions: readonly SessionInfo[], machineId: string): SessionInfo[] {
    const live = [...this.pendingSessionStarts.values()].filter((start) => !start.discarded && start.cwd === cwd && start.machineId === machineId).map((start) => start.session);
    const liveIds = new Set(live.map((session) => session.id));
    const shown = this.getState().sessions.filter((session): session is ClientPendingStartSessionInfo => isClientPendingStartSessionInfo(session) && session.cwd === cwd && session.machineId === machineId && !liveIds.has(session.id));
    const pending = [...live, ...shown];
    if (pending.length === 0) return [...sessions];
    const pendingIds = new Set(pending.map((session) => session.id));
    return [...pending, ...sessions.filter((session) => !pendingIds.has(session.id))];
  }

  /** The rows of this page's live new-session starts on a machine, in any directory: the machine-wide list shows them too. */
  pendingStartRowsOn(machineId: string): SessionInfo[] {
    return [...this.pendingSessionStarts.values()].filter((start) => !start.discarded && start.machineId === machineId).map((start) => start.session);
  }

  /**
   * Before a start opened from a machine-wide list is shown, move the page to its own project and
   * workspace, as opening a session does: the header, the files and the session list beside it name
   * its place, and its row swaps to the session once made (r44 round 3 live: the start rendered
   * under the place the reader left, and never swapped). A workspace the page has not loaded is
   * asked of the catalogue while `wanted` holds; a directory no open project claims leaves the open
   * projects; while a project has not answered, nothing moves.
   */
  async placePendingStartRow(session: SessionInfo, wanted: () => boolean): Promise<void> {
    if (isClientPendingStartSessionInfo(session)) await this.placeStart(session.machineId, session.cwd, wanted);
  }

  /** Move the page to the place of a start in `cwd` on the selected machine; whether it moved. */
  private async placeStart(machineId: string, cwd: string, wanted: () => boolean): Promise<boolean> {
    const state = this.getState();
    if (selectedMachineId(state) !== machineId || state.selectedWorkspace?.path === cwd) return false;
    const loaded = [...state.workspaces, ...Object.values(state.workspacesByProjectId).flat()];
    const ancestors = ancestorsForSession({ cwd }, { workspaces: loaded, projects: state.projects });
    const place: SessionPlace<Workspace, Project> = ancestors === undefined
      ? await locateSessionWorkspace(cwd, {
        projects: () => this.catalogue.projects(machineId, wanted),
        workspaces: (projectId: string) => this.catalogue.workspaces(machineId, projectId, wanted),
      })
      : { kind: "found", ...ancestors, workspaces: state.workspacesByProjectId[ancestors.project.id] ?? state.workspaces };
    if (!wanted() || selectedMachineId(this.getState()) !== machineId) return false;
    if (place.kind === "outside") return this.leaveOpenProjects();
    if (place.kind === "unknown") return false;
    this.moveToStartPlace(machineId, cwd, place);
    return true;
  }

  private moveToStartPlace(machineId: string, cwd: string, place: { readonly workspace: Workspace; readonly project: Project; readonly workspaces: readonly Workspace[] }): void {
    const state = this.getState();
    this.setState({
      ...resetWorkspaceScopedState(),
      projects: state.projects.some((project) => project.id === place.project.id) ? state.projects : [...state.projects, place.project],
      selectedProject: place.project,
      selectedWorkspace: place.workspace,
      workspaces: [...place.workspaces],
      workspacesByProjectId: { ...state.workspacesByProjectId, [place.project.id]: [...place.workspaces] },
      sessions: this.withPendingStartRows(cwd, cachedSessionsFor(machineId, cwd) ?? [], machineId),
      sessionsLoad: "loading",
    });
    void this.refreshCurrentWorkspaceSessions(machineId);
  }

  /**
   * A new session the machine lost (a daemon restart drops unwritten sessions) is created again as a
   * pending start, so its create carries a token and survives an unanswered request like any other;
   * its composer state moves to the pending start, and on to the session once the machine made it.
   */
  private recreateCachedNewSession(session: SessionInfo, options?: { updateUrl?: boolean | undefined }): void {
    const state = this.getState();
    const machineId = selectedMachineId(state);
    const deadWorkspace = state.workspaces.some((workspace) => workspace.cwdMissing === true && workspace.path === session.cwd);
    if (deadWorkspace) {
      this.setState({ ...noticePatch(noticeForReader(MISSING_PROJECT_FOLDER)), statusArrival: "none" });
      return;
    }
    const pending = this.createPendingSessionStart(session.cwd, machineId);
    this.pendingSessionStarts.set(pending.tempId, pending);
    this.moveComposerState(machineId, session.id, pending.tempId);
    forgetCachedNewSession(session.id, machineId);
    const sessions = [pending.session, ...state.sessions.filter((candidate) => candidate.id !== session.id)];
    this.selectClientPendingStartSession(pending.session, { updateUrl: false, sessions });
    this.updateUrl(options?.updateUrl === false ? { replace: true } : undefined);
    void this.launchPendingStart(pending);
  }

  private markCachedNewSessionPersisted(session: SessionInfo): void {
    if (!isCachedNewSessionInfo(session)) return;
    const latest = this.getState().sessions.find((candidate) => candidate.id === session.id) ?? session;
    this.replaceSession(stripCachedNewSessionMarker(latest));
  }

  /**
   * A command's text result lives on its own bubble in the command ledger,
   * once; injecting it into the transcript as well drew the same line twice
   * (a system row above, the bubble below) and the injected row vanished on
   * reload while the bubble did not.
   */
  private applyCommandResult(result: CommandResult) {
    if (result.type === "select") {
      this.setState({ commandDialog: result });
      return;
    }
    if (result.type === "tree") {
      this.setState({ treeDialog: result.tree });
      return;
    }
    if (result.type === "done" && result.session) {
      if (result.promptDraft !== undefined) saveDraft(this.sessionCacheKey(result.session.id), result.promptDraft);
      const current = this.getState().selectedSession;
      const sessions = [result.session, ...this.getState().sessions.filter((session) => session.id !== result.session?.id)];
      this.setState({ sessions, selectedSession: current?.id === result.session.id ? result.session : current });
      if (current?.id !== result.session.id) void this.selectSession(result.session);
    }
  }

  /**
   * `/new` ran on the session this page shows (owner, 2026-10-17): the page follows it to the new
   * session, as every page showing it does, carrying what the reader was writing. On the device
   * that sent the `/new`, its row reads "New session started", and what was queued comes back to the
   * composer first, as a Stop's answer does, so it travels with the draft (owner, 2026-10-18). Not
   * a rename: the old session stays a session of its own, with its own stored draft and outbox. A
   * frame replayed after the reader went elsewhere moves nothing. The stored draft moves here so it
   * follows even when no composer is mounted; a mounted composer then carries its live words and
   * attachments over it, which is the newer copy.
   */
  private async followReplacedSession(event: Extract<SessionUiEvent, { type: "session.replaced" }>): Promise<void> {
    const machineId = selectedMachineId(this.getState());
    const startedHere = this.holdsCommandRow(event.commandClientMessageId);
    if (event.commandClientMessageId !== undefined) this.settleLedgerRow(event.commandClientMessageId, { state: "ok", resultText: "New session started" });
    if (startedHere) await this.returnStoppedQueue({ machineId, sessionId: event.sessionId }, event.returned);
    const current = this.getState();
    if (current.selectedSession?.id !== event.sessionId || selectedMachineId(current) !== machineId) return;
    const fromKey = machineSessionKey(machineId, event.sessionId);
    const toKey = machineSessionKey(machineId, event.session.id);
    moveDraft(fromKey, toKey);
    carryComposer(machineId, event.sessionId, event.session.id);
    this.applyCreatedSession(event.session);
    void this.selectSession(event.session);
  }

  /**
   * A command this device sent did not run: a `/new` that did not start a session, or an extension
   * command the session refused before its handler ran. Its row reads failed, a plugin waiting on
   * it hears the refusal, and what a `/new` stopped comes back to the composer.
   */
  private failCommand(event: Extract<SessionUiEvent, { type: "command.failed" }>): void {
    const startedHere = this.holdsCommandRow(event.clientMessageId);
    this.settleLedgerRow(event.clientMessageId, { state: "failed", resultText: event.message });
    this.pluginCommands.refused(event.clientMessageId, event.message);
    const current = this.getState();
    const selected = current.selectedSession;
    if (startedHere && selected !== undefined) void this.returnStoppedQueue({ machineId: selectedMachineId(current), sessionId: selected.id }, event.returned);
  }

  private holdsCommandRow(clientMessageId: string | undefined): boolean {
    return clientMessageId !== undefined && this.getState().commandLedger.some((row) => row.id === clientMessageId);
  }

  private async returnStoppedQueue(scope: ReturnScope, returned: readonly QueuedSessionMessage[]): Promise<void> {
    const current = this.getState();
    const lines = this.isSelectedSessionIdentity(scope.sessionId, scope.machineId) ? current.messages : [];
    await this.returnQueuedToComposer?.(scope, returned, lines).catch(() => { console.warn("PI WEB could not put the messages /new stopped back in the composer"); });
  }

  private applyCreatedSession(session: SessionInfo) {
    for (const pending of this.pendingSessionStarts.values()) {
      if (pending.backendSessionId === session.id) pending.wake?.();
    }
    const state = this.getState();
    // Session trees are worktree-scoped, so a session created elsewhere has no
    // bearing on this listing.
    if (state.selectedWorkspace?.path !== session.cwd) return;
    if (state.sessions.some((candidate) => candidate.id === session.id)) return;
    const machineId = selectedMachineId(state);
    if (this.mayBePendingStartsOwn(session, machineId)) {
      this.suppressedCreatedSessions.set(session.id, { session, machineId });
      return;
    }
    this.setState({ sessions: [session, ...state.sessions] });
  }

  private applyActivity(activity: SessionActivity) {
    this.frameClock += 1;
    this.activityFrameMarks.set(activity.sessionId, this.frameClock);
    this.setState({
      sessionActivities: { ...this.getState().sessionActivities, [activity.sessionId]: activity },
      activity: this.getState().selectedSession?.id === activity.sessionId ? activity : this.getState().activity,
    });
  }

  private applyStatus(incoming: SessionStatus, source: ProjectionSource) {
    const state = this.getState();
    const isSelected = state.selectedSession?.id === incoming.sessionId;
    const dialogRevision = isSelected ? incoming.pendingDialogsRevision : undefined;
    const dialogVerdict: ProjectionVerdict = dialogRevision === undefined ? "adopt" : this.dialogScope.projectionVerdict(dialogRevision, incoming.daemonInstanceId, source);
    const status = dialogVerdict === "adopt" ? incoming : withOpenDialogs(incoming, state.pendingDialogs);
    const runtimeIdle = !status.isStreaming && !status.isCompacting && status.pendingMessageCount === 0;
    const messages = isSelected ? applyQueueToDelivery(state.messages, status.queuedMessages, sessionWorking(status)) : state.messages;
    const commandLedger = runtimeIdle ? settleIdleAwaitingCommands(state.commandLedger, machineSessionKey(selectedMachineId(state), status.sessionId), Date.now()) : state.commandLedger;
    const clearsStaleActivity = activityOutlivesStatus(state.sessionActivities[status.sessionId], status);
    const adoptedActivity = statusActivityToAdopt(clearsStaleActivity ? undefined : state.sessionActivities[status.sessionId], status);
    // Falling edge only: a turn that just ended is the one moment worth
    // re-reading a plugin panel's files for, and every other status update would
    // make it a poll.
    const becameIdle = isSelected && isSessionActive(state.status ?? status) && !isSessionActive(status);
    const dialogsCurrent = isSelected && dialogVerdict === "adopt";
    this.setState({
      sessionStatuses: { ...state.sessionStatuses, [status.sessionId]: status },
      ...sessionRowPatch(state, status),
      ...(clearsStaleActivity || adoptedActivity !== undefined ? { sessionActivities: activitiesAfterAdoption(state.sessionActivities, status.sessionId, adoptedActivity) } : {}),
      status: isSelected ? status : state.status,
      ...(isSelected ? { statusReadFailed: undefined } : {}),
      activity: isSelected ? adoptedActivity ?? (clearsStaleActivity ? undefined : state.activity) : state.activity,
      // The status projection is authoritative for the selected session's open
      // dialogs, including their removal. Closed-card outcomes are
      // event/response-driven instead, so a status without the dialog simply
      // drops it from the open list.
      // A dialog this browser already settled is the one thing the projection
      // cannot speak for: the snapshot is unordered against socket frames, so
      // one taken before the close can arrive after it. Re-opening a dismissed
      // dialog would record its outcome card again and cost the reader a second
      // tap, so those ids are held back. A projection older than frames already
      // applied is skipped for the same reason: it would drop a dialog opened since.
      ...(dialogsCurrent ? { pendingDialogs: openDialogsAfterDismissals(status.pendingDialogs, state.settledDialogIds) } : {}),
      ...(messages === state.messages ? {} : { messages }),
      ...(commandLedger === state.commandLedger ? {} : { commandLedger }),
    });
    if (dialogRevision !== undefined) DIALOG_GATE_AFTER_STATUS[dialogVerdict](this.dialogScope, dialogRevision, incoming.daemonInstanceId);
    if (becameIdle) {
      this.onSelectedSessionIdle?.();
      void this.recheckTranscript();
    }
  }

  /** Advance one tracked message's delivery mark in the visible transcript. */
  /**
   * Close the rows whose answer this browser lost.
   *
   * The daemon answers only for identities it holds, so an id missing from the
   * answer stays unverifiable rather than becoming a failure: "we have no row"
   * and "it did not happen" are different facts, and only the second would
   * justify telling the reader the message is gone.
   */
  /**
   * Whether opening this session can show something at once (D8): its transcript is in this
   * machine's cache, or it is still being started here and has nothing to read yet.
   */
  canOpenAtOnce(session: SessionInfo, machineId: string): boolean {
    return isClientPendingStartSessionInfo(session) || this.transcripts.rawHistoryPage(machineSessionKey(machineId, session.id)) !== undefined;
  }

  /**
   * Read a session's first page before the page moves to it (D8, B29): the reader stays where
   * they are, the tapped row answers, and the page moves once there is something to show.
   * Stored where selecting the session looks, so the selection seeds from it in the same frame.
   * Selecting still reads the page again as it joins the live stream; that second read runs
   * behind a transcript already on screen, and B7 (heads) is what removes it. Rejects, so the
   * tapped row can say it could not open.
   */
  async readFirstPage(session: SessionRef, machineId: string): Promise<void> {
    const page = await this.api.messages(session, { limit: MESSAGE_PAGE_SIZE }, machineId);
    this.transcripts.mergeHistory(machineSessionKey(machineId, session.id), page);
  }

  private readonly verificationRetries = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * One ask of the ledger for the rows on screen. An ask the link could not carry is not an
   * answer: it is an unanswered read of that session (state-diagram D5, P1 slice 6), recorded with
   * its machine and session and counted from the first ask that got none, which the app's one row
   * reports after the grace like any other. One retry chain per session asks again every
   * `VERIFY_RETRY_MS` until an ask gets through, the rows settle, or the reader leaves. Only an ask
   * that got through, or the reader leaving, ends the claim. It used to be a red notice in
   * `state.error`, with Retry, retired by comparing its words.
   */
  private async askLedgerAbout(session: SessionRef, machineId: string): Promise<void> {
    const key = machineSessionKey(machineId, session.id);
    const onScreen = (): boolean => !this.disposed && this.getState().selectedSession?.id === session.id && selectedMachineId(this.getState()) === machineId;
    const scope = { machineId, sessionId: session.id };
    const leave = (): void => {
      if (isClaimOf(this.getState().messageStatusUnanswered, scope)) this.setState({ messageStatusUnanswered: undefined });
    };
    if (!onScreen()) {
      leave();
      return;
    }
    while (this.selectedSessionRefreshes.pending(key)) {
      await this.selectedSessionRefreshes.settled(key);
      if (!onScreen()) {
        leave();
        return;
      }
    }
    const asked = await this.askLedgerAboutUnsettledRows(session);
    if (this.disposed) return;
    if (!onScreen()) {
      leave();
      return;
    }
    if (asked.kind !== "unreachable") {
      leave();
      return;
    }
    this.claimUnansweredMessageStatus(session, machineId, asked.miss);
    if (this.verificationRetries.has(key)) return;
    this.verificationRetries.set(key, setTimeout(() => {
      this.verificationRetries.delete(key);
      void this.askLedgerAbout(session, machineId);
    }, VERIFY_RETRY_MS));
  }

  /**
   * Ask again about the unanswered sends on screen, as when the tab comes back into view.
   *
   * The ask waits for a refresh in flight. After a daemon restart the ledger reads `unknown`
   * for a message still waiting in the restored inbox until the refresh reopens the session
   * and the inbox records it again; asked in between, a waiting row read "not received".
   */
  async verifyUnansweredSends(): Promise<void> {
    const session = this.getState().selectedSession;
    if (session === undefined) return;
    await this.askLedgerAbout(session, selectedMachineId(this.getState()));
  }

  /**
   * Ask the daemon's ledger about every row of the session on screen that the machine took but
   * the transcript has not settled: a terminal fact whose frame went to a socket the reader had
   * left - a take-back, a refusal, a loss - still reaches it.
   */
  private async askLedgerAboutUnsettledRows(session: SessionRef): Promise<LedgerAsk> {
    const askedAbout = new Map<string, MessageDeliveryState>();
    for (const line of this.getState().messages) {
      const delivery = line.meta?.delivery;
      if (delivery !== undefined && ASKED_ABOUT[delivery.state]) askedAbout.set(delivery.clientMessageId, delivery.state);
    }
    const open = [...askedAbout.keys()];
    if (open.length === 0) return LEDGER_ANSWERED;
    const machineId = selectedMachineId(this.getState());
    let outcomes: Record<string, string>;
    try {
      outcomes = await this.api.operationOutcomes(session, open, machineId);
    } catch (error) {
      return ledgerUnreachable(error) ? { kind: "unreachable", miss: ledgerMiss(error) } : LEDGER_ANSWERED;
    }
    if (this.getState().selectedSession?.id !== session.id || selectedMachineId(this.getState()) !== machineId) return LEDGER_ANSWERED;
    const outboxKey = machineSessionKey(machineId, session.id);
    for (const [clientMessageId, askedState] of askedAbout) {
      if (rowState(this.getState().messages, clientMessageId) !== askedState) continue;
      const steps: Readonly<Record<VerificationStep, () => void>> = {
        withdraw: () => { this.ledgerWithdrew(outboxKey, clientMessageId); },
        cancel: () => { this.cancelMessage({ machineId, sessionId: session.id }, clientMessageId, "the agent refused it"); },
        resend: () => { this.ledgerLost(outboxKey, clientMessageId); },
        wait: () => undefined,
      };
      steps[provenRowStep(outcomes[clientMessageId])]();
    }
    return LEDGER_ANSWERED;
  }

  /** The ledger says the machine took the message back, or a command took it without an entry. */
  private ledgerWithdrew(outboxKey: string, clientMessageId: string): void {
    retireMessage(outboxKey, clientMessageId);
    this.setState({ messages: withdrawDeliveryLine(this.getState().messages, clientMessageId) });
  }

  /** The machine lost the message before the agent read it: it goes back into the outbox, on its way again. */
  private ledgerLost(outboxKey: string, clientMessageId: string): void {
    const selected = this.getState().selectedSession;
    const machineId = selectedMachineId(this.getState());
    void requeueLostMessage(outboxKey, clientMessageId).then(requeued => {
      if (!requeued || selected === undefined || !this.isSelectedSessionIdentity(selected.id, machineId)) return;
      this.setState({ messages: restartDelivery(this.getState().messages, clientMessageId) });
    }).catch(() => { console.warn("PI WEB lost message requeue deferred"); });
  }

  /**
   * A message refused for good - by the machine's answer, or by the runtime after the machine took
   * it (docs/design/message-states.md, `cancelled`): the row goes, the words go back to the
   * composer, and a note where the row was says why. Nothing offers Retry; sending the words again
   * makes a new message.
   */
  private cancelMessage(scope: ReturnScope, clientMessageId: string, reason: string): void {
    const key = machineSessionKey(scope.machineId, scope.sessionId);
    const held = heldWords(key, clientMessageId);
    if (held === undefined || payloadInHand(held)) {
      this.finishCancelledMessage(scope, clientMessageId, reason, retireMessage(key, clientMessageId));
      return;
    }
    reserveAcceptedPrompt(key, clientMessageId);
    void loadPayload(held).then(loaded => { this.cancelledAfterLoad[loaded.kind](scope, clientMessageId, reason, loaded.record); });
  }

  /**
   * A cancelled message whose attachments had to be read. Read, they go back with the words; gone
   * from this browser, the words go back and the note says how many did not; unreadable, the words
   * go back and the note says the attachments could not be read - not that this browser has no copy.
   */
  private readonly cancelledAfterLoad: Readonly<Record<PayloadLoad["kind"], (scope: ReturnScope, clientMessageId: string, reason: string, record: PendingPrompt) => void>> = {
    ready: (scope, clientMessageId, reason, record) => {
      const key = machineSessionKey(scope.machineId, scope.sessionId);
      this.finishCancelledMessage(scope, clientMessageId, reason, retireMessage(key, clientMessageId) === undefined ? undefined : record);
    },
    absent: (scope, clientMessageId, reason, record) => {
      const key = machineSessionKey(scope.machineId, scope.sessionId);
      const shortfall = MISSED_SHORTFALL.absent(record.attachmentRef?.count ?? 0);
      this.finishCancelledMessage(scope, clientMessageId, reason, retireMessage(key, clientMessageId) === undefined ? undefined : record, shortfall);
    },
    unreadable: (scope, clientMessageId, reason, record) => {
      const key = machineSessionKey(scope.machineId, scope.sessionId);
      const shortfall = MISSED_SHORTFALL.unreadable(record.attachmentRef?.count ?? 0);
      this.finishCancelledMessage(scope, clientMessageId, reason, retireMessage(key, clientMessageId) === undefined ? undefined : record, shortfall);
    },
  };

  private finishCancelledMessage(scope: ReturnScope, clientMessageId: string, reason: string, words: PendingPrompt | undefined, shortfall?: AttachmentShortfall): void {
    if (this.isSelectedSessionIdentity(scope.sessionId, scope.machineId)) this.setState({ messages: withdrawDeliveryLine(this.getState().messages, clientMessageId) });
    this.noteUnder(scope, clientMessageId, words === undefined ? `Not sent: ${reason}.` : `Not sent: ${reason}. The words are back in the composer.`);
    if (words !== undefined) this.returnToComposer?.(scope, { text: words.text, attachments: shortfall === undefined ? words.attachments ?? [] : [], ...(shortfall === undefined ? {} : { shortfall }) });
  }

  /**
   * A message that leaves no row (D1): the reader took it back, here or on another device, or an
   * input handler or extension command consumed it without a user entry. No transcript copy is
   * coming, so without the frame the row would wait at "Queued" or "Received" forever, and a retry
   * would send it again. Terminal: the row goes, and its outbox record with it. A queued command's
   * row goes the same way when Stop or Clear returned the command to the composer.
   */
  private dropPromptRow(clientMessageId: string): void {
    if (this.getState().commandLedger.some((row) => row.id === clientMessageId)) this.setState({ commandLedger: withdrawCommand(this.getState().commandLedger, clientMessageId) });
    const current = this.getState();
    const selected = current.selectedSession;
    if (selected === undefined) return;
    forgetPendingPrompt(machineSessionKey(selectedMachineId(current), selected.id), clientMessageId);
    const messages = withdrawDeliveryLine(current.messages, clientMessageId);
    if (messages.length !== current.messages.length) this.setState({ messages });
  }

  private markDelivery(sessionId: string, clientMessageId: string, state: MessageDeliveryState): void {
    const current = this.getState();
    if (current.selectedSession?.id !== sessionId) return;
    const messages = markDelivery(current.messages, clientMessageId, state);
    if (messages !== current.messages) this.setState({ messages });
  }

  /**
   * The POST answered for this message. A row the agent already took
   * keeps nothing aside; the answer can arrive after the delivered row retired its reserve, and
   * reserving then left the words in storage for a day. Anything else is waiting while the session
   * works and said otherwise (`acceptedDeliveryState`), and kept aside until the agent takes it.
   */
  private settleAnsweredSend(session: SessionRef, machineId: string, clientMessageId: string): void {
    if (isClaimOf(this.getState().messageStatusUnanswered, { machineId, sessionId: session.id })) this.setState({ messageStatusUnanswered: undefined });
    const row = rowState(this.getState().messages, clientMessageId);
    const key = machineSessionKey(machineId, session.id);
    if (row === "delivered") {
      forgetPendingPrompt(key, clientMessageId);
      return;
    }
    this.markDelivery(session.id, clientMessageId, acceptedDeliveryState(sessionWorking(this.getState().status)));
    reserveAcceptedPrompt(key, clientMessageId);
  }

  private readonly retiredRecords = new Set<string>();

  /**
   * A message the agent took leaves the outbox, and so does a take-back still on its way for it:
   * the note under the message says it came too late. Its record stayed on file past acceptance so a
   * runtime refusal could still make it retryable; once its row is delivered, or the history holds
   * its committed copy (a reader who left before the row turned delivered), nothing can refuse it.
   * Every write of the transcript passes here, and only an id not retired before reads storage.
   */
  private retireTakenRecords(messages: readonly ChatLine[]): void {
    const current = this.getState();
    const selected = current.selectedSession;
    if (selected === undefined) return;
    const key = machineSessionKey(selectedMachineId(current), selected.id);
    for (const line of messages) {
      const taken = takenMessageId(line);
      if (taken === undefined) continue;
      const retired = `${key}\u0000${taken}`;
      if (this.retiredRecords.has(retired)) continue;
      this.retiredRecords.add(retired);
      const takeBack = loadPendingPrompts(key).find((record) => record.takeBackOf === taken);
      retireMessage(key, taken);
      if (takeBack !== undefined && takeBack.attachmentsLost === undefined) this.noteUnder(takeBack.scope, taken, "Already with the agent; it could not be taken back.");
    }
  }

  private applyOpenedDialog(dialog: PendingExtensionDialog): void {
    const state = this.getState();
    if (state.selectedSession === undefined) return;
    // Events apply exactly once, so an id already on screen means this frame
    // was already reflected (e.g. a rehydrated open) and must not duplicate
    // the card.
    if (state.pendingDialogs.some((pending) => pending.dialogId === dialog.dialogId)) return;
    // A live open is newer news than any snapshot, so it also forgives the
    // dismissal this browser recorded: the daemon is asking again, and the next
    // status frame that carries the dialog must not be filtered as stale news -
    // that would wipe the genuinely re-opened card the frame after it appeared.
    this.setState({
      pendingDialogs: [...state.pendingDialogs, dialog],
      ...(state.settledDialogIds.some((id) => id === dialog.dialogId)
        ? { settledDialogIds: state.settledDialogIds.filter((id) => id !== dialog.dialogId) }
        : {}),
    });
  }

  private applyClosedDialog(dialogId: string): void {
    // A close for a dialog that is not on screen is already reflected here
    // (e.g. the answering browser's own response landed first), so it must not
    // clear or duplicate other cards.
    const dialog = this.getState().pendingDialogs.find((pending) => pending.dialogId === dialogId);
    if (dialog === undefined) return;
    this.settleClosedDialog(dialog);
  }

  /**
   * A dialog that closed leaves no card (state-diagram D2, owner 2026-10-12): what became of it is
   * the tool row's, as in pi. Settling still matters: its id joins the suppression list at once, so
   * a status snapshot built before the close cannot re-open a question that already settled.
   */
  private settleClosedDialog(dialog: PendingExtensionDialog): void {
    const state = this.getState();
    if (state.settledDialogIds.includes(dialog.dialogId)) return;
    const sessionId = state.selectedSession?.id;
    this.setState({
      pendingDialogs: state.pendingDialogs.filter((pending) => pending.dialogId !== dialog.dialogId),
      settledDialogIds: [...state.settledDialogIds, dialog.dialogId],
    });
    if (sessionId !== undefined) {
      const sessionKey = machineSessionKey(selectedMachineId(state), sessionId);
      clearDialogAnswerDraft(sessionKey, dialog.dialogId);
      clearCardDraft(sessionKey, dialog.dialogId);
    }
    // The card is gone; the status map must stop listing the dialog too, or
    // the closed question rides the map back on the next selection and the
    // row keeps its asking marker.
    this.patchSessionStatus(sessionId, (sessionStatus) => {
      if (sessionStatus.pendingDialogs === undefined) return sessionStatus;
      if (!sessionStatus.pendingDialogs.some((pending) => pending.dialogId === dialog.dialogId)) return sessionStatus;
      return { ...sessionStatus, pendingDialogs: sessionStatus.pendingDialogs.filter((pending) => pending.dialogId !== dialog.dialogId) };
    });
  }

  /**
   * Rewrite one session's entry in the shared status map. The top-level cards
   * are the selected session's projection; the map is what the rows, the
   * switcher and a reselection read, so a card-level retraction has to reach
   * it too or the closed state rides the map back on the next selection.
   */
  /**
   * The runtime that held a session's extension values was closed (archive, delete): pi drops
   * them with its process, so the session's status stops drawing them. The daemon cannot say so
   * on a status, since a status built from the dying runtime would refile its warnings.
   */
  private forgetStandingValues(sessionId: string | undefined): void {
    this.patchSessionStatus(sessionId, withoutStandingValues);
    const status = this.getState().status;
    if (status !== undefined && status.sessionId === sessionId) this.setState({ status: withoutStandingValues(status) });
  }

  private patchSessionStatus(sessionId: string | undefined, patch: (status: SessionStatus) => SessionStatus): void {
    if (sessionId === undefined) return;
    const state = this.getState();
    const status = state.sessionStatuses[sessionId];
    if (status === undefined) return;
    const next = patch(status);
    if (next === status) return;
    this.setState({ sessionStatuses: { ...state.sessionStatuses, [sessionId]: next } });
  }

  /**
   * Give a session a human alias.
   *
   * Routed through the daemon's existing `/name` command rather than a new
   * endpoint: that path already owns persistence into the session file and the
   * `session.name` broadcast, so every other connected browser and the terminal
   * UI converge without a second source of truth.
   *
   * The rename is applied locally first so the list reflects the new alias
   * immediately; the broadcast that follows is identical, and a failure rolls
   * back to the previous name rather than leaving a lie on screen.
   */
  /** Rename a session, showing the name at once and taking it back when the machine refuses; whether the machine took it. */
  async renameSession(session: SessionInfo, name: string, machineId = selectedMachineId(this.getState())): Promise<boolean> {
    const trimmed = name.trim();
    if (trimmed === "") return false;
    const previous = session.name;
    this.applySessionName(session.id, trimmed);
    try {
      await this.api.runCommand({ id: session.id, cwd: session.cwd }, `/name ${trimmed}`, machineId);
      return true;
    } catch (error) {
      this.applySessionName(session.id, previous);
      this.failedFor(session, error);
      return false;
    }
  }

  private applySessionName(sessionId: string, name: string | undefined) {
    const rename = (session: SessionInfo) => {
      if (session.id !== sessionId) return session;
      const next = { ...session };
      if (name === undefined || name === "") delete next.name;
      else next.name = name;
      return next;
    };
    const selectedSession = this.getState().selectedSession;
    this.setState({
      sessions: this.getState().sessions.map(rename),
      selectedSession: selectedSession === undefined ? undefined : rename(selectedSession),
    });
  }

  /**
   * Rebase the live stream on a view just rebuilt from a read. Frames still waiting for the next
   * render were applied to the view being replaced: those the read reflects are in it already,
   * and the machine fetches the ones after it again, so only frames without a seq stay queued.
   */
  private reseedLiveStream(watermark: StreamFrontier): void {
    if (this.gapRepair === undefined) return;
    this.pendingTranscriptEvents = this.pendingTranscriptEvents.filter((event) => Reflect.get(event, "seq") === undefined);
    this.gapRepair.seed(watermark);
    this.socket.noteApplied?.(watermark.seq);
  }

  /**
   * Every live frame, the join buffer's included, flows through the gap repair: seeded with
   * the snapshot's watermark, it applies frames in seq order exactly once and fetches any
   * range it sees missing, including frames published between the snapshot and the
   * subscription.
   */
  private routeLiveEvent(event: SessionUiEvent): void {
    this.outbox.heardFrom(selectedMachineId(this.getState()));
    const seq: unknown = Reflect.get(event, "seq");
    this.gapRepair?.onLiveFrame(event, typeof seq === "number" ? seq : undefined);
  }

  private applyEvent(event: SessionUiEvent) {
    // Drop events already reflected in the seeded join snapshot (committed
    // history + partial). Everything past the watermark applies exactly once,
    // so live content streams directly on top of the seeded partial.
    if (this.isStreamEventBelowWatermark(event)) return;
    const streamed = this.getState();
    if (streamed.selectedSession !== undefined) this.onStreamFrame?.({ machineId: selectedMachineId(streamed), sessionId: streamed.selectedSession.id }, event);

    // Status and activity arrive once per token (the server republishes them on
    // every transcript event). Buffer them alongside high-frequency transcript
    // deltas so the host component renders at most once per animation frame
    // instead of once per token. Coalescing these here is what keeps the prompt
    // editor's DOM stable during streaming, so in-progress touch gestures (e.g.
    // the iOS long-press edit/paste callout) are not interrupted by a re-render.
    if (event.type === "status.update") {
      this.queueStatusUpdate(event.status, event.seq === undefined ? event.status.streamPosition : { seq: event.seq, ...(event.epoch === undefined ? {} : { epoch: event.epoch }) });
      return;
    }
    if (event.type === "activity.update") {
      this.queueActivityUpdate(event.activity);
      return;
    }
    if (isHighFrequencyTranscriptEvent(event)) {
      this.queueTranscriptEvent(event);
      return;
    }

    this.flushPendingUpdates();
    if (event.type === "session.stopped") {
      if (event.cause === "closed") this.forgetStandingValues(this.getState().selectedSession?.id);
      return;
    }
    if (event.type === "extension.ui" && event.kind === "editorText") {
      if (this.framesFromReplay.has(event)) return;
      const current = this.getState();
      const selected = current.selectedSession;
      if (selected !== undefined) void this.replacePromptEditorText?.({ machineId: selectedMachineId(current), sessionId: selected.id, text: event.text, mode: event.mode });
      return;
    }
    if (event.type === "activity.changed") return;
    if (event.type === "operation.applied") {
      const current = this.getState();
      const selected = current.selectedSession;
      if (selected !== undefined) this.outbox.streamApplied(machineSessionKey(selectedMachineId(current), selected.id), event);
      return;
    }
    if (event.type === "prompt.withdrawn") {
      this.pluginCommands.withdrawn(event.clientMessageId);
      this.dropPromptRow(event.clientMessageId);
      return;
    }
    if (event.type === "prompt.consumed") {
      this.dropPromptRow(event.clientMessageId);
      return;
    }
    if (event.type === "session.replaced") {
      void this.followReplacedSession(event);
      return;
    }
    if (event.type === "command.failed") {
      this.failCommand(event);
      return;
    }
    if (event.type === "command.settled") {
      this.pluginCommands.settled(event.clientMessageId, event.notices);
      if (this.holdsCommandRow(event.clientMessageId)) this.settleLedgerRow(event.clientMessageId, { state: "ok" });
      return;
    }
    if (event.type === "prompt.refused") {
      const current = this.getState();
      const selected = current.selectedSession;
      if (selected !== undefined) this.cancelMessage({ machineId: selectedMachineId(current), sessionId: selected.id }, event.clientMessageId, event.message);
      return;
    }
    if (event.type === "prompt.accepted") {
      // D7: the daemon owns this prompt now — the bubble moves from sending to
      // waiting or said (the wrapper is a no-op for later states). A lost frame
      // is repaired by the gap replay like any other session frame. Session
      // frames apply to the selected session; the wrapper's own guard keeps a
      // stale frame from touching another chat.
      const current = this.getState();
      const selected = current.selectedSession;
      if (selected !== undefined) {
        this.markDelivery(selected.id, event.clientMessageId, acceptedDeliveryState(sessionWorking(current.status)));
        // The daemon has it: whatever the send call reported - a timeout that
        // raced an accepted request, a socket that dropped mid-reply - this
        // message is not unsent, so it leaves the outbox. Its content is kept
        // aside until the agent takes it, so a runtime refusal can still make it
        // retryable. Leaving it in the outbox is what offered "Retry" for a
        // message the agent had already answered.
        reserveAcceptedPrompt(machineSessionKey(selectedMachineId(current), selected.id), event.clientMessageId);
      }
      return;
    }
    if (event.type === "dialog.opened") {
      this.dialogScope.observe(event, () => { this.applyOpenedDialog(event.dialog); });
      return;
    }
    if (event.type === "dialog.closed") {
      this.dialogScope.observe(event, () => { this.applyClosedDialog(event.dialogId); });
      return;
    }
    const view = this.getState();
    const transcriptEvent = this.transcripts.applyLiveEvent(view.messages, event);
    if (transcriptEvent) {
      if (view.messagePageEnd < view.messagePageTotal) {
        // The tail is trimmed: appending here would land new rows after an
        // invisible gap. Park the event on the "newer messages" chip instead.
        if (view.selectedSession !== undefined) this.parkedNotices.park(this.sessionCacheKey(view.selectedSession.id), event);
        if (commitsMessage(event)) this.setState({ newerPendingCount: view.newerPendingCount + 1 });
      } else {
        this.setState({ messages: transcriptEvent });
      }
    } else if (event.type === "session.name") {
      this.applySessionName(event.sessionId, event.name);
    }
  }

  private queueTranscriptEvent(event: SessionUiEvent): void {
    this.pendingTranscriptEvents.push(event);
    this.schedulePendingFlush();
  }

  /**
   * Queue a status frame with its place in the session's stream: its own seq on the session
   * socket, or the position the daemon stamped on the machine-wide copy of the same frame.
   */
  private queueStatusUpdate(status: SessionStatus, position: StatusPosition | undefined = status.streamPosition): void {
    const pending = this.pendingStatusPositions.get(status.sessionId);
    if (pending !== undefined && position !== undefined && pending.epoch === position.epoch && pending.seq >= position.seq) return;
    this.pendingStatusBySession.set(status.sessionId, status);
    if (position === undefined) this.pendingStatusPositions.delete(status.sessionId);
    else this.pendingStatusPositions.set(status.sessionId, position);
    this.schedulePendingFlush();
  }

  /**
   * Apply one status frame unless a read already applied for this session is at least as new.
   * Every applied status frame for the selected session is counted, so a read that carries no
   * position can tell whether one landed while it was in flight.
   */
  private applyStatusFrame(status: SessionStatus, position: StatusPosition | undefined): void {
    const selected = this.getState().selectedSession?.id === status.sessionId;
    const known = this.statusPosition?.sessionId === status.sessionId ? this.statusPosition : undefined;
    if (selected && position !== undefined && known !== undefined && known.epoch === position.epoch && position.seq <= known.seq) return;
    this.applyStatus(status, "read");
    this.frameClock += 1;
    this.statusFrameMarks.set(status.sessionId, this.frameClock);
    if (!selected) return;
    if (position !== undefined) this.statusPosition = { sessionId: status.sessionId, ...position };
  }

  /** Whether a status read of the selected session lost the race to a newer status fact. */
  private statusReadIsStale(status: SessionStatus, framesAtRequest: number): boolean {
    const known = this.statusPosition?.sessionId === status.sessionId ? this.statusPosition : undefined;
    return statusReadVerdict({ position: status.streamPosition, frameAppliedWhileReading: (this.statusFrameMarks.get(status.sessionId) ?? 0) > framesAtRequest }, known) === "stale";
  }

  /** Apply a status read that is not stale, and remember the position it was computed at. */
  private applyStatusRead(status: SessionStatus): void {
    this.applyStatus(status, "read");
    if (status.streamPosition !== undefined) this.statusPosition = { sessionId: status.sessionId, ...status.streamPosition };
  }

  private queueActivityUpdate(activity: SessionActivity): void {
    this.pendingActivityBySession.set(activity.sessionId, activity);
    this.schedulePendingFlush();
  }

  // Session startup progress arrives while the daemon is still constructing the
  // session, so the target row is resolved by exact identity only: a session id
  // the browser already knows (an open), else the correlation token this browser
  // minted for its own create and the daemon echoed back. Matching neither means
  // the row is not one this browser shows — an agent's or another tab's session is
  // *deliberately* absent while a create is pending — so it is ignored rather than
  // guessed at. A resolved row goes through the normal activity buffer, rendering
  // like any other activity and staying batched per frame.
  private queueStartupProgress(event: SessionStartupProgressEvent): void {
    if (this.getState().sessions.some((session) => session.id === event.activity.sessionId)) {
      this.queueActivityUpdate(event.activity);
      return;
    }
    const pending = event.startupToken === undefined ? undefined : this.pendingSessionStarts.get(event.startupToken);
    if (pending === undefined || pending.discarded) return;
    this.learnPendingStartBackendSession(pending, event.activity.sessionId);
    if (event.activity.phase === "idle") pending.wake?.();
    // An idle startup phase means the daemon has nothing left to attribute, so
    // restore this row's own generic wording rather than clearing the text of a
    // creation request that has not returned yet.
    this.queueActivityUpdate(event.activity.phase === "idle"
      ? creatingPendingSessionActivity(pending.tempId, waitingToStart(pending))
      : pendingStartActivity(event.activity, pending.tempId));
  }

  /**
   * The token names the creation, and the machine says which session that is: after a daemon
   * restart a repeat under the token makes a new one, whose dialogs replace the dead session's.
   */
  private learnPendingStartBackendSession(pending: PendingSessionStart, sessionId: string): void {
    if (sessionId === "" || pending.backendSessionId === sessionId) return;
    const replaced = pending.backendSessionId !== undefined;
    pending.backendSessionId = sessionId;
    this.applyReleasedCreatedSessions(this.takeSuppressedCreatedSessionsFor(pending.cwd, pending.machineId), pending.machineId);
    if (this.getState().selectedSession?.id !== pending.tempId) return;
    if (replaced) this.setState({ pendingDialogs: [], settledDialogIds: [] });
    this.connectPendingStartSocket(pending);
  }

  /**
   * Subscribe the selected pending-start row to its constructing session.
   * `session_start` dialogs park the create request until answered, so waiting
   * for readiness to subscribe would make them unanswerable; the per-session
   * event channel and (on this daemon version) the status route both serve a
   * session whose startup is still waiting on the user.
   */
  private connectPendingStartSocket(pending: PendingSessionStart): void {
    const backendSessionId = pending.backendSessionId;
    if (backendSessionId === undefined || pending.discarded) return;
    const ref: SessionRef = { id: backendSessionId, cwd: pending.cwd };
    this.socket.connect(ref, pending.machineId, {
      onEvent: (event) => { this.applyPendingStartEvent(pending, event); },
      onReconnect: () => { this.resyncPendingStartDialogs(pending); },
      onInitialOpen: () => { this.resyncPendingStartDialogs(pending); },
      onMalformed: () => { this.resyncPendingStartDialogs(pending); },
      onGap: () => { this.resyncPendingStartDialogs(pending); },
    });
    this.resyncPendingStartDialogs(pending);
  }

  /**
   * Recover dialogs that opened before this subscription connected (or during
   * a reconnect gap) from the daemon's status projection. The HTTP snapshot is
   * unordered against socket frames — dialogs the socket already opened or
   * closed are newer than anything it can say about them — so only genuinely
   * unknown opens are adopted, never a wholesale replace. A daemon that
   * predates mid-startup status answers 404 until readiness: tolerated, since
   * everything that opens from here still arrives as an event.
   */
  private resyncPendingStartDialogs(pending: PendingSessionStart): void {
    const backendSessionId = pending.backendSessionId;
    if (backendSessionId === undefined) return;
    void this.api.status({ id: backendSessionId, cwd: pending.cwd }, pending.machineId).then(
      (status) => {
        // Guard before applying: this unordered snapshot can land after the
        // readiness swap made the real session selected, and a stale replace
        // must not clobber the socket's fresher dialog state.
        if (pending.discarded || this.getState().selectedSession?.id !== pending.tempId) return;
        this.applyStatus(status, "read");
        const state = this.getState();
        const knownIds = new Set<string>([
          ...state.pendingDialogs.map((pendingDialog) => pendingDialog.dialogId),
          ...state.settledDialogIds,
        ]);
        const recovered = (status.pendingDialogs ?? []).filter((recoveredDialog) => !knownIds.has(recoveredDialog.dialogId));
        if (recovered.length > 0) this.setState({ pendingDialogs: [...state.pendingDialogs, ...recovered] });
      },
      () => undefined,
    );
  }

  /**
   * Route a constructing session's events onto its pending-start row. Only
   * dialog frames and their status reconciliation apply here: everything else
   * (transcript, activity, naming) is re-fetched authoritatively by the
   * readiness join, and routing it onto a temporary row would pollute state
   * keyed for a session that does not exist yet. Frames that arrive after the
   * row stopped being the selected pending start belong to the selection flow
   * that took over.
   */
  private applyPendingStartEvent(pending: PendingSessionStart, event: SessionUiEvent): void {
    if (pending.discarded || this.getState().selectedSession?.id !== pending.tempId) return;
    if (event.type === "extension.ui" && event.kind === "editorText") {
      void this.replacePromptEditorText?.({ machineId: selectedMachineId(this.getState()), sessionId: pending.tempId, text: event.text, mode: event.mode });
      return;
    }
    if (event.type === "dialog.opened") {
      this.applyOpenedDialog(event.dialog);
      return;
    }
    if (event.type === "dialog.closed") {
      this.applyClosedDialog(event.dialogId);
      return;
    }
    if (event.type === "status.update") this.applyPendingStartStatus(pending, event.status, "read");
  }

  /**
   * Apply a constructing session's status from an ordered channel (the
   * socket's own status frame, or a dialog close response): the daemon's
   * projection is authoritative there, so the open list is replaced wholesale,
   * exactly as applyStatus does for a ready session. The per-session map stays
   * truthful too — the readiness swap seeds the selected status from it.
   */
  private applyPendingStartStatus(pending: PendingSessionStart, status: SessionStatus, source: ProjectionSource): void {
    this.applyStatus(status, source);
    if (pending.discarded || this.getState().selectedSession?.id !== pending.tempId) return;
    this.setState({ pendingDialogs: status.pendingDialogs ?? [] });
  }

  private schedulePendingFlush(): void {
    this.pendingFrame ??= requestAnimationFrame(() => {
      this.pendingFrame = undefined;
      this.flushPendingUpdates();
    });
    this.pendingFlushTimer ??= setTimeout(() => {
      this.pendingFlushTimer = undefined;
      this.flushPendingUpdates();
    }, PENDING_FLUSH_DEADLINE_MS);
  }

  private cancelScheduledFlush(): void {
    if (this.pendingFrame !== undefined) {
      cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = undefined;
    }
    if (this.pendingFlushTimer !== undefined) {
      clearTimeout(this.pendingFlushTimer);
      this.pendingFlushTimer = undefined;
    }
  }

  // Apply buffered transcript deltas, activity, and status in one task. Activity
  // is applied before status to mirror the server's publish order, so an idle
  // status can clear the now-stale active activity it supersedes. Status and
  // activity are last-write-wins per session, so iterating the maps applies only
  // the latest buffered value per session. These writes run in a single task, so
  // Lit batches them into one render.
  flushPendingUpdates(): void {
    // Whichever scheduler won the race, the buffer is now empty: cancel the
    // other so it cannot re-enter with nothing to apply.
    this.cancelScheduledFlush();
    if (this.pendingTranscriptEvents.length > 0) {
      const events = this.pendingTranscriptEvents;
      this.pendingTranscriptEvents = [];
      const view = this.getState();
      if (view.messagePageEnd < view.messagePageTotal) {
        // The tail is trimmed: batch-appending would land rows after an
        // invisible gap. Park the batch on the "load newer" chip instead.
        const selected = view.selectedSession;
        if (selected !== undefined) for (const event of events) this.parkedNotices.park(this.sessionCacheKey(selected.id), event);
        const committed = events.filter(commitsMessage).length;
        if (committed > 0) this.setState({ newerPendingCount: view.newerPendingCount + committed });
      } else {
        let messages = view.messages;
        for (const event of events) messages = this.transcripts.applyLiveEvent(messages, event) ?? messages;
        if (messages !== view.messages) this.setState({ messages });
      }
    }
    if (this.pendingActivityBySession.size > 0) {
      const activities = Array.from(this.pendingActivityBySession.values());
      this.pendingActivityBySession.clear();
      for (const activity of activities) this.applyActivity(activity);
    }
    if (this.pendingStatusBySession.size > 0) {
      const statuses = Array.from(this.pendingStatusBySession.values());
      const positions = new Map(this.pendingStatusPositions);
      this.pendingStatusBySession.clear();
      this.pendingStatusPositions.clear();
      for (const status of statuses) this.applyStatusFrame(status, positions.get(status.sessionId));
    }
  }

  private clearPendingUpdates(): void {
    this.pendingTranscriptEvents = [];
    this.pendingStatusBySession.clear();
    this.pendingStatusPositions.clear();
    this.pendingActivityBySession.clear();
    this.cancelScheduledFlush();
  }

  /**
   * Watermark filter for join-time exactly-once application. An event is below the watermark
   * when it belongs to the selected session's seeded snapshot (`seq <= watermark.seq`); such
   * events are already reflected in the committed history and seeded partial and must be
   * dropped. Events with no `seq` are never dropped. A seq only compares within its epoch:
   * after a daemon restart the new numbering starts at 1, and comparing it with the old
   * snapshot's seq dropped live frames. Revisioned frames (dialog, ask, inbox) are not in the
   * transcript snapshot: the status read reflects them, and their revision scope drops old ones.
   */
  private isStreamEventBelowWatermark(event: SessionUiEvent): boolean {
    if (revisionedFrameType(event) !== undefined) return false;
    const watermark = this.streamWatermark;
    if (watermark === undefined || watermark.sessionId !== this.getState().selectedSession?.id) return false;
    if (event.epoch !== undefined && watermark.epoch !== undefined && event.epoch !== watermark.epoch) return false;
    return event.seq !== undefined && event.seq <= watermark.seq;
  }
}

/**
 * The daemon's open list minus the dialogs this reader already dismissed. The
 * status projection describes what the daemon believed when it was built, which
 * for a dialog settled here is older news than the close this browser applied.
 */
/** The dialogs a selection starts with: the status when it has them, else what this same session already showed. */
function pendingDialogsForSelection(state: AppState, session: SessionInfo): PendingExtensionDialog[] {
  if (session.archived === true) return [];
  const fromStatus = state.sessionStatuses[session.id]?.pendingDialogs;
  if (fromStatus !== undefined) return fromStatus;
  return state.selectedSession?.id === session.id ? state.pendingDialogs : [];
}

function openDialogsAfterDismissals(
  pendingDialogs: readonly PendingExtensionDialog[] | undefined,
  settledDialogIds: readonly string[],
): PendingExtensionDialog[] {
  const open = pendingDialogs ?? [];
  if (settledDialogIds.length === 0) return [...open];
  const dismissed = new Set(settledDialogIds);
  return open.filter((dialog) => !dismissed.has(dialog.dialogId));
}

/** The page's activities once a status has spoken: the session's own replaced by what the status brought, or dropped. */
function activitiesAfterAdoption(activities: Record<string, SessionActivity>, sessionId: string, adopted: SessionActivity | undefined): Record<string, SessionActivity> {
  return adopted === undefined ? omitSessionActivity(activities, sessionId) : { ...activities, [sessionId]: adopted };
}

function omitSessionActivity(activities: Record<string, SessionActivity>, sessionId: string): Record<string, SessionActivity> {
  return omitKey(activities, sessionId);
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));
}

function omitKeys<T>(record: Record<string, T>, keys: readonly string[]): Record<string, T> {
  if (keys.length === 0) return record;
  const removed = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([id]) => !removed.has(id)));
}

function moveRecordKey<T>(record: Record<string, T>, fromKey: string, toKey: string): Record<string, T> {
  if (fromKey === toKey || !(fromKey in record)) return record;
  const value = record[fromKey];
  if (value === undefined) return record;
  return { ...omitKey(record, fromKey), [toKey]: value };
}

function replacePendingSessionInList(sessions: readonly SessionInfo[], pendingSessionId: string, resolvedSession: SessionInfo): SessionInfo[] {
  const next: SessionInfo[] = [];
  let inserted = false;
  for (const session of sessions) {
    if (session.id === pendingSessionId) {
      if (!inserted) {
        next.push(resolvedSession);
        inserted = true;
      }
      continue;
    }
    if (session.id === resolvedSession.id) continue;
    next.push(session);
  }
  if (!inserted) return [resolvedSession, ...next];
  return next;
}

function isClientPendingStartSessionInfo(session: SessionInfo | undefined): session is ClientPendingStartSessionInfo {
  return session !== undefined && "clientPendingStart" in session && session.clientPendingStart === true;
}

/**
 * Re-label a startup report onto the browser's own pending create row.
 *
 * The daemon's startup marker is dropped: this row stands for a create the user
 * asked for and is waiting on, which the browser has always reported as active
 * work in progress, rather than for a session the daemon is opening. Only the
 * phase text is borrowed, so the row keeps its own `creating · ` appearance.
 */
function pendingStartActivity(activity: SessionActivity, sessionId: string): SessionActivity {
  return {
    sessionId,
    phase: activity.phase,
    label: activity.label,
    ...(activity.detail === undefined ? {} : { detail: activity.detail }),
    at: activity.at,
  };
}

function creatingPendingSessionActivity(sessionId: string, queuedCount = 0): SessionActivity {
  return {
    sessionId,
    phase: "active",
    label: "Creating session",
    detail: queuedCount > 0 ? `${String(queuedCount)} queued ${queuedCount === 1 ? "message" : "messages"} will send when the backend session is ready` : "Waiting for the backend session to be ready",
    at: new Date().toISOString(),
  };
}

function failedPendingSessionActivity(sessionId: string, message: string, queuedCount = 0): SessionActivity {
  const queuedDetail = queuedCount > 0 ? ` · ${String(queuedCount)} queued ${queuedCount === 1 ? "message" : "messages"} kept below` : "";
  return {
    sessionId,
    phase: "error",
    label: "Session creation failed",
    detail: `${message}${queuedDetail}`,
    at: new Date().toISOString(),
  };
}

/** A bulk answer per session: the ones done, and each refusal with the machine's words. */
function bulkAnswer(doneIds: readonly string[], failures: readonly SessionBulkFailure[]): InstantAnswer {
  return { doneIds, refused: failures.map((failure) => ({ id: failure.sessionId, reason: failure.error })), unansweredIds: [] };
}

/**
 * What a status says about its session's row: its message count, and when it last changed. The
 * Navigate page draws the machine in use from this listing, so a status that moves the activity
 * time must move it here as well as on the board (B28); the time only ever moves later.
 */
/**
 * A projection that may speak for the dialog surface is a full read of it, so the gate may trust
 * its counter again; one that cannot be ordered against this daemon instance sends the surface
 * for the read that can. A status without the surface's revision says nothing about it and never
 * reaches the gate (an older daemon fails open).
 */
const DIALOG_GATE_AFTER_STATUS: Readonly<Record<ProjectionVerdict, (scope: RevisionScope, revision: number, daemonInstanceId: string | undefined) => void>> = {
  adopt: (scope, revision, daemonInstanceId) => { scope.markFresh(revision, daemonInstanceId); },
  stale: (scope, revision, daemonInstanceId) => { scope.markFresh(revision, daemonInstanceId); },
  unordered: (scope) => { scope.requestResync(); },
};

/**
 * A status whose dialog projection predates frames already applied still speaks for everything
 * else, but its dialogs must not replace the ones on screen: the "asking" marker reads them from
 * the stored status, and a session parked on a dialog publishes no later status to correct it.
 */
function withOpenDialogs(status: SessionStatus, openDialogs: readonly PendingExtensionDialog[]): SessionStatus {
  if (openDialogs.length > 0) return { ...status, pendingDialogs: [...openDialogs] };
  const withoutDialogs = { ...status };
  delete withoutDialogs.pendingDialogs;
  return withoutDialogs;
}

function sessionRowPatch(state: AppState, status: SessionStatus): Pick<Partial<AppState>, "sessions" | "selectedSession"> {
  const update = (session: SessionInfo): SessionInfo => {
    const counted = status.messageCount === undefined || session.messageCount === status.messageCount ? session : { ...session, messageCount: status.messageCount };
    return status.lastActivityAt === undefined ? counted : withLaterActivity(counted, status.lastActivityAt);
  };
  const listed = state.sessions.find((session) => session.id === status.sessionId);
  const updated = listed === undefined ? undefined : update(listed);
  const selectedSession = state.selectedSession?.id === status.sessionId ? update(state.selectedSession) : state.selectedSession;
  return {
    ...(updated === listed ? {} : { sessions: state.sessions.map((session) => (session.id === status.sessionId ? updated ?? session : session)) }),
    ...(selectedSession === state.selectedSession ? {} : { selectedSession }),
  };
}

function isHighFrequencyTranscriptEvent(event: SessionUiEvent): boolean {
  return event.type === "assistant.delta" || event.type === "assistant.thinking.delta" || event.type === "shell.chunk";
}

/**
 * A live frame that commits a message to the session: pi ends every message it adds (a prompt, a
 * reply, a tool result) with `message_end`, and those are what the daemon's page total counts. So
 * they are what "N newer messages below" counts while the tail is trimmed; counting every frame
 * made one streamed reply read as several hundred newer messages.
 */
function commitsMessage(event: SessionUiEvent): boolean {
  return event.type === "message.end" && event.message !== undefined;
}

/** What a transcript read the reader did not ask for does to their window. */
type ResyncLanding = "mergeTail" | "noteTotal" | "replaceWithTail";

/** A transcript tail read the reader did not ask for: a resync of the open session, or the read that opens it. */
type TailRead = "resync" | "openAtNewest" | "openAtSpot";

interface HeldWindow {
  readonly end: number;
  readonly total: number;
}

/**
 * Where a session's opening read lands: where its reader left it, as the page saved it then. Left at
 * a spot they were reading, the window the reader left holds it; left at the newest messages, or
 * with nothing saved, the newest page is theirs.
 */
function openingRead(sessionKey: string): TailRead {
  return readSavedScrollPosition(sessionKey)?.mode === "anchor" ? "openAtSpot" : "openAtNewest";
}

/**
 * Whether the held window is a reader's place in history: one that ends below the total it knows,
 * as no window of a reader at the newest messages does. An opening at the newest messages is never
 * in history, however old its cached window is. An opening at a spot is when its window was: a
 * window that reached its own end lacks the rows that arrived live while the reader watched, which
 * only the view holds, so keeping it on the total the read brings lost a spot among them and paged
 * back to the session's first message looking for it (review of r167).
 */
const IN_HISTORY: Record<TailRead, (held: HeldWindow) => boolean> = {
  resync: (held) => held.end < held.total,
  openAtNewest: () => false,
  openAtSpot: (held) => held.end < held.total,
};

/**
 * A reader below the newest page is reading history, and a resync (a gap repair, a dialog resync, a
 * manual refresh) says what the tail is, not where the reader should be: replacing their window
 * with the newest page moved them to the end mid-scroll (#68), so it only notes the new total. The
 * read that opens a session lands by where its reader left it (`openingRead`). Left at a spot in
 * history, the window stays and the total is noted, so the restore finds the spot and the messages
 * since are counted below; taking the newest page brought a reader who left mid-history back to the
 * newest messages instead. Left at the newest messages, it takes the newest page: kept, a window left
 * at the end of an older span reopened `following`, where scrolling down asks for nothing. A total that fell
 * below the window's end (retry attempts hidden, another client moving the branch) means rows the
 * window holds are gone from the session: noted, it was a span the cache refuses, and nothing read
 * forward again; merged, the old total won and the stale rows stayed. The window is replaced by the
 * newest page instead.
 */
function resyncLanding(read: { readonly kind: TailRead; readonly total: number }, held: HeldWindow): ResyncLanding {
  if (read.total < held.end) return "replaceWithTail";
  return held.end > 0 && IN_HISTORY[read.kind](held) ? "noteTotal" : "mergeTail";
}

/**
 * A replay as the gap repair takes it. A frame that does not parse, or a revisioned frame that
 * fails validation, answers like a resync: skipped, the frontier passed it and the catch-up called
 * the page in step without it, so the full read repairs it instead. The live path drops the same
 * frames the same way, so a replay is never trusted more than the socket.
 */
function replayedFrames(sync: Awaited<ReturnType<typeof defaultApi.streamSync>>): GapReplayResult {
  if (sync.kind !== "replay") return { ok: false };
  const frames: SessionUiEvent[] = [];
  for (const raw of sync.frames) {
    const parsed = parsedJson(raw);
    if (parsed === undefined) return { ok: false };
    const event = parseSessionSocketEvent(parsed);
    if (event !== undefined) frames.push(event);
    else if (revisionedFrameType(parsed) !== undefined) return { ok: false };
  }
  return { ok: true, frames };
}

function parsedJson(raw: string): unknown {
  try {
    const value: unknown = JSON.parse(raw);
    return value;
  } catch {
    return undefined;
  }
}

/** The rows the daemon's ledger is asked about: ones the machine took (received, queued) that the transcript has not settled yet. */
const ASKED_ABOUT: Readonly<Record<MessageDeliveryState, boolean>> = {
  received: true,
  queued: true,
  sending: false,
  takingBack: false,
  delivered: false,
};

/**
 * A row's state now. An answer applies only to a row still in the state it was asked about: a
 * retry that went out, or a frame that landed, while the ledger was being asked has moved the
 * row on, and the answer describes the ledger before that.
 */
function rowState(messages: readonly ChatLine[], clientMessageId: string): MessageDeliveryState | undefined {
  return messages[findDeliveryLineIndex(messages, clientMessageId)]?.meta?.delivery?.state;
}

/** A read whose failure is kept as a value, so it can be awaited after another read without ever going unobserved. */
type Settled<T> = { readonly kind: "answered"; readonly value: T } | { readonly kind: "failed"; readonly error: unknown };

function selectionScope(target: SelectedSessionRefreshTarget): SelectionScope {
  return { machineId: target.machineId, cwd: target.session.cwd, sessionId: target.session.id, selectionSeq: target.selectionSeq };
}

function settled<T>(read: Promise<T>): Promise<Settled<T>> {
  return read.then((value) => ({ kind: "answered", value }), (error: unknown) => ({ kind: "failed", error }));
}

function withoutStandingValues(status: SessionStatus): SessionStatus {
  const { extensionUi, ...rest } = status;
  return extensionUi === undefined ? status : rest;
}
