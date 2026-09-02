import type { AuthProviderOption, CommandOption, CommandResult, ExtensionDialogAnswer, ExtensionDialogCloseReason, FileContentResponse, FileTreeEntry, GoalRecordSummary, Machine, MachineHealth, MachineRuntime, OAuthFlowState, PendingAskUser, PendingExtensionDialog, PiWebSelfUpdateStatus, PiWebStatusResponse, Project, QueuedSessionMessage, SessionActivity, SessionInfo, SessionModelCatalogEntry, SessionStatus, SessionBackgroundTaskInfo, SessionSubagentInfo, SessionSubagentRunInfo, SessionTreeSnapshot, TerminalCommandRun, Workspace } from "./api";import type { ChatLine } from "./components/shared";
import { normalizeMessages } from "./chatMessages";
import type { CommandLedgerEntry } from "./commandLedger";
import { RetiredBy } from "./notice";
import { machineWorkspaceKey } from "./machineKeys";
import { selectedMachineId } from "./controllers/types";
import type { MachineStatusSnapshot } from "../../shared/machineStatus";
import type { QualifiedContributionId } from "./plugins/ids";
import type { SelectedSessionNotificationInbox } from "./sessionNotifications";
import type { WorkspaceUploadBatchState } from "./workspaceUploadState";

export interface ActivityOutputView {
  readonly title: string;
  readonly text: string;
  readonly empty: boolean;
}

export function activityOutputView(title: string, text: string): ActivityOutputView {
  return { title, text, empty: text.trim() === "" };
}

/**
 * One subagent run's conversation, opened from its activity row.
 *
 * It carries the reason it is read-only rather than leaving the absence to be
 * guessed at: a reader who can watch a child working will look for a way to
 * steer it, and a missing control with no explanation reads as an unfinished
 * feature instead of a boundary. Steering, resuming and interrupting travel
 * over the subagent extension's RPC on the in-process Pi event bus, which this
 * server does not hold.
 */
export interface ActivityConversationView {
  readonly title: string;
  readonly subtitle: string;
  /**
   * Normalized here rather than in the view, so a child's turns travel as the
   * same `ChatLine` the transcript is built from and reach the same renderer.
   */
  readonly messages: readonly ChatLine[];
  readonly total: number;
  readonly empty: boolean;
  /** Why this conversation cannot be joined, shown with it. */
  readonly interventionUnavailable: string;
}

export const SUBAGENT_INTERVENTION_UNAVAILABLE = "Steering this run is not available from the web app.";

export function subagentRunConversationView(
  run: { runId: string; agent: string; status: string },
  page: { messages: readonly unknown[]; total: number },
): ActivityConversationView {
  // The same normalization the transcript store applies to a session's own
  // page. A fork-context child's event log has already been adapted into this
  // shape server-side, so both kinds of child arrive here identical.
  const messages = normalizeMessages([...page.messages]);
  return {
    title: `${run.agent} · ${run.runId.slice(0, 8)}`,
    subtitle: `Child run of this session · ${run.status}`,
    messages,
    total: page.total,
    empty: messages.length === 0,
    interventionUnavailable: SUBAGENT_INTERVENTION_UNAVAILABLE,
  };
}

