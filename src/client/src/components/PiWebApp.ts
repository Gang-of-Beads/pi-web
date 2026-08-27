import { LitElement, html, type TemplateResult } from "lit";
import { clearPlaceholderFrame, notePlaceholderFrame } from "../historyWrites";
import { bannerHoldDecision } from "./bannerHold";
import { routeMatchesUrl } from "../routeMatch";
import { autoFocusesComposer } from "../appShell/appShellController";
import { touchPrimaryPointer } from "../keyboardDismissal";
import { customElement, query, state } from "lit/decorators.js";
import { configApi, effectiveWorkspaceUploadFolder, fleetApi, projectsApi, selfUpdateApi, sessionsApi, terminalsApi, workspacesApi, workspaceEffectiveUploadFolder, type AskUserSubmission, type CommandOption, type ExtensionDialogAnswer, type Machine, type MachineHealth, type PiWebConfigValues, type PiWebShortcutConfig, type Project, type SessionCleanupExecuteResponse, type SessionCleanupPreviewResponse, type SessionCleanupRequest, type SessionInfo, type SessionModel,
  type QueuedSessionMessage, type SessionBackgroundTaskInfo, type SessionSubagentInfo, type SessionSubagentRunInfo, type SessionTreeForkResult, type SessionTreeNavigateResult, type SessionTreeSummaryChoice, type TerminalCommandRun, type TerminalUiEvent, type Workspace } from "../api";
import type { GoalRecordSummary, PiWebFleetReport, PiWebFleetRunResponse } from "../../../shared/apiTypes";import type { AppAction } from "../actions";
import { initialAppState, type AppState } from "../appState";
import { isSessionActive } from "../../../shared/activity";
import type { SessionStateBadgeKind } from "./activityBadge";
import { PI_WEB_CAPABILITIES, supportsPiWebCapability } from "../../../shared/capabilities";
import { machineScopedPluginId } from "../../../shared/machinePluginIds";
import { AuthController } from "../controllers/authController";
import { FileExplorerController } from "../controllers/fileExplorerController";
import { MachineController } from "../controllers/machineController";
import { MachineStatusController } from "../controllers/machineStatusController";
import { ProjectController, type ProjectTrustChoice } from "../controllers/projectController";
import { PiWebStatusController } from "../controllers/piWebStatusController";
import { SessionController } from "../controllers/sessionController";
import { SessionNotificationController } from "../controllers/sessionNotificationController";
import { WorkspaceController } from "../controllers/workspaceController";
import { emptyMachineNavigationSnapshot, machineNavigationSnapshotFromState, routeFromMachineNavigationSnapshot, SessionStorageMachineNavigationMemory, type MachineNavigationSnapshot, type WorkspaceRouteSurface } from "../controllers/machineNavigationMemory";
import { SessionStorageSessionSelectionMemory } from "../controllers/sessionSelection";
import { SessionStorageTerminalSelectionMemory } from "../controllers/terminalSelection";
import { SessionStorageWorkspaceSelectionMemory } from "../controllers/workspaceSelection";
import { KeyboardShortcutDispatcher } from "../keyboardShortcuts";
import { selectedMachineId } from "../controllers/types";
import type { RecoveredPrompt } from "../resendMessage";
import { keyboardInset } from "../appShell/keyboardInset";
import { machineSessionKey } from "../machineKeys";
import { composedPathOf, composerCollapsedForFocus } from "../composerCollapse";
import { shouldPollSessionActivity } from "../sessionActivityPolling";
import { isWaitingForUser } from "../sessionWaiting";
import { sessionCleanupRequestKey } from "../sessionCleanupUi";
import { selectedNotificationView } from "../sessionNotifications";
import { SessionUnreadController } from "../sessionUnread";
import { initialSessionWarningVisibilityState, reconcileSessionWarningVisibility, toggleSessionWarnings } from "../sessionWarningVisibility";
import { RealtimeSocket, type BrowserRealtimeEvent } from "../sessionSocket";
import type { PluginMachine, PluginPromptEditor, QualifiedContributionId, QualifiedThemeContribution, QualifiedThemePairContribution, QualifiedWorkspacePanelContribution, PluginRuntimeContext, TerminalCommandRunsInternalRuntime, WorkspaceFiles, WorkspaceHost, WorkspaceLabelContext, WorkspaceLabelItem, WorkspacePanelContext, WorkspacePluginBinding } from "../plugins/types";
import { CLASSIC_THEME_ID, DEFAULT_THEME_PREFERENCE, applyPiWebTheme, findThemePairForTheme, readStoredThemePreference, resolveThemePreference, writeStoredThemePreference, type ThemePreference, type ThemePreferenceResolution } from "../theme";
import { DEFAULT_UI_SCALE, applyUiScale, clampUiScale, readStoredUiScale, writeStoredUiScale } from "../uiScale";
import { corePlugin } from "../plugins/core";
import { themePackPlugin } from "../plugins/themes";
import { loadExternalPlugins, type ExternalPluginLoadResult } from "../plugins/external";
import { PluginRegistry, installPluginRuntimeScope, installWorkspaceLabelScope, installWorkspacePanelScope } from "../plugins/registry";
import { createPluginWorkspaceBackend } from "../plugins/workspaceBackend";
import { createWorkspaceFiles as createPluginWorkspaceFiles } from "../plugins/workspaceFiles";
import { queryNamespace, readNamespacedString, setNamespacedQueryKey } from "../namespacedQueryArgs";
import { AppShellController } from "../appShell/appShellController";
import { BrowserResumeController } from "../appShell/browserResumeController";
import { NavigationSectionsController, type NavigationSection } from "../appShell/navigationState";
import { PanelCollapseController, mainViewClass } from "../appShell/panelCollapseController";
import { PanelResizeController, type PanelResizeConstraints, type ResizablePanelSide } from "../appShell/panelResizeController";
import { readRoute, resolveAppRoute, resolveWorkspacePanelRouteValue, writeRoute, type AppRoute, type ParsedAppRoute } from "../route";
import { readSettingsSection, writeSettingsSection, type SettingsSection } from "../settingsRoute";
import { applyActiveShortcutPreferences } from "../shortcutPreferences";
import { createTerminalCommandRunsRuntime } from "../runtime/terminalRuntime";
import { canDeleteWorkspace, isWorkspaceDeletionPending, isWorkspaceDeletionRunPending, latestWorkspaceDeletionRuns, pendingWorkspaceDeletionIds, targetWorkspaceIdForRun, workspaceDeletionRunFilter, workspaceRemovalConfirmation } from "../workspaceDeletion";
import "./MachineList";
import "./ProjectList";
import "./WorkspaceList";
import { unreadSessionCount } from "./SessionList";
import "./SessionCleanupDialog";
import "./SessionTreeNavigator";
import "./ChatView";
import type { ChatView } from "./ChatView";
import "./PromptEditor";
import type { PromptEditor } from "./PromptEditor";
import "./StatusBar";
import "./CommandPicker";
import "./ModelPicker";
import "./ActionPalette";
import "./QuickSwitcher";
import "./AuthDialog";
import "./ProjectDialog";
import "./MachineDialog";
import type { MachineDialogSubmit } from "./MachineDialog";
import { hasRenderedModal } from "./modalLayerRegistry";
import "./SettingsDialog";
import "./WorkspacePanel";
import type { WorkspacePanelEmptyState } from "./WorkspacePanel";
import "./appShell/AppContextBar";
import type { AppMobileView } from "./appShell/AppMobileToolSheet";
import "./appShell/AppMobileToolSheet";
import { shouldShowMachinesSection, type AppNavigationPanel, type NavigationFocusTarget } from "./appShell/AppNavigationPanel";
import "./appShell/AppPanelEdgeControl";
import "./appShell/AppRefreshControl";
import { quickSwitcherSessionStates, renameSessionInList } from "../quickSwitcher";
import { readPinnedSessionIds, togglePinnedSessionId, writePinnedSessionIds } from "../sessionPins";
import { observeTransportRecovery } from "../api/transportHealth";
import { dismissKeyboardIfRaised } from "../keyboardDismissal";
import { errorBanner, isTransientError, TRANSIENT_ERROR_TIMEOUT_MS } from "./errorBanner";
import { deprecatedAgentInputsBanner, deprecatedAgentInputsWarnings } from "./deprecatedAgentInputsBanner";
import { appStyles } from "./shared";
import { documentTitleFor } from "../contextName";


const PI_WEB_STATUS_REFRESH_MS = 15 * 60 * 1000;
/**
 * How often the open session re-reads its subagents, tool runs and background
 * tasks. Fast enough that a child spawned mid-conversation shows up while the
 * reader is still looking at the answer that announced it, cheap enough to run
 * for as long as the tab is in front.
 */
const SUBAGENT_REFRESH_MS = 4000;
/**
 * How often an open tab checks that its sockets are still alive.
 *
 * A socket dropped by a proxy, a NAT table, or a tunnel that blinked stays
 * OPEN in the browser and fires no close event, so nothing arrives and nothing
 * complains: the page simply stops updating until it is reloaded. Resuming the
 * tab already triggers this check, which left the case nobody thought about -
 * the tab that never went away. The check itself is a comparison against the
 * last frame's timestamp; the socket's own 50s staleness window decides.
 */
const SOCKET_LIVENESS_CHECK_MS = 15_000;

interface FocusEventTargetLike {
  addEventListener(type: string, listener: (event: FocusEvent) => void): void;
  removeEventListener(type: string, listener: (event: FocusEvent) => void): void;
}

function isEventTargetLike(value: unknown): value is FocusEventTargetLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate: { addEventListener?: unknown; removeEventListener?: unknown } = value;
  return typeof candidate.addEventListener === "function" && typeof candidate.removeEventListener === "function";
}
const PI_WEB_STATUS_DEFER_MS = 750;
const REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 15_000, 30_000] as const;
const GLOBAL_SHORTCUT_LISTENER_OPTIONS = { capture: true } as const;
const THEME_AUTO_ON_VALUE = "auto:on";
const THEME_AUTO_OFF_VALUE = "auto:off";
const THEME_OPTION_PREFIX = "theme:";
const FILES_ROUTE_NAMESPACE = queryNamespace("core:workspace.files");
const TERMINAL_ROUTE_NAMESPACE = queryNamespace("core:workspace.terminal");
const MIN_RESIZABLE_CHAT_WIDTH_PX = 320;
const PANEL_EDGE_COLUMNS_WIDTH_PX = 2;
const DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY = "(min-width: 1181px)";

interface SessionCleanupDialogState {
  preview?: SessionCleanupPreviewResponse | undefined;
  previewRequest?: SessionCleanupRequest | undefined;
  result?: SessionCleanupExecuteResponse | undefined;
  loading?: boolean | undefined;
  running?: boolean | undefined;
  error?: string | undefined;
}

@customElement("pi-web-app")
export class PiWebApp extends LitElement {
  @state() private state: AppState = initialAppState();
  @query("chat-view") private chatView?: ChatView;
  @query("prompt-editor") private promptEditor?: PromptEditor;
  @query("app-navigation-panel") private navigationPanel?: AppNavigationPanel;
  @query("#navigation-panel") private navigationPanelFrame?: HTMLElement;
  @query("#workspace-panel") private workspacePanelFrame?: HTMLElement;

  private readonly sessionUnread = new SessionUnreadController({
    onChange: (machineId) => {
      if (selectedMachineId(this.state) !== machineId) return;
      this.syncUnreadSessionIds();
      this.syncSelectedSessionReadState();
    },
    onBackgroundError: (operation, machineId, error) => {
      console.warn(`Failed to ${operation} session unread state for ${machineId}`, error);
    },
  });
  @state() private interruptedSessionIds: ReadonlySet<string> = new Set();
  @state() private unreadSessionIds: ReadonlySet<string> = this.sessionUnread.unreadSessionIds(selectedMachineId(this.state), this.state.sessions);
  private unreadConnected = false;
  private committedChatIdentity: string | undefined;
  private readyChatIdentity: string | undefined;

