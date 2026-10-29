import type { AuthProviderOption, CommandOption, CommandResult, Machine, MachineHealth, MachineRuntime, OAuthFlowState, PendingExtensionDialog, PiWebStatusResponse, Project, SessionActivity, SessionInfo, SessionModelCatalogEntry, SessionStatus, SessionTreeSnapshot, TerminalCommandRun, Workspace } from "./api";
import type { ChatLine } from "./components/shared";
import type { ModelPickerMode } from "./components/ModelPicker";
import type { CommandLedgerEntry } from "./commandLedger";
import { RetiredBy, type NoticeTone } from "./notice";
import type { TransportClaim } from "./api/transportClaim";
import type { MachineStatusSnapshot } from "../../shared/machineStatus";
import type { TranscriptSync } from "./transcriptSync";
import type { QualifiedContributionId } from "./plugins/ids";
import type { ScopedSessionTarget } from "./sessionTarget";
import type { MessageStatusUnanswered } from "./sendVerification";
import type { ReadMiss } from "./sync/readPhase";
import type { MessageNote } from "./messageNotes";

export interface AppState {
  machines: Machine[];
  selectedMachine: Machine | undefined;
  /** Whether the machines roster has answered; see MachineController.loadMachines. */
  machinesLoad: MachinesLoadState;
  machineStatuses: Record<string, MachineHealth>;
  machineRuntimes: Record<string, MachineRuntime>;
  /** Latest per-machine status tree published by each machine's daemon. */
  machineStatusSnapshots: Record<string, MachineStatusSnapshot>;
  projects: Project[];
  workspaces: Workspace[];
  sessions: SessionInfo[];
  /**
   * Three-state discipline for `sessions` (unloaded/loading/loaded). The empty
   * list is only a claim the browser may make once a listing has completed and
   * returned zero; before that the list carries a cached previous listing or a
   * quiet loading state. See workspaceSessionsCache and SessionList.
   */
  sessionsLoad: SessionsLoadState;
  messages: ChatLine[];
  messagePageStart: number;
  messagePageEnd: number;
  messagePageTotal: number;
  /**
   * Transcript events parked while the in-memory span is bottom-trimmed
   * (`messagePageEnd < messagePageTotal`): they extend the known gap instead
   * of silently appending after it.
   */
  newerPendingCount: number;
  /**
   * The page read on its way, and which end of the window asked for it, or
   * undefined when none is. One read at a time: both ends are held while one is
   * out (`loadEarlierMessages` and `loadNewerMessages` refuse), because a page
   * merged into a window another read is about to move is a page of the wrong
   * place (chatTranscriptStore). The end is named, not inferred from the
   * offsets, so a boundary reads "loading" only for the page it is waiting on.
   */
  pageReadEnd: "earlier" | "newer" | undefined;
  /** True until the selected session's first reads (transcript tail, status, thinking levels) have each answered or failed (selectionReadiness.ts). */
  isOpeningSession: boolean;
  /** Whether the selected transcript is known to be in step with the daemon (transcriptSync.ts). */
  transcriptSync: TranscriptSync | undefined;
  /** Sessions with a prompt upload in flight, keyed by sessionId (client-owned). */
  sendingPrompts: Record<string, true>;
  /** Machines this browser sent a batch to that nobody has answered yet, since when, and why, as the app row words it (outboxEngine.ts). */
  outboxUnanswered: readonly { readonly machineId: string; readonly since: number; readonly miss: ReadMiss }[];
  /** Notes about single messages, shown under them (messageNotes.ts). */
  messageNotes: readonly MessageNote[];
  /** The machine the open session's stream is known to be behind, since when: a frame number skipped, or a read again after "resync". */
  streamBehind: { readonly machineId: string; readonly since: number } | undefined;
  /**
   * The browser's record of every command it issued: the receipt a slash
   * command's invisible route never produced. Rows carry the session key they
   * were issued under and render only beneath it.
   */
  commandLedger: CommandLedgerEntry[];
  /** Client-initiated session creation requests waiting for the server. */
  startingSessionCount: number;
  /**
   * Four-state discipline for `projects` (unloaded/loading/loaded/failed).
   * An empty list is only "no projects" once a listing completed and returned
   * zero; a failure keeps the previous rows and reports itself on the list.
   */
  projectsLoad: ProjectsLoadState;
  isLoadingWorkspaces: boolean;
  selectedProject: Project | undefined;
  selectedWorkspace: Workspace | undefined;
  selectedSession: SessionInfo | undefined;
  /**
   * The session a link, a restore or a pick named, while it is not selected:
   * still being asked about, unanswered, or answered as one that cannot be
   * opened (state-diagram D8, "The target of a session link"). Only the
   * session target resolver writes it, and it renders only while its machine
   * and workspace are the selection.
   */
  sessionTarget: ScopedSessionTarget | undefined;
  /** The daemon's ledger went unanswered for the session on screen; the row says so after the grace. */
  messageStatusUnanswered: MessageStatusUnanswered | undefined;
  /**
   * The selected session's transcript read failed, with the daemon's own words.
   * An empty transcript after a failed read must render this, never the empty
   * claim: a session whose working directory is gone reads identically to a
   * fresh one otherwise, and the empty state invites writing into it.
   */
  transcriptFailed: string | undefined;
  /**
   * The selected session's own status read failed, with the reason. It reset on every
   * selection; without it a failed read read as "No session status yet", a read that had not
   * happened, with no way to ask again (reads F8).
   */
  statusReadFailed: string | undefined;
  status: SessionStatus | undefined;
  activity: SessionActivity | undefined;
  /**
   * The selected session's open extension dialogs, derived from the
   * daemon-owned {@link SessionStatus.pendingDialogs} plus live dialog events.
   * Oldest first; opening never supersedes, so several dialogs may wait at
   * once.
   */
  pendingDialogs: PendingExtensionDialog[];
  /**
   * Dialog ids this browser saw close for the selected session. A close has to
   * be remembered rather than merely applied: the daemon's status projection is
   * unordered against socket frames, so a snapshot taken before the close can
   * land after it and re-open a dialog this browser already settled. Cleared
   * with the selection: nothing outlives it.
   */
  settledDialogIds: readonly string[];
  /** Thinking levels available for the selected session's current model. */
  availableThinkingLevels: readonly string[];
  /** Statuses keyed by session id, carried with the machine they were read
   * from: a stale entry answers for a session this machine may no longer
   * have, so machine switches clear the map instead of retaining it. */
  sessionStatuses: Record<string, SessionStatus>;
  sessionActivities: Record<string, SessionActivity>;
  workspacesByProjectId: Record<string, Workspace[]>;
  workspaceDeletionRuns: Record<string, TerminalCommandRun>;
  commandDialog: Extract<CommandResult, { type: "select" }> | undefined;
  treeDialog: SessionTreeSnapshot | undefined;
  modelDialog: { title: string; options: CommandOption[]; catalog: SessionModelCatalogEntry[]; selectedValue?: string; query?: string; mode?: ModelPickerMode } | undefined;
  thinkingDialog: { title: string; options: CommandOption[]; selectedValue?: string } | undefined;
  themeDialog: { title: string; options: CommandOption[]; selectedValue?: string } | undefined;
  authDialog: AuthDialogState | undefined;
  actionPaletteOpen: boolean;
  workspaceTool: QualifiedContributionId;
  mainView: "navigation" | "chat" | QualifiedContributionId;
  activeTerminalCount: number;
  selectedTerminalId: string | undefined;
  piWebStatus: PiWebStatusResponse | undefined;
  error: string;
  /** What retires the error notice; see notice.ts. */
  errorRetiredBy: RetiredBy;
  /** Which machine's link the error speaks about; "page" for page-level claims, which any response disproves. */
  errorMachineId: string;
  /** What a self-healing error claims about the link, which the row words for it (B16); undefined for every other notice. */
  errorClaim: TransportClaim | undefined;
  /** The session, on `errorMachineId`, a notice about an action in it belongs to; undefined for every other notice. */
  errorSessionId: string | undefined;
  /** Whether the notice reports a failure or informs; see notice.ts. */
  noticeTone: NoticeTone;
}