export interface AppState {
  machines: Machine[];
  selectedMachine: Machine | undefined;
  isLoadingMachines: boolean;
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
  /** The latest activity read for the selected session failed. Empty arrays
   * cannot distinguish a failed read from a completed one that found nothing,
   * and the panel must not answer a failure with a claim of absence. */
  activityFailed: boolean;
  /** Subagent-tool runs for the selected session; see server/sessions/subagentRuns.ts. */
  subagentRuns: readonly SessionSubagentRunInfo[];
  /** Kept out of `messages`: a log is a file, not something the agent said. */
  activityOutput: ActivityOutputView | undefined;
  /** A child run's conversation, opened from its activity row. */
  activityConversation: ActivityConversationView | undefined;
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
  /** Goals recorded for the selected workspace, newest unfinished first,
   * carried with the selection they were read for: the panel's empty claim is
   * only reachable through a completed read that answers for the workspace on
   * screen, never through a retained list keyed elsewhere or a read that never
   * happened. */
  workspaceGoalsLoad: PanelLoad<GoalRecordSummary[]>;
  sessionStatuses: Record<string, SessionStatus>;
  sessionActivities: Record<string, SessionActivity>;
  /** Authoritative projection plus browser-local optimistic overlays for the selected inbox. */
  selectedNotificationInbox: SelectedSessionNotificationInbox | undefined;
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
  projectDialogOpen: boolean;
  machineDialogOpen: boolean;
  workspaceTool: QualifiedContributionId;
  mainView: "navigation" | "chat" | QualifiedContributionId;
  fileTree: FileTreeEntry[];
  expandedDirs: Record<string, FileTreeEntry[]>;
  selectedFilePath: string | undefined;
  selectedFileContent: FileContentResponse | undefined;
  selectedFileLoadError: string | undefined;
  fileTreeStale: boolean;
  /** Manual workspace file upload batches, keyed by client-owned batch id. */
  workspaceUploadBatches: Record<string, WorkspaceUploadBatchState>;
  activeTerminalCount: number;
  selectedTerminalId: string | undefined;
  piWebStatus: PiWebStatusResponse | undefined;
  error: string;
  /** What retires the error notice; see notice.ts. */
  errorRetiredBy: RetiredBy;
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

/**
 * What a panel knows about its own data: one of four named states, carried
 * with the selection key the data was read for. An empty array by itself is
 * "not read yet", "the read failed", and "someone else's rows" just as often
 * as it is "genuinely empty", and a panel that derives its empty claim from
 * the shape of the data will render all four as "genuinely empty" - which is
 * how the goals panel told the owner his active goal did not exist.
 */
export interface PanelLoad<T> {
  state: "unloaded" | "loading" | "loaded" | "failed";
  /** The selection the data was read, or is being read, for. */
  key: string | undefined;
  data: T;
}

export type WorkspaceScopedStateReset = Pick<AppState,
  | "sessions"
  | "sessionsLoad"
  | "workspaceGoalsLoad"
  | "clientQueuedSessionMessages"
  | "commandLedger"
  | "startingSessionCount"
  | "selectedNotificationInbox"
  | "treeDialog"
  | "fileTree"
  | "expandedDirs"
  | "selectedFilePath"
  | "selectedFileContent"
  | "selectedFileLoadError"
  | "fileTreeStale"
  | "selectedTerminalId"
  | "error"
>;

/**
 * The selection key the workspace-scoped surfaces answer for, as
 * machine:project:workspace — the same shape the retained goals state is
 * keyed by.
 */
export function workspaceSelectionKey(state: Pick<AppState, "selectedMachine" | "selectedWorkspace">): string | undefined {
  const workspace = state.selectedWorkspace;
  if (workspace === undefined) return undefined;
  return machineWorkspaceKey(selectedMachineId(state), workspace.projectId, workspace.id);
}

/**
 * The goals load for the current selection. The retained slot is handed
 * through only when it was fetched for exactly this machine+project+workspace;
 * on any other selection it would be another project's goal with live Resume
 * and Abandon buttons, so it reads as "nothing loaded yet" for this selection —
 * which is a different thing from a read that completed and found nothing.
 */
export function goalsForSelectedWorkspace(state: AppState): PanelLoad<GoalRecordSummary[]> {
  const key = workspaceSelectionKey(state);
  const slot = state.workspaceGoalsLoad;
  if (slot.key !== undefined && slot.key === key) return slot;
  return { state: "unloaded", key, data: [] };
}

/**
 * Whether acting on the rendered goals (Resume, Abandon) is allowed: only
 * when the goals state answers for the current selection. Defense in depth
 * behind the render gate above — a stale render must be inert, not merely
 * unlikely.
 */
export function canActOnWorkspaceGoals(state: AppState): boolean {
  const key = workspaceSelectionKey(state);
  return state.workspaceGoalsLoad.key !== undefined && state.workspaceGoalsLoad.key === key;
}

export function resetWorkspaceScopedState(): WorkspaceScopedStateReset {
  return {
    sessions: [],
    // The workspace is being left; the next list is not loaded, not empty.
    sessionsLoad: "unloaded",
    // Goals belong to the workspace being left, so they must not linger over
    // the next one while its own records load. The key goes with them: an
    // unkeyed list would be retained by nothing and owned by no one.
    workspaceGoalsLoad: { state: "unloaded", key: undefined, data: [] },
    clientQueuedSessionMessages: {},
    commandLedger: [],
    startingSessionCount: 0,
    selectedNotificationInbox: undefined,
    treeDialog: undefined,
    fileTree: [],
    expandedDirs: {},
    selectedFilePath: undefined,
    selectedFileContent: undefined,
    selectedFileLoadError: undefined,
    fileTreeStale: false,
    selectedTerminalId: undefined,
    error: "",
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
    activityFailed: false,
    subagentRuns: [],
    activityOutput: undefined,
    activityConversation: undefined,
    status: undefined,
    activity: undefined,
    pendingAsk: undefined,
    pendingDialogs: [],
    closedDialogs: [],
    dismissedDialogIds: [],
    availableThinkingLevels: [],
    workspaceGoalsLoad: { state: "unloaded", key: undefined, data: [] },
    sessionStatuses: {},
    sessionActivities: {},
    selectedNotificationInbox: undefined,
    workspacesByProjectId: {},
    workspaceDeletionRuns: {},
    commandDialog: undefined,
    treeDialog: undefined,
    modelDialog: undefined,
    thinkingDialog: undefined,
    themeDialog: undefined,
    authDialog: undefined,
    actionPaletteOpen: false,
    projectDialogOpen: false,
    machineDialogOpen: false,
    workspaceTool: "core:workspace.files",
    mainView: "chat",
    fileTree: [],
    expandedDirs: {},
    selectedFilePath: undefined,
    selectedFileContent: undefined,
    selectedFileLoadError: undefined,
    fileTreeStale: false,
    workspaceUploadBatches: {},
    activeTerminalCount: 0,
    selectedTerminalId: undefined,
    piWebStatus: undefined,
    error: "",
    errorRetiredBy: RetiredBy.reader,
  };
}
