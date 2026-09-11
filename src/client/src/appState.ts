import type { AuthProviderOption, CommandOption, CommandResult, ExtensionDialogAnswer, ExtensionDialogCloseReason, Machine, MachineHealth, MachineRuntime, OAuthFlowState, PendingAskUser, PendingExtensionDialog, PiWebSelfUpdateStatus, PiWebStatusResponse, Project, QueuedSessionMessage, SessionActivity, SessionInfo, SessionModelCatalogEntry, SessionStatus, SessionBackgroundTaskInfo, SessionSubagentInfo, SessionSubagentRunInfo, SessionTreeSnapshot, TerminalCommandRun, Workspace } from "./api";
import type { ChatLine } from "./components/shared";
import type { CommandLedgerEntry } from "./commandLedger";
import { RetiredBy } from "./notice";
import type { MachineStatusSnapshot } from "../../shared/machineStatus";
import type { QualifiedContributionId } from "./plugins/ids";

export interface AppState {
  machines: Machine[];
  selectedMachine: Machine | undefined;
  isLoadingMachines: boolean;
  /** Four-state load discipline threaded from the machines roster; see MachineController.loadMachines. */
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
  isLoadingEarlierMessages: boolean;
  /** True while the selected session's transcript is being read for the first time. */
  isLoadingTranscript: boolean;
  /** Sessions with a prompt upload in flight, keyed by sessionId (client-owned). */
  sendingPrompts: Record<string, true>;
  /** Client-side queued sends waiting for a just-created backend session, keyed by sessionId. */
  clientQueuedSessionMessages: Record<string, QueuedSessionMessage[]>;
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
  /** Subagents (child sessions) of the selected session, most urgent first. */
  subagents: readonly SessionSubagentInfo[];
  backgroundTasks: readonly SessionBackgroundTaskInfo[];
  /**
   * The selected session's transcript read failed, with the daemon's own words.
   * An empty transcript after a failed read must render this, never the empty
   * claim: a session whose working directory is gone reads identically to a
   * fresh one otherwise, and the empty state invites writing into it.
   */
  transcriptFailed: string | undefined;
  /** Subagent-tool runs for the selected session; see server/sessions/subagentRuns.ts. */
  subagentRuns: readonly SessionSubagentRunInfo[];
  status: SessionStatus | undefined;
  activity: SessionActivity | undefined;
  /**
   * The selected session's open `ask_user` question set, derived from the
   * daemon-owned {@link SessionStatus.pendingAsk} plus live ask events.
   */
  pendingAsk: PendingAskUser | undefined;
  /**
   * The selected session's open extension dialogs, derived from the
   * daemon-owned {@link SessionStatus.pendingDialogs} plus live dialog events.
   * Oldest first; unlike an ask, opening never supersedes, so several dialogs
   * may wait at once.
   */
  pendingDialogs: PendingExtensionDialog[];
  /**
   * Dialogs that closed while their session was selected, kept with the close
   * reason and any answer so the settled card can show what became of the
   * dialog. The card stays until the user dismisses it. The wire outcome is
   * deliberately small, so only a browser that saw the dialog open can show
   * the closed card; deselection and reloads drop these.
   */
  closedDialogs: ClosedExtensionDialog[];
  /**
   * Dialog ids the reader dismissed from the settled-card list. A dismissal has
   * to be remembered rather than merely applied: the daemon's status projection
   * is unordered against socket frames, so a snapshot taken before the close can
   * land after it and re-open a dialog this browser already settled. Without the
   * memory the re-open records a second outcome card and the reader has to tap
   * Dismiss again. Bounded by and cleared with `closedDialogs`, whose ids these
   * are: both describe the selected session's settled cards and nothing outlives
   * that selection.
   */
  dismissedDialogIds: readonly string[];
  /** Thinking levels available for the selected session's current model. */
  availableThinkingLevels: readonly string[];
  /** Statuses keyed by session id, carried with the machine they were read
   * from: a stale entry answers for a session this machine may no longer
   * have, so machine switches clear the map instead of retaining it. */
  sessionStatuses: Record<string, SessionStatus>;
  sessionActivities: Record<string, SessionActivity>;
  /** Self-update check result for this host; undefined means not checked yet. */
  selfUpdate: PiWebSelfUpdateStatus | undefined;
  /** True while the Update now flow is applying and the page will reconnect. */
  selfUpdateApplying: boolean;
  workspacesByProjectId: Record<string, Workspace[]>;
  workspaceDeletionRuns: Record<string, TerminalCommandRun>;
  commandDialog: Extract<CommandResult, { type: "select" }> | undefined;
  treeDialog: SessionTreeSnapshot | undefined;
  modelDialog: { title: string; options: CommandOption[]; catalog: SessionModelCatalogEntry[]; selectedValue?: string } | undefined;
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
}