/** `machineId` stays bound to the machine selected when the auth operation began. */
export type AuthDialogState =
  | { step: "method"; machineId: string }
  | { step: "providers"; mode: "login"; machineId: string; authType?: "oauth" | "api_key"; providers: AuthProviderOption[] }
  | { step: "oauth"; flow: OAuthFlowState; machineId: string; responding?: boolean; inputValue?: string; error?: string }
  | { step: "logout"; machineId: string; providers: AuthProviderOption[] };

/**
 * Whether a workspace's session listing has completed. `loaded` is the only
 * state in which `sessions: []` means "this workspace has no sessions";
 * `unloaded` and `loading` mean the browser does not know yet.
 */
export type SessionsLoadState = "unloaded" | "loading" | "loaded";

/**
 * Whether the selected machine's projects listing has answered. There is no "failed", as for the
 * machines roster below: a listing read without an answer stays "loading" while it is read again by
 * itself (B48), so a missing list never reads as "no projects". The plugin API's `NavProjectsLoad`
 * keeps "failed": a plugin may run under a page released before B48, which sends it.
 */
export type ProjectsLoadState = "unloaded" | "loading" | "loaded";

/**
 * Whether the machines roster has answered. There is no "failed": a roster
 * read without an answer stays "loading" while it is read again by itself
 * (B48). A refusal the web process stated also leaves it "loading", with the
 * refusal shown as a notice; the roster is not read again until asked.
 */