  private readonly notifications = new SessionNotificationController(
    () => this.state,
    (patch) => { this.setState(patch); },
    { onBackgroundError: (message, error) => { console.warn(message, error); } },
  );
  private readonly sessions = new SessionController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    new SessionStorageSessionSelectionMemory(),
    {
      notifications: this.notifications,
      // A finished turn may have changed the goal file (/goal-tweak,
      // /goal-resume, a completed task), and nothing else tells this browser:
      // the panel showed PAUSED 9/10 for a goal that was active.
      onSelectedSessionIdle: () => { void this.workspaces.refreshWorkspaceGoals(); },
      onSelectedSessionReady: ({ machineId, session }) => {
        void this.commitReadyChatAfterRender(machineId, session);
        void this.refreshSelfUpdate();
      },
      replacePromptEditorText: async ({ machineId, sessionId, text }) => {
        await this.updateComplete;
        if (selectedMachineId(this.state) !== machineId || this.state.selectedSession?.id !== sessionId) return;
        this.promptEditor?.replaceText(text);
      },
    },
  );
  private readonly machineStatus = new MachineStatusController(
    () => this.state,
    (patch) => { this.setState(patch); },
  );
  private readonly auth = new AuthController(
    () => this.state,
    (patch) => { this.setState(patch); },
    (status) => { this.sessions.applySessionStatus(status); },
  );
  private readonly workspaces = new WorkspaceController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    this.sessions,
    new SessionStorageWorkspaceSelectionMemory(),
  );
  private readonly projects = new ProjectController(
    () => this.state,
    (patch) => { this.setState(patch); },
    this.workspaces,
  );
  private readonly machines = new MachineController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    this.projects,
  );
  private readonly piWebStatusController = new PiWebStatusController(
    () => this.state,
    (patch) => { this.setState(patch); },
    { onRefreshError: (machineId, error) => { console.warn(`Failed to refresh PI WEB status for ${machineId}`, error); } },
  );
  private readonly files = new FileExplorerController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
  );
  private readonly keyboard = new KeyboardShortcutDispatcher();
  private readonly realtime = new RealtimeSocket();
  private readonly machineRealtimeSockets = new Map<string, RealtimeSocket>();
  private readonly activeTerminalIds = new Set<string>();
  private readonly machineNavigation = new SessionStorageMachineNavigationMemory();
  private readonly terminalSelection = new SessionStorageTerminalSelectionMemory();
  private readonly appShell = new AppShellController(this);
  private readonly browserResume = new BrowserResumeController({
    onResumeSignal: () => { this.handleBrowserResumeSignal(); },
    refreshAfterResume: () => this.refreshAfterBrowserResume(),
    onRefreshError: (error) => { console.warn("Failed to refresh after browser resume", error); },
  });
  private readonly panelCollapse = new PanelCollapseController(this);
  private readonly panelResize = new PanelResizeController(this);
  private readonly navigationSections = new NavigationSectionsController(this, () => this.state);
  private readonly systemLightThemeMedia = typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia("(prefers-color-scheme: light)") : undefined;
  private terminalAutoStartWorkspaceId: string | undefined;
  private piWebStatusTimer: number | undefined;
  private piWebStatusDeferredTimer: number | undefined;
  private workspaceDeletionPollTimer: number | undefined;
  private subagentPollTimer: number | undefined;
  private livenessTimer: number | undefined;
  private refreshingWorkspaceDeletionRuns = false;
  private readonly handledWorkspaceDeletionRunIds = new Set<string>();
  private readonly terminalCommandRunRuntimes = new Map<string, TerminalCommandRunsInternalRuntime>();
  private machineNavigationRestoreSeq = 0;
  private navigationSelectionSeq = 0;
  private routeRestoreSeq = 0;
  private routeRestoreDepth = 0;
  private restoringRouteTerminalId: string | undefined;
  private pendingRemoteRouteRestore: ParsedAppRoute | undefined;
  private remoteRouteRestoreTimer: number | undefined;
  private remoteRouteRestoreAttempt = 0;
  private remoteRouteRestoreInProgress = false;
  private readonly plugins = createPluginRegistry();
  private readonly loadedMachinePluginIds = new Set<string>();
  private readonly machinePluginLoadPromises = new Map<string, Promise<void>>();
  private gatewayPluginLoadPromise: Promise<void> | undefined;
  private themePreference: ThemePreference = readStoredThemePreference() ?? DEFAULT_THEME_PREFERENCE;
  @state() private uiScale: number = readStoredUiScale() ?? DEFAULT_UI_SCALE;
  @state() private activeThemeId: QualifiedContributionId = CLASSIC_THEME_ID;
  @state() private isRefreshingApp = false;
  private transientErrorTimer: number | undefined;
  private bannerShownAt: number | undefined;
  private bannerHoldTimer: number | undefined;
  private heldErrorBanner: TemplateResult | null = null;
  private lastScheduledError = "";
  @state() private quickSwitcherOpen = false;
  /** True while a question form or dialog field has focus (see composerCollapse). */
  @state() private composerCollapsed = false;
  @state() private mobileToolSheetOpen = false;
  @state() private quickSwitcherLoading = false;
  @state() private quickSwitcherSessions: readonly SessionInfo[] = [];
  @state() private pinnedSessionIds: ReadonlySet<string> = readPinnedSessionIds();
  @state() private quickSwitcherWorkspaces: readonly Workspace[] = [];
  private quickSwitcherMachineId: string | undefined;
  @state() private sessionCleanupDialog: SessionCleanupDialogState | undefined;
  @state() private settingsSection: SettingsSection | undefined = readSettingsSection();
  @state() private fleetReport: PiWebFleetReport | undefined;
  @state() private fleetLoading = false;
  @state() private fleetError: string | undefined;
  private fleetSectionShown = false;
  @state() private shortcutConfig: PiWebShortcutConfig = {};
  @state() private workspaceUploadDefaultFolder = effectiveWorkspaceUploadFolder(undefined);
  @state() private speechToTextConfig: PiWebConfigValues["speechToText"];
  private sessionWarningVisibility = initialSessionWarningVisibilityState();
  private readonly onPopState = () => {
    if (this.modalLayerOpen()) {
      // The back gesture pops the placeholder frame we pushed when the layer
      // opened: consume it by closing the layer, never by moving the route.
      clearPlaceholderFrame();
      this.closeModalLayer();
      return;
    }
    // A placeholder frame from a layer that was closed by its own cancel is
    // still on the stack; its URL equals the current state, so there is
    // nothing to restore. Only a real navigation (URL changed) restores.
    if (this.currentRouteMatchesUrl()) return;
    void this.withChatScrollTransition(async () => {
      this.restoreSettingsRoute();
      await this.restoreRoute(false);
    });
  };

  /**
   * The route lives in the URL; the state traces it. When the two agree, the
   * popped frame was a placeholder for a layer that has since closed normally,
   * so the back gesture has nothing left to do.
   */
  private currentRouteMatchesUrl(): boolean {
    const state = this.state;
    const url = new URL(window.location.href);
    const param = (key: string): string | undefined => {
      const value = url.searchParams.get(key);
      return value === null || value === "" ? undefined : value;
    };
    // The local machine is the default and is never written to the URL, so an
    // absent machine parameter matches the local machine.
    const machine = state.selectedMachine === undefined ? undefined : state.selectedMachine.id;
    const machineMatches = param("machine") === (machine === "local" ? undefined : machine);
    if (!machineMatches) return false;
    return routeMatchesUrl(
      {
        project: param("project"),
        workspace: param("workspace"),
        session: param("session"),
        view: param("view"),
      },
      {
        project: state.selectedProject?.id,
        workspace: state.selectedWorkspace?.id,
        session: state.selectedSession?.id,
        view: state.mainView,
      },
      this.appShell.defaultRouteView({ sessionId: state.selectedSession?.id }),
    );
  }

  /** Close the topmost modal layer; popstate is the only caller. */
  private closeModalLayer(): void {
    if (this.mobileToolSheetOpen) {
      this.mobileToolSheetOpen = false;
      return;
    }
    if (this.quickSwitcherOpen) {
      this.quickSwitcherOpen = false;
      return;
    }
    const state = this.state;
    if (state.actionPaletteOpen) { this.setState({ actionPaletteOpen: false }); return; }
    if (state.projectDialogOpen) { this.setState({ projectDialogOpen: false }); return; }
    if (state.machineDialogOpen) { this.setState({ machineDialogOpen: false }); return; }
    if (state.commandDialog !== undefined) { this.sessions.cancelCommand(); return; }
    if (state.modelDialog !== undefined) { this.setState({ modelDialog: undefined }); return; }
    if (state.thinkingDialog !== undefined) { this.setState({ thinkingDialog: undefined }); return; }
    if (state.themeDialog !== undefined) { this.setState({ themeDialog: undefined }); return; }
    if (this.sessionCleanupDialog !== undefined) { this.sessionCleanupDialog = undefined; return; }
  }
  private readonly onPageShow = () => {
    void this.sessionUnread.refreshAll();
    this.appShell.repairViewportPosition();
    this.retryPendingRemoteRouteRestoreSoon();
  };

  /** A tab coming back to the front should show current activity at once. */
  /**
   * The OS says the network is back. Retry immediately rather than waiting out
   * a backoff window measured against a network that no longer exists, and let
   * the liveness check retire any socket that only looks alive.
   */
  private readonly onBrowserOnline = () => {
    this.realtime.reconnectNow();
    this.sessions.reconnectSocketNow();
    this.checkSocketLiveness();
  };

  /**
   * Focus moving inside this element's shadow tree is not redispatched to the
   * host, so a listener on the host only ever saw focus arriving from outside
   * the app - which is every case except the one this exists for. The listener
   * belongs on the shadow root, where the retargeted event actually travels.
   */
  private readonly onFocusIn = (event: FocusEvent) => {
    this.composerCollapsed = composerCollapsedForFocus(event.composedPath());
  };

  /**
   * Collapsing is a loan, not a sale: focus leaving the form gives the composer
   * back. `relatedTarget` is where focus is going, so a move within the same
   * form keeps it collapsed.
   */
  /**
   * Subscribe the shadow root to focus movement, where a retargeted focus event
   * actually travels. Tolerates a stand-in render root: node-environment tests
   * install a minimal object with no event API.
   */
  private listenForFormFocus(action: "add" | "remove"): void {
    const root: unknown = this.renderRoot;
    if (!isEventTargetLike(root)) return;
    if (action === "add") {
      root.addEventListener("focusin", this.onFocusIn);
      root.addEventListener("focusout", this.onFocusOut);
      return;
    }
    root.removeEventListener("focusin", this.onFocusIn);
    root.removeEventListener("focusout", this.onFocusOut);
  }

  private readonly onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (next === null) return;
    this.composerCollapsed = composerCollapsedForFocus(composedPathOf(next));
  };

  private readonly onDocumentVisibilityChange = () => {
    this.updateSubagentPolling();
    if (document.visibilityState === "visible") void this.refreshSubagents();
  };
  private readonly onSystemLightThemeChange = () => {
    if (this.themePreference.auto) this.applyPreferredTheme(false);
  };
  private get routeRestoreInProgress(): boolean {
    return this.routeRestoreDepth > 0;
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (this.isRenderedModalOpen()) return;
    if (this.keyboard.handle(event, this.getDefaultActions(), { shortcuts: this.shortcutConfig })) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  protected override willUpdate(): void {
    this.toggleAttribute("pwa-display-mode", this.appShell.isPwaDisplayMode);
    this.syncSessionWarningVisibility();
  }

  protected override updated(): void {
    // Lit has now committed the selected chat and app-shell visibility state.
    // Recheck after every rendered transition; the unread controller
    // deduplicates acknowledgements for the observed completion order.
    this.committedChatIdentity = selectedChatIdentity(this.state);
    this.syncSelectedSessionReadState();
    this.syncFleetOnSettingsSection();
    this.syncDocumentTitle();
  }

  /**
   * The tab says which context is focused. A reader with several PI WEB tabs
   * open cannot tell them apart from the product name they all share.
   */
  private syncDocumentTitle(): void {
    const state = this.state;
    const title = documentTitleFor({
      mainView: state.mainView,
      selectedMachine: state.selectedMachine,
      selectedProject: state.selectedProject,
      selectedWorkspace: state.selectedWorkspace,
      selectedSession: state.selectedSession,
    });
    if (document.title !== title) document.title = title;
  }

  /**
   * Fetch the fleet when the machines panel becomes visible, whatever opened it
   * - a menu action, a URL restore, or in-panel navigation all land here, so
   * the data is not tied to one entry path.
   */
  private syncFleetOnSettingsSection(): void {
    const showing = this.settingsSection === "machines";
    if (showing && !this.fleetSectionShown) void this.refreshFleet();
    this.fleetSectionShown = showing;
  }

  private syncSessionWarningVisibility(): void {
    const session = this.state.selectedSession;
    this.sessionWarningVisibility = reconcileSessionWarningVisibility(
      this.sessionWarningVisibility,
      session === undefined ? undefined : machineSessionKey(selectedMachineId(this.state), session.id),
      this.state.status === undefined ? undefined : this.state.status.warnings ?? [],
    );
  }

  private syncSelectedSessionReadState(): void {
    const session = this.state.selectedSession;
    if (session === undefined) return;
    const machineId = selectedMachineId(this.state);
    if (!this.isSessionSeen(machineId, session)) return;
    void this.sessionUnread.acknowledge(machineId, session);
  }

  private markSessionsRead(sessions: readonly SessionInfo[]): void {
    const machineId = selectedMachineId(this.state);
    for (const session of sessions) void this.sessionUnread.acknowledge(machineId, session);
  }

  private async commitReadyChatAfterRender(machineId: string, session: SessionInfo): Promise<void> {
    const identity = unreadChatIdentity(machineId, session);
    await this.updateComplete;
    if (!this.unreadConnected || selectedChatIdentity(this.state) !== identity) return;
    this.readyChatIdentity = identity;
    this.syncSelectedSessionReadState();
  }

  /**
   * Runs the daemon's last restart cut off. They will not finish on their own,
   * so they are surfaced above work that is merely idle. Reading the record
   * clears it, so this is only worth doing when a connection is established.
   */
  private refreshInterruptedRuns(machineId: string): void {
    void this.sessions.loadInterruptedRuns(machineId).then((ids) => {
      // Adopt the record verbatim, empty or not: the daemon clears the file
      // once it is read, so an empty later read is the retraction of markers
      // the user has already seen -- keeping the old set would leave a session
      // stuck with the hollow interrupted ring long after its run continued.
      this.interruptedSessionIds = ids;
    });
  }

  /**
   * Poll the selected session's activity while its tab is on screen.
   *
   * Fetch-on-select was not enough. The usual way to get a subagent is to ask
   * for one in the session you are already reading, and nothing re-read the
   * list afterwards, so the drawer stayed empty until the reader happened to
   * switch sessions and come back. Polling stops when the document is hidden
   * and when no session is selected, so a backgrounded tab costs nothing.
   */
  private updateSubagentPolling(): void {
    const shouldPoll = shouldPollSessionActivity({
      hasSelectedSession: this.state.selectedSession !== undefined,
      documentVisible: document.visibilityState === "visible",
    });
    if (shouldPoll && this.subagentPollTimer === undefined) {
      this.subagentPollTimer = window.setInterval(() => { void this.refreshSubagents(); }, SUBAGENT_REFRESH_MS);
      return;
    }
    if (!shouldPoll && this.subagentPollTimer !== undefined) {
      window.clearInterval(this.subagentPollTimer);
      this.subagentPollTimer = undefined;
    }
  }

  /** Open a subagent session listed anywhere in the machine. */
  private openSubagent(info: SessionSubagentInfo): void {
    const session = this.quickSwitcherSessions.find((entry) => entry.id === info.sessionId) ??
      this.state.sessions.find((entry) => entry.id === info.sessionId);
    if (session === undefined) return;
    void this.selectNavigationItem("sessions", "chat", () => this.sessions.selectSession(session));
  }

  private async refreshSubagents(): Promise<void> {
    const session = this.state.selectedSession;
    if (session === undefined) return;
    try {
      const machineId = selectedMachineId(this.state);
      // Both reads on the same tick: they refresh together and the strip never
      // shows a half-updated mix of the two.
      const [snapshot, tasks] = await Promise.all([
        sessionsApi.subsessions(session, machineId),
        sessionsApi.backgroundTasks(session, machineId).catch(() => this.state.backgroundTasks),
      ]);
      if (this.state.selectedSession?.id !== session.id || selectedMachineId(this.state) !== machineId) return;
      const subagentsChanged = !sameSubagents(snapshot.subsessions, this.state.subagents);
      const runsChanged = !sameSubagentRuns(snapshot.toolRuns, this.state.subagentRuns);
      const tasksChanged = !sameBackgroundTasks(tasks, this.state.backgroundTasks);
      if (!subagentsChanged && !runsChanged && !tasksChanged) return;
      this.setState({ subagents: snapshot.subsessions, subagentRuns: snapshot.toolRuns, backgroundTasks: tasks });
    } catch {
      // A failed read leaves the previous strip; the error banner shows why.
    }
  }

  /**
   * Interactive self-update: check the fork remote (cheap, daemon-cached) and
   * surface an "Update now / Skip" banner like the pi extension updater. The
   * trigger is opening a session, which is when someone actually reads the
   * page; a background timer is exactly the machinery the user asked not to
   * have.
   */
  private selfUpdateCooldownUntil = 0;
  private async refreshSelfUpdate(): Promise<void> {
    if (Date.now() < this.selfUpdateCooldownUntil) return;
    this.selfUpdateCooldownUntil = Date.now() + 60_000;
    try {
      const status = await selfUpdateApi.status();
      this.setState({ selfUpdate: status });
    } catch (error) {
      // A disabled host answers with enabled:false; a hard failure just means
      // no banner. Neither is worth an error toast on every session open.
      console.warn("Self-update status check failed", error);
    }
  }

  private async applySelfUpdate(): Promise<void> {
    if (this.state.selfUpdateApplying) return;
    this.setState({ selfUpdateApplying: true });
    try {
      const result = await selfUpdateApi.apply();
      if (!result.started) {
        this.setState({ selfUpdateApplying: false });
        if (result.error !== undefined) {
          this.setState({ error: `Update failed: ${result.error}` });
          this.scheduleTransientErrorDismissal(`Update failed: ${result.error}`);
        }
      }
      // On success the page keeps saying "reconnecting…"; the socket comes
      // back after the restart. The applying flag stays up until then.
    } catch {
      this.setState({ selfUpdateApplying: false });
      this.setState({ error: "Update request failed" });
      this.scheduleTransientErrorDismissal("Update request failed");
    }
  }

  private skipSelfUpdate(): void {
    const latest = this.state.selfUpdate?.latest;
    if (latest === undefined) return;
    try {
      window.localStorage.setItem("piWebSelfUpdateSkipped", latest);
    } catch {
      // Private mode: skipping just lasts this visit.
    }
    this.setState({ selfUpdate: undefined });
  }

  /** Render the "Update now / Skip" strip above the session view. */
  private renderSelfUpdateBanner(): TemplateResult | null {
    const status = this.state.selfUpdate;
    if (status === undefined || !status.enabled || !status.available) return null;
    if (this.state.selfUpdateApplying) {
      return html`
        <div class="self-update-banner applying" role="status" aria-live="polite">
          <span class="state-dots"><span class="state-dot"></span><span class="state-dot"></span><span class="state-dot"></span></span>
          <span>正在更新 pi-web（${status.current} → ${status.latest ?? "new"}）… 重启后页面将自动重连。</span>
        </div>`;
    }
    let skipped = false;
    try { skipped = window.localStorage.getItem("piWebSelfUpdateSkipped") === status.latest; } catch { /* ignore */ }
    if (skipped) return null;
    return html`
      <div class="self-update-banner" role="status" aria-live="polite">
        <span>pi-web 有新版本：${status.current} → ${status.latest ?? "new"}</span>
        <button type="button" @click=${() => { void this.applySelfUpdate(); }}>Update now</button>
        <button type="button" class="skip" @click=${() => { this.skipSelfUpdate(); }}>Skip</button>
      </div>`;
  }

  private syncUnreadSessionIds(): void {
    const next = this.sessionUnread.unreadSessionIds(selectedMachineId(this.state), this.state.sessions);
    if (!sameStringSet(next, this.unreadSessionIds)) this.unreadSessionIds = next;
  }

  private isSessionSeen(machineId: string, session: SessionInfo): boolean {
    if (!this.unreadConnected) return false;
    const identity = unreadChatIdentity(machineId, session);
    if (selectedChatIdentity(this.state) !== identity
      || this.committedChatIdentity !== identity
      || this.readyChatIdentity !== identity) return false;
    if (typeof document !== "undefined") {
      if (document.visibilityState !== "visible") return false;
      if (typeof document.hasFocus === "function" && !document.hasFocus()) return false;
    }
    if (this.isRenderedModalOpen()) return false;
    if (this.state.mainView === "chat") return true;
    if (this.state.mainView === "navigation") return !this.appShell.isMobileNavigationLayout;
    return this.isDesktopSideBySideLayout();
  }

  private isRenderedModalOpen(): boolean {
    return hasRenderedModal(this.ownerDocument);
  }

  /**
   * Shorten the shell by however much of it the soft keyboard covers.
   *
   * The shell is fixed at 100dvh, which follows the layout viewport and so does
   * not change when a keyboard opens; without this the composer, send button
   * included, sits underneath it.
   */
  private readonly onVisualViewportChange = (): void => {
    const inset = keyboardInset(window.innerHeight, window.visualViewport ?? undefined);
    this.style.setProperty("--pi-app-keyboard-inset", `${String(Math.round(inset))}px`);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    // Recovery is noticed by whichever channel succeeds next, which is often
    // not the one that failed; the realtime socket alone was leaving a banner
    // on screen until the page was reloaded by hand.
    observeTransportRecovery(() => { this.clearTransientError(); });
    this.unreadConnected = true;
    window.visualViewport?.addEventListener("resize", this.onVisualViewportChange);
    window.visualViewport?.addEventListener("scroll", this.onVisualViewportChange);
    this.onVisualViewportChange();
    window.addEventListener("popstate", this.onPopState);
    window.addEventListener("pageshow", this.onPageShow);
    this.browserResume.connect();
    window.addEventListener("keydown", this.onKeyDown, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    this.systemLightThemeMedia?.addEventListener("change", this.onSystemLightThemeChange);
    this.applyPreferredTheme(false);
    applyUiScale(this.uiScale);
    this.connectRealtime();
    this.syncSessionUnreadMachines();
    this.piWebStatusTimer = window.setInterval(() => { this.schedulePiWebStatusRefresh(); }, PI_WEB_STATUS_REFRESH_MS);
    document.addEventListener("visibilitychange", this.onDocumentVisibilityChange);
    this.listenForFormFocus("add");
    this.livenessTimer = window.setInterval(() => { this.checkSocketLiveness(); }, SOCKET_LIVENESS_CHECK_MS);
    window.addEventListener("online", this.onBrowserOnline);
    this.updateSubagentPolling();
    void this.loadClientConfig();
    void this.refreshSelfUpdate();
    void this.ensureGatewayPluginsLoaded();
    void this.loadProjectsAndRestoreRoute().finally(() => { this.schedulePiWebStatusRefresh(); });
  }

  /** Withdraw a transport complaint that a successful exchange has disproved. */
  private clearTransientError(): void {
    if (this.state.error === "" || !isTransientError(this.state.error)) return;
    if (this.transientErrorTimer !== undefined) {
      window.clearTimeout(this.transientErrorTimer);
      this.transientErrorTimer = undefined;
    }
    this.setState({ error: "" });
  }

  /**
   * Let a self-healing message withdraw itself.
   *
   * A reconnect notice that outlives the reconnect is just noise occupying the
   * top of a phone screen. A permanent failure is never expired here: it stays
   * until the user has seen and dismissed it.
   */
  private scheduleTransientErrorDismissal(error: string): void {
    if (this.transientErrorTimer !== undefined) {
      window.clearTimeout(this.transientErrorTimer);
      this.transientErrorTimer = undefined;
    }
    if (!isTransientError(error)) return;
    this.transientErrorTimer = window.setTimeout(() => {
      this.transientErrorTimer = undefined;
      // Only clear what we scheduled for: a newer message must not be swallowed.
      if (this.state.error === error) this.setState({ error: "" });
    }, TRANSIENT_ERROR_TIMEOUT_MS);
  }

  override disconnectedCallback(): void {
    observeTransportRecovery(undefined);
    if (this.transientErrorTimer !== undefined) window.clearTimeout(this.transientErrorTimer);
    window.visualViewport?.removeEventListener("resize", this.onVisualViewportChange);
    window.visualViewport?.removeEventListener("scroll", this.onVisualViewportChange);
    this.unreadConnected = false;
    this.committedChatIdentity = undefined;
    this.readyChatIdentity = undefined;
    this.sessionUnread.retainMachines(new Set<string>());
    window.removeEventListener("popstate", this.onPopState);
    window.removeEventListener("pageshow", this.onPageShow);
    this.browserResume.disconnect();
    window.removeEventListener("keydown", this.onKeyDown, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    this.systemLightThemeMedia?.removeEventListener("change", this.onSystemLightThemeChange);
    this.keyboard.reset();
    this.auth.dispose();
    this.sessions.dispose();
    this.notifications.dispose();
    this.realtime.close();
    this.closeMachineActivitySockets();
    if (this.piWebStatusTimer !== undefined) window.clearInterval(this.piWebStatusTimer);
    this.piWebStatusTimer = undefined;
    this.clearScheduledPiWebStatusRefresh();
    if (this.workspaceDeletionPollTimer !== undefined) window.clearInterval(this.workspaceDeletionPollTimer);
    this.workspaceDeletionPollTimer = undefined;
    if (this.subagentPollTimer !== undefined) window.clearInterval(this.subagentPollTimer);
    this.subagentPollTimer = undefined;
    if (this.livenessTimer !== undefined) window.clearInterval(this.livenessTimer);
    this.livenessTimer = undefined;
    window.removeEventListener("online", this.onBrowserOnline);
    document.removeEventListener("visibilitychange", this.onDocumentVisibilityChange);
    this.listenForFormFocus("remove");
    this.clearPendingRemoteRouteRestore();
    super.disconnectedCallback();
  }

  private setState(patch: Partial<AppState>) {
    if (!patchChangesState(this.state, patch)) return;
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    if (selectedChatIdentity(previous) !== selectedChatIdentity(this.state)) {
      this.committedChatIdentity = undefined;
      this.readyChatIdentity = undefined;
    }
    if (machineUnreadInputsChanged(previous, this.state)) this.syncSessionUnreadMachines();
    this.syncUnreadSessionIds();
    this.handleActivityTransition(previous, this.state);
    this.handleWorkspaceChange(previous, this.state);
    this.handleMachineChange(previous, this.state);
    if (machineActivitySubscriptionInputsChanged(previous, this.state)) this.syncMachineActivitySubscriptions();
    this.notifications.syncEnvironment(previous, this.state);
    // Only the timer here: `setState` must stay free of network side effects,
    // and the selection paths that can afford an immediate read already ask for
    // one. The poll picks up every other path within its interval.
    if (previous.selectedSession?.id !== this.state.selectedSession?.id) this.updateSubagentPolling();
    // Nothing left to answer, nothing left to yield to: a form that closed
    // while its field held focus emits no focusout anyone can act on.
    if (this.composerCollapsed && this.state.pendingAsk === undefined && this.state.pendingDialogs.length === 0) this.composerCollapsed = false;
  }

  private async loadProjectsAndRestoreRoute() {
    this.restoreSettingsRoute();
    const route = readRoute();
    await this.machines.loadMachines(route.machineId);
    const effectiveRoute = this.routeForSelectedMachine(route);
    const initialRouteMachineHealth = this.state.machineStatuses[effectiveRoute.machineId ?? "local"];
    if (effectiveRoute !== route) this.replaceRouteAndClearWorkspaceQuery(effectiveRoute);
    await this.projects.loadProjects();
    await this.withChatScrollTransition(() => this.restoreRouteFor(effectiveRoute, false));
    if (this.shouldDeferRemoteRouteRestore(effectiveRoute, initialRouteMachineHealth)) this.deferRemoteRouteRestore(effectiveRoute);
    else {
      this.clearPendingRemoteRouteRestore();
      this.rememberCurrentMachineNavigation();
    }
    await this.refreshWorkspaceDeletionRuns();
  }

  /**
   * Both sockets verify themselves; a stale one closes and reconnects, and the
   * reconnect is what refetches whatever was missed. Skipped while the tab is
   * hidden, where the resume path takes over.
   */
  private checkSocketLiveness(): void {
    if (document.visibilityState !== "visible") return;
    this.realtime.checkLiveness();
    this.sessions.checkSocketLiveness();
  }

  private handleBrowserResumeSignal(): void {
    this.appShell.repairViewportPosition();
    // Coming back to the foreground is when a connection that died while the
    // tab was hidden has to be noticed: nothing else will report it, because a
    // socket dropped by a proxy or NAT without a FIN stays OPEN in the browser
    // and fires no close event. Both sockets check themselves and reconnect,
    // which is also what refetches whatever was missed.
    this.realtime.checkLiveness();
    this.sessions.checkSocketLiveness();
    this.schedulePiWebStatusRefresh();
    this.retryPendingRemoteRouteRestoreSoon();
  }

  private async refreshAfterBrowserResume(): Promise<void> {
    await this.sessionUnread.refreshAll();
    await Promise.all([
      this.sessions.refreshSelectedSession(),
      this.refreshMachineStatusSnapshots(),
      this.refreshWorkspaceDeletionRuns(),
      this.refreshCurrentWorkspaceSurface(),
      this.workspaces.refreshSelectedProjectTopology(),
    ]);
  }

  private schedulePiWebStatusRefresh(delayMs = PI_WEB_STATUS_DEFER_MS): void {
    this.clearScheduledPiWebStatusRefresh();
    this.piWebStatusDeferredTimer = window.setTimeout(() => {
      this.piWebStatusDeferredTimer = undefined;
      void this.piWebStatusController.refresh();
    }, delayMs);
  }

  private clearScheduledPiWebStatusRefresh(): void {
    if (this.piWebStatusDeferredTimer === undefined) return;
    window.clearTimeout(this.piWebStatusDeferredTimer);
    this.piWebStatusDeferredTimer = undefined;
  }

  /**
   * Explicit-refresh path for the status tree. Socket frames keep a loaded
   * snapshot current, including the one sent on connect, so this only covers
   * resumes and manual refreshes. A machine whose daemon does not serve the
   * route simply keeps no snapshot, which renders as no indicators.
   */
  private async refreshMachineStatusSnapshots(): Promise<void> {
    await Promise.all(this.refreshableMachineIds().map(async (machineId) => {
      try {
        await this.machineStatus.refresh(machineId);
      } catch (error) {
        console.warn(`Failed to refresh machine status for ${machineId}`, error);
      }
    }));
  }

  private refreshableMachineIds(): string[] {
    if (this.state.machines.length === 0) return [selectedMachineId(this.state)];
    return this.state.machines
      .filter((machine) => shouldRefreshMachineActivity(machine, this.state.machineStatuses[machine.id]))
      .map((machine) => machine.id);
  }

  private async loadClientConfig(): Promise<void> {
    try {
      this.applyClientConfig((await configApi.config()).effectiveConfig);
    } catch (error) {
      console.warn("Failed to load PI WEB config", error);
    }
  }

  private applyClientConfig(config: PiWebConfigValues): void {
    this.shortcutConfig = config.shortcuts ?? {};
    this.workspaceUploadDefaultFolder = effectiveWorkspaceUploadFolder(config);
    // Absent config means the dictation control is never rendered, so an
    // install that has not opted in cannot reach a microphone at all.
    this.speechToTextConfig = config.speechToText;
  }

  private async refreshAppData(): Promise<void> {
    if (this.isRefreshingApp) return;
    this.isRefreshingApp = true;
    try {
      await Promise.all([
        this.sessions.refreshSelectedSession(),
        this.refreshMachineStatusSnapshots(),
        this.loadClientConfig(),
        this.refreshWorkspaceDeletionRuns(),
        this.refreshCurrentWorkspaceSurface(),
        this.workspaces.refreshSelectedProjectTopology(),
      ]);
      this.schedulePiWebStatusRefresh();
    } finally {
      this.isRefreshingApp = false;
    }
  }

  private async refreshCurrentWorkspaceSurface(): Promise<void> {
    const workspace = this.state.selectedWorkspace;
    const tool = this.state.mainView !== "chat" && this.state.mainView !== "navigation" ? this.state.mainView : this.state.workspaceTool;
    if (tool === "core:workspace.files") await this.files.refreshFiles();
    else if (tool === "core:workspace.terminal" && workspace !== undefined) await this.refreshActiveTerminals(workspace);
    else await this.invalidateWorkspacePanels(tool);
  }

  private hardReloadApp(): void {
    window.location.reload();
  }

  private async restoreRoute(updateUrl: boolean) {
    await this.restoreRouteFor(readRoute(), updateUrl);
    this.rememberCurrentMachineNavigation();
  }

  private async restoreRouteFor(parsedRoute: ParsedAppRoute, updateUrl: boolean, surface = this.readWorkspaceRouteSurface(parsedRoute), restoredMainView?: AppState["mainView"]) {
    const machineBeforeRestore = selectedMachineId(this.state);
    const routeSurface = parsedRoute.projectId === undefined || parsedRoute.projectId === "" ? emptyWorkspaceRouteSurface() : surface;
    const restoreSeq = ++this.routeRestoreSeq;
    this.routeRestoreDepth += 1;
    this.restoringRouteTerminalId = routeSurface.selectedTerminalId;
    try {
      await this.restoreRouteMachine(parsedRoute, false);
      await this.loadPluginsForSelectedMachine();
      if (!this.isCurrentRouteRestore(restoreSeq)) return;
      const route = resolveAppRoute(parsedRoute, (value) => this.plugins.resolveWorkspacePanelRouteId(value, selectedMachineId(this.state)));
      this.setState({
        workspaceTool: route.tool ?? this.state.workspaceTool,
        mainView: this.resolveRestoredMainView(restoredMainView) ?? route.view ?? this.defaultRouteView(route),
        selectedFilePath: routeSurface.selectedFilePath,
        selectedTerminalId: routeSurface.selectedTerminalId,
      });
      if (route.projectId === undefined || route.projectId === "") {
        if (updateUrl) this.updateUrl();
        return;
      }
      if (this.routeMatchesCurrentSelection(route)) {
        if (routeSurface.selectedTerminalId !== undefined) this.rememberSelectedTerminal(routeSurface.selectedTerminalId);
        await this.refreshRestoredWorkspaceTool(route.tool, routeSurface.selectedFilePath);
        if (updateUrl) this.updateUrl();
        return;
      }
      const project = this.state.projects.find((p) => p.id === route.projectId);
      if (!project) {
        this.setState({ selectedFilePath: undefined, selectedTerminalId: undefined });
        if (updateUrl) this.updateUrl();
        return;
      }
      await this.workspaces.selectProject(project, { workspaceId: route.workspaceId, sessionId: route.sessionId, updateUrl: false });
      if (!this.isCurrentRouteRestore(restoreSeq)) return;
      this.setState({ selectedFilePath: routeSurface.selectedFilePath, selectedTerminalId: routeSurface.selectedTerminalId });
      if (routeSurface.selectedTerminalId !== undefined) this.rememberSelectedTerminal(routeSurface.selectedTerminalId);
      await this.refreshRestoredWorkspaceTool(route.tool, routeSurface.selectedFilePath);
      if (updateUrl) this.updateUrl();
    } finally {
      this.routeRestoreDepth = Math.max(0, this.routeRestoreDepth - 1);
      if (this.routeRestoreDepth === 0) this.restoringRouteTerminalId = undefined;
      if (selectedMachineId(this.state) !== machineBeforeRestore) this.schedulePiWebStatusRefresh();
    }
  }

  private isCurrentRouteRestore(restoreSeq: number): boolean {
    return restoreSeq === this.routeRestoreSeq;
  }

  private readWorkspaceRouteSurface(route: ParsedAppRoute): WorkspaceRouteSurface {
    if (route.projectId === undefined || route.projectId === "") return emptyWorkspaceRouteSurface();
    return {
      selectedFilePath: readNamespacedString(FILES_ROUTE_NAMESPACE, "file"),
      selectedTerminalId: readNamespacedString(TERMINAL_ROUTE_NAMESPACE, "terminal"),
    };
  }

  private routeForSelectedMachine(route: ParsedAppRoute): ParsedAppRoute {
    const currentMachineId = this.state.selectedMachine?.id ?? "local";
    if ((route.machineId ?? "local") === currentMachineId) return route;
    return { machineId: currentMachineId, projectId: undefined, workspaceId: undefined, sessionId: undefined, tool: undefined, view: undefined };
  }

  private replaceRouteAndClearWorkspaceQuery(route: ParsedAppRoute): void {
    writeRoute(route, { replace: true });
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", undefined, { replace: true });
    setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACE, "terminal", undefined, { replace: true });
  }

  private shouldDeferRemoteRouteRestore(route: ParsedAppRoute, routeMachineHealth = this.state.machineStatuses[route.machineId ?? "local"]): boolean {
    const machineId = route.machineId ?? "local";
    const machine = this.state.selectedMachine;
    if (machineId === "local" || machine?.id !== machineId || machine.kind !== "remote") return false;
    if (routeMachineHealth?.ok !== false) return false;
    if (route.projectId === undefined || route.projectId === "") return this.state.projects.length === 0;
    return this.state.selectedProject?.id !== route.projectId;
  }

  private deferRemoteRouteRestore(route: ParsedAppRoute): void {
    this.pendingRemoteRouteRestore = route;
    this.remoteRouteRestoreAttempt = 0;
    this.setRemoteRouteRestoreMessage(route);
    this.schedulePendingRemoteRouteRestore();
  }

  private retryPendingRemoteRouteRestoreSoon(): void {
    if (this.pendingRemoteRouteRestore === undefined) return;
    this.schedulePendingRemoteRouteRestore(0);
  }

  private schedulePendingRemoteRouteRestore(delayMs = remoteRouteRestoreRetryDelay(this.remoteRouteRestoreAttempt)): void {
    if (this.pendingRemoteRouteRestore === undefined) return;
    this.clearPendingRemoteRouteRestoreTimer();
    this.remoteRouteRestoreTimer = window.setTimeout(() => {
      this.remoteRouteRestoreTimer = undefined;
      void this.retryPendingRemoteRouteRestore();
    }, delayMs);
  }

  private async retryPendingRemoteRouteRestore(): Promise<void> {
    if (this.remoteRouteRestoreInProgress) return;
    const route = this.pendingRemoteRouteRestore;
    if (route === undefined) return;
    if (!this.pendingRemoteRouteRestoreStillCurrent(route)) {
      this.clearPendingRemoteRouteRestore();
      return;
    }

    this.remoteRouteRestoreInProgress = true;
    try {
      const machineId = route.machineId ?? "local";
      const health = await this.machines.refreshMachineHealth(machineId);
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      if (health?.ok !== true) {
        this.scheduleNextRemoteRouteRestoreAttempt(route);
        return;
      }

      await this.machines.refreshMachineRuntime(machineId);
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      await this.projects.loadProjects();
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      if (this.state.error !== "") {
        this.scheduleNextRemoteRouteRestoreAttempt(route);
        return;
      }

      await this.withChatScrollTransition(() => this.restoreRouteFor(route, false));
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      this.clearPendingRemoteRouteRestore();
      this.rememberCurrentMachineNavigation();
      await this.refreshWorkspaceDeletionRuns();
    } finally {
      this.remoteRouteRestoreInProgress = false;
    }
  }

  private scheduleNextRemoteRouteRestoreAttempt(route: ParsedAppRoute): void {
    this.remoteRouteRestoreAttempt += 1;
    if (this.remoteRouteRestoreAttempt >= REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS.length) {
      this.setRemoteRouteRestoreMessage(route, { exhausted: true });
      this.clearPendingRemoteRouteRestore();
      return;
    }
    this.setRemoteRouteRestoreMessage(route);
    this.schedulePendingRemoteRouteRestore();
  }

  private setRemoteRouteRestoreMessage(route: ParsedAppRoute, options: { exhausted?: boolean } = {}): void {
    const machineId = route.machineId ?? "local";
    const machineName = this.state.machines.find((machine) => machine.id === machineId)?.name ?? this.state.selectedMachine?.name ?? "Remote machine";
    const health = this.state.machineStatuses[machineId];
    const detail = health?.error ?? (this.state.error === "" ? undefined : this.state.error);
    const prefix = options.exhausted === true
      ? `${machineName} is still unavailable.`
      : `${machineName} is unavailable; reconnecting…`;
    this.setState({ error: `${prefix}${detail === undefined ? "" : ` ${detail}`}` });
  }

  private pendingRemoteRouteRestoreStillCurrent(route: ParsedAppRoute): boolean {
    const machineId = route.machineId ?? "local";
    return machineId !== "local"
      && this.pendingRemoteRouteRestore === route
      && this.state.selectedMachine?.id === machineId
      && this.state.machines.some((machine) => machine.id === machineId);
  }

  private clearPendingRemoteRouteRestore(): void {
    this.clearPendingRemoteRouteRestoreTimer();
    this.pendingRemoteRouteRestore = undefined;
    this.remoteRouteRestoreAttempt = 0;
  }

  private clearPendingRemoteRouteRestoreTimer(): void {
    if (this.remoteRouteRestoreTimer === undefined) return;
    window.clearTimeout(this.remoteRouteRestoreTimer);
    this.remoteRouteRestoreTimer = undefined;
  }

  private async restoreRouteMachine(route: ParsedAppRoute, updateUrl: boolean): Promise<void> {
    const routeMachineId = route.machineId ?? "local";
    if (this.state.selectedMachine?.id === routeMachineId) return;
    const machine = this.state.machines.find((candidate) => candidate.id === routeMachineId);
    if (machine === undefined) return;
    await this.machines.selectMachine(machine, { updateUrl });
  }

  private routeMatchesCurrentSelection(route: AppRoute): boolean {
    return (route.machineId ?? "local") === (this.state.selectedMachine?.id ?? "local")
      && route.workspaceId !== undefined
      && route.workspaceId !== ""
      && this.state.selectedProject?.id === route.projectId
      && this.state.selectedWorkspace?.id === route.workspaceId
      && this.state.selectedSession?.id === route.sessionId;
  }

  private async refreshRestoredWorkspaceTool(tool: QualifiedContributionId | undefined, selectedFilePath: string | undefined): Promise<void> {
    if (tool === "core:workspace.files") {
      await this.files.refreshFiles();
      if (selectedFilePath !== undefined) await this.files.restoreFile(selectedFilePath);
    } else if (tool !== undefined && tool !== "core:workspace.terminal") {
      await this.invalidateWorkspacePanels(tool);
    }
  }

  private resolveRestoredMainView(view: AppState["mainView"] | undefined): AppState["mainView"] | undefined {
    if (view === undefined || view === "chat" || view === "navigation") return view;
    return resolveWorkspacePanelRouteValue(view, (value) => this.plugins.resolveWorkspacePanelRouteId(value, selectedMachineId(this.state)));
  }

  private async withChatScrollTransition(action: () => Promise<void>, shouldComplete: () => boolean = () => true) {
    this.chatView?.saveScrollPosition();
    await action();
    if (!shouldComplete()) return;
    await this.updateComplete;
    if (!shouldComplete()) return;
    await this.chatView?.updateComplete;
    if (!shouldComplete()) return;
    await nextFrame();
    if (!shouldComplete()) return;
    this.chatView?.restoreScrollPosition();
    if (this.shouldAutoFocusPrompt()) this.promptEditor?.focusInput();
  }

  private shouldAutoFocusPrompt(): boolean {
    return autoFocusesComposer({ touchPrimary: touchPrimaryPointer(), modalOpen: this.isRenderedModalOpen() })
      && this.appShell.shouldAutoFocusPrompt();
  }

  private async withChatPrependTransition(action: () => Promise<void>) {
    await action();
    await this.updateComplete;
    await this.chatView?.updateComplete;
  }

  private defaultRouteView(route: { readonly sessionId?: string | undefined } = {}): AppState["mainView"] {
    return this.appShell.defaultRouteView(route);
  }

  private updateUrl(options?: { replace?: boolean | undefined }) {
    this.rememberCurrentMachineNavigation();
    writeRoute({
      machineId: this.state.selectedMachine?.id,
      projectId: this.state.selectedProject?.id,
      workspaceId: this.state.selectedWorkspace?.id,
      sessionId: this.state.selectedSession?.id,
      tool: this.state.workspaceTool,
      view: this.state.mainView === "navigation" ? undefined : this.state.mainView,
    }, options);
    this.syncWorkspaceRouteSurfaceToUrl();
  }

  private rememberCurrentMachineNavigation(): void {
    this.machineNavigation.remember(machineNavigationSnapshotFromState(this.state));
  }

  private syncWorkspaceRouteSurfaceToUrl(): void {
    this.writeWorkspaceRouteSurfaceToUrl(machineNavigationSnapshotFromState(this.state).surface);
  }

  private writeMachineNavigationSnapshotToUrl(snapshot: MachineNavigationSnapshot, options?: { replace?: boolean | undefined }): void {
    writeRoute(routeFromMachineNavigationSnapshot(snapshot), options);
    this.writeWorkspaceRouteSurfaceToUrl(snapshot.surface);
  }

  private writeWorkspaceRouteSurfaceToUrl(surface: WorkspaceRouteSurface): void {
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", surface.selectedFilePath, { replace: true });
    setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACE, "terminal", surface.selectedTerminalId, { replace: true });
  }

  private async selectMachineWithMemory(machine: Machine, options: { rememberCurrent?: boolean } = {}): Promise<void> {
    if (this.state.selectedMachine?.id === machine.id) return;
    if (options.rememberCurrent !== false && !this.routeRestoreInProgress) this.rememberCurrentMachineNavigation();
    const seq = ++this.machineNavigationRestoreSeq;
    const snapshot = this.machineNavigation.latest(machine.id) ?? emptyMachineNavigationSnapshot(machine.id);
    await this.restoreRouteFor(routeFromMachineNavigationSnapshot(snapshot), false, snapshot.surface, snapshot.view);
    if (seq !== this.machineNavigationRestoreSeq || this.state.selectedMachine?.id !== machine.id) return;
    if (this.shouldPreserveUnrestoredMachineNavigation(snapshot)) {
      this.machineNavigation.remember(snapshot);
      this.writeMachineNavigationSnapshotToUrl(snapshot);
      return;
    }
    this.updateUrl();
  }

  private shouldPreserveUnrestoredMachineNavigation(snapshot: MachineNavigationSnapshot): boolean {
    return snapshot.projectId !== undefined && this.state.selectedProject?.id !== snapshot.projectId && this.state.error !== "";
  }

  private openWorkspaceTool(tool: QualifiedContributionId) {
    if (tool === "core:workspace.terminal") this.terminalAutoStartWorkspaceId = this.state.selectedWorkspace?.id;
    this.setState({ workspaceTool: tool, mainView: tool });
    this.updateUrl();
    this.refreshSelectedWorkspaceTool(tool);
  }

  private openTerminal(options?: { terminalId?: string | undefined }): void {
    if (options?.terminalId !== undefined) this.selectTerminal(options.terminalId, { replace: true });
    this.openWorkspaceTool("core:workspace.terminal");
  }

  private terminalCommandRunsForOrigin(origin: string, machineId = selectedMachineId(this.state)): TerminalCommandRunsInternalRuntime {
    const key = machineScopedKey(machineId, origin);
    const existing = this.terminalCommandRunRuntimes.get(key);
    if (existing !== undefined) return existing;
    const runtime = createTerminalCommandRunsRuntime(origin, {
      api: {
        runTerminalCommand: (runtimeOrigin, input) => terminalsApi.runTerminalCommand(runtimeOrigin, input, machineId),
        listCommandRuns: (filter) => terminalsApi.listCommandRuns(filter, machineId),
        getCommandRun: (runId) => terminalsApi.getCommandRun(runId, machineId),
      },
      openTerminal: (workspace, options) => { void this.openRuntimeTerminal(machineId, workspace, options); },
    });
    this.terminalCommandRunRuntimes.set(key, runtime);
    return runtime;
  }

  private async openRuntimeTerminal(machineId: string, workspace: Workspace | undefined, options?: { terminalId?: string | undefined }): Promise<void> {
    if (selectedMachineId(this.state) !== machineId || (workspace !== undefined && (this.state.selectedWorkspace?.id !== workspace.id || this.state.selectedProject?.id !== workspace.projectId))) {
      if (!this.routeRestoreInProgress) this.rememberCurrentMachineNavigation();
      await this.restoreRouteFor({
        machineId,
        projectId: workspace?.projectId,
        workspaceId: workspace?.id,
        sessionId: undefined,
        tool: "core:workspace.terminal",
        view: "core:workspace.terminal",
      }, false, { selectedTerminalId: options?.terminalId }, "core:workspace.terminal");
      if (selectedMachineId(this.state) !== machineId) {
        this.setState({ error: "Machine not found for terminal command run" });
        return;
      }
    }
    this.openTerminal(options);
  }

  private selectTerminal(terminalId: string | undefined, options?: { replace?: boolean | undefined }): void {
    this.rememberSelectedTerminal(terminalId);
    this.setState({ selectedTerminalId: terminalId });
    this.rememberCurrentMachineNavigation();
    this.writeSelectedTerminalToUrl(terminalId, options);
  }

  private rememberSelectedTerminal(terminalId: string | undefined): void {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return;
    if (terminalId === undefined) this.terminalSelection.forgetWorkspace(this.terminalWorkspaceKey(workspace));
    else this.terminalSelection.rememberTerminal(this.terminalWorkspaceKey(workspace), terminalId);
  }

  private writeSelectedTerminalToUrl(terminalId: string | undefined, options?: { replace?: boolean | undefined }): void {
    setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACE, "terminal", terminalId, options);
  }

  private terminalWorkspaceKey(workspace: Workspace): string {
    return `${selectedMachineId(this.state)}:${workspace.path}`;
  }

  private selectMainView(view: AppState["mainView"]) {
    if (view !== "navigation" && view !== "chat") {
      this.openWorkspaceTool(view);
      return;
    }
    this.setState({ mainView: view });
    this.updateUrl();
  }

  private openSettings(section: SettingsSection = "general"): void {
    this.settingsSection = section;
    writeSettingsSection(section);
  }

  private async refreshFleet(): Promise<void> {
    this.fleetLoading = true;
    this.fleetError = undefined;
    try {
      this.fleetReport = await fleetApi.report();
    } catch (error) {
      this.fleetError = error instanceof Error ? error.message : String(error);
    } finally {
      this.fleetLoading = false;
    }
  }

  /**
   * Run one fleet operation and re-read the report.
   *
   * The report is re-read even when the run failed: a restart that started
   * changes what the machine reports about itself, and a failure often means a
   * machine went offline, which the list should show.
   */
  private async runFleetOperation(operation: "restart" | "update", machineIds?: readonly string[]): Promise<PiWebFleetRunResponse | undefined> {
    this.fleetError = undefined;
    try {
      return await fleetApi.run(operation, machineIds);
    } catch (error) {
      this.fleetError = error instanceof Error ? error.message : String(error);
      return undefined;
    } finally {
      void this.refreshFleet();
    }
  }

  private closeSettings(): void {
    this.settingsSection = undefined;
    writeSettingsSection(undefined);
  }

  private navigateSettings(section: SettingsSection): void {
    this.settingsSection = section;
    writeSettingsSection(section);
  }

  private restoreSettingsRoute(): void {
    this.settingsSection = readSettingsSection();
  }

  private handleWorkspaceChange(previous: AppState, next: AppState) {
    if (previous.selectedWorkspace?.id === next.selectedWorkspace?.id) return;
    this.terminalAutoStartWorkspaceId = undefined;
    this.activeTerminalIds.clear();
    const selectedTerminalId = this.routeRestoreInProgress ? this.restoringRouteTerminalId : next.selectedWorkspace === undefined ? undefined : this.terminalSelection.latestTerminalId(this.terminalWorkspaceKey(next.selectedWorkspace));
    this.setState({ activeTerminalCount: 0, selectedTerminalId });
    if (!this.routeRestoreInProgress) {
      this.rememberCurrentMachineNavigation();
      this.writeSelectedTerminalToUrl(selectedTerminalId, { replace: true });
    }
    if (next.selectedWorkspace === undefined) return;
    void this.refreshActiveTerminals(next.selectedWorkspace);
    void this.refreshWorkspaceDeletionRuns();
    this.refreshSelectedWorkspaceTool(next.workspaceTool);
  }

  private syncSessionUnreadMachines(): void {
    if (!this.unreadConnected) {
      this.sessionUnread.retainMachines(new Set<string>());
      return;
    }
    const machineIds = new Set(this.state.machines.map((machine) => machine.id));
    machineIds.add(selectedMachineId(this.state));
    this.sessionUnread.retainMachines(machineIds);
    for (const machineId of machineIds) {
      // Socket events keep a loaded projection current; only the initial join
      // (or a machine whose snapshot never landed) needs an HTTP snapshot.
      if (this.sessionUnread.projection(machineId) === undefined) void this.sessionUnread.refresh(machineId);
    }
  }

  private connectRealtime(): void {
    const machineId = selectedMachineId(this.state);
    // Read once on the first connect too, not only when re-establishing: a
    // fresh page load is exactly when the user is looking for the work the
    // last restart cut off.
    this.refreshInterruptedRuns(machineId);
    this.realtime.connect(
      (event) => { this.handleRealtimeEvent(machineId, event); },
      () => {
        // The socket being back is proof the transport healed, so a transport
        // complaint on screen is now describing the past. Only self-healing
        // messages are withdrawn; a real failure stays until it is read.
        this.clearTransientError();
        void this.sessionUnread.refresh(machineId);
        // Status updates that landed during the gap are gone for good, so this
        // has to overwrite what the browser holds rather than fill gaps: a
        // session that finished while disconnected kept its "working" state
        // until the page was reloaded.
        void this.sessions.hydrateSessionStatuses(machineId, { replaceKnown: true });
        // The list itself can be stale too - sessions created, renamed or
        // archived during the gap were announced on the socket that was down.
        void this.sessions.refreshCurrentWorkspaceSessions(machineId);
        this.refreshInterruptedRuns(machineId);
        const workspace = this.state.selectedWorkspace;
        if (workspace !== undefined) void this.refreshActiveTerminals(workspace);
      },
      machineId,
    );
  }

  private syncMachineActivitySubscriptions(): void {
    const desiredMachineIds = this.machineActivitySubscriptionIds();
    for (const [machineId, socket] of this.machineRealtimeSockets.entries()) {
      if (desiredMachineIds.has(machineId)) continue;
      socket.close();
      this.machineRealtimeSockets.delete(machineId);
    }
    for (const machineId of desiredMachineIds) {
      if (this.machineRealtimeSockets.has(machineId)) continue;
      const socket = new RealtimeSocket();
      socket.connect(
        (event) => { this.handleMachineActivityEvent(machineId, event); },
        () => { void this.sessionUnread.refresh(machineId); },
        machineId,
      );
      this.machineRealtimeSockets.set(machineId, socket);
    }
  }

  private closeMachineActivitySockets(): void {
    for (const socket of this.machineRealtimeSockets.values()) socket.close();
    this.machineRealtimeSockets.clear();
  }

  private machineActivitySubscriptionIds(): Set<string> {
    const selected = selectedMachineId(this.state);
    return new Set(this.state.machines
      .filter((machine) => machine.id !== selected)
      .filter((machine) => shouldSubscribeToMachineActivity(machine, this.state.machineStatuses[machine.id]))
      .map((machine) => machine.id));
  }

  private handleMachineActivityEvent(machineId: string, event: BrowserRealtimeEvent): void {
    if (event.type === "sessions.unread") this.sessionUnread.applyEvent(machineId, event);
    else if (event.type === "machine.status") this.machineStatus.apply(machineId, event.status);
  }

  private handleRealtimeEvent(machineId: string, event: BrowserRealtimeEvent): void {
    if (event.type === "sessions.unread") this.sessionUnread.applyEvent(machineId, event);
    else if (event.type === "machine.status") this.machineStatus.apply(machineId, event.status);
    else if (isTerminalEvent(event)) {
      this.applyTerminalEvent(event);
      if (event.type === "terminal.exited") void this.refreshWorkspaceDeletionRuns();
    } else this.sessions.applyGlobalEvent(event);
  }

  private applyTerminalEvent(event: TerminalUiEvent): void {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return;
    const cwd = event.type === "terminal.closed" ? event.cwd : event.terminal.cwd;
    if (cwd !== workspace.path) return;
    if (event.type === "terminal.created" && !event.terminal.exited) this.activeTerminalIds.add(event.terminal.id);
    else this.activeTerminalIds.delete(event.type === "terminal.closed" ? event.terminalId : event.terminal.id);
    if (event.type === "terminal.closed") {
      this.terminalSelection.forgetTerminal(event.terminalId);
      if (this.state.selectedTerminalId === event.terminalId) this.selectTerminal(undefined, { replace: true });
    }
    this.setState({ activeTerminalCount: this.activeTerminalIds.size });
  }

  private async refreshActiveTerminals(workspace: Workspace): Promise<void> {
    const machineId = selectedMachineId(this.state);
    try {
      const terminals = await terminalsApi.terminals(workspace.projectId, workspace.id, machineId);
      if (selectedMachineId(this.state) !== machineId || this.state.selectedWorkspace?.id !== workspace.id) return;
      this.activeTerminalIds.clear();
      for (const terminal of terminals) {
        if (!terminal.exited) this.activeTerminalIds.add(terminal.id);
      }
      this.setState({ activeTerminalCount: this.activeTerminalIds.size });
    } catch (error) {
      this.setState({ error: String(error) });
    }
  }

  private handleActivityTransition(previous: AppState, next: AppState) {
    const wasActive = isActive(previous);
    const nowActive = isActive(next);
    if (wasActive && !nowActive) {
      this.setState({ fileTreeStale: true });
      this.refreshSelectedWorkspaceTool(this.state.workspaceTool);
    }
  }

  private handleMachineChange(previous: AppState, next: AppState): void {
    if ((previous.selectedMachine?.id ?? "local") === (next.selectedMachine?.id ?? "local")) return;
    const pendingMachineId = this.pendingRemoteRouteRestore?.machineId ?? "local";
    if (pendingMachineId !== (next.selectedMachine?.id ?? "local")) this.clearPendingRemoteRouteRestore();
    this.sessions.clearActiveSession();
    this.realtime.close();
    this.connectRealtime();
    this.activeTerminalIds.clear();
    this.sessionCleanupDialog = undefined;
    this.setState({ piWebStatus: undefined });
    void this.loadPluginsForSelectedMachine();
  }

  private refreshSelectedWorkspaceTool(tool: QualifiedContributionId): void {
    if (tool === "core:workspace.files") void this.files.refreshFiles();
    else if (tool !== "core:workspace.terminal") void this.invalidateWorkspacePanels(tool);
  }

  private renderWorkspacePanel() {
    const workspace = this.state.selectedWorkspace;
    const panelContext = workspace === undefined ? undefined : this.createWorkspacePanelContext(workspace);
    const emptyState = workspace === undefined ? this.workspacePanelEmptyState() : undefined;
    return html`
      <workspace-panel
        id="workspace-panel"
        .workspace=${workspace}
        .panelContext=${panelContext}
        .emptyState=${emptyState}
        .tool=${this.state.workspaceTool}
        .panels=${this.visibleWorkspacePanels()}
        .onSelectTool=${(tool: QualifiedContributionId) => { this.openWorkspaceTool(tool); }}
      ></workspace-panel>
    `;
  }

  private renderNavigationPanelEdgeControl() {
    const constraints = this.resizablePanelConstraints("navigation");
    return html`
      <app-panel-edge-control
        side="navigation"
        controls="navigation-panel"
        resizeLabel="Resize navigation panel"
        expandLabel="Expand navigation panel"
        collapseLabel="Collapse navigation panel"
        .collapsed=${this.panelCollapse.navigationPanelCollapsed}
        .resizable=${!this.appShell.isMobileNavigationLayout}
        .panelWidth=${this.panelResize.panelWidth("navigation")}
        .minWidth=${constraints.minWidth}
        .maxWidth=${constraints.maxWidth}
        .onToggle=${() => { this.panelCollapse.toggleNavigationPanel(); }}
        .onResizeStart=${() => this.startPanelResize("navigation")}
        .onResize=${(width: number) => { this.panelResize.resizePanel("navigation", width, { persist: false }); }}
        .onResizeEnd=${() => { this.panelResize.persistPanelSizes(); }}
        .onReset=${() => { this.resetResizablePanel("navigation"); }}
      ></app-panel-edge-control>
    `;
  }

  private renderWorkspacePanelEdgeControl() {
    const constraints = this.resizablePanelConstraints("workspace");
    return html`
      <app-panel-edge-control
        side="workspace"
        controls="workspace-panel"
        resizeLabel="Resize workspace panel"
        expandLabel="Expand workspace panel"
        collapseLabel="Collapse workspace panel"
        .collapsed=${this.panelCollapse.workspacePanelCollapsed}
        .resizable=${!this.appShell.isMobileNavigationLayout}
        .panelWidth=${this.panelResize.panelWidth("workspace")}
        .minWidth=${constraints.minWidth}
        .maxWidth=${constraints.maxWidth}
        .onToggle=${() => { this.panelCollapse.toggleWorkspacePanel(); }}
        .onResizeStart=${() => this.startPanelResize("workspace")}
        .onResize=${(width: number) => { this.panelResize.resizePanel("workspace", width, { persist: false }); }}
        .onResizeEnd=${() => { this.panelResize.persistPanelSizes(); }}
        .onReset=${() => { this.resetResizablePanel("workspace"); }}
      ></app-panel-edge-control>
    `;
  }

  private startPanelResize(side: ResizablePanelSide): number {
    if (side === "navigation") this.panelCollapse.expandNavigationPanel();
    else this.panelCollapse.expandWorkspacePanel();
    return this.measuredPanelWidth(side) ?? this.panelResize.panelWidth(side);
  }

  private resizablePanelConstraints(side: ResizablePanelSide): PanelResizeConstraints {
    const constraints = this.panelResize.constraints(side);
    return {
      ...constraints,
      maxWidth: this.resizablePanelMaxWidth(side, constraints),
    };
  }

  private resizablePanelMaxWidth(side: ResizablePanelSide, constraints: PanelResizeConstraints): number {
    const shellWidth = this.getBoundingClientRect().width || (typeof window === "undefined" ? 0 : window.innerWidth);
    if (shellWidth <= 0) return constraints.maxWidth;

    const otherPanelWidth = this.oppositeResizablePanelWidth(side);
    const maxWidth = Math.floor(shellWidth - otherPanelWidth - PANEL_EDGE_COLUMNS_WIDTH_PX - MIN_RESIZABLE_CHAT_WIDTH_PX);
    return Math.max(constraints.minWidth, Math.min(constraints.maxWidth, maxWidth));
  }

  private oppositeResizablePanelWidth(side: ResizablePanelSide): number {
    const otherSide: ResizablePanelSide = side === "navigation" ? "workspace" : "navigation";
    if (this.isResizablePanelCollapsedOrStacked(otherSide)) return 0;
    return this.measuredPanelWidth(otherSide) ?? this.panelResize.panelWidth(otherSide);
  }

  private isResizablePanelCollapsedOrStacked(side: ResizablePanelSide): boolean {
    if (side === "navigation") return this.panelCollapse.navigationPanelCollapsed;
    return this.panelCollapse.workspacePanelCollapsed || !this.isDesktopSideBySideLayout();
  }

  private isDesktopSideBySideLayout(): boolean {
    if (typeof window === "undefined" || !("matchMedia" in window)) return true;
    return window.matchMedia(DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY).matches;
  }

  private measuredPanelWidth(side: ResizablePanelSide): number | undefined {
    const element = side === "navigation" ? this.navigationPanelFrame : this.workspacePanelFrame;
    const width = element?.getBoundingClientRect().width;
    return width === undefined || width <= 0 ? undefined : width;
  }

  private resetResizablePanel(side: ResizablePanelSide): void {
    this.panelResize.resetPanel(side);
  }

  private resetResizablePanels(): void {
    this.panelResize.resetPanels();
  }

  private selectedMachineRuntime() {
    return this.state.machineRuntimes[selectedMachineId(this.state)];
  }

  private openSessionCleanupDialog(): void {
    this.sessionCleanupDialog = { error: "" };
  }

  private closeSessionCleanupDialog(): void {
    this.sessionCleanupDialog = undefined;
  }

  private async previewSessionCleanup(request: SessionCleanupRequest): Promise<void> {
    const machineId = selectedMachineId(this.state);
    this.sessionCleanupDialog = { ...(this.sessionCleanupDialog ?? {}), loading: true, error: "", preview: undefined, previewRequest: undefined, result: undefined };
    try {
      const preview = await sessionsApi.cleanupPreview(request, machineId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.sessionCleanupDialog = { ...this.sessionCleanupDialog, preview, previewRequest: request, result: undefined, loading: false, error: "" };
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.sessionCleanupDialog = { ...this.sessionCleanupDialog, loading: false, error: `Failed to preview cleanup: ${errorMessage(error)}` };
    }
  }

  private async runSessionCleanup(request: SessionCleanupRequest): Promise<void> {
    const dialog = this.sessionCleanupDialog;
    if (dialog?.preview === undefined || sessionCleanupRequestKey(dialog.previewRequest) !== sessionCleanupRequestKey(request)) {
      this.sessionCleanupDialog = { ...(dialog ?? {}), error: "Preview cleanup before running it." };
      return;
    }
    const machineId = selectedMachineId(this.state);
    this.sessionCleanupDialog = { ...dialog, running: true, error: "" };
    try {
      const result = await sessionsApi.cleanup(request, machineId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.sessionCleanupDialog = { ...this.sessionCleanupDialog, preview: result, previewRequest: request, result, running: false, error: "" };
      await this.sessions.applySessionCleanupResult(result, machineId);
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.sessionCleanupDialog = { ...this.sessionCleanupDialog, running: false, error: `Failed to run cleanup: ${errorMessage(error)}` };
    }
  }

  private renderNavigationPanel() {
    return html`
      <app-navigation-panel
        .machines=${this.state.machines}
        .selectedMachine=${this.state.selectedMachine}
        .machineStatuses=${this.state.machineStatuses}
        .machineStatusSnapshots=${this.state.machineStatusSnapshots}
        .machinesCollapsed=${this.navigationSections.isCollapsed("machines")}
        .onToggleMachines=${() => { this.navigationSections.toggle("machines"); }}
        .onSelectMachine=${(machine: Machine) => this.selectNavigationItem("machines", "projects", () => this.selectMachineWithMemory(machine))}
        .onRemoveMachine=${(machine: Machine) => { void this.removeMachine(machine); }}
        .onRenameMachine=${(machine: Machine, name: string) => { void this.renameMachine(machine, name); }}
        .projects=${this.state.projects}
        .selectedProject=${this.state.selectedProject}
        .workspaces=${this.state.workspaces}
        .selectedWorkspace=${this.state.selectedWorkspace}
        .deletingWorkspaceIds=${pendingWorkspaceDeletionIds(this.state.workspaceDeletionRuns)}
        .sessions=${this.state.sessions}
        .sessionStatuses=${this.state.sessionStatuses}
        .sessionActivities=${this.state.sessionActivities}
        .sendingPrompts=${this.state.sendingPrompts}
        .unreadSessionIds=${this.unreadSessionIds}
        .selectedSession=${this.state.selectedSession}
        .startingSessionCount=${this.state.startingSessionCount}
        .canStartSession=${!!this.state.selectedWorkspace}
        .collapsible=${true}
        .compact=${this.appShell.isMobileNavigationLayout}
        .projectsCollapsed=${this.navigationSections.isCollapsed("projects")}
        .workspacesCollapsed=${this.navigationSections.isCollapsed("workspaces")}
        .sessionsCollapsed=${this.navigationSections.isCollapsed("sessions")}
        .workspaceLabelItems=${(workspace: Workspace) => this.workspaceLabelItems(workspace)}
        .refreshControl=${this.appShell.shouldShowAppRefreshInHeader() ? this.renderAppRefresh() : undefined}
        .onAddProject=${() => { this.openProjectDialog(); }}
        .onQuickSwitch=${() => { this.openQuickSwitcher(); }}
        .onShowActions=${() => { this.openActionPalette(); }}
        .onOpenSettings=${() => { this.openSettings("general"); }}
        .onAddMachine=${() => { this.openMachineDialog(); }}
        .onRefreshMachine=${async (machine: Machine) => {
          await this.machines.selectMachine(machine);
          await Promise.all([this.machines.refreshMachineHealth(), this.machines.refreshMachineRuntime()]);
        }}
        .onOpenMachine=${(machine: Machine) => { if (machine.kind === "remote" && machine.baseUrl !== undefined) window.open(machine.baseUrl, "_blank", "noopener,noreferrer"); }}
        .onToggleProjects=${() => { this.navigationSections.toggle("projects"); }}
        .onToggleWorkspaces=${() => { this.navigationSections.toggle("workspaces"); }}
        .onToggleSessions=${() => { this.navigationSections.toggle("sessions"); }}
        .onSelectProject=${(project: Project) => this.selectNavigationItem("projects", "workspaces", () => this.workspaces.selectProject(project))}
        .onCloseProject=${(project: Project) => this.projects.closeProject(project.id)}
        .onSelectWorkspace=${(workspace: Workspace) => this.selectNavigationItem("workspaces", "sessions", () => this.workspaces.selectWorkspace(workspace))}
        .onDeleteWorkspace=${(workspace: Workspace) => { void this.deleteWorkspace(workspace); }}
        .onArchivedCollapsed=${() => { this.sessions.clearSelectionAfterArchivedCollapse(); }}
        .onStartSession=${() => this.startSessionFromNavigation()}
        .onSelectSession=${(session: SessionInfo) => this.selectNavigationItem("sessions", "chat", () => this.sessions.selectSession(session).finally(() => { void this.refreshSubagents(); }))}
        .onMarkSessionRead=${(session: SessionInfo) => { this.markSessionsRead([session]); }}
        .onMarkSessionsRead=${(sessions: SessionInfo[]) => { this.markSessionsRead(sessions); }}
        .onArchiveSession=${(session: SessionInfo) => this.sessions.archiveSession(session)}
        .onArchiveSessionWithDescendants=${(session: SessionInfo) => this.sessions.archiveSessionWithDescendants(session)}
        .onArchiveSessions=${(sessions: SessionInfo[]) => this.sessions.archiveSessions(sessions)}
        .onRestoreSession=${(session: SessionInfo) => this.selectNavigationItem("sessions", "chat", () => this.sessions.restoreSession(session).finally(() => { void this.refreshSubagents(); }))}
        .onDeleteCachedNewSession=${(session: SessionInfo) => this.sessions.deleteCachedNewSession(session)}
        .onDeleteArchivedSession=${(session: SessionInfo) => this.sessions.deleteArchivedSessions([session])}
        .onDeleteArchivedSessions=${(sessions: SessionInfo[]) => this.sessions.deleteArchivedSessions(sessions)}
        .onDetachParentSession=${(session: SessionInfo) => this.sessions.detachParent(session)}
        .onRenameSession=${(session: SessionInfo, name: string) => {
          this.applyRenameToQuickSwitcher(session.id, name);
          return this.sessions.renameSession(session, name);
        }}
        .goals=${this.state.workspaceGoals}
        ?goalsLoading=${this.state.workspaceGoalsLoading}
        .onRefreshGoals=${() => this.workspaces.refreshWorkspaceGoals()}
        .onArchiveGoal=${(goal: GoalRecordSummary) => this.workspaces.archiveWorkspaceGoal(goal.id)}
        .onRunGoalCommand=${(_goal: GoalRecordSummary, command: string) => this.runGoalCommand(command)}
        .onReloadSession=${(session: SessionInfo) => this.sessions.reloadSession(session)}
        .onOpenSessionTree=${(session: SessionInfo) => this.openSessionTree(session)}
        .onCleanupSessions=${() => { this.openSessionCleanupDialog(); }}
        .onFocusNavigationTarget=${(target: NavigationFocusTarget) => { void this.focusNavigationTarget(target); }}
        .onCancelKeyboardNavigation=${() => { void this.focusChatComposer(); }}
      ></app-navigation-panel>
    `;
  }

  private openNavigationSection(section: NavigationSection): void {
    this.navigationSections.open(section, () => { this.selectMainView("navigation"); });
  }

  private async selectNavigationItem(section: NavigationSection, nextTarget: NavigationFocusTarget, action: () => Promise<void>): Promise<void> {
    const seq = ++this.navigationSelectionSeq;
    const isCurrentSelection = () => seq === this.navigationSelectionSeq;

    await this.withChatScrollTransition(async () => {
      this.navigationSections.advanceAfterSelection(section);
      await action();
    }, isCurrentSelection);

    if (!isCurrentSelection()) return;
    // The workspace count is only known once the project has loaded, so the
    // decision to skip that step is re-made here rather than guessed at the tap.
    // Selecting the project already selects its only workspace, so stopping on
    // a list of one would ask for a tap that changes nothing.
    let target = nextTarget;
    if (section === "projects") {
      this.navigationSections.advanceAfterSelection("projects", { workspaceCount: this.state.workspaces.length });
      if (this.state.workspaces.length === 1 && this.state.selectedWorkspace !== undefined) target = "sessions";
    }
    await this.focusNavigationTarget(target);
  }

  private async startSessionFromNavigation(): Promise<void> {
    const seq = ++this.navigationSelectionSeq;
    const isCurrentSelection = () => seq === this.navigationSelectionSeq;

    this.navigationSections.advanceAfterSelection("sessions");
    await this.startSessionAndOpenChat(isCurrentSelection);
  }

  private canStartSession(): boolean {
    return this.state.selectedWorkspace !== undefined;
  }

  /**
   * Active sessions for the switcher's WORKING group.
   *
   * Based on the machine-wide list the switcher renders, not the selected
   * workspace's session list: a recent session from another workspace runs
   * just as much as one from here, and grouping it under WORKING without a
   * working badge would recreate the divergence this code exists to avoid.
   */
  private activeSessionIds(): ReadonlySet<string> {
    const active = new Set<string>();
    for (const session of this.quickSwitcherSessions) {
      if (isSessionActive(this.state.sessionStatuses[session.id], this.state.sessionActivities[session.id])) active.add(session.id);
    }
    return active;
  }

  /** Four-state badge per session for the quick switcher and list rows. */
  private sessionStateKinds(): ReadonlyMap<string, SessionStateBadgeKind> {
    return quickSwitcherSessionStates(this.quickSwitcherSessions, this.state.sessionStatuses, this.state.sessionActivities);
  }

  /**
   * Sessions whose agent stopped on an error - an unavailable model, a failed
   * tool. They are listed first because nothing moves until someone looks, not
   * even with an answer typed into them.
   */
  private errorSessionIds(): ReadonlySet<string> {
    const errored = new Set<string>();
    for (const [sessionId, kind] of this.sessionStateKinds()) {
      if (kind === "error") errored.add(sessionId);
    }
    return errored;
  }

  private togglePinnedSession(session: SessionInfo): void {
    this.pinnedSessionIds = togglePinnedSessionId(this.pinnedSessionIds, session.id);
    writePinnedSessionIds(this.pinnedSessionIds);
  }

  /**
   * Sessions whose agent is blocked on an `ask_user` answer. They cannot make
   * any progress until the user replies, which is why the switcher lists them
   * above work that is merely running.
   */
  private waitingSessionIds(): ReadonlySet<string> {
    const waiting = new Set<string>();
    for (const session of this.quickSwitcherSessions) {
      if (isWaitingForUser(this.state.sessionStatuses[session.id])) waiting.add(session.id);
    }
    return waiting;
  }

  /** True while a modal layer owns the back gesture. */
  private modalLayerOpen(): boolean {
    return this.quickSwitcherOpen
      || this.mobileToolSheetOpen
      || this.state.actionPaletteOpen
      || this.state.projectDialogOpen
      || this.state.machineDialogOpen
      || this.state.commandDialog !== undefined
      || this.state.modelDialog !== undefined
      || this.state.thinkingDialog !== undefined
      || this.state.themeDialog !== undefined
      || this.sessionCleanupDialog !== undefined;
  }

  /**
   * Android back must close the layer it is looking at, not jump to another
   * session. Push a placeholder frame when a layer opens so the back gesture
   * pops to that frame; the popstate handler then closes the layer instead of
   * restoring the previous session route.
   */
  private pushModalLayerFrame(): void {
    // Same URL, new frame: writeRoute dedupes identical URLs, so push directly.
    window.history.pushState({}, "");
    notePlaceholderFrame();
  }

  private openActionPalette(): void {
    this.pushModalLayerFrame();
    this.setState({ actionPaletteOpen: true });
  }

  private openProjectDialog(): void {
    this.pushModalLayerFrame();
    this.setState({ projectDialogOpen: true });
  }

  private openQuickSwitcher(): void {
    // The composer usually still holds focus, which leaves the on-screen
    // keyboard covering the list this exists to show.
    dismissKeyboardIfRaised();
    this.quickSwitcherOpen = true;
    this.pushModalLayerFrame();
    // Show what is cached, then refresh behind it. The cache was previously
    // kept for the life of the page, so anything that changed after the first
    // open -- a rename, a new session, one archived on another device -- stayed
    // invisible until a reload.
    void this.loadQuickSwitcherData(this.quickSwitcherSessions.length > 0);
    // The interrupted record is read-once on the daemon; re-reading it when
    // the switcher opens retracts markers whose runs have since continued.
    const machineId = selectedMachineId(this.state);
    if (machineId !== "") this.refreshInterruptedRuns(machineId);
  }

  /**
   * Keep the switcher's own copy of a session in step with a rename.
   *
   * It holds a separate list from the navigation panel, so without this the
   * switcher goes on offering the name the user just renamed away from.
   */
  private applyRenameToQuickSwitcher(sessionId: string, name: string): void {
    this.quickSwitcherSessions = renameSessionInList(this.quickSwitcherSessions, sessionId, name);
  }

  private async loadQuickSwitcherData(force = false): Promise<void> {
    const machineId = selectedMachineId(this.state);
    if (!force && this.quickSwitcherMachineId === machineId && (this.quickSwitcherSessions.length > 0 || this.quickSwitcherWorkspaces.length > 0 || this.quickSwitcherLoading)) {
      return;
    }
    this.quickSwitcherLoading = true;
    try {
      const projects = this.state.projects.length > 0 ? this.state.projects : await projectsApi.projects(machineId);
      const workspaceLists = await Promise.all(projects.map(async (project) => {
        try {
          return await workspacesApi.workspaces(project.id, machineId);
        } catch {
          return [];
        }
      }));
      const workspaces = dedupeById(workspaceLists.flat());
      const sessionLists = await Promise.all(workspaces.map(async (workspace) => {
        try {
          return await sessionsApi.sessions(workspace.path, machineId);
        } catch {
          return [];
        }
      }));
      this.quickSwitcherMachineId = machineId;
      this.quickSwitcherWorkspaces = workspaces;
      this.quickSwitcherSessions = dedupeById(sessionLists.flat()).sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.setState({ error: `Failed to load sessions: ${errorMessage(error)}` });
    } finally {
      if (selectedMachineId(this.state) === machineId) this.quickSwitcherLoading = false;
    }
  }

  /**
   * Opening from the sheet lands directly in the conversation. The navigation
   * view is only meaningful on the mobile stacked layout, and returning there
   * after an explicit pick would undo the tap the user just made.
   */
  private async openSessionFromQuickSwitcher(session: SessionInfo): Promise<void> {
    await this.sessions.selectSession(session);
    await this.focusChatComposer();
  }

  private async startSessionAndOpenChat(shouldComplete: () => boolean = () => true): Promise<void> {
    // `startSession()` remains in flight until the backend session resolves;
    // open the chat as soon as the controller has inserted the temporary row.
    const start = this.sessions.startSession().catch((error: unknown) => {
      if (shouldComplete()) this.setState({ error: String(error) });
    });
    if (shouldComplete()) await this.focusChatComposer();
    void start;
  }

  private async focusNavigationTarget(target: NavigationFocusTarget): Promise<void> {
    if (target === "chat") {
      await this.focusChatComposer();
      return;
    }
    await this.focusNavigationSection(target);
  }

  private async focusNavigationSection(section: NavigationSection): Promise<void> {
    if (section === "machines" && !shouldShowMachinesSection(this.state.machines)) {
      await this.focusNavigationSection("projects");
      return;
    }
    this.panelCollapse.expandNavigationPanel();
    if (this.appShell.isMobileNavigationLayout) this.selectMainView("navigation");
    this.navigationSections.expand(section);
    await this.updateComplete;
    await nextFrame();
    await this.navigationPanel?.focusSection(section);
  }

  private async focusChatComposer(): Promise<void> {
    if (this.state.mainView !== "chat") this.selectMainView("chat");
    await this.updateComplete;
    await nextFrame();
    // The focus request may outlive the dialog transition that scheduled it.
    // Recheck the rendered boundary at the final side-effect point so a newer
    // or surviving modal keeps visual and keyboard focus ownership.
    if (this.isRenderedModalOpen()) return;
    if (this.shouldAutoFocusPrompt()) this.promptEditor?.focusInput();
  }

  private async navigateSessionTree(targetId: string, summaryChoice: SessionTreeSummaryChoice): Promise<SessionTreeNavigateResult> {
    const originMachineId = selectedMachineId(this.state);
    const originSessionId = this.state.selectedSession?.id;
    const result = await this.sessions.navigateTree(targetId, summaryChoice);
    if (!result.cancelled
      && originSessionId !== undefined
      && selectedMachineId(this.state) === originMachineId
      && this.state.selectedSession?.id === originSessionId) {
      await this.focusChatComposer();
    }
    return result;
  }

  private async forkSessionTree(entryId: string): Promise<SessionTreeForkResult> {
    // The controller selects the forked session and closes the dialog on success.
    return this.sessions.forkFromTree(entryId);
  }

  /**
   * Open the tree for a session from its row.
   *
   * The navigator existed only behind a typed /tree command, so the ability to
   * see a session's branches was invisible unless you already knew about it.
   * The command stays the source of truth; this just runs it for the row the
   * user pointed at, selecting that session first because the command acts on
   * the selected one.
   */
  private async openSessionTree(session: SessionInfo): Promise<void> {
    if (this.state.selectedSession?.id !== session.id) await this.sessions.selectSession(session);
    await this.sessions.runCommand("/tree");
  }

  private closeSessionTreeNavigator(): void {
    this.sessions.closeTreeDialog();
    void this.focusChatComposer();
  }

  private renderSessionTreeNavigator(state: AppState) {
    return state.treeDialog === undefined ? null : html`
      <session-tree-navigator
        .tree=${state.treeDialog}
        .onNavigate=${(targetId: string, summaryChoice: SessionTreeSummaryChoice) => this.navigateSessionTree(targetId, summaryChoice)}
        .onFork=${(entryId: string) => this.forkSessionTree(entryId)}
        .onAbort=${() => this.sessions.abortTreeNavigation()}
        .onCancel=${() => { this.closeSessionTreeNavigator(); }}
      ></session-tree-navigator>
    `;
  }

  private visibleWorkspacePanels(): QualifiedWorkspacePanelContribution[] {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return [];
    const context = this.createWorkspacePanelContext(workspace);
    return this.plugins.getWorkspacePanels().filter((panel) => panel.visible?.(context) ?? true);
  }

  private workspacePanelEmptyState(): WorkspacePanelEmptyState {
    const project = this.state.selectedProject;
    if (this.state.isLoadingProjects) {
      return {
        title: "Loading projects…",
        body: "Looking for projects you have added to PI WEB.",
      };
    }
    if (project === undefined) {
      return this.state.projects.length === 0
        ? {
            title: "No projects yet",
            body: "Use Actions → Add Project to add a folder. Workspace tools will appear here after you choose a workspace.",
          }
        : {
            title: "Select a project",
            body: "Choose a project from the sidebar, then select a workspace to use its tools.",
          };
    }
    if (this.state.isLoadingWorkspaces) {
      return {
        title: "Loading workspaces…",
        body: `Preparing workspace tools for ${project.name}.`,
      };
    }
    if (this.state.workspaces.length === 0) {
      return {
        title: "No workspaces found",
        body: `${project.name} does not have any available workspaces. Try selecting the project again or re-adding it.`,
      };
    }
    return {
      title: "Select a workspace",
      body: `Choose a workspace in ${project.name} to use its tools.`,
    };
  }

  private sessionEmptyMessage(): string {
    if (this.state.isLoadingProjects) return "Loading projects…";
    if (this.state.selectedWorkspace !== undefined) return "Select or start a session.";
    if (this.state.selectedProject !== undefined) return "Select a workspace to start a session.";
    if (this.state.projects.length === 0) return "Add a project to start a session.";
    return "Select a project and workspace to start a session.";
  }

  private mobilePanelBadge(panel: QualifiedWorkspacePanelContribution): unknown {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return undefined;
    return panel.badge?.(this.createWorkspacePanelContext(workspace));
  }

  private workspaceLabelItems(workspace: Workspace): WorkspaceLabelItem[] {
    return this.plugins.getWorkspaceLabelItems(this.createWorkspaceLabelContext(workspace));
  }

  private createWorkspaceLabelContext(workspace: Workspace): WorkspaceLabelContext {
    const machine = pluginMachineFromState(this.state);
    const createContext = (binding: WorkspacePluginBinding): WorkspaceLabelContext => {
      const backend = createPluginWorkspaceBackend(binding, workspace, machine.id);
      return installWorkspaceLabelScope({
        machine,
        workspace,
        state: this.state,
        files: this.createWorkspaceFiles(workspace, machine.id),
        ...(backend === undefined ? {} : { backend }),
        host: this.createWorkspaceHost(),
      }, createContext);
    };
    return createContext(coreWorkspacePluginBinding());
  }

  private createWorkspaceFiles(workspace: Workspace, machineId: string): WorkspaceFiles {
    return createPluginWorkspaceFiles(workspacesApi, workspace, machineId, () => { void this.files.refreshFiles(); });
  }

  private createWorkspaceHost(): WorkspaceHost {
    return {
      requestRender: () => { this.requestUpdate(); },
    };
  }

  private createWorkspacePanelContext(workspace: Workspace): WorkspacePanelContext {
    const machine = pluginMachineFromState(this.state);
    const machineId = machine.id;
    const createContext = (binding: WorkspacePluginBinding): WorkspacePanelContext => {
      const terminalCommandRuns = this.terminalCommandRunsForOrigin(binding.registrationPluginId, machineId);
      const backend = createPluginWorkspaceBackend(binding, workspace, machineId);
      return installWorkspacePanelScope({
        machine,
        workspace,
        state: this.state,
        files: this.createWorkspaceFiles(workspace, machineId),
        ...(backend === undefined ? {} : { backend }),
        prompt: this.createPromptEditor(),
        terminal: {
          open: (options) => { void this.openRuntimeTerminal(machineId, workspace, options); },
          runCommand: (input) => terminalCommandRuns.runCommand({ ...input, workspace }),
        },
        openTerminal: (options) => { void this.openRuntimeTerminal(machineId, workspace, options); },
        host: this.createWorkspaceHost(),
        piWebUnstable: { terminalCommandRuns },
        fileTree: this.state.fileTree,
        expandedDirs: this.state.expandedDirs,
        selectedFilePath: this.state.selectedFilePath,
        selectedFileContent: this.state.selectedFileContent,
        selectedFileLoadError: this.state.selectedFileLoadError,
        fileTreeStale: this.state.fileTreeStale,
        activeTerminalCount: this.state.activeTerminalCount,
        selectedTerminalId: this.state.selectedTerminalId,
        terminalAutoStart: this.terminalAutoStartWorkspaceId === workspace.id,
        workspaceUploadDefaultFolder: workspaceEffectiveUploadFolder(workspace.effectiveConfig, this.workspaceUploadDefaultFolder),
        onRefreshFiles: () => { void this.files.refreshFiles(); },
        onExpandDir: (path: string) => { void this.files.expandDir(path); },
        onSelectFile: (path: string) => { void this.files.selectFile(path); },
        onStartWorkspaceUpload: (files, options) => this.files.startWorkspaceUpload(files, options),
        onCancelWorkspaceUpload: (batchId) => { this.files.cancelWorkspaceUpload(batchId); },
        onClearWorkspaceUpload: (batchId) => { this.files.clearWorkspaceUpload(batchId); },
        onSelectTerminal: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => { this.selectTerminal(terminalId, options); },
      }, createContext);
    };
    return createContext(coreWorkspacePluginBinding());
  }

  private invalidateWorkspacePanels(panelId?: QualifiedContributionId): Promise<void> {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return Promise.resolve();
    return this.plugins.invalidateWorkspacePanels(this.createWorkspacePanelContext(workspace), panelId);
  }

  private getActions(): AppAction[] {
    return applyActiveShortcutPreferences(this.getDefaultActions(), this.shortcutConfig);
  }

  private getDefaultActions(): AppAction[] {
    return [...this.plugins.getActions(this.createPluginRuntimeContext()), ...this.workspaceSurfaceActions(), ...this.sessionActions(), ...this.navigationFocusActions(), ...this.panelLayoutActions()];
  }

  private workspaceSurfaceActions(): AppAction[] {
    return [{
      id: "core:workspace.refresh-current",
      title: "Refresh Current Panel",
      shortcut: "mod+shift+r",
      group: "Workspace",
      enabled: this.state.selectedWorkspace !== undefined,
      run: () => this.refreshCurrentWorkspaceSurface(),
    }];
  }

  private sessionActions(): AppAction[] {
    return [
      {
        id: "app.sessions.quick-switch",
        title: "Open Session",
        description: "Search and open a session, or start a new one, without walking the navigation panel",
        // mod+k already opens the action palette (core plugin); mod+p keeps the
        // familiar "quick open" meaning for jumping straight to a session.
        shortcut: "mod+p",
        group: "Sessions",
        run: () => { this.openQuickSwitcher(); },
      },
      {
        id: "app.sessions.new",
        title: "New Session",
        description: "Start a session in the selected workspace",
        shortcut: "mod+shift+n",
        group: "Sessions",
        enabled: this.canStartSession(),
        ...(this.canStartSession() ? {} : { disabledReason: "Select a workspace first" }),
        run: () => { void this.startSessionAndOpenChat(); },
      },
      {
        id: "app.sessions.cleanup",
        title: "Clean Up Sessions",
        description: "Preview and manually clean up idle or archived sessions on the selected machine",
        group: "Sessions",
        run: () => { this.openSessionCleanupDialog(); },
      },
    ];
  }

  private panelLayoutActions(): AppAction[] {
    return [
      {
        id: "app.layout.reset-navigation-panel-size",
        title: "Reset Navigation Panel Size",
        description: "Restore the navigation panel to its default width",
        group: "View",
        run: () => { this.resetResizablePanel("navigation"); },
      },
      {
        id: "app.layout.reset-workspace-panel-size",
        title: "Reset Workspace Panel Size",
        description: "Restore the workspace panel to its default width",
        group: "View",
        run: () => { this.resetResizablePanel("workspace"); },
      },
      {
        id: "app.layout.reset-panel-sizes",
        title: "Reset Panel Sizes",
        description: "Restore all side panels to their default widths",
        group: "View",
        run: () => { this.resetResizablePanels(); },
      },
    ];
  }

  private navigationFocusActions(): AppAction[] {
    return [
      {
        id: "app.navigation.focus-machines",
        title: "Focus Machines",
        description: "Move keyboard focus to the machine selector",
        shortcut: "mod+g m",
        group: "Navigation",
        run: () => this.focusNavigationSection("machines"),
      },
      {
        id: "app.navigation.focus-projects",
        title: "Focus Projects",
        description: "Move keyboard focus to the projects list",
        shortcut: "mod+g p",
        group: "Navigation",
        run: () => this.focusNavigationSection("projects"),
      },
      {
        id: "app.navigation.focus-workspaces",
        title: "Focus Workspaces",
        description: "Move keyboard focus to the workspaces list",
        shortcut: "mod+g w",
        group: "Navigation",
        run: () => this.focusNavigationSection("workspaces"),
      },
      {
        id: "app.navigation.focus-sessions",
        title: "Focus Sessions",
        description: "Move keyboard focus to the sessions list",
        shortcut: "mod+g s",
        group: "Navigation",
        run: () => this.focusNavigationSection("sessions"),
      },
    ];
  }

  private ensureGatewayPluginsLoaded(): Promise<void> {
    const existing = this.gatewayPluginLoadPromise;
    if (existing !== undefined) return existing;
    const load = this.loadExternalPlugins().then((complete) => {
      if (!complete && this.gatewayPluginLoadPromise === load) this.gatewayPluginLoadPromise = undefined;
    });
    this.gatewayPluginLoadPromise = load;
    return load;
  }

  private loadExternalPlugins(): Promise<boolean> {
    return this.registerExternalPlugins("PI WEB plugins", () => loadExternalPlugins("pi-web-plugins/manifest.json", {
      shouldLoadPlugin: (entry) => !this.plugins.hasPlugin(entry.id),
    }));
  }

  private async loadPluginsForSelectedMachine(): Promise<void> {
    await this.ensureGatewayPluginsLoaded();
    const machine = this.state.selectedMachine;
    if (machine?.kind !== "remote") return;
    await this.loadPluginsForMachine(machine);
  }

  private async loadPluginsForMachine(machine: Machine): Promise<void> {
    await this.ensureGatewayPluginsLoaded();
    if (machine.kind !== "remote" || this.loadedMachinePluginIds.has(machine.id)) return;
    const runtime = this.state.machineRuntimes[machine.id];
    if (runtime?.ok === true && !supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.pluginLifecycle)) {
      console.warn(`PI WEB plugins from ${machine.name} require a matching plugin lifecycle capability; update and restart PI WEB on that machine`);
      return;
    }
    const existing = this.machinePluginLoadPromises.get(machine.id);
    if (existing !== undefined) return existing;

    const load = this.registerExternalPlugins(`PI WEB plugins from ${machine.name}`, () => loadExternalPlugins(`api/machines/${encodeURIComponent(machine.id)}/pi-web-plugins/manifest.json`, {
      machineId: machine.id,
      shouldLoadPlugin: (entry) => !this.plugins.hasPlugin(machineScopedPluginId(machine.id, entry.id))
        && this.plugins.shouldLoadRemotePlugin(entry.id, entry.machineSpecific),
    }))
      .then((loaded) => { if (loaded) this.loadedMachinePluginIds.add(machine.id); })
      .finally(() => { this.machinePluginLoadPromises.delete(machine.id); });
    this.machinePluginLoadPromises.set(machine.id, load);
    await load;
  }

  private async registerExternalPlugins(label: string, load: () => Promise<ExternalPluginLoadResult>): Promise<boolean> {
    try {
      const result = await load();
      let complete = result.failures.length === 0;
      for (const failure of result.failures) {
        console.warn(`Failed to load PI WEB plugin ${failure.entry.id} (${failure.entry.module})`, failure.error);
      }
      for (const registration of result.registrations) {
        if (this.plugins.hasPlugin(registration.id)) continue;
        try {
          this.plugins.register(registration);
        } catch (error) {
          complete = false;
          console.warn(`Failed to register PI WEB plugin ${registration.id}`, error);
        }
      }
      this.applyPreferredTheme(false);
      this.requestUpdate();
      return complete;
    } catch (error) {
      console.warn(`Failed to load ${label}`, error);
      return false;
    }
  }

  private createPromptEditor(): PluginPromptEditor {
    return {
      insertText: (text: string) => {
        const editor = this.promptEditor?.view;
        if (!editor) return;
        if (!editor.hasFocus) editor.focus();
        const sel = editor.state.selection.main;
        editor.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
        });
      },
      getText: () => {
        return this.promptEditor?.view?.state.doc.toString() ?? "";
      },
      getSelection: () => {
        const editor = this.promptEditor?.view;
        if (!editor) return null;
        const sel = editor.state.selection.main;
        if (sel.empty) return null;
        return { start: sel.from, end: sel.to, text: editor.state.sliceDoc(sel.from, sel.to) };
      },
    };
  }

  private createPluginRuntimeContext(): PluginRuntimeContext {
    const createContext = (origin: string): PluginRuntimeContext => installPluginRuntimeScope({
      state: this.state,
      prompt: this.createPromptEditor(),
      piWebUnstable: {
        terminalCommandRuns: this.terminalCommandRunsForOrigin(origin),
        openSettings: (section) => { this.openSettings(section); },
      },
      openActionPalette: () => { this.openActionPalette(); },
      focusPrompt: () => { void this.focusChatComposer(); },
      addProject: () => { this.openProjectDialog(); },
      addMachine: () => { this.openMachineDialog(); },
      refreshSelectedMachine: async () => {
        await Promise.all([this.machines.refreshMachineHealth(), this.machines.refreshMachineRuntime()]);
      },
      removeSelectedMachine: () => this.removeMachine(),
      openSelectedMachine: () => { this.openSelectedMachine(); },
      configureAuth: () => this.auth.openLogin(),
      logoutAuth: () => this.auth.openLogout(),
      openThemePicker: () => { this.openThemeDialog(); },
      openModelPicker: () => this.openModelDialog(),
      openThinkingLevelPicker: () => this.openThinkingDialog(),
      selectMainView: (view) => { this.selectMainView(view); },
      selectWorkspaceTool: (tool) => { this.openWorkspaceTool(tool); },
      openTerminal: (options) => { this.openTerminal(options); },
      refreshFiles: () => this.files.refreshFiles(),
      refreshWorkspacePanels: (panelId) => this.invalidateWorkspacePanels(panelId),
      refreshAppData: () => this.refreshAppData(),
      checkForPiWebUpdates: () => this.piWebStatusController.checkForUpdates(),
      reloadPage: () => { this.hardReloadApp(); },
      deleteWorkspace: (workspace) => this.deleteWorkspace(workspace),
      startSession: () => this.withChatScrollTransition(() => this.startSessionAndOpenChat()),
      archiveSession: () => this.sessions.archiveSession(),
      reloadSession: () => this.sessions.reloadSession(),
      deleteCachedNewSession: () => this.sessions.deleteCachedNewSession(),
      stopActiveWork: async () => { await this.sessions.stopActiveWork(); },
    }, createContext);
    return createContext("core");
  }

  private async deleteWorkspace(workspace = this.state.selectedWorkspace): Promise<void> {
    if (workspace === undefined) return;
    if (!canDeleteWorkspace(workspace)) {
      this.setState({ error: "Workspace removal is not available" });
      return;
    }
    if (isWorkspaceDeletionPending(this.state, workspace)) return;
    const removal = workspace.removal;
    const confirmation = workspaceRemovalConfirmation(workspace);
    if (removal === undefined || confirmation === undefined || !confirm(confirmation)) return;

    const machineId = selectedMachineId(this.state);
    try {
      const run = await workspacesApi.deleteWorkspace(
        workspace.projectId,
        workspace.id,
        removal.precondition,
        machineId,
      );
      if (selectedMachineId(this.state) !== machineId) return;
      this.recordWorkspaceDeletionRun(run, machineId);
      const commandWorkspace = await this.workspaceForCommandRun(run);
      if (selectedMachineId(this.state) !== machineId) return;
      if (commandWorkspace !== undefined) void this.openRuntimeTerminal(machineId, commandWorkspace, { terminalId: run.terminalId });
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.setState({ error: `Failed to start workspace removal: ${errorMessage(error)}` });
    }
  }

  private async workspaceForCommandRun(run: TerminalCommandRun): Promise<Workspace | undefined> {
    let workspaces = this.state.selectedProject?.id === run.projectId ? this.state.workspaces : this.state.workspacesByProjectId[run.projectId];
    if (workspaces === undefined || workspaces.length === 0) workspaces = await this.workspaces.refreshProjectWorkspaces(run.projectId);
    return workspaces.find((workspace) => workspace.id === run.workspaceId);
  }

  private recordWorkspaceDeletionRun(run: TerminalCommandRun, machineId: string): void {
    if (selectedMachineId(this.state) !== machineId) return;
    const workspaceId = targetWorkspaceIdForRun(run);
    if (workspaceId === undefined) return;
    this.setState({ workspaceDeletionRuns: { ...this.state.workspaceDeletionRuns, [workspaceId]: run } });
    this.updateWorkspaceDeletionPolling();
  }

  private async refreshWorkspaceDeletionRuns(): Promise<void> {
    if (this.refreshingWorkspaceDeletionRuns) return;
    const machineId = selectedMachineId(this.state);
    const project = this.state.selectedProject;
    if (project === undefined) {
      this.setState({ workspaceDeletionRuns: {} });
      this.updateWorkspaceDeletionPolling();
      return;
    }

    this.refreshingWorkspaceDeletionRuns = true;
    try {
      const runs = await this.terminalCommandRunsForOrigin("core", machineId).listCommandRuns(workspaceDeletionRunFilter(project.id));
      if (selectedMachineId(this.state) !== machineId) return;
      const latestRuns = latestWorkspaceDeletionRuns(runs);
      this.setState({ workspaceDeletionRuns: latestRuns });
      for (const run of Object.values(latestRuns)) {
        if (!isWorkspaceDeletionRunPending(run)) await this.handleCompletedWorkspaceDeletionRun(run, machineId);
      }
    } catch (error) {
      console.warn("Failed to refresh workspace deletion runs", error);
    } finally {
      this.refreshingWorkspaceDeletionRuns = false;
      this.updateWorkspaceDeletionPolling();
    }
  }

  private updateWorkspaceDeletionPolling(): void {
    const hasPendingDeletion = Object.values(this.state.workspaceDeletionRuns).some(isWorkspaceDeletionRunPending);
    if (hasPendingDeletion && this.workspaceDeletionPollTimer === undefined) {
      this.workspaceDeletionPollTimer = window.setInterval(() => { void this.refreshWorkspaceDeletionRuns(); }, 1000);
      return;
    }
    if (!hasPendingDeletion && this.workspaceDeletionPollTimer !== undefined) {
      window.clearInterval(this.workspaceDeletionPollTimer);
      this.workspaceDeletionPollTimer = undefined;
    }
  }

  private async handleCompletedWorkspaceDeletionRun(run: TerminalCommandRun, machineId = selectedMachineId(this.state)): Promise<void> {
    if (selectedMachineId(this.state) !== machineId) return;
    const runKey = machineScopedKey(machineId, run.id);
    if (this.handledWorkspaceDeletionRunIds.has(runKey)) return;
    const workspaceId = targetWorkspaceIdForRun(run);
    if (workspaceId === undefined) return;
    this.handledWorkspaceDeletionRunIds.add(runKey);

    if (run.status === "succeeded") {
      await this.workspaces.refreshAfterWorkspaceDeleted(run.projectId, workspaceId);
      if (selectedMachineId(this.state) !== machineId) return;
      this.setState({ workspaceDeletionRuns: omitWorkspaceDeletionRun(this.state.workspaceDeletionRuns, workspaceId) });
      this.updateWorkspaceDeletionPolling();
      return;
    }

    if (run.status === "failed") {
      this.setState({ error: "Workspace removal failed. See terminal output." });
      this.updateWorkspaceDeletionPolling();
    }
  }

  /** Give the restored composer the caret it was tapped for. */
  private async focusPromptEditorSoon(): Promise<void> {
    await this.updateComplete;
    if (this.shouldAutoFocusPrompt()) this.promptEditor?.focusInput();
  }

  private openMachineDialog(): void {
    this.pushModalLayerFrame();
    this.setState({ machineDialogOpen: true, error: "" });
  }

  private async submitMachineDialog(input: MachineDialogSubmit): Promise<void> {
    const machine = await this.machines.addMachine(input);
    if (machine !== undefined) {
      this.setState({ machineDialogOpen: false });
      this.schedulePiWebStatusRefresh();
    }
  }

  private async renameMachine(machine: Machine, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === machine.name) return;
    await this.machines.updateMachine(machine, { name: trimmed });
  }

  private async removeMachine(machine: Machine | undefined = this.state.selectedMachine): Promise<void> {
    if (machine === undefined || machine.kind === "local") return;
    if (!window.confirm(`Remove ${machine.name}?\n\nThis only removes it from this PI WEB gateway.`)) return;
    const wasSelected = this.state.selectedMachine?.id === machine.id;
    if (wasSelected) this.rememberCurrentMachineNavigation();
    const fallback = await this.machines.deleteMachine(machine, { selectFallback: !wasSelected });
    if (!this.state.machines.some((candidate) => candidate.id === machine.id)) this.machineNavigation.forget(machine.id);
    if (wasSelected && fallback !== undefined) await this.selectMachineWithMemory(fallback, { rememberCurrent: false });
  }

  private openSelectedMachine(): void {
    const machine = this.state.selectedMachine;
    if (machine?.kind !== "remote" || machine.baseUrl === undefined) return;
    window.open(machine.baseUrl, "_blank", "noopener,noreferrer");
  }

  private runAction(action: AppAction): void {
    void Promise.resolve()
      .then(() => action.run())
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Action failed: ${action.id}`, error);
        this.setState({ error: `Action failed: ${message}` });
      });
  }

  private async openModelDialog() {
    const [models, catalog] = await Promise.all([this.sessions.listModels(), this.sessions.listModelCatalog()]);
    const selectedValue = this.currentModelValue();    this.setState({
      modelDialog: {
        title: "Select Model",
        ...(selectedValue !== undefined ? { selectedValue } : {}),
        options: this.modelDialogOptions(models),
        catalog,
      },
    });
  }

  private currentModelValue(): string | undefined {
    const provider = this.state.status?.model?.provider;
    const id = this.state.status?.model?.id;
    return provider !== undefined && id !== undefined ? `${provider}/${id}` : undefined;
  }

  private modelDialogOptions(models: readonly Pick<SessionModel, "provider" | "id">[]): CommandOption[] {
    const selectedValue = this.currentModelValue();
    return models.map((model) => {
      const provider = model.provider ?? "";
      const id = model.id ?? "";
      const value = `${provider}/${id}`;
      return { value, label: `${id}${value === selectedValue ? " ✓ current" : ""}`, description: provider };
    });
  }

  private async pickModel(value: string) {
    this.setState({ modelDialog: undefined });
    const slash = value.indexOf("/");
    if (slash <= 0) return;
    await this.sessions.setModel(value.slice(0, slash), value.slice(slash + 1));
  }

  private openThemeDialog() {
    const themes = this.plugins.getThemes();
    const resolution = this.resolveCurrentThemePreference(themes);
    const selectedThemeId = resolution.selectedTheme?.id;
    const autoValue = this.themePreference.auto ? THEME_AUTO_OFF_VALUE : THEME_AUTO_ON_VALUE;
    this.pushModalLayerFrame();
    this.setState({
      themeDialog: {
        title: "Select Theme",
        selectedValue: selectedThemeId === undefined ? autoValue : `${THEME_OPTION_PREFIX}${selectedThemeId}`,
        options: [
          {
            value: autoValue,
            label: `Auto ${this.themePreference.auto ? "✓ on" : "off"}`,
            description: this.autoThemeDescription(resolution),
          },
          ...themes.map((theme) => ({
            value: `${THEME_OPTION_PREFIX}${theme.id}`,
            label: this.themeOptionLabel(theme, selectedThemeId),
            description: this.themeOptionDescription(theme),
          })),
        ],
      },
    });
  }

  /**
   * Apply an interface size chosen from the appearance panel and remember it
   * on this device. Applied on every change rather than on release, because a
   * size setting whose effect you cannot see while choosing it is guesswork.
   */
  private setUiScale(scale: number): void {
    this.uiScale = clampUiScale(scale);
    applyUiScale(this.uiScale);
    writeStoredUiScale(this.uiScale);
  }

  /** Apply a theme chosen from the appearance panel and remember it. */
  private selectTheme(themeId: QualifiedContributionId): void {
    const theme = this.plugins.getThemes().find((candidate) => candidate.id === themeId);
    if (theme === undefined) return;
    this.themePreference = { themeId: theme.id, auto: this.themePreference.auto };
    this.applyPreferredTheme(true);
  }

  /**
   * Follow the system's light/dark preference, using the pair the chosen theme
   * belongs to. Without a pair there is nothing to switch between, so the
   * switch is left off rather than silently doing nothing.
   */
  private setFollowSystemTheme(follow: boolean): void {
    this.themePreference = { themeId: this.themePreference.themeId, auto: follow };
    this.applyPreferredTheme(true);
  }

  private pickTheme(value: string) {
    this.setState({ themeDialog: undefined });
    if (value === THEME_AUTO_ON_VALUE || value === THEME_AUTO_OFF_VALUE) {
      const selectedThemeId = this.resolveCurrentThemePreference().selectedTheme?.id;
      if (selectedThemeId === undefined) return;
      this.themePreference = { themeId: selectedThemeId, auto: value === THEME_AUTO_ON_VALUE };
      this.applyPreferredTheme(true);
      return;
    }
    if (!value.startsWith(THEME_OPTION_PREFIX)) return;
    const themeId = value.slice(THEME_OPTION_PREFIX.length);
    const theme = this.plugins.getThemes().find((candidate) => candidate.id === themeId);
    if (theme === undefined) return;
    this.themePreference = { themeId: theme.id, auto: this.themePreference.auto };
    this.applyPreferredTheme(true);
  }

  private applyPreferredTheme(persist: boolean): void {
    const theme = this.resolveCurrentThemePreference().activeTheme;
    if (theme === undefined) return;
    this.activeThemeId = theme.id;
    applyPiWebTheme(theme);
    if (persist) writeStoredThemePreference(this.themePreference);
  }

  private resolveCurrentThemePreference(themes = this.plugins.getThemes()): ThemePreferenceResolution {
    return resolveThemePreference({
      themes,
      themePairs: this.plugins.getThemePairs(),
      preference: this.themePreference,
      prefersLight: this.systemPrefersLight(),
    });
  }

  private themePairForTheme(themeId: QualifiedContributionId): QualifiedThemePairContribution | undefined {
    return findThemePairForTheme(this.plugins.getThemePairs(), themeId);
  }

  private systemPrefersLight(): boolean {
    return this.systemLightThemeMedia?.matches ?? false;
  }

  private autoThemeDescription(resolution: ThemePreferenceResolution): string {
    if (!this.themePreference.auto) return "Follow the system light/dark preference when the selected theme has a pair.";
    if (resolution.selectedTheme === undefined) return "Follow the system light/dark preference when the selected theme has a pair.";
    if (resolution.selectedThemePair === undefined) return "On, but the selected theme has no light/dark pair, so it will stay selected.";
    return `On · ${resolution.selectedThemePair.name} follows the system ${this.systemPrefersLight() ? "light" : "dark"} preference.`;
  }

  private themeOptionLabel(theme: QualifiedThemeContribution, selectedThemeId: QualifiedContributionId | undefined): string {
    const markers = [
      ...(theme.id === selectedThemeId ? ["selected"] : []),
      ...(theme.id === this.activeThemeId && theme.id !== selectedThemeId ? ["active"] : []),
    ];
    return markers.length === 0 ? theme.name : `${theme.name} ✓ ${markers.join(" · ")}`;
  }

  private themeOptionDescription(theme: QualifiedThemeContribution): string {
    const parts: string[] = [theme.colorScheme];
    if (this.themePairForTheme(theme.id) !== undefined) parts.push("auto pair");
    if (theme.description !== undefined) parts.push(theme.description);
    return parts.join(" · ");
  }

  private async openThinkingDialog() {
    const levels = await this.sessions.listThinkingLevels();
    const current = this.state.status?.thinkingLevel ?? "off";
    this.pushModalLayerFrame();
    this.setState({
      thinkingDialog: {
        title: "Select Thinking Level",
        selectedValue: current,
        options: levels.map((level) => { const description = thinkingDescription(level); return { value: level, label: `${level}${level === current ? " ✓ current" : ""}`, ...(description === undefined ? {} : { description }) }; }),
      },
    });
  }

  private async pickThinking(value: string) {
    this.setState({ thinkingDialog: undefined });
    if (value !== "") await this.sessions.setThinkingLevel(value);
  }

  /** Resolves false when the message was not accepted, so the composer can restore it. */
  /**
   * Runs a goal slash command in the focused session.
   *
   * The extension owns goal state, so the command text is sent exactly as a
   * person would type it: the same audit trail, token accounting and focus
   * rules apply, including the picker the extension raises when a session has
   * no focused goal and the workspace has more than one open.
   */
  private async runGoalCommand(command: string): Promise<void> {
    if (this.state.selectedSession === undefined) return;
    await this.sendPrompt(command);
  }

  private async sendPrompt(text: string, streamingBehavior?: "steer" | "followUp", attachments?: import("../api").PromptAttachment[], delivery?: import("../../../shared/apiTypes").PromptAttachmentDelivery, replay?: { clientMessageId?: string }): Promise<boolean> {
    const hasAttachments = attachments !== undefined && attachments.length > 0;
    // Handled locally by the auth flow; nothing to restore.
    if (!hasAttachments && streamingBehavior === undefined && this.auth.handleSlashCommand(text)) return true;
    return await this.sessions.send(text, streamingBehavior, attachments, delivery, replay);
  }

  // Stable handler identities for child components. Inlined arrow closures
  // would be a fresh reference on every render, forcing Lit to re-commit the
  // bindings each time the app re-renders; bound class fields keep them constant.
  private readonly handleSendPrompt = (text: string, streamingBehavior?: "steer" | "followUp", attachments?: import("../api").PromptAttachment[], delivery?: import("../../../shared/apiTypes").PromptAttachmentDelivery, replay?: { clientMessageId?: string }): Promise<boolean> =>
    this.sendPrompt(text, streamingBehavior, attachments, delivery, replay);

  /**
   * Put messages that left the queue back where they can be edited and sent
   * again.
   *
   * Recalling one, clearing the queue and pressing stop are the same
   * transition with three triggers - a message the server was holding is no
   * longer held - and the product owes the sender the same thing in all three:
   * the text, not a deletion. Keeping that in one place is what stops the next
   * caller from being the one that forgets.
   */
  private restoreToComposer(messages: readonly QueuedSessionMessage[]): void {
    const texts = messages.map((message) => message.text).filter((text) => text.trim() !== "");
    if (texts.length === 0) return;
    this.promptEditor?.replaceText(texts.join("\n\n"));
    if (this.shouldAutoFocusPrompt()) this.promptEditor?.focusInput();
  }

  private readonly handleStopActiveWork = (): void => {
    // Stop cancels the turn, so the queue written for that turn goes with it.
    void this.sessions.stopActiveWork().then((discarded) => { this.restoreToComposer(discarded); });
  };

  private readonly handleClearServerQueue = (queued: QueuedSessionMessage[]): void => {
    this.restoreToComposer(queued);
    void this.sessions.clearServerQueue();
  };

  /**
   * Open the artifact a finished subagent run left behind. Running work has
   * nothing to open yet, which is why those rows are inert rather than absent:
   * the point of the row is to say that the child exists and what it is doing.
   */
  // Openable even without a result file: the server falls back to the run's own
  // transcript, so a running child shows what it has done so far instead of
  // being an inert row.
  private readonly handleOpenSubagentRun = (run: SessionSubagentRunInfo): void => {
    void this.sessions.openSubagentRunOutput(run);
  };

  private readonly handleOpenBackgroundTask = (task: SessionBackgroundTaskInfo): void => {
    if (!task.hasOutput) return;
    void this.sessions.openBackgroundTaskOutput(task);
  };

  private readonly handleCloseActivityOutput = (): void => {
    this.sessions.closeActivityOutput();
  };

  private readonly handleOpenSubagentSession = (info: SessionSubagentInfo): void => {
    this.openSubagent(info);
  };

  private readonly handleRecallQueuedMessage = (message: QueuedSessionMessage): void => {
    // The composer is filled only once the server confirms the message left the
    // queue, so a recall that lost the race to the agent does not offer the
    // text for a second send.
    void this.sessions.recallQueuedMessage(message).then((recalled) => {
      if (recalled) this.restoreToComposer([message]);
    });
  };

  private readonly handleDismissWarning = (dismissId: string): void => {
    void this.sessions.dismissWarning(dismissId);
  };

  private readonly handleSubmitAsk = (askId: string, submission: AskUserSubmission): Promise<void> => this.sessions.submitAsk(askId, submission);

  private readonly handleAnswerDialog = (dialogId: string, value: ExtensionDialogAnswer): Promise<void> => this.sessions.answerDialog(dialogId, value);

  private readonly handleCancelDialog = (dialogId: string): Promise<void> => this.sessions.cancelDialog(dialogId);

  private readonly handleDismissClosedDialog = (dialogId: string): void => {
    this.sessions.dismissClosedDialog(dialogId);
  };

  private readonly handleDismissNotification = (notificationId: string): void => {
    void this.notifications.dismissNotification(notificationId);
  };

  private readonly handleDismissAllNotifications = (): void => {
    void this.notifications.dismissAll();
  };

  private readonly handleToggleWarnings = (): void => {
    const next = toggleSessionWarnings(this.sessionWarningVisibility);
    if (next === this.sessionWarningVisibility) return;
    this.sessionWarningVisibility = next;
    this.requestUpdate();
  };

  /**
   * Put a sent prompt back in the composer so a failed turn can be retried
   * without retyping it or re-picking its images.
   */
  private readonly handleResendMessage = (prompt: RecoveredPrompt): void => {
    this.promptEditor?.restorePrompt(prompt);
  };

  private readonly handleSelectModel = (): void => {
    void this.openModelDialog();
  };

  private readonly handleToggleModelEnabled = async (provider: string, modelId: string, enabled: boolean): Promise<void> => {
    const catalog = await this.sessions.setModelEnabled(provider, modelId, enabled);
    const dialog = this.state.modelDialog;
    if (catalog === undefined || dialog === undefined) return;
    // The fresh catalog's enabled rows are the session's Enabled list in
    // order, so rebuilding both data sets keeps the dialog's modes and pi's
    // persisted scope consistent without another round trip.
    this.setState({ modelDialog: { ...dialog, catalog, options: this.modelDialogOptions(catalog.filter((entry) => entry.enabled)) } });
  };

  private readonly handleSelectThinking = (): void => {
    void this.openThinkingDialog();
  };

  private renderChatView(state: AppState, session: SessionInfo) {
    return html`
      <chat-view .goals=${this.state.workspaceGoals} .onRunGoalCommand=${(_goal: GoalRecordSummary, command: string) => this.runGoalCommand(command)} .sessionId=${session.id} .messages=${state.messages} .messageStart=${state.messagePageStart} .messageEnd=${state.messagePageEnd} .messageTotal=${state.messagePageTotal} .hasMore=${state.messagePageStart > 0} .loadingMore=${state.isLoadingEarlierMessages} .isSendingPrompt=${state.sendingPrompts[session.id] === true} .isCompacting=${state.status?.isCompacting === true} .pendingMessageCount=${state.status?.pendingMessageCount ?? 0} .clientQueuedMessages=${state.clientQueuedSessionMessages[session.id] ?? []} .status=${state.status} .activity=${state.activity} .pendingAsk=${state.pendingAsk} .pendingDialogs=${state.pendingDialogs} .closedDialogs=${state.closedDialogs} .onAnswerDialog=${this.handleAnswerDialog} .onCancelDialog=${this.handleCancelDialog} .onDismissClosedDialog=${this.handleDismissClosedDialog} .onResendMessage=${this.handleResendMessage} .askDraftSessionId=${machineSessionKey(selectedMachineId(state), session.id)} .onSubmitAsk=${this.handleSubmitAsk} .notificationInbox=${selectedNotificationView(state.selectedNotificationInbox)} .subagents=${state.subagents} .subagentRuns=${state.subagentRuns} .backgroundTasks=${state.backgroundTasks} .activityOutput=${state.activityOutput} .onCloseActivityOutput=${this.handleCloseActivityOutput} .onOpenSubagent=${this.handleOpenSubagentSession} .onOpenSubagentRun=${this.handleOpenSubagentRun} .onOpenBackgroundTask=${this.handleOpenBackgroundTask} .onClearServerQueue=${this.handleClearServerQueue} .onRecallQueuedMessage=${this.handleRecallQueuedMessage} .onDismissWarning=${this.handleDismissWarning} .onDismissNotification=${this.handleDismissNotification} .onDismissAllNotifications=${this.handleDismissAllNotifications} .warningsVisible=${!this.sessionWarningVisibility.collapsed} .onToggleWarnings=${this.handleToggleWarnings} .onLoadMore=${() => this.withChatPrependTransition(() => this.sessions.loadEarlierMessages())}></chat-view>
    `;
  }

  private renderStatusBar(state: AppState) {
    const warningCount = this.sessionWarningVisibility.warningCount;
    return html`
      <status-bar .status=${state.status} .warningCount=${warningCount} .warningsExpanded=${warningCount > 0 && !this.sessionWarningVisibility.collapsed} .onToggleWarnings=${this.handleToggleWarnings}></status-bar>
    `;
  }

  private renderErrorBanner(error: string) {
    const decision = bannerHoldDecision({ shownAt: this.bannerShownAt, now: Date.now(), next: error });
    if (decision.kind === "hold") {
      if (this.bannerHoldTimer !== undefined) window.clearTimeout(this.bannerHoldTimer);
      this.bannerHoldTimer = window.setTimeout(() => { this.bannerHoldTimer = undefined; this.requestUpdate(); }, decision.retryInMs);
      return this.heldErrorBanner;
    }
    if (decision.kind === "hide") {
      this.bannerShownAt = undefined;
      this.heldErrorBanner = null;
      return null;
    }
    this.bannerShownAt ??= Date.now();
    if (error !== this.lastScheduledError) {
      this.lastScheduledError = error;
      this.scheduleTransientErrorDismissal(error);
    }
    this.heldErrorBanner = errorBanner(error, () => { this.setState({ error: "" }); });
    return this.heldErrorBanner;
  }

  private renderContextBar() {
    if (!this.appShell.isMobileNavigationLayout) return null;
    return html`
      <app-context-bar
        .machines=${this.state.machines}
        .machine=${this.state.selectedMachine}
        .project=${this.state.selectedProject}
        .workspace=${this.state.selectedWorkspace}
        .session=${this.state.selectedSession}
        ?emphasizeSession=${this.state.mainView === "chat"}
        ?isWorking=${this.state.mainView === "chat" && this.state.selectedSession !== undefined && isActive(this.state)}
        .refreshControl=${this.appShell.shouldShowAppRefreshInContextBar() ? this.renderAppRefresh() : undefined}
        .onOpenSection=${(section: NavigationSection) => { this.openNavigationSection(section); }}
        .onQuickSwitch=${() => { this.openQuickSwitcher(); }}
        .onRenameSession=${(name: string) => {
          const session = this.state.selectedSession;
          if (session === undefined) return;
          this.applyRenameToQuickSwitcher(session.id, name);
          void this.sessions.renameSession(session, name);
        }}
        .onShowActions=${() => { this.setState({ actionPaletteOpen: true }); }}
        .onOpenTools=${() => { this.openMobileToolSheet(); }}
      ></app-context-bar>
    `;
  }

  /**
   * The workspace views, reachable from one control instead of a strip.
   *
   * The strip of unlabelled icons cost 57px on every mobile surface and put the
   * terminal behind a glyph. The sheet lists the same views by name, so nothing
   * is lost and the transcript keeps the height.
   */
  private renderMobileToolSheet() {
    if (!this.mobileToolSheetOpen) return null;
    return html`
      <app-mobile-tool-sheet
        .tabs=${this.mobileMainTabs()}
        .selectedView=${this.state.mainView}
        .onSelect=${(view: AppState["mainView"]) => { this.selectMainView(view); }}
        .onClose=${() => { this.mobileToolSheetOpen = false; }}
      ></app-mobile-tool-sheet>
    `;
  }

  private openMobileToolSheet(): void {
    this.pushModalLayerFrame();
    this.mobileToolSheetOpen = true;
  }

  private mobileMainTabs(): AppMobileView[] {
    const unreadCount = unreadSessionCount(this.state.sessions, this.unreadSessionIds);
    return [
      {
        id: "navigation",
        label: "Sessions",
        icon: "navigation",
        className: "navigation-tab",
        ...(unreadCount === 0 ? {} : { badge: unreadCount, badgeLabel: `${String(unreadCount)} unread`, badgeTone: "unread" }),
      },
      { id: "chat", label: "Chat", icon: "chat" },
      ...this.visibleWorkspacePanels().map((panel): AppMobileView => {
        const icon = panel.icon;
        return {
          id: panel.id,
          label: panel.title,
          ...(icon === undefined ? {} : { icon }),
          badge: this.mobilePanelBadge(panel),
        };
      }),
    ];
  }

  private renderAppRefresh() {
    return html`<app-refresh-control .onReload=${() => { this.hardReloadApp(); }}></app-refresh-control>`;
  }

  override render() {
    const state = this.state;
    return html`
      <div class=${this.panelCollapse.shellClass(state.mainView, state.selectedWorkspace !== undefined)} style=${this.panelResize.shellStyle({ navigation: this.resizablePanelConstraints("navigation"), workspace: this.resizablePanelConstraints("workspace") })}>
        <aside id="navigation-panel">${this.appShell.isMobileNavigationLayout ? null : this.renderNavigationPanel()}</aside>
        ${this.renderNavigationPanelEdgeControl()}
        <main class=${mainViewClass(state.mainView)}>
          ${this.renderContextBar()}

          ${this.renderErrorBanner(state.error)}
          ${this.renderSelfUpdateBanner()}
          ${deprecatedAgentInputsBanner(deprecatedAgentInputsWarnings(state.machines, state.machineRuntimes))}
          <div class="mobile-navigation-panel">${this.appShell.isMobileNavigationLayout ? this.renderNavigationPanel() : null}</div>
          ${state.selectedSession ? html`
            ${this.renderChatView(state, state.selectedSession)}
            <prompt-editor .sessionId=${state.selectedSession.id} .cwd=${state.selectedWorkspace?.path} .machineId=${selectedMachineId(state)} .projectId=${state.selectedWorkspace?.projectId} .workspaceId=${state.selectedWorkspace?.id} .disabled=${state.selectedSession.archived === true} .canSteer=${state.status?.isStreaming === true} .isCompacting=${state.status?.isCompacting === true} .canStop=${state.status?.isStreaming === true || state.status?.isBashRunning === true || state.status?.isCompacting === true || (state.status?.pendingMessageCount ?? 0) > 0} .status=${state.status} .availableThinkingLevels=${state.availableThinkingLevels} .sending=${state.sendingPrompts[state.selectedSession.id] === true} ?collapsed=${this.composerCollapsed} .onExpand=${() => { this.composerCollapsed = false; void this.focusPromptEditorSoon(); }} .onSend=${this.handleSendPrompt} .onStop=${this.handleStopActiveWork} .onSelectModel=${this.handleSelectModel} .onSelectThinking=${this.handleSelectThinking} .speechToText=${this.speechToTextConfig}></prompt-editor>
            ${this.renderStatusBar(state)}
            ${state.commandDialog !== undefined ? html`<command-picker .title=${state.commandDialog.title} .options=${state.commandDialog.options} .onPick=${(value: string) => this.sessions.respondToCommand(state.commandDialog?.requestId ?? "", value)} .onCancel=${() => { this.sessions.cancelCommand(); }}></command-picker>` : null}
            ${state.modelDialog !== undefined ? html`<model-picker title=${state.modelDialog.title} .options=${state.modelDialog.options} .catalog=${state.modelDialog.catalog} .selectedValue=${state.modelDialog.selectedValue} .onPick=${(value: string) => { void this.pickModel(value); }} .onToggleEnabled=${this.handleToggleModelEnabled} .onCancel=${() => { this.setState({ modelDialog: undefined }); }}></model-picker>` : null}
            ${state.thinkingDialog !== undefined ? html`<command-picker title=${state.thinkingDialog.title} .options=${state.thinkingDialog.options} .selectedValue=${state.thinkingDialog.selectedValue} .onPick=${(value: string) => { void this.pickThinking(value); }} .onCancel=${() => { this.setState({ thinkingDialog: undefined }); }}></command-picker>` : null}
          ` : html`<div class="empty">${this.sessionEmptyMessage()}</div>`}
        </main>
        ${this.renderWorkspacePanelEdgeControl()}
        ${this.renderWorkspacePanel()}
        ${state.authDialog !== undefined ? html`<auth-dialog .state=${state.authDialog} .onChooseMethod=${(authType: "oauth" | "api_key") => { void this.auth.chooseLoginMethod(authType); }} .onSelectProvider=${(providerId: string, authType: "oauth" | "api_key") => { void this.auth.selectLoginProvider(providerId, authType); }} .onLogoutProvider=${(providerId: string) => { void this.auth.logoutProvider(providerId); }} .onOAuthInput=${(value: string) => { this.auth.updateOAuthInput(value); }} .onOAuthRespond=${(value?: string) => { void this.auth.respondOAuth(value); }} .onOAuthCancel=${() => { void this.auth.cancelOAuth(); }} .onCancel=${() => { this.auth.closeDialog(); }}></auth-dialog>` : null}
        ${this.renderMobileToolSheet()}
        ${this.quickSwitcherOpen ? html`<quick-switcher
          .loading=${this.quickSwitcherLoading}
          .sessions=${this.quickSwitcherSessions}
          .workspaces=${this.quickSwitcherWorkspaces}
          .selectedSession=${state.selectedSession}
          .selectedWorkspace=${state.selectedWorkspace}
          .activeSessionIds=${this.activeSessionIds()}
          .sessionStates=${this.sessionStateKinds()}
          .waitingSessionIds=${this.waitingSessionIds()}
          .unreadSessionIds=${this.unreadSessionIds}
          .interruptedSessionIds=${this.interruptedSessionIds}
          .errorSessionIds=${this.errorSessionIds()}
          .pinnedSessionIds=${this.pinnedSessionIds}
          .projects=${state.projects}
          .canStartSession=${this.canStartSession()}
          .onCreateSession=${() => { void this.startSessionAndOpenChat(); }}
          .onOpenSession=${(session: SessionInfo) => { void this.openSessionFromQuickSwitcher(session); }}
          .onSelectWorkspace=${(workspace: Workspace) => { void this.workspaces.selectWorkspace(workspace); }}
          .onBrowse=${() => { this.openNavigationSection("projects"); }}
          .onTogglePin=${(session: SessionInfo) => { this.togglePinnedSession(session); }}
          .onRenameSession=${(session: SessionInfo, name: string) => {
            this.applyRenameToQuickSwitcher(session.id, name);
            return this.sessions.renameSession(session, name);
          }}
          .onClose=${() => { this.quickSwitcherOpen = false; }}
        ></quick-switcher>` : null}
        ${state.actionPaletteOpen ? html`<action-palette .actions=${this.getActions()} .onRun=${(action: AppAction) => { this.setState({ actionPaletteOpen: false }); this.runAction(action); }} .onCancel=${() => { this.setState({ actionPaletteOpen: false }); }}></action-palette>` : null}
        ${this.renderSessionTreeNavigator(state)}
        ${state.projectDialogOpen ? html`<project-dialog .machineId=${selectedMachineId(state)} .onSubmit=${(path: string, create: boolean, trust: ProjectTrustChoice | undefined) => this.projects.addProject(path, create, trust)} .onCancel=${() => { this.setState({ projectDialogOpen: false }); }}></project-dialog>` : null}
        ${state.machineDialogOpen ? html`<machine-dialog .error=${state.error} .onSubmit=${(input: MachineDialogSubmit) => this.submitMachineDialog(input)} .onCancel=${() => { this.setState({ machineDialogOpen: false }); }}></machine-dialog>` : null}
        ${this.sessionCleanupDialog !== undefined ? html`<session-cleanup-dialog .preview=${this.sessionCleanupDialog.preview} .previewRequest=${this.sessionCleanupDialog.previewRequest} .result=${this.sessionCleanupDialog.result} .loading=${this.sessionCleanupDialog.loading === true} .running=${this.sessionCleanupDialog.running === true} .error=${this.sessionCleanupDialog.error ?? ""} .onPreview=${(request: SessionCleanupRequest) => { void this.previewSessionCleanup(request); }} .onRun=${(request: SessionCleanupRequest) => { void this.runSessionCleanup(request); }} .onClose=${() => { this.closeSessionCleanupDialog(); }}></session-cleanup-dialog>` : null}
        ${state.themeDialog !== undefined ? html`<command-picker title=${state.themeDialog.title} .options=${state.themeDialog.options} .selectedValue=${state.themeDialog.selectedValue} .onPick=${(value: string) => { this.pickTheme(value); }} .onCancel=${() => { this.setState({ themeDialog: undefined }); }}></command-picker>` : null}
        ${this.settingsSection !== undefined ? html`<settings-dialog .section=${this.settingsSection} .machine=${state.selectedMachine} .machineRuntime=${this.selectedMachineRuntime()} .actions=${this.getDefaultActions()} .onNavigate=${(section: SettingsSection) => { this.navigateSettings(section); }} .onClose=${() => { this.closeSettings(); }} .onConfigSaved=${(config: PiWebConfigValues) => { this.applyClientConfig(config); }} .onRefreshMachineRuntime=${async (machineId: string) => { await this.machines.refreshMachineRuntime(machineId); }} .machines=${state.machines} .machineStatuses=${state.machineStatuses} .onAddMachine=${() => { this.openMachineDialog(); }} .onRenameMachine=${async (machine: Machine, name: string) => { await this.renameMachine(machine, name); }} .onRemoveMachine=${(machine: Machine) => { void this.removeMachine(machine); }} .fleetReport=${this.fleetReport} ?fleetLoading=${this.fleetLoading} .fleetError=${this.fleetError} .onRefreshFleet=${() => this.refreshFleet()} .onRunFleet=${(operation: "restart" | "update", machineIds?: readonly string[]) => this.runFleetOperation(operation, machineIds)} .themes=${this.plugins.getThemes()} .selectedThemeId=${this.resolveCurrentThemePreference().selectedTheme?.id} .activeThemeId=${this.activeThemeId} ?followSystemTheme=${this.themePreference.auto} .onSelectTheme=${(themeId: QualifiedContributionId) => { this.selectTheme(themeId); }} .onToggleFollowSystem=${(follow: boolean) => { this.setFollowSystemTheme(follow); }} .uiScale=${this.uiScale} .onChangeUiScale=${(scale: number) => { this.setUiScale(scale); }}></settings-dialog>` : null}
      </div>
    `;
  }

  static override styles = appStyles;
}

function createPluginRegistry(): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register({ id: "core", plugin: corePlugin });
  registry.register({ id: "themes", plugin: themePackPlugin });
  return registry;
}

function coreWorkspacePluginBinding(): WorkspacePluginBinding {
  return { registrationPluginId: "core", sourcePluginId: "core" };
}

function pluginMachineFromState(state: Pick<AppState, "selectedMachine">): PluginMachine {
  const machine = state.selectedMachine;
  if (machine !== undefined) return { id: machine.id, name: machine.name, kind: machine.kind };
  return { id: "local", name: "local", kind: "local" };
}

function unreadChatIdentity(machineId: string, session: Pick<SessionInfo, "id" | "cwd">): string {
  return JSON.stringify([machineId, session.id, session.cwd]);
}

function selectedChatIdentity(state: Pick<AppState, "selectedMachine" | "selectedSession">): string | undefined {
  const session = state.selectedSession;
  return session === undefined ? undefined : unreadChatIdentity(selectedMachineId(state), session);
}

function machineUnreadInputsChanged(previous: AppState, next: AppState): boolean {
  return previous.machines !== next.machines;
}

function machineActivitySubscriptionInputsChanged(previous: AppState, next: AppState): boolean {
  return previous.machines !== next.machines
    || previous.machineStatuses !== next.machineStatuses
    || (previous.selectedMachine?.id ?? "local") !== (next.selectedMachine?.id ?? "local");
}

function shouldSubscribeToMachineActivity(machine: Machine, health: MachineHealth | undefined): boolean {
  return shouldRefreshMachineActivity(machine, health);
}

function shouldRefreshMachineActivity(machine: Machine, health: MachineHealth | undefined): boolean {
  if (machine.kind === "local") return true;
  const status = health?.status ?? machine.status;
  return status === undefined || status === "unknown" || status === "online";
}

function patchChangesState(state: AppState, patch: Partial<AppState>): boolean {
  return Object.entries(patch).some(([key, value]) => Reflect.get(state, key) !== value);
}

/** Only the fields the strip shows: a byte counter ticking must not re-render. */
export function sameBackgroundTasks(left: readonly SessionBackgroundTaskInfo[], right: readonly SessionBackgroundTaskInfo[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other?.id === entry.id && other.status === entry.status && other.exitCode === entry.exitCode && other.durationMs === entry.durationMs;
  });
}

function sameSubagents(left: readonly SessionSubagentInfo[], right: readonly SessionSubagentInfo[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other?.sessionId === entry.sessionId && other.status === entry.status;
  });
}

/**
 * Runs compare on what the strip shows, elapsed time included: a running child
 * has to re-render as its clock moves, or the list would freeze at whatever it
 * said when the run started.
 */
function sameSubagentRuns(left: readonly SessionSubagentRunInfo[], right: readonly SessionSubagentRunInfo[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other?.runId === entry.runId && other.status === entry.status && other.elapsedMs === entry.elapsedMs && other.lastActivity === entry.lastActivity;
  });
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

function isActive(state: Pick<AppState, "status" | "activity">): boolean {
  return isSessionActive(state.status, state.activity);
}

function isTerminalEvent(event: BrowserRealtimeEvent): event is TerminalUiEvent {
  return event.type === "terminal.created" || event.type === "terminal.exited" || event.type === "terminal.closed";
}

function emptyWorkspaceRouteSurface(): WorkspaceRouteSurface {
  return {};
}

function machineScopedKey(machineId: string, value: string): string {
  return JSON.stringify([machineId, value]);
}

function remoteRouteRestoreRetryDelay(attempt: number): number {
  const index = Math.min(attempt, REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS.length - 1);
  return REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS[index] ?? 30_000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function omitWorkspaceDeletionRun(runs: Record<string, TerminalCommandRun>, workspaceId: string): Record<string, TerminalCommandRun> {
  return Object.fromEntries(Object.entries(runs).filter(([candidate]) => candidate !== workspaceId));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => { resolve(); }));
}

function thinkingDescription(level: string): string | undefined {
  switch (level) {
    case "off": return "No reasoning";
    case "minimal": return "Very brief reasoning (~1k tokens)";
    case "low": return "Light reasoning (~2k tokens)";
    case "medium": return "Moderate reasoning (~8k tokens)";
    case "high": return "Deep reasoning (~16k tokens)";
    case "xhigh": return "Maximum reasoning (~32k tokens)";
    default: return undefined; // unknown level from a newer pi: no description
  }
}