/** A closed extension dialog paired with the record the browser rendered while it was open. */
export interface ClosedExtensionDialog {
  dialog: PendingExtensionDialog;
  reason: ExtensionDialogCloseReason;
  /** Present only when `reason` is `"answered"`. */
  answer?: ExtensionDialogAnswer;
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
 * Whether the projects listing has completed, and how it ended. `failed` is
 * deliberately sticky until a later load succeeds: a silent recovery is how a
 * missing project list read as "no projects".
 */

export type ProjectsLoadState = "unloaded" | "loading" | "loaded" | "failed";

/** Four-state load discipline for the machines roster; mirrors ProjectsLoadState. */
export type MachinesLoadState = "unloaded" | "loading" | "loaded" | "failed";

export type WorkspaceScopedStateReset = Pick<AppState,
  | "sessions"
  | "sessionsLoad"
  | "clientQueuedSessionMessages"
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
    // Goals belong to the workspace being left, so they must not linger over
    // the next one while its own records load. The key goes with them: an
    // unkeyed list would be retained by nothing and owned by no one.
    clientQueuedSessionMessages: {},
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
 * The directory the composer resolves slash commands against.
 *
 * The selected workspace is the refinement; the session being composed into
 * is the source of truth. Reading only the workspace handed the editor an
 * empty cwd whenever the workspace had not resolved yet — a session opened
 * before its workspace listing landed, a route restored session-first — and
 * the command lookup is guarded on a non-empty cwd, so typing "/" quietly
 * offered nothing while the rest of the composer kept working.
 */
export function composerCwd(state: Pick<AppState, "selectedSession" | "selectedWorkspace">): string | undefined {
  const workspacePath = state.selectedWorkspace?.path;
  if (workspacePath !== undefined && workspacePath !== "") return workspacePath;
  const sessionCwd = state.selectedSession?.cwd;
  return sessionCwd === undefined || sessionCwd === "" ? undefined : sessionCwd;
}

export function initialAppState(): AppState {
  return {
    machines: [],
    selfUpdate: undefined,
    selfUpdateApplying: false,
    selectedMachine: undefined,
    isLoadingMachines: false,
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
    newerPendingCount: 0,
    isLoadingEarlierMessages: false,
    isLoadingTranscript: false,
    sendingPrompts: {},
    clientQueuedSessionMessages: {},
    commandLedger: [],
    startingSessionCount: 0,
    projectsLoad: "unloaded",
    isLoadingWorkspaces: false,
    selectedProject: undefined,
    selectedWorkspace: undefined,
    selectedSession: undefined,
    subagents: [],
    backgroundTasks: [],
    transcriptFailed: undefined,
    subagentRuns: [],
    status: undefined,
    activity: undefined,
    pendingAsk: undefined,
    pendingDialogs: [],
    closedDialogs: [],
    dismissedDialogIds: [],
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
    workspaceTool: "files:files",
    mainView: "chat",
    activeTerminalCount: 0,
    selectedTerminalId: undefined,
    piWebStatus: undefined,
    error: "",
    errorRetiredBy: RetiredBy.reader,
    errorMachineId: "page",
  };
}