export type MachinesLoadState = "unloaded" | "loading" | "loaded";

export type WorkspaceScopedStateReset = Pick<AppState,
  | "sessions"
  | "sessionsLoad"
  | "commandLedger"
  | "startingSessionCount"
  | "treeDialog"
  | "selectedTerminalId"
>;


export function resetWorkspaceScopedState(): WorkspaceScopedStateReset {
  return {
    sessions: [],
    // The workspace is being left; the next list is not loaded, not empty.
    sessionsLoad: "unloaded",
    commandLedger: [],
    startingSessionCount: 0,
    treeDialog: undefined,
    selectedTerminalId: undefined,
    // The error triple stays: a reader-retired failure (a failed delete, an
    // unknown state) is the record of something the reader acted on, and the
    // owner's call is that switching scope may not silently eat it - the
    // banner is the notification, and it is still there when they come back.
    // A newer claim replaces it through the normal seam.
  };
}

/**
 * The directory every session request from the composer names: its messages, slash commands,
 * models and extension completions.
 *
 * The session's own directory is the scope; the selected workspace only stands in while the
 * session has none yet. Preferring the workspace sent a session recorded in a subdirectory of the
 * workspace (a project rooted at the home folder listing a session opened in a repository under
 * it) with the workspace's path, where the machine could not find it: every message came back
 * "Not sent: Session not found" until a reload happened to select the session's own workspace
 * (owner, 2026-10-14).
 */
export function composerCwd(state: Pick<AppState, "selectedSession" | "selectedWorkspace">): string | undefined {
  const sessionCwd = state.selectedSession?.cwd;
  if (sessionCwd !== undefined && sessionCwd !== "") return sessionCwd;
  const workspacePath = state.selectedWorkspace?.path;
  return workspacePath === undefined || workspacePath === "" ? undefined : workspacePath;
}

export function initialAppState(): AppState {
  return {
    machines: [],
    selectedMachine: undefined,
    machinesLoad: "unloaded",
    machineStatuses: {},
    machineRuntimes: {},
    machineStatusSnapshots: {},
    projects: [],
    workspaces: [],
    sessions: [],
    sessionsLoad: "unloaded",
    messages: [],
    messagePageStart: 0,
    messagePageEnd: 0,
    messagePageTotal: 0,
    transcriptSync: undefined,
    newerPendingCount: 0,
    pageReadEnd: undefined,
    isOpeningSession: false,
    sendingPrompts: {},
    outboxUnanswered: [],
    streamBehind: undefined,
    messageNotes: [],
    commandLedger: [],
    startingSessionCount: 0,
    projectsLoad: "unloaded",
    isLoadingWorkspaces: false,
    selectedProject: undefined,
    selectedWorkspace: undefined,
    selectedSession: undefined,
    sessionTarget: undefined,
    messageStatusUnanswered: undefined,
    transcriptFailed: undefined,
    statusReadFailed: undefined,
    status: undefined,
    activity: undefined,
    pendingDialogs: [],
    settledDialogIds: [],
    availableThinkingLevels: [],
    sessionStatuses: {},
    sessionActivities: {},
    workspacesByProjectId: {},
    workspaceDeletionRuns: {},
    commandDialog: undefined,
    treeDialog: undefined,
    modelDialog: undefined,
    thinkingDialog: undefined,
    themeDialog: undefined,
    authDialog: undefined,
    actionPaletteOpen: false,
    workspaceTool: "core:workspace.files",
    mainView: "chat",
    activeTerminalCount: 0,
    selectedTerminalId: undefined,
    piWebStatus: undefined,
    error: "",
    errorRetiredBy: RetiredBy.reader,
    errorMachineId: "page",
    errorClaim: undefined,
    errorSessionId: undefined,
    noticeTone: "error",
  };
}
