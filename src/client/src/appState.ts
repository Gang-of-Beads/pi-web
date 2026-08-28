import type { AuthProviderOption, CommandOption, CommandResult, ExtensionDialogAnswer, ExtensionDialogCloseReason, FileContentResponse, FileTreeEntry, GoalRecordSummary, Machine, MachineHealth, MachineRuntime, OAuthFlowState, PendingAskUser, PendingExtensionDialog, PiWebSelfUpdateStatus, PiWebStatusResponse, Project, QueuedSessionMessage, SessionActivity, SessionInfo, SessionModelCatalogEntry, SessionStatus, SessionBackgroundTaskInfo, SessionSubagentInfo, SessionSubagentRunInfo, SessionTreeSnapshot, TerminalCommandRun, Workspace } from "./api";import type { ChatLine } from "./components/shared";
import { normalizeMessages } from "./chatMessages";
import { RetiredBy } from "./notice";
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
  messages: ChatLine[];
  messagePageStart: number;
  messagePageEnd: number;
  messagePageTotal: number;
  isLoadingEarlierMessages: boolean;
  /** Sessions with a prompt upload in flight, keyed by sessionId (client-owned). */
  sendingPrompts: Record<string, true>;
  /** Client-side queued sends waiting for a just-created backend session, keyed by sessionId. */
  clientQueuedSessionMessages: Record<string, QueuedSessionMessage[]>;
  /** Client-initiated session creation requests waiting for the server. */
  startingSessionCount: number;
  isLoadingProjects: boolean;
  isLoadingWorkspaces: boolean;
  selectedProject: Project | undefined;
  selectedWorkspace: Workspace | undefined;
  selectedSession: SessionInfo | undefined;
  /** Subagents (child sessions) of the selected session, most urgent first. */
  subagents: readonly SessionSubagentInfo[];
  backgroundTasks: readonly SessionBackgroundTaskInfo[];
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
  /** Thinking levels available for the selected session's current model. */
  availableThinkingLevels: readonly string[];
  /** Goals recorded for the selected workspace, newest unfinished first. */
  workspaceGoals: GoalRecordSummary[];
  workspaceGoalsLoading: boolean;
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

export type WorkspaceScopedStateReset = Pick<AppState,
  | "sessions"
  | "workspaceGoals"
  | "workspaceGoalsLoading"
  | "clientQueuedSessionMessages"
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

export function resetWorkspaceScopedState(): WorkspaceScopedStateReset {
  return {
    sessions: [],
    // Goals belong to the workspace being left, so they must not linger over
    // the next one while its own records load.
    workspaceGoals: [],
    workspaceGoalsLoading: false,
    clientQueuedSessionMessages: {},
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
    messages: [],
    messagePageStart: 0,
    messagePageEnd: 0,
    messagePageTotal: 0,
    isLoadingEarlierMessages: false,
    sendingPrompts: {},
    clientQueuedSessionMessages: {},
    startingSessionCount: 0,
    isLoadingProjects: false,
    isLoadingWorkspaces: false,
    selectedProject: undefined,
    selectedWorkspace: undefined,
    selectedSession: undefined,
    subagents: [],
    backgroundTasks: [],
    subagentRuns: [],
    activityOutput: undefined,
    activityConversation: undefined,
    status: undefined,
    activity: undefined,
    pendingAsk: undefined,
    pendingDialogs: [],
    closedDialogs: [],
    availableThinkingLevels: [],
    workspaceGoals: [],
    workspaceGoalsLoading: false,
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
