import { css, LitElement, html, nothing, type TemplateResult, unsafeCSS } from "lit";
import { uiIconStyle, renderChatIcon, renderCommandIcon, renderListIcon, renderPluginIcon } from "./uiIcons.js";
import { loadSurface, warmLazySurfaces, type LazySurface } from "./lazySurfaces.js";
import { sessionStateBadgeStyles } from "./sessionStateBadgeStyles.js";
import type { ChatLine } from "./shared";
import { clearErrorPatch, errorNoticePatch, noticePatch } from "../errorNotice";
import { request } from "../api/http";
import { sessionPinsApi } from "../api/clients";
import { workspaceTerminalSessions } from "../plugins/workspaceTerminalSessions";
import { createPluginHostUi, type PluginDialogHost } from "../plugins/pluginHostUi";
import { describeError, noticeForReader, noticeFromTransport, RetiredBy } from "../notice";
import { clearPlaceholderFrame, notePlaceholderFrame, placeholderFrameOutstanding } from "../historyWrites";
import { bannerHoldDecision, TRANSIENT_GRACE_MS } from "./bannerHold";
import { routeMatchesUrl } from "../routeMatch";
import { autoFocusesComposer } from "../appShell/appShellController";
import { touchPrimaryPointer } from "../keyboardDismissal";
import { customElement, query, state } from "lit/decorators.js";
import { api, configApi, effectiveWorkspaceUploadFolder, fleetApi, piWebApi, projectsApi, selfUpdateApi, sessionsApi, terminalsApi, trustApi, workspacesApi, workspaceEffectiveUploadFolder, type AskUserSubmission, type CommandOption, type ExtensionDialogAnswer, type Machine, type MachineHealth, type PiWebConfigValues, type PiWebShortcutConfig, type Project, type SessionCleanupExecuteResponse, type SessionCleanupPreviewResponse, type SessionCleanupRequest, type SessionInfo, type SessionModel,
  type QueuedSessionMessage, type SessionBackgroundTaskInfo, type SessionTreeForkResult, type SessionTreeNavigateResult, type SessionTreeSummaryChoice, type TerminalCommandRun, type TerminalUiEvent, type Workspace } from "../api";
import type { BackgroundTasksRead, PiWebFleetReport, PiWebFleetRunResponse } from "../../../shared/apiTypes";
import type { AppAction } from "../actions";
import { composerCwd, initialAppState, type AppState } from "../appState";
import { isSessionNotFoundError } from "../sessionNotFound";
import { renderArchivedStrip } from "./archivedStrip";
import { sessionWorkSettled } from "../sessionWorkSettled";
import type { SessionStateBadgeKind } from "./activityBadge";
import { PI_WEB_CAPABILITIES, supportsPiWebCapability } from "../../../shared/capabilities";
import { machineScopedPluginId } from "../../../shared/machinePluginIds";
import { AuthController } from "../controllers/authController";
import { MachineController, remoteReportedDown } from "../controllers/machineController";
import { SessionBoardController } from "../controllers/sessionBoardController";
import type { BoardAnswer } from "../sync/sessionBoard";
import { MachineStatusController } from "../controllers/machineStatusController";
import { ProjectController } from "../controllers/projectController";
import { PiWebStatusController } from "../controllers/piWebStatusController";
import { SessionController } from "../controllers/sessionController";
import { TrailingRefreshCoordinator } from "../controllers/trailingRefreshCoordinator";
import { anchoredRead, graceRemaining, type AnchoredRead } from "../socketAnchoredRead";
import { WorkspaceController } from "../controllers/workspaceController";
import { emptyMachineNavigationSnapshot, machineNavigationSnapshotFromState, routeFromMachineNavigationSnapshot, SessionStorageMachineNavigationMemory, type MachineNavigationSnapshot, type WorkspaceRouteSurface } from "../controllers/machineNavigationMemory";
import { SessionStorageSessionSelectionMemory } from "../controllers/sessionSelection";
import { SessionStorageTerminalSelectionMemory } from "../controllers/terminalSelection";
import { SessionStorageWorkspaceSelectionMemory } from "../controllers/workspaceSelection";
import { KeyboardShortcutDispatcher } from "../keyboardShortcuts";
import { selectedMachineId } from "../controllers/types";
import { placeSessionId, targetInScope, targetUnanswered, type ScopedSessionTarget } from "../sessionTarget";
import { sessionTargetView, type SessionTargetNames } from "../sessionTargetView";
import { recoverPromptFromLine, type RecoveredPrompt } from "../resendMessage";
import { keyboardInset, visualViewportOffsetTop } from "../appShell/keyboardInset";
import { machineSessionKey, machineWorkspaceKey } from "../machineKeys";
import { askConfirmation, confirmationText, type ConfirmRequest } from "../confirmDialog";
import { modifiedMs, sessionSections } from "../sessionOrder";
import { commandsForSession } from "../commandLedger";
import { oneReadAtATime, shouldPollSessionActivity } from "../sessionActivityPolling";
import { routedWorkspaceTool } from "../routedWorkspaceTool";
import { shownWorkspacePanel, workspacePanelHoldsCanvas, workspacePanelMayHoldCanvas } from "../workspacePanelCanvas";
import { sessionCleanupRequestKey } from "../sessionCleanupUi";
import { SessionUnreadController } from "../sessionUnread";
import { workspaceViewTransition } from "../workspaceViewTransition";
import { RealtimeSocket, type BrowserRealtimeEvent } from "../sessionSocket";
import { refreshOnReturn, workspaceChangeVerdict, type WorkspaceScope } from "../workspaceChange";
import type { PluginMachine, PluginPromptEditor, QualifiedContributionId, QualifiedThemeContribution, QualifiedThemePairContribution, QualifiedWorkspacePanelContribution, PluginRuntimeContext, TerminalCommandRunsInternalRuntime, WorkspaceFiles, WorkspaceHost, WorkspaceLabelContext, WorkspaceLabelItem, WorkspacePanelContext, WorkspacePluginBinding, PluginDialog, PluginDialogHandle, NavSectionContext, MachineSectionContext } from "../plugins/types";
import { CORE_PRO_LIGHT_THEME_ID, isNativeThemeId, applyNativeProLightTheme, CORE_PRO_THEME_ID, CLASSIC_THEME_ID, DEFAULT_THEME_PREFERENCE, applyNativeProTheme, applyPiWebTheme, findThemePairForTheme, readStoredThemePreference, resolveThemePreference, writeStoredThemePreference, type ThemePreference, type ThemePreferenceResolution } from "../theme";
import { corePlugin } from "../plugins/core";
import { loadExternalPlugins, type ExternalPluginLoadResult } from "../plugins/external";
import { PluginRegistry, installPluginRuntimeScope, installWorkspaceLabelScope, installWorkspacePanelScope } from "../plugins/registry";
import { createPluginWorkspaceBackend } from "../plugins/workspaceBackend";
import { createWorkspaceFiles as createPluginWorkspaceFiles } from "../plugins/workspaceFiles";
import { queryNamespace, readNamespacedString, setNamespacedQueryKey } from "../namespacedQueryArgs";
import { AppShellController } from "../appShell/appShellController";
import { BrowserResumeController } from "../appShell/browserResumeController";
import "./appShell/ContextSwitcherSheet";
import "./appShell/AppGoToSheet";
import "./SessionRenameDialog";
import type { GoToDestination } from "./appShell/AppGoToSheet";
import { PanelCollapseController, mainViewClass, panelToggleHiddenState, workspacePanelTakesSpace } from "../appShell/panelCollapseController";
import { PanelResizeController, type PanelResizeConstraints, type ResizablePanelSide } from "../appShell/panelResizeController";
import { readRoute, resolveAppRoute, resolveWorkspacePanelRouteValue, writeRoute, type AppRoute, type ParsedAppRoute } from "../route";
import { readSettingsOpen, readSettingsSection, writeSettingsOpen, writeSettingsSection, type SettingsSection } from "../settingsRoute";
import { applyActiveShortcutPreferences } from "../shortcutPreferences";
import { createTerminalCommandRunsRuntime } from "../runtime/terminalRuntime";
import { canDeleteWorkspace, isWorkspaceDeletionPending, isWorkspaceDeletionRunPending, latestWorkspaceDeletionRuns, pendingWorkspaceDeletionIds, targetWorkspaceIdForRun, workspaceDeletionRunFilter, workspaceRemovalConfirmation } from "../workspaceDeletion";
import "./SessionCleanupDialog";
import "./ChatView";
import type { ChatView } from "./ChatView";
import "./PromptEditor";
import type { PromptEditor } from "./PromptEditor";
import "./StatusBar";
import "./CommandPicker";
import "./ModelPicker";
import "./ActionPalette";
import "./AuthDialog";
import { hasRenderedModal } from "./modalLayerRegistry";
import "./WorkspacePanel";
import type { WorkspacePanelEmptyState } from "./WorkspacePanel";
import "./appShell/AppContextBar";
import "./appShell/AppNavigatePage";
import type { AppNavigatePage, NavigateKind } from "./appShell/AppNavigatePage";
import type { NavigateRowActionId, NavigateRowKind } from "../navigateRowActions";
import { sessionLabel } from "../sessionLabels";
import { NavigationIntents, openingAnnouncement } from "../navigationIntent";
import { writeClipboardText } from "../clipboard";
import type { NavigateInput, NavigateLevel } from "../navigateModel";
import type { ShellToolTab } from "../appShell/shellToolTabs";
import "./appShell/AppPanelEdgeControl";
import "./appShell/AppRefreshControl";
import { quickSwitcherSessionStates, sessionIdsIn } from "../quickSwitcher";
import { reloadOffer } from "../versionSkew";
import { oneRowPerIdentity } from "../transcriptInvariant";
import { readPinnedSessionIds, togglePinnedSessionId, writePinnedSessionIds } from "../sessionPins";
import { readPinnedProjectIds, togglePinnedProjectId, writePinnedProjectIds } from "../projectPins";
import { observeTransportRecovery } from "../api/transportHealth";
import { dismissKeyboardIfRaised } from "../keyboardDismissal";
import { errorBanner, normalizeTransientError, unansweredRow, TRANSIENT_ERROR_TIMEOUT_MS } from "./errorBanner";
import { rowDecision, type ShownUnanswered } from "../sync/connectionSummary";
import { messageStatusUnanswered } from "../sendVerification";
import { earliestUnanswered } from "../sync/scopedResource";
import { QUIET_WINDOW_MS, retryDelayMs } from "../sync/readPhase";
import { interruptedRunsReadPlan } from "../interruptedRunsRead";
import { deprecatedAgentInputsBanner, deprecatedAgentInputsWarnings } from "./deprecatedAgentInputsBanner";
import { interactiveSurfaceStyles } from "./shared";
import { documentTitleFor } from "../contextName";

export interface PluginDialogEntry {
  readonly id: number;
  readonly dialog: PluginDialog;
  readonly close: () => void;
}

export const appStyles = css`${unsafeCSS(uiIconStyle)}
  .navigation-announcer { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .navigation-progress { position: fixed; top: env(safe-area-inset-top); left: 0; right: 0; height: 2px; z-index: var(--pi-layer-dialog); pointer-events: none; overflow: hidden; }
  .navigation-progress::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 40%; background: var(--pi-accent); animation: navigation-progress 1.1s ease-in-out infinite; }
  @keyframes navigation-progress { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
  .plugin-dialog { position: fixed; inset: 0; z-index: var(--pi-layer-dialog); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); line-height: inherit; }
  /* The fullscreen presentation is the plugin page form: edge-to-edge, no
     card chrome, so content authored against a large canvas survives direct
     load instead of being squeezed into the centered overlay card. */
  .plugin-dialog-alert { --modal-surface-width: min(480px, calc(100vw - 40px)); --modal-surface-max-height: calc(100vh - 40px); }
  .plugin-dialog-fullscreen { --modal-surface-width: 100%; --modal-surface-height: 100%; --modal-surface-max-height: 100%; --modal-surface-radius: 0; --modal-surface-border: 0; --modal-surface-shadow: none; }
  /* Motion is decoration here: scroll shadows, hover fades, pulsing dots. A
     reader who asked the system for less motion gets none of it. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }

  /* A pending image attachment opens full-size in its own dialog: the native
     top layer covers the page, Esc and a backdrop click close it, and the
     controls are reachable by keyboard like every other control in the app. */
  dialog.attachment-zoom { box-sizing: border-box; position: fixed; inset: 0; margin: auto; max-width: calc(96vw - env(safe-area-inset-left) - env(safe-area-inset-right)); max-height: calc(96vh - env(safe-area-inset-top) - env(safe-area-inset-bottom)); width: fit-content; height: fit-content; padding: 0; border: none; background: transparent; overflow: visible; }
  dialog.attachment-zoom[open] { display: flex; }
  dialog.attachment-zoom::backdrop { background: rgba(0, 0, 0, 0.8); }
  .attachment-zoom-full { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: var(--pi-radius-md); object-fit: contain; }
  /* 100dvh is an assumption about what the browser subtracts; --pi-app-visible-height is a measurement. */
  :host { --pi-app-safe-area-bottom: 0px; --pi-app-keyboard-inset: 0px; --pi-app-viewport-offset-top: 0px; position: fixed; top: var(--pi-app-viewport-offset-top); right: 0; left: 0; display: block; height: var(--pi-app-visible-height, calc(100dvh - var(--pi-app-keyboard-inset))); box-sizing: border-box; overflow: hidden; padding: env(safe-area-inset-top) env(safe-area-inset-right) var(--pi-app-safe-area-bottom) env(safe-area-inset-left); color: var(--pi-text); background: var(--pi-bg); font: var(--pi-text-base) var(--pi-font-ui); line-height: inherit; }
  :host([pwa-display-mode]) { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  @media (display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui) {
    :host { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  }
  .shell { --navigation-panel-size: 340px; --workspace-panel-size: 340px; --navigation-panel-width: var(--navigation-panel-size); --workspace-panel-width: var(--workspace-panel-size); display: grid; grid-template-columns: var(--navigation-panel-width) 1px minmax(320px, 1.35fr) 1px var(--workspace-panel-width); height: 100%; min-height: 0; }
  aside { grid-column: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  aside app-navigation-panel { flex: 1 1 auto; min-height: 0; }
  aside app-navigate-page { flex: 1 1 auto; min-height: 0; }
  /* Over the session, not instead of it: the page covers the screen while it
     is open and the close returns to the conversation underneath. */
  .navigate-overlay { position: fixed; inset: var(--pi-app-viewport-offset-top, 0px) 0 0 0; z-index: var(--pi-layer-overlay); background: var(--pi-bg); }
  header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
  .header-actions { display: flex; align-items: center; gap: var(--pi-space-4); }
  main { grid-column: 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  /* A dashed hairline, not the browser's medium default: this rule was
     generalised from a chip that carried its own border width. */
  .empty { border: 1px dashed var(--pi-border); border-radius: var(--pi-radius-lg); padding: var(--pi-space-7); color: var(--pi-muted); }
  workspace-panel { grid-column: 5; min-width: 0; min-height: 0; overflow: hidden; }
  @media (min-width: 1181px) {
    /* A workspace tool can request the content area without owning or changing
       the surrounding shell. The selected panel keeps its own tabs and state. */
    /* Expanded review tools need the full desktop canvas; their own toolbar
       provides the exit action, so neither app pane remains actionable here. */
    .shell.workspace-panel-fullscreen { grid-template-columns: minmax(0, 1fr); }
    .shell.workspace-panel-fullscreen > aside, .shell.workspace-panel-fullscreen > main,
    .shell.workspace-panel-fullscreen > app-panel-edge-control { display: none; }
    .shell.workspace-panel-fullscreen > workspace-panel { grid-column: 1; }
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; }
    .shell.navigation-panel-collapsed > aside { display: none; }
    .shell.workspace-panel-collapsed { --workspace-panel-width: 0px; }
    .shell.workspace-panel-collapsed > workspace-panel { display: none; }
  }
  @media (max-width: 1180px) {
    .shell { grid-template-columns: var(--navigation-panel-width) 1px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; }
    .shell.navigation-panel-collapsed > aside { display: none; }
    aside { grid-row: 1 / 3; }
    main { grid-column: 3; grid-row: 1 / 3; }
    .shell.workspace-view main { grid-row: 1; min-height: auto; }
    .shell.workspace-view > workspace-panel { grid-column: 3; grid-row: 2; display: flex; border-left: 0; }
    .shell:not(.workspace-view) > workspace-panel { display: none; }
    main.workspace-view chat-view, main.workspace-view prompt-editor, main.workspace-view status-bar,
    main.workspace-view .empty { display: none; }
    main.workspace-view { overflow: hidden; }
  }
  @media (pointer: coarse), (max-width: 760px) {
    .shell { grid-template-columns: minmax(0, 1fr); }
    aside { display: none; }
    main, .shell.workspace-view > workspace-panel { grid-column: 1; }
    main.navigation-view chat-view, main.navigation-view prompt-editor, main.navigation-view status-bar,
    main.navigation-view .empty { display: none; }
    /* One place at a time: a div shows by default, so without this the session
       list sat above the conversation and left it a strip at the bottom. */
    main:not(.navigation-view) .mobile-navigation-panel { display: none; }
    main.navigation-view .mobile-navigation-panel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    main.navigation-view .mobile-navigation-panel app-navigation-panel { flex: 1 1 auto; min-height: 0; }
  }
  status-bar { flex: 0 0 auto; }
  chat-view { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  prompt-editor { flex: 0 0 auto; }
  button { font: var(--pi-text-xs) var(--pi-font-ui); line-height: inherit; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
  .empty { margin: auto; display: flex; flex-direction: column; align-items: center; gap: var(--pi-space-5); text-align: center; color: var(--pi-muted); }
  .archived-strip { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-5); padding: var(--pi-space-5) var(--pi-space-7); border-top: 1px solid var(--pi-border); color: var(--pi-muted); }
  .archived-strip p { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .empty .empty-link { min-height: var(--pi-control-height-touch); border-color: transparent; background: transparent; color: var(--pi-muted); text-decoration: underline; }
  .empty button, .archived-strip button { box-sizing: border-box; min-height: var(--pi-control-height-touch); padding: var(--pi-space-4) var(--pi-space-6); border: 1px solid var(--pi-accent-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-accent); font: var(--pi-text-sm) var(--pi-font-ui); line-height: inherit; cursor: pointer; }
  .error { display: flex; gap: var(--pi-space-4); align-items: flex-start; padding: var(--pi-space-5) var(--pi-space-7); border-bottom: 1px solid var(--pi-border); color: var(--pi-danger); }
  .error.transient { color: var(--pi-warning); background: color-mix(in srgb, var(--pi-warning) 8%, transparent); }
  .error .error-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .error .error-retry { box-sizing: border-box; flex: 0 0 auto; min-height: var(--pi-control-height); padding: 0 var(--pi-space-5); border: 1px solid currentColor; border-radius: var(--pi-radius-md); background: none; color: inherit; font: inherit; cursor: pointer; }
  @media (pointer: coarse) { .error .error-retry { min-height: var(--pi-control-height-touch); } }
  .error .error-dismiss { box-sizing: border-box; flex: 0 0 auto; display: grid; place-items: center; min-width: var(--pi-control-height); min-height: var(--pi-control-height); padding: 0 var(--pi-space-3); border: 0; background: none; color: inherit; line-height: 1.4; }
  .deprecation-notice { padding: var(--pi-space-5) var(--pi-space-7); border-bottom: 1px solid var(--pi-border); color: var(--pi-warning); }
  .deprecation-notice .deprecation-notice-text { margin: 0; overflow-wrap: anywhere; }
  .deprecation-notice .deprecation-notice-text + .deprecation-notice-text { margin-top: var(--pi-space-2); }

  .self-update-banner { display: flex; align-items: center; gap: var(--pi-space-4); flex-wrap: wrap; box-sizing: border-box; margin: 0 var(--pi-space-6) var(--pi-space-5); border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-lg); background: var(--pi-warning-surface); color: var(--pi-warning); padding: var(--pi-space-4) var(--pi-space-6); font-size: var(--pi-text-sm); }
  .self-update-banner.applying { border-color: var(--pi-accent-border); background: var(--pi-surface); color: var(--pi-text); }
  /* The banner sits in the same column as the transcript controls, which are
     all 44px on a finger; a 32px row here was a second touch floor. */
  .self-update-banner button { box-sizing: border-box; min-height: var(--pi-control-height); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; padding: var(--pi-space-2) var(--pi-space-5); }
  @media (pointer: coarse) { .self-update-banner button { min-height: var(--pi-control-height-touch); } .error .error-dismiss { min-width: var(--pi-control-height-touch); min-height: var(--pi-control-height-touch); } }
  @media (hover: hover) { .self-update-banner button:hover { border-color: var(--pi-accent); } }
  .self-update-banner button.skip { color: var(--pi-muted); background: transparent; }
  .self-update-banner .state-dot { background: currentColor; }
`;


const PI_WEB_STATUS_REFRESH_MS = 15 * 60 * 1000;
// Surface backed up: the pi-web runtime status readout (header health, self-
// update banner). Nothing events it; the tab re-reads on this slow cadence.
const EMPTY_ID_SET: ReadonlySet<string> = new Set();

/**
 * A panel whose data has not answered yet says nothing (owner, 2026-09-30): no
 * "Loading…" title, and never an empty-state claim it cannot know. While the
 * machine goes unanswered, the app row speaks (B48).
 */
const UNKNOWN_YET: WorkspacePanelEmptyState = { kind: "unknown" };
const EMPTY_STATE_MAP: ReadonlyMap<string, SessionStateBadgeKind> = new Map();
/** How much of a session's own history to offer the composer's picker. */
const PROMPT_HISTORY_PROP_LIMIT = 50;
/**
 * How often an open tab checks that its sockets are still alive.
 *
 * A socket dropped by a proxy, a NAT table, or a tunnel that blinked stays
 * OPEN in the browser and fires no close event, so nothing arrives and nothing
 * complains: the page simply stops updating until it is reloaded. Resuming the
 * tab already triggers this check, which left the case nobody thought about -
 * the tab that never went away. The check itself is a comparison against the
 * last frame's timestamp; the socket's own 50s staleness window decides.
 *
 * Surface backed up: every socket's liveness - the check that turns a dead
 * but OPEN connection into the reconnect that refetches state.
 */
const SOCKET_LIVENESS_CHECK_MS = 5_000;
/** A tap is a person waiting: probe the sockets, but not on every finger down. */
const INTERACTION_LIVENESS_THROTTLE_MS = 2_000;

const INTERRUPTED_RUNS_UNKNOWN_MESSAGE = "Interrupted-run status is unknown: the read failed. Reconnect to read it again.";
const PI_WEB_STATUS_DEFER_MS = 750;
const GLOBAL_SHORTCUT_LISTENER_OPTIONS = { capture: true } as const;
const THEME_AUTO_ON_VALUE = "auto:on";
const THEME_AUTO_OFF_VALUE = "auto:off";
const THEME_OPTION_PREFIX = "theme:";
const FILES_ROUTE_NAMESPACE = queryNamespace("core:workspace.files");
const FILES_PANEL_ROUTE_ID: QualifiedContributionId = "files:files";
const TERMINAL_ROUTE_NAMESPACE = queryNamespace("core:workspace.terminal");
const WORKSPACE_ROUTE_NAMESPACE = queryNamespace("core:workspace");
const MIN_RESIZABLE_CHAT_WIDTH_PX = 320;
const PANEL_EDGE_COLUMNS_WIDTH_PX = 2;
import { deliveredClientMessageIds } from "../userMessageRegister";
import { OUTBOX_CHANGED_EVENT, sessionsWithFailedSends } from "../pendingOutbox";
import { rowedClientMessageIds } from "../messageDelivery";

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
  /** Whether the tree dialog's first appearance has already fetched its module. */
  private treeDialogAnnounced = false;
  /** Whether the settings surface's module has been asked for this opening. */
  private settingsLoadAnnounced = false;
  @state() private workspacePanelFullscreen = false;
  @query("chat-view") private chatView?: ChatView;
  private prunedSessionsSignature = "";
  @query("prompt-editor") private promptEditor?: PromptEditor;
  @query(".navigate-overlay app-navigate-page") private navigatePage?: AppNavigatePage;
  @query("#navigation-panel") private navigationPanelFrame?: HTMLElement;
  @query("#workspace-panel") private workspacePanelFrame?: HTMLElement;

  /** Where the reader is going: one counter for every navigation, and the tapped item's pending state (D8). */
  private readonly navigation = new NavigationIntents(() => { this.requestUpdate(); });
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
  /** The interrupted markers and the machine they were read from: a late read
   * for a machine the user has already left must not adopt here. */
  /** Adopted markers per machine: adopting B's must not evict A's, whose
   * own record was already spent by its boot read. */
  private interruptedRunsByMachine = new Map<string, ReadonlySet<string>>();
  private interruptedRunsBootReadByMachine = new Set<string>();
  @state() private failedSendSessionIds: ReadonlySet<string> = sessionsWithFailedSends();
  @state() private unreadSessionIds: ReadonlySet<string> = this.sessionUnread.unreadSessionIds(selectedMachineId(this.state), this.state.sessions);
  private unreadConnected = false;
  private readonly onOutboxChanged = (): void => {
    const next = sessionsWithFailedSends();
    if (!sameStringSet(next, this.failedSendSessionIds)) this.failedSendSessionIds = next;
  };
  private committedChatIdentity: string | undefined;
  private readyChatIdentity: string | undefined;

  private readonly sessions: SessionController = new SessionController(
    () => this.state,
    (patch) => { this.setState(patch); },
    (options) => { this.updateUrl(options); },
    new SessionStorageSessionSelectionMemory(),
    {
      urlSessionId: () => readRoute().sessionId,
      onBackgroundRunCountChanged: (sessionId: string) => {
        if (this.state.selectedSession?.id !== sessionId) return;
        void this.refreshSubagents();
      },
      onSelectedSessionReady: ({ machineId, session }) => {
        void this.commitReadyChatAfterRender(machineId, session);
        void this.refreshSelfUpdate();
      },
      replacePromptEditorText: async ({ machineId, sessionId, text }) => {
        await this.updateComplete;
        if (selectedMachineId(this.state) !== machineId || this.state.selectedSession?.id !== sessionId) return;
        this.promptEditor?.replaceText(text);
      },
      catalogue: {
        projects: (machineId, wanted) => this.projects.answeredProjects(machineId, wanted),
        workspaces: (machineId, projectId, wanted) => this.workspaces.answeredWorkspaces(machineId, projectId, wanted),
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
    { noteDialogOpening: () => { this.pushModalLayerFrame(); } },
  );
  private readonly workspaces: WorkspaceController = new WorkspaceController(
    () => this.state,
    (patch) => { this.setState(patch); },
    (options) => { this.updateUrl(options); },
    this.sessions,
    new SessionStorageWorkspaceSelectionMemory(),
    { opensPreferredSession: () => !this.appShell.isMobileNavigationLayout },
  );
  private readonly projects: ProjectController = new ProjectController(
    () => this.state,
    (patch) => { this.setState(patch); },
    this.workspaces,
    { onListingChange: () => { this.onProjectsListingChange(); } },
  );
  private readonly machines = new MachineController(
    () => this.state,
    (patch) => { this.setState(patch); },
    (options) => { this.updateUrl(options); },
    this.projects,
  );
  /** The machine-wide session board the navigation page and the quick switcher list (B48, P1 slice 5). */
  private readonly sessionBoards: SessionBoardController = new SessionBoardController({
    knownProjects: (machineId) => machineId === selectedMachineId(this.state) && this.state.projectsLoad === "loaded" ? this.state.projects : undefined,
  });
  private readonly unsubscribeSessionBoards = this.sessionBoards.subscribe(() => { this.mirrorSessionBoard(); });
  private readonly piWebStatusController = new PiWebStatusController(
    () => this.state,
    (patch) => { this.setState(patch); },
    { onRefreshError: (machineId, error) => { console.warn(`Failed to refresh PI WEB status for ${machineId}`, error); } },
  );
  private workspaceUploadFolderFallback = effectiveWorkspaceUploadFolder(undefined);
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
  private readonly systemLightThemeMedia = typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia("(prefers-color-scheme: light)") : undefined;
  private terminalAutoStartWorkspaceId: string | undefined;
  private piWebStatusTimer: number | undefined;
  private piWebStatusDeferredTimer: number | undefined;
  private workspaceDeletionPollTimer: number | undefined;
  private subagentRefreshArmedFor: string | undefined;
  private restoringSessionId: string | undefined;
  private livenessTimer: number | undefined;
  private unansweredShown: ShownUnanswered | undefined;
  private workspaceChangedWhileHidden: WorkspaceScope | undefined;
  private reconnectingRecheck: number | undefined;
  private lastInteractionLivenessAt = 0;
  private readonly workspaceDeletionRunReads = new TrailingRefreshCoordinator<string>();
  private readonly firstOpenFallbacks = new Map<string, number>();
  private workspaceDeletionRetry: { key: string; attempt: number; timer: number } | undefined;
  private readonly handledWorkspaceDeletionRunIds = new Set<string>();
  private readonly terminalCommandRunRuntimes = new Map<string, TerminalCommandRunsInternalRuntime>();
  private machineNavigationRestoreSeq = 0;
  private routeRestoreSeq = 0;
  private routeRestoreDepth = 0;
  private restoringRouteTerminalId: string | undefined;
  private pendingRemoteRouteRestore: ParsedAppRoute | undefined;
  /** The reader's intent when a restore was deferred; a tap since then retires the retry (D8). */
  private pendingRestoreIntent = 0;
  private remoteRouteRestoreTimer: number | undefined;
  private remoteRouteRestoreAttempt = 0;
  /** The notice the deep-link ladder last raised: raised again only when its words change, so a dismissed one stays dismissed. */
  private remoteRouteRestoreNotice: string | undefined;
  private remoteRouteRestoreInProgress = false;
  private readonly plugins = createPluginRegistry({ showDialog: (dialog) => this.openPluginDialog(dialog) }, (machineId) => this.piWebStatusController.read(machineId));
  private readonly loadedMachinePluginIds = new Set<string>();
  private readonly machinePluginLoadPromises = new Map<string, Promise<void>>();
  private gatewayPluginLoadPromise: Promise<void> | undefined;
  private themePreference: ThemePreference = readStoredThemePreference() ?? DEFAULT_THEME_PREFERENCE;
  @state() private activeThemeId: QualifiedContributionId = CLASSIC_THEME_ID;
  @state() private isRefreshingApp = false;
  private transientErrorTimer: number | undefined;
  private bannerShownAt: number | undefined;
  private bannerHoldTimer: number | undefined;
  /** When a transport claim first appeared and was held back (grace before show). */
  private transientPendingSince: number | undefined;
  private transientGraceTimer: number | undefined;
  private heldErrorBanner: TemplateResult | null = null;
  /** Set when the reader dismisses the banner: the hold window must not resurrect what the reader has already acted on. */
  private bannerDismissedByReader = false;
  private lastScheduledError = "";
  private lastScheduledMachineId: string | undefined = undefined;
  private bannerContextKey = "";
  @state() private quickSwitcherOpen = false;
  /** The one navigation surface; see `navigateModel`. */
  @state() private navigateOpen = false;
  @state() private contextSheetOpen = false;
  @state() private goToSheetOpen = false;
  /** The first-boot centre asked for a new session in whichever project the reader picks next. */
  private startSessionOnProjectChoice = false;
  /** The first-boot centre's Add a project: the added project opens with a new session. */
  private startSessionAfterAddingProject = false;
  /** The session the rename dialog names, with the machine it lives on: a row of a browsed machine is renamed there. */
  @state() private renameFromBar: { session: SessionInfo; machineId: string } | undefined;
  /** How much of the browsed machine's board has answered; the lists claim emptiness only for a complete one. */
  @state() private quickSwitcherBoardAnswer: BoardAnswer = "none";
  @state() private quickSwitcherSessions: readonly SessionInfo[] = [];
  /** Pinned sessions of the browsed machine that no open project lists (B49). */
  @state() private quickSwitcherPinnedElsewhere: readonly SessionInfo[] = [];
  /**
   * Pins for the machine on screen. A pin is keyed by machine because session
   * ids are unique per machine; the cache is re-read whenever the selection
   * moves, so machine A's pins can never mark or act on machine B's rows.
   */
  @state() private pinCache: { machineId: string; ids: ReadonlySet<string> } | undefined;
  private pinReadsInFlight = new Set<string>();
  private pinsAdopted = new Set<string>();

  private get pinnedSessionIds(): ReadonlySet<string> {
    return this.pinnedSessionIdsFor(selectedMachineId(this.state));
  }

  /**
   * Pins belong to the machine that holds the sessions, so the answer comes
   * from that machine and every device browsing it sees the same set. The
   * device's old local pins are handed to the machine once, so nothing the
   * owner pinned before the move is lost. Until the machine answers, the
   * local set stands in - it is the last thing known to be true, for this
   * machine, on this device.
   */
  private pinnedSessionIdsFor(machineId: string): ReadonlySet<string> {
    const cached = this.pinCache;
    if (cached?.machineId === machineId) {
      void this.ensureMachinePins(machineId);
      return cached.ids;
    }
    const ids = readPinnedSessionIds(machineId);
    this.pinCache = { machineId, ids };
    void this.ensureMachinePins(machineId);
    return ids;
  }

  /**
   * Read the machine's pins once, not once per render.
   *
   * `pinnedSessionIdsFor` runs while rendering, so anything that ends in a
   * render starts another read: the read applied its answer, that scheduled a
   * render, the render asked again. Measured on a phone-sized viewport: 7,127
   * requests to this endpoint in five seconds - 1,425 a second - with the whole
   * app re-rendering just as often. It is why the interface felt busy and why
   * the transcript kept moving under the reader.
   *
   * A machine already answered is read again only when it says its pins
   * changed (`pins.changed`), its socket reopens, or the tab resumes
   * (`refreshMachinePins`); it used to be re-read on any render once 2 s
   * old, 7-8 reads a minute with the git panel open and nothing happening
   * (P5 slice a). A machine whose last read failed is retried on the next render.
   */
  private readonly pinsStale = new Set<string>();

  private async ensureMachinePins(machineId: string): Promise<void> {
    if (this.pinReadsInFlight.has(machineId)) return;
    if (this.pinsAdopted.has(machineId) && !this.pinsStale.has(machineId)) return;
    if (this.socketKeptRead(machineId) === "await-open") return;
    this.pinReadsInFlight.add(machineId);
    this.pinsStale.delete(machineId);
    try {
      const local = readPinnedSessionIds(machineId);
      const answered = this.pinsAdopted.has(machineId) || local.size === 0
        ? await sessionPinsApi.pins(machineId)
        : await sessionPinsApi.adopt([...local], machineId);
      this.pinsAdopted.add(machineId);
      this.applyMachinePins(machineId, answered);
    } catch {
      // The machine could not answer: the local set keeps standing in, and the
      // next read tries again. A pin is never invented or silently dropped.
      this.pinReadsInFlight.delete(machineId);
      this.pinsStale.add(machineId);
      return;
    }
    this.pinReadsInFlight.delete(machineId);
    if (this.pinsStale.has(machineId)) void this.ensureMachinePins(machineId);
  }

  /**
   * The machine said its pins changed, or what it said while the page was away is unknown: read
   * them once more. A read already on its way may have been answered before the change, so the
   * mark stays and one more read follows it; a burst of changes during a read costs one.
   */
  private refreshMachinePins(machineId: string): void {
    this.pinsStale.add(machineId);
    void this.ensureMachinePins(machineId);
  }

  private applyMachinePins(machineId: string, ids: readonly string[]): void {
    writePinnedSessionIds(machineId, new Set(ids));
    if (this.pinCache?.machineId === machineId) this.pinCache = { machineId, ids: new Set(ids) };
    this.requestUpdate();
  }
  @state() private quickSwitcherWorkspaces: readonly Workspace[] = [];
  private quickSwitcherMachineId: string | undefined;
  /**
   * The machine whose sessions the switcher is browsing. Defaults to the
   * machine the app is on and changes with the machine tabs; opening a
   * session that lives elsewhere moves the app there first.
   */
  @state() private quickSwitcherBrowseMachineId = "";
  @state() private staleClientServerVersion: string | undefined;
  @state() private sessionCleanupDialog: SessionCleanupDialogState | undefined;
  @state() private pluginDialogs: readonly PluginDialogEntry[] = [];
  private pluginDialogSeq = 0;
  @state() private settingsOpen = readSettingsOpen();
  private settingsListFramePushed = false;
  @state() private settingsSection: SettingsSection | undefined = readSettingsSection();
  @state() private fleetReport: PiWebFleetReport | undefined;
  @state() private fleetLoading = false;
  @state() private fleetError: string | undefined;
  private fleetSectionShown = false;
  @state() private shortcutConfig: PiWebShortcutConfig = {};
  private readonly onPopState = () => {
    if (this.modalLayerOpen()) {
      // The back gesture pops the placeholder frame we pushed when the layer
      // opened: consume it by closing the layer, never by moving the route.
      clearPlaceholderFrame();
      this.closeModalLayer();
      return;
    }
    if (this.settingsOpen || readSettingsOpen()) {
      // Settings rides the URL instead of a placeholder frame: a pop either
      // moves between its own screens or leaves settings entirely, in both
      // directions. The URL is the single owner of the sheet's visibility.
      this.restoreSettingsRoute();
      return;
    }
    // A placeholder frame from a layer that was closed by its own cancel is
    // still on the stack; its URL equals the current state, so there is
    // nothing to restore. Only a real navigation (URL changed) restores.
    if (this.currentRouteMatchesUrl()) return;
    this.navigation.begin();
    void this.withChatScrollTransition(async () => {
      this.restoreSettingsRoute();
      await this.restoreRoute();
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
        session: placeSessionId(state),
        view: state.mainView,
      },
      this.appShell.defaultRouteView({ sessionId: placeSessionId(state) }),
    );
  }

  /** Close the topmost modal layer; popstate is the only caller. */
  private closeModalLayer(): void {
    this.navigation.cancel();
    if (this.quickSwitcherOpen) {
      this.quickSwitcherOpen = false;
      return;
    }
    if (this.contextSheetOpen) {
      this.contextSheetOpen = false;
      return;
    }
    if (this.goToSheetOpen) {
      this.goToSheetOpen = false;
      return;
    }
    const state = this.state;
    if (state.actionPaletteOpen) { this.setState({ actionPaletteOpen: false }); return; }
    if (state.commandDialog !== undefined) { this.sessions.cancelCommand(); return; }
    if (state.modelDialog !== undefined) { this.setState({ modelDialog: undefined }); return; }
    if (state.thinkingDialog !== undefined) { this.setState({ thinkingDialog: undefined }); return; }
    if (state.themeDialog !== undefined) { this.setState({ themeDialog: undefined }); return; }
    if (this.sessionCleanupDialog !== undefined) { this.sessionCleanupDialog = undefined; return; }
    if (this.state.treeDialog !== undefined) { this.sessions.closeTreeDialog(); return; }
    if (this.state.authDialog !== undefined) { this.auth.closeDialog(); return; }
    if (this.pluginDialogs.length > 0) {
      const top = this.pluginDialogs[this.pluginDialogs.length - 1];
      if (top !== undefined) top.close();
      return;
    }
    // The navigation page is the outermost layer: everything above it has
    // already answered the gesture, so back leaves the page it was opened on.
    if (this.navigateOpen) this.closeNavigate();
  }
  private readonly onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) void this.sessionUnread.refreshAll();
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
    this.projects.wake();
    this.workspaces.wake();
    this.machines.wake();
    this.sessionBoards.wake();
    this.realtime.reconnectNow();
    this.sessions.reconnectSocketNow();
    this.checkSocketLiveness();
  };

  /**
   * A tap is somebody waiting for this surface. A socket the network killed
   * without a FIN stays OPEN and silent, and waiting out the periodic probe
   * spends seconds of a person's attention on a connection already known to be
   * dead the moment they touch the screen.
   */
  private readonly onInteractionLivenessProbe = () => {
    const now = Date.now();
    if (now - this.lastInteractionLivenessAt < INTERACTION_LIVENESS_THROTTLE_MS) return;
    this.lastInteractionLivenessAt = now;
    this.checkSocketLiveness();
  };

  private readonly onDocumentVisibilityChange = () => {
    this.updateSubagentPolling();
    if (document.visibilityState === "visible") {
      this.projects.wake();
      this.workspaces.wake();
      this.machines.wake();
      this.sessionBoards.wake();
      this.refreshWorkspaceChangedWhileHidden();
      void this.refreshSubagents();
      // Coming back to the tab is the moment a stale bundle bites next; a
      // server upgraded while the phone slept should be offered, not hidden.
      void this.checkClientFreshness();
    }
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
    if (this.displayMainView() === "navigation") this.noteNavigationViewShown();
    else this.navigationViewLoaded = false;
    // The tree module is fetched when its dialog first appears, outside the
    // render path: a load call from render schedules an update on every settle,
    // and once the module has settled that is an unbounded microtask loop.
    if (this.state.treeDialog !== undefined && !this.treeDialogAnnounced) {
      this.treeDialogAnnounced = true;
      this.openLazySurface("session-tree", "Session tree");
    } else if (this.state.treeDialog === undefined) {
      this.treeDialogAnnounced = false;
    }
    // A settings route restored from the URL or boot never passes through
    // openSettings, so its module would never load: the route claims a panel
    // that is not on screen, with no banner either.
    if (this.settingsOpen && !this.settingsLoadAnnounced) {
      this.settingsLoadAnnounced = true;
      this.openLazySurface("settings", "Settings");
    } else if (!this.settingsOpen) {
      this.settingsLoadAnnounced = false;
    }
  }

  protected override updated(): void {
    // Saved reading positions were never evicted, and they were keyed by bare session
    // id across machines. Prune against the sessions this machine actually lists, once
    // a list exists: a pruned position only costs a landing at the newest, a stale one
    // costs a landing on another transcript's row.
    if (this.state.sessions.length > 0) {
      const listed = this.state.sessions.map((session) => session.id).join("\n");
      if (listed !== this.prunedSessionsSignature) {
        this.prunedSessionsSignature = listed;
        this.chatView?.pruneScrollPositions(this.state.sessions.map((session) => session.id));
      }
    }
    // A delivered message retires its outbox row even when the frame that would
    // have said so never arrived: the transcript is the proof, and the row is
    // what the reader sees contradicted by it. Gated on the outbox being
    // non-empty so a long transcript is not walked on every render.
    if (this.promptEditor?.hasStoredOutbox() === true) {
      // The optimistic bubbles are in `messages` too, and one of them is exactly
      // what an offline send leaves behind: counting it as delivered retired the
      // outbox row for a message the daemon never saw. Only the ids the queue no
      // longer holds are proof.
      const delivered = deliveredClientMessageIds(this.state.messages);
      for (const optimistic of this.state.clientQueuedSessionMessages[this.state.selectedSession?.id ?? ""] ?? []) {
        if (optimistic.clientMessageId !== undefined) delivered.delete(optimistic.clientMessageId);
      }
      this.promptEditor.settleOutbox(delivered);
    }
    // Lit has now committed the selected chat and app-shell visibility state.
    // Recheck after every rendered transition; the unread controller
    // deduplicates acknowledgements for the observed completion order.
    const chatIdentity = selectedChatIdentity(this.state);
    if (chatIdentity !== this.committedChatIdentity) {
      // A failed activity read keeps the rows it last saw, but those rows are
      // facts about the chat they were read for: carrying them under another
      // selection would render one chat's frozen work on another's dock.
      if (this.state.backgroundTasks.length > 0 || this.state.backgroundTasksRead !== "unread") {
        this.setState({ backgroundTasks: [], backgroundTasksRead: "unread" });
      }
    }
    this.committedChatIdentity = chatIdentity;
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
   *
   * The daemon's record is read-and-clear: after the boot read has spent it,
   * every later read answers with an empty file, which cannot distinguish
   * "the runs have since continued" from "the record was spent earlier". Only
   * the boot read may adopt an empty record as a retraction; a later read
   * adopts new markers but never erases the ones already on screen - whether
   * a run has continued is arbitrated by the live session state, not by a
   * spent file.
   */
  /* The boot read is once per page, not once per connection: a machine
     switch tears the socket down and reconnects, and that re-entry must not
     wear boot semantics - the record the first read spent stays spent, and
     an empty answer on re-entry says nothing about continuance. */


  private refreshInterruptedRuns(machineId: string, options: { adoptEmpty?: boolean } = {}): void {
    void this.sessions.loadInterruptedRuns(machineId).then((ids) => {
      // A failed read is not a record: the daemon may still hold markers, so
      // the previous set survives and the banner says the state is unknown
      // rather than quietly showing none.
      // A stale machine's failed read must not announce onto the machine the
      // reader is now looking at.
      if (selectedMachineId(this.state) !== machineId) return;
      const adoptEmpty = options.adoptEmpty ?? !this.interruptedRunsBootReadByMachine.has(machineId);
      const plan = interruptedRunsReadPlan(ids, adoptEmpty);
      if (plan.failed) {
        // A failed read is only worth a banner AFTER a successful read on the
        // same machine: that is when markers may sit unread on the daemon and
        // the reader has something to lose. At cold boot the record is simply
        // not read yet - the next reconnect's read delivers it without a
        // scary banner over an otherwise empty screen.
        if (this.interruptedRunsBootReadByMachine.has(machineId) && this.state.error === "") {
          this.setState(noticePatch(noticeForReader(INTERRUPTED_RUNS_UNKNOWN_MESSAGE, machineId)));
        }
        return;
      }
      this.interruptedRunsBootReadByMachine.add(machineId);
      if (plan.adoptMarkers && ids !== undefined) {
        this.interruptedRunsByMachine.set(machineId, ids);
      }
      // A successful read is the answer the banner asked for, whether or not
      // the record had content - after the boot read, emptiness is the only
      // answer a recovery can ever bring. This sits after every early
      // return: the round-25 fix moved a flag write above the emptiness
      // check and left this retraction unreachable on the very path its
      // sentence promises.
      // The retraction is an identity match on this feature's own private
      // wording (INTERRUPTED_RUNS_UNKNOWN_MESSAGE has a single producer), and
      // the banner's machine stamp must be this read's machine - a success
      // from machine B may not clear machine A's unknown banner now that
      // banners survive scope switches. The stamp lives on the state, so it
      // travels with the banner instead of a private that cannot follow it.
      if (plan.resolveUnknown && this.state.error === INTERRUPTED_RUNS_UNKNOWN_MESSAGE && this.state.errorMachineId === machineId) this.setState(clearErrorPatch());
    });
  }

  /**
   * Poll the selected session's activity while its tab is on screen.
   *
   * Fetch-on-select was not enough. The usual way to get a subagent is to ask
   * for one in the session you are already reading, and nothing re-read the
   * list afterwards, so the drawer stayed empty until the reader happened to
   * switch sessions and come back. The 4s poll that covered this was removed
   * by D8: the strip refetches on the count-change signal, on selection, and
   * on visibility recovery.
   */
  private updateSubagentPolling(): void {
    const shouldPoll = shouldPollSessionActivity({
      hasSelectedSession: this.state.selectedSession !== undefined,
      documentVisible: document.visibilityState === "visible",
    });
    // D8/4.2: the 4s poll is gone. The strip refetches on the count-change
    // signal (the daemon's status frames carry it), on selection, and on
    // visibility recovery — no timer backs it up.
    if (shouldPoll && this.subagentRefreshArmedFor !== this.state.selectedSession?.id) {
      this.subagentRefreshArmedFor = this.state.selectedSession?.id;
      void this.refreshSubagents();
      return;
    }
    if (!shouldPoll) this.subagentRefreshArmedFor = undefined;
  }

  private readonly refreshSubagents = oneReadAtATime(() => this.readBackgroundTasks());

  /**
   * The session's background runs, for the dock and the Background panel. It also read
   * `/subsessions` - child sessions and subagent-tool runs - which nothing has rendered since
   * the chip strip went: the Subagents panel reads its own runs. The dead read fired twice
   * within 250ms on every selection (reads F9), so it is gone rather than kept for a surface
   * that no longer exists.
   */
  private async readBackgroundTasks(): Promise<void> {
    const session = this.state.selectedSession;
    if (session === undefined) return;
    const machineId = selectedMachineId(this.state);
    const [tasks] = await Promise.allSettled([sessionsApi.backgroundTasks(session, machineId)]);
    if (this.state.selectedSession?.id !== session.id || selectedMachineId(this.state) !== machineId) return;
    const patch: Partial<AppState> = {};
    if (tasks.status === "fulfilled" && !sameBackgroundTasks(tasks.value, this.state.backgroundTasks)) patch.backgroundTasks = tasks.value;
    const read: BackgroundTasksRead = tasks.status === "fulfilled" ? "read" : "failed";
    if (read !== this.state.backgroundTasksRead) patch.backgroundTasksRead = read;
    if (Object.keys(patch).length > 0) this.setState(patch);
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
          this.setState(noticePatch(noticeForReader(`Update failed: ${result.error}`)));
        }
      }
      // On success the page keeps saying "reconnecting…"; the socket comes
      // back after the restart. The applying flag stays up until then.
    } catch {
      this.setState({ selfUpdateApplying: false });
      this.setState(noticePatch(noticeForReader("Update request failed")));
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

  /** Render the "Reload to get the new version" strip above the session view. */
  /**
   * The tab keeps running the bundle it loaded, however many times the server
   * underneath is upgraded; every client-side fix shipped in between is
   * invisible here, and gets reported as still broken. The server states its
   * version; a mismatch is an offer to reload - the reader's move, never an
   * automatic one.
   */
  private renderStaleClientBanner(): TemplateResult | null {
    if (this.staleClientServerVersion === undefined) return null;
    return html`
      <div class="self-update-banner" role="status" aria-live="polite">
        <span>The server was updated to ${this.staleClientServerVersion}; this page is running ${__PI_WEB_CLIENT_VERSION__}.</span>
        <button type="button" @click=${() => { window.location.reload(); }}>Reload</button>
      </div>`;
  }

  private async checkClientFreshness(): Promise<void> {
    try {
      const serverVersion = await piWebApi.webServerVersion();
      this.staleClientServerVersion = reloadOffer(__PI_WEB_CLIENT_VERSION__, serverVersion);
    } catch {
      // An unreachable version endpoint says nothing about staleness.
    }
  }

  private renderSelfUpdateBanner(): TemplateResult | null {
    const status = this.state.selfUpdate;
    if (status === undefined || !status.enabled || !status.available) return null;
    if (this.state.selfUpdateApplying) {
      return html`
        <div class="self-update-banner applying" role="status" aria-live="polite">
          <span class="state-dots"><span class="state-dot"></span><span class="state-dot"></span><span class="state-dot"></span></span>
          <span>Updating pi-web (${status.current} → ${status.latest ?? "new"})… The page reconnects automatically after the restart.</span>
        </div>`;
    }
    let skipped = false;
    try { skipped = window.localStorage.getItem("piWebSelfUpdateSkipped") === status.latest; } catch { /* ignore */ }
    if (skipped) return null;
    return html`
      <div class="self-update-banner" role="status" aria-live="polite">
        <span>pi-web update available: ${status.current} → ${status.latest ?? "new"}</span>
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
    const viewport = window.visualViewport ?? undefined;
    const inset = keyboardInset(window.innerHeight, viewport);
    this.style.setProperty("--pi-app-keyboard-inset", `${String(Math.round(inset))}px`);
    this.style.setProperty("--pi-app-viewport-offset-top", `${String(Math.round(visualViewportOffsetTop(viewport)))}px`);
    const visible = viewport?.height;
    if (visible === undefined || !Number.isFinite(visible) || visible <= 0) this.style.removeProperty("--pi-app-visible-height");
    else this.style.setProperty("--pi-app-visible-height", `${String(Math.round(visible))}px`);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    // Past first paint, fetch the dialogs nobody has opened yet, so an open is
    // instant without the entry bundle carrying them.
    warmLazySurfaces();
    // Recovery is noticed by whichever channel succeeds next, which is often
    // not the one that failed; the realtime socket alone was leaving a banner
    // on screen until the page was reloaded by hand.
    observeTransportRecovery((machineId) => { this.clearTransientError(machineId); });
    // A failed send is a fact about a session the reader may not be looking at, so the
    // list must learn about it from the outbox rather than from a visit.
    window.addEventListener(OUTBOX_CHANGED_EVENT, this.onOutboxChanged);
    this.failedSendSessionIds = sessionsWithFailedSends();
    this.unreadConnected = true;
    // The navigation page is mounted, not opened: the desktop rail always is,
    // and the phone boots straight into it. Nothing called openNavigate in
    // either case, so the listing it renders was never requested - the board
    // showed pins alone until the reader tapped a path level, which is what
    // finally asked for it.
    void this.loadQuickSwitcherData();
    window.visualViewport?.addEventListener("resize", this.onVisualViewportChange);
    window.visualViewport?.addEventListener("scroll", this.onVisualViewportChange);
    // The layout viewport changes on its own when a phone's address bar hides,
    // and that arrives as a window resize rather than a visual viewport one.
    // Without this the shell kept a height the screen no longer had and its
    // bottom sat off screen until a keyboard was opened and closed by hand.
    window.addEventListener("resize", this.onVisualViewportChange);
    window.addEventListener("orientationchange", this.onVisualViewportChange);
    this.onVisualViewportChange();
    // Browser chrome is still settling on the first frames, so the height read
    // at connect can be one nobody ever sees.
    requestAnimationFrame(() => { this.onVisualViewportChange(); });
    window.setTimeout(() => { this.onVisualViewportChange(); }, 400);
    window.addEventListener("popstate", this.onPopState);
    window.addEventListener("pageshow", this.onPageShow);
    this.browserResume.connect();
    window.addEventListener("keydown", this.onKeyDown, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    this.systemLightThemeMedia?.addEventListener("change", this.onSystemLightThemeChange);
    this.applyPreferredTheme(false);
    this.connectRealtime();
    this.syncSessionUnreadMachines();
    // Surface backed up: the pi-web runtime status readout (PI_WEB_STATUS_REFRESH_MS).
    this.piWebStatusTimer = window.setInterval(() => { this.schedulePiWebStatusRefresh(); }, PI_WEB_STATUS_REFRESH_MS);
    document.addEventListener("visibilitychange", this.onDocumentVisibilityChange);
    // Surface backed up: every socket's liveness (SOCKET_LIVENESS_CHECK_MS).
    this.livenessTimer = window.setInterval(() => { this.checkSocketLiveness(); }, SOCKET_LIVENESS_CHECK_MS);
    window.addEventListener("online", this.onBrowserOnline);
    window.addEventListener("pointerdown", this.onInteractionLivenessProbe, { passive: true, capture: true });
    this.updateSubagentPolling();
    void this.loadClientConfig();
    void this.refreshSelfUpdate();
    void this.checkClientFreshness();
    void this.ensureGatewayPluginsLoaded();
    void this.loadProjectsAndRestoreRoute().finally(() => { this.schedulePiWebStatusRefresh(); });
  }

  /**
   * Withdraw a transport complaint that a successful exchange has disproved.
   * The report vouches for one machine: a claim about machine B survives a
   * success from machine A. A page-level ("page") claim is disproved by any
   * response at all - it speaks about the link this page fetches through.
   */
  private clearTransientError(machineId: string | undefined): void {
    if (this.state.error === "" || this.state.errorRetiredBy !== RetiredBy.reply) return;
    // A page-level claim is disproved by any response from the origin; a
    // machine-scoped claim only by a response that was routed to that machine.
    const disproved = this.state.errorMachineId === "page" || this.state.errorMachineId === machineId;
    if (!disproved) return;
    // Reset the scope with the text: a stale scope would let the next
    // transport complaint inherit a machine it does not speak about.
    // The schedule marker pair goes too: the hold window keeps showing the
    // banner after this, and a re-raised identical text - for the same
    // machine or for the page - must re-arm its own expiry rather than be
    // silently gated by the previous schedule.
    this.lastScheduledError = "";
    this.lastScheduledMachineId = undefined;
    this.setState(clearErrorPatch());
    if (this.transientErrorTimer !== undefined) {
      window.clearTimeout(this.transientErrorTimer);
      this.transientErrorTimer = undefined;
    }
  }

  /**
   * Let a self-healing message withdraw itself.
   *
   * A reconnect notice that outlives the reconnect is just noise occupying the
   * top of a phone screen. A permanent failure is never expired here: it stays
   * until the user has seen and dismissed it.
   */
  private scheduleTransientErrorDismissal(error: string, machineId: string | undefined): void {
    if (this.transientErrorTimer !== undefined) {
      window.clearTimeout(this.transientErrorTimer);
      this.transientErrorTimer = undefined;
    }
    // Expiry is a property of the retirement model, not of the words: only a
    // reply-retired transport claim heals on its own. A reply-retired message
    // the wording layer declines to shorten (a composed "X is unavailable;
    // reconnecting… <detail>", the retry ladder's terminal sentence) asserts
    // a state, renders with the permanent style, and stays until its machine's
    // answers or the reader retire it - expiring it contradicted its own
    // rendering and deleted the ladder's final word six seconds in.
    if (this.state.errorRetiredBy !== RetiredBy.reply) return;
    if (normalizeTransientError(error) === undefined) return;
    this.transientErrorTimer = window.setTimeout(() => {
      this.transientErrorTimer = undefined;
      // Only clear what we scheduled for: a newer message must not be
      // swallowed. The schedule marker resets with the text, so a same-batch
      // re-raise of identical wording re-arms its own expiry instead of
      // inheriting a spent gate.
      this.lastScheduledError = "";
      this.lastScheduledMachineId = undefined;
      // Only clear what we scheduled for - and "what" is the claim, not the
      // wording: two machines down in a row can produce identical text, and
      // the first machine's timer must not delete the second machine's claim
      // that never answered once.
      if (this.state.error === error && this.state.errorMachineId === machineId && this.state.errorRetiredBy === RetiredBy.reply) {
        this.setState(clearErrorPatch());
      }
    }, TRANSIENT_ERROR_TIMEOUT_MS);
  }

  override disconnectedCallback(): void {
    observeTransportRecovery(undefined);
    this.navigation.dispose();
    if (this.transientErrorTimer !== undefined) window.clearTimeout(this.transientErrorTimer);
    if (this.bannerHoldTimer !== undefined) window.clearTimeout(this.bannerHoldTimer);
    if (this.transientGraceTimer !== undefined) window.clearTimeout(this.transientGraceTimer);
    window.removeEventListener(OUTBOX_CHANGED_EVENT, this.onOutboxChanged);
    window.removeEventListener("resize", this.onVisualViewportChange);
    window.removeEventListener("orientationchange", this.onVisualViewportChange);
    window.visualViewport?.removeEventListener("resize", this.onVisualViewportChange);
    window.visualViewport?.removeEventListener("scroll", this.onVisualViewportChange);
    this.unreadConnected = false;
    this.committedChatIdentity = undefined;
    this.readyChatIdentity = undefined;
    this.sessionUnread.retainMachines(new Set<string>());
    for (const timer of this.firstOpenFallbacks.values()) window.clearTimeout(timer);
    this.firstOpenFallbacks.clear();
    this.cancelWorkspaceDeletionRetry();
    window.removeEventListener("popstate", this.onPopState);
    window.removeEventListener("pageshow", this.onPageShow);
    this.browserResume.disconnect();
    window.removeEventListener("keydown", this.onKeyDown, GLOBAL_SHORTCUT_LISTENER_OPTIONS);
    this.systemLightThemeMedia?.removeEventListener("change", this.onSystemLightThemeChange);
    this.keyboard.reset();
    this.auth.dispose();
    this.sessions.dispose();
    this.realtime.close();
    this.closeMachineActivitySockets();
    if (this.piWebStatusTimer !== undefined) window.clearInterval(this.piWebStatusTimer);
    this.piWebStatusTimer = undefined;
    this.clearScheduledPiWebStatusRefresh();
    if (this.workspaceDeletionPollTimer !== undefined) window.clearInterval(this.workspaceDeletionPollTimer);
    this.workspaceDeletionPollTimer = undefined;
    if (this.reconnectingRecheck !== undefined) window.clearTimeout(this.reconnectingRecheck);
    this.reconnectingRecheck = undefined;
    this.projects.dispose();
    this.workspaces.dispose();
    this.machines.dispose();
    this.unsubscribeSessionBoards();
    this.sessionBoards.dispose();
    if (this.livenessTimer !== undefined) window.clearInterval(this.livenessTimer);
    this.livenessTimer = undefined;
    window.removeEventListener("online", this.onBrowserOnline);
    window.removeEventListener("pointerdown", this.onInteractionLivenessProbe, { capture: true });
    document.removeEventListener("visibilitychange", this.onDocumentVisibilityChange);
    this.clearPendingRemoteRouteRestore();
    super.disconnectedCallback();
  }

  private setState(patch: Partial<AppState>) {
    if (patch.messages !== undefined) patch = { ...patch, messages: oneRowPerIdentity(patch.messages) };
    if (!patchChangesState(this.state, patch)) return;
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    if (selectedChatIdentity(previous) !== selectedChatIdentity(this.state)) {
      this.committedChatIdentity = undefined;
      this.readyChatIdentity = undefined;
      this.endMessageStatusClaimOffScreen();
    }
    this.syncUnreadSessionIds();
    this.handleActivityTransition(previous, this.state);
    if (listingSelectionChanged(previous, this.state)) this.workspaces.selectionChanged();
    this.handleWorkspaceChange(previous, this.state);
    if (workspaceDeletionRunsKey(previous) !== workspaceDeletionRunsKey(this.state)) {
      this.cancelWorkspaceDeletionRetry();
      if (Object.keys(this.state.workspaceDeletionRuns).length > 0) this.setState({ workspaceDeletionRuns: {} });
      void this.refreshWorkspaceDeletionRuns();
    }
    this.handleMachineChange(previous, this.state);
    if (machineActivitySubscriptionInputsChanged(previous, this.state)) this.syncMachineActivitySubscriptions();
    if (machineUnreadInputsChanged(previous, this.state)) this.syncSessionUnreadMachines();
    // Only the timer here: the selection paths that can afford an immediate
    // read already ask for one, and the poll picks up every other path within
    // its interval.
    if (previous.selectedSession?.id !== this.state.selectedSession?.id) this.updateSubagentPolling();
  }

  /**
   * A message-status claim belongs to the session it was about. When the reader leaves that
   * session the episode ends, so coming back never shows a claim counted from before: it would skip
   * the row's grace on a link that may well have recovered meanwhile (review of b469d48b).
   */
  private endMessageStatusClaimOffScreen(): void {
    const claim = this.state.messageStatusUnanswered;
    if (claim === undefined) return;
    if (messageStatusUnanswered(claim, { machineId: selectedMachineId(this.state), sessionId: this.state.selectedSession?.id }) !== undefined) return;
    this.setState({ messageStatusUnanswered: undefined });
  }

  /**
   * The boot: list the machines, then restore the route. A roster without an
   * answer cannot resolve a remote route's machine, and restoring then would
   * flatten a machine+project+session deep link to the local machine - how a
   * reload on a flaky connection once lost the whole machine dimension. So a
   * remote deep link waits for the roster, retried by itself, for as long as
   * it is still the reader's intent (B48); the URL is untouched meanwhile. A
   * local route needs no roster and goes on at once.
   */
  private async loadProjectsAndRestoreRoute() {
    const intent = this.navigation.latest();
    this.restoreSettingsRoute();
    const route = readRoute();
    await this.machines.loadMachines(route.machineId, () => this.navigation.isCurrent(intent) && readRoute().machineId === route.machineId);
    if (this.state.machinesLoad !== "loaded" && (route.machineId ?? "local") !== "local") {
      const answered = await this.machines.rosterAnswered(() => this.navigation.isCurrent(intent) && readRoute().machineId === route.machineId);
      if (!answered) return;
    }
    await this.restoreBootRoute(route, intent);
  }

  /** `intent` is the reader's latest intent when the boot restore began; every step and deferral keeps it (D8). */
  private async restoreBootRoute(route: ParsedAppRoute, intent: number) {
    const effectiveRoute = this.routeForSelectedMachine(route);
    const initialRouteMachineHealth = this.state.machineStatuses[effectiveRoute.machineId ?? "local"];
    if (effectiveRoute !== route) this.replaceRouteAndClearWorkspaceQuery(effectiveRoute);
    await this.projects.loadProjects();
    // A failed listing cannot resolve the route's project id: restoring now
    // gives up silently and rewrites the URL without the project, which is
    // how a reload on a flaky connection landed on "Select or start a
    // session." with no way back. Defer to the retry loop instead — it
    // re-lists the projects and re-restores the same route once the listing
    // recovers.
    if (effectiveRoute.projectId !== undefined && this.state.projectsLoad !== "loaded") {
      this.deferRemoteRouteRestore(effectiveRoute, intent);
      return;
    }
    await this.withChatScrollTransition(() => this.restoreRouteFor(effectiveRoute, undefined, undefined, intent));
    if (this.shouldDeferRemoteRouteRestore(effectiveRoute, initialRouteMachineHealth)) this.deferRemoteRouteRestore(effectiveRoute, intent);
    else {
      this.clearPendingRemoteRouteRestore();
      this.rememberCurrentMachineNavigation();
    }
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
    for (const machineId of this.pinsAdopted) this.refreshMachinePins(machineId);
    await Promise.all([
      this.sessions.refreshSelectedSession(),
      this.sessions.verifyUnansweredSends(),
      this.refreshMachineStatusSnapshots(),
      this.refreshWorkspaceDeletionRuns(),
      this.refreshCurrentWorkspaceSurface(),
      this.workspaces.refreshSelectedProjectTopology(),
      // A projects listing that failed while the browser slept recovers here
      // instead of waiting for a manual reload.
      this.projects.loadProjects(),
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
    this.workspaceUploadFolderFallback = effectiveWorkspaceUploadFolder(config);
    // Absent config means the dictation control is never rendered, so an
    // install that has not opted in cannot reach a microphone at all.
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
    const resolved = this.plugins.resolveWorkspacePanelRouteId(tool, selectedMachineId(this.state));
    if (resolved === "core:workspace.terminal" && workspace !== undefined) await this.refreshActiveTerminals(workspace);
    else await this.invalidateWorkspacePanels(resolved);
  }

  private hardReloadApp(): void {
    window.location.reload();
  }

  private async restoreRoute() {
    await this.restoreRouteFor(readRoute());
    this.rememberCurrentMachineNavigation();
  }

  /**
   * Restore a route: boot, back and forward, a machine switch, a deferred retry. `intent` is the
   * reader's latest intent when the restore was asked for; a tap made since then wins, and the
   * restore stops moving the page (D8, B29).
   */
  private async restoreRouteFor(parsedRoute: ParsedAppRoute, surface = this.readWorkspaceRouteSurface(parsedRoute), restoredMainView?: AppState["mainView"], intent = this.navigation.latest()) {
    const machineBeforeRestore = selectedMachineId(this.state);
    const routeSurface = parsedRoute.projectId === undefined || parsedRoute.projectId === "" ? emptyWorkspaceRouteSurface() : surface;
    const restoreSeq = ++this.routeRestoreSeq;
    this.sessions.yieldPlacement();
    this.routeRestoreDepth += 1;
    this.restoringRouteTerminalId = routeSurface.selectedTerminalId;
    try {
      await this.restoreRouteMachine(parsedRoute);
      await this.loadPluginsForSelectedMachine();
      if (!this.isCurrentRouteRestore(restoreSeq, intent)) return;
      const route = resolveAppRoute(parsedRoute, (value) => this.plugins.resolveWorkspacePanelRouteId(value, selectedMachineId(this.state)));
      const mainView = this.resolveRestoredMainView(restoredMainView) ?? route.view ?? this.defaultRouteView(route);
      this.workspacePanelFullscreen = false;
      this.setState({
        workspaceTool: routedWorkspaceTool(route.tool, mainView, this.state.workspaceTool),
        mainView,
        selectedTerminalId: routeSurface.selectedTerminalId,
      });
      if (route.projectId === undefined || route.projectId === "") {
        if (route.sessionId !== undefined && route.sessionId !== "" && placeSessionId(this.state) !== route.sessionId) {
          this.workspaces.clearSelection({ updateUrl: false });
          await this.sessions.openSessionAlone(route.sessionId, { updateUrl: false });
        }
        return;
      }
      if (this.routeMatchesCurrentSelection(route)) {
        this.restoreWorkspaceExpandedRoute(route, routeSurface, mainView);
        if (routeSurface.selectedTerminalId !== undefined) this.rememberSelectedTerminal(routeSurface.selectedTerminalId);
        await this.refreshRestoredWorkspaceTool(route.tool);
        return;
      }
      // A project missing from the loaded list is not a project that does not
      // exist: on a reload the route is restored before the list has arrived,
      // and giving up here is what dropped the reader on "Select or start a
      // session" after switching sessions and refreshing. Ask for the list
      // before concluding anything.
      let project = this.state.projects.find((p) => p.id === route.projectId);
      if (!project) {
        project = await this.locateRouteProject(route.projectId);
        if (!this.isCurrentRouteRestore(restoreSeq, intent)) return;
      }
      if (!project) {
        this.setState({ selectedTerminalId: undefined });
        return;
      }
      const landed = await this.workspaces.selectProject(project, { workspaceId: route.workspaceId, sessionId: route.sessionId, updateUrl: false });
      if (!landed || !this.isCurrentRouteRestore(restoreSeq, intent)) return;
      this.setState({ selectedTerminalId: routeSurface.selectedTerminalId });
      this.restoreWorkspaceExpandedRoute(route, routeSurface, mainView);
      if (routeSurface.selectedTerminalId !== undefined) this.rememberSelectedTerminal(routeSurface.selectedTerminalId);
      await this.refreshRestoredWorkspaceTool(route.tool);
      if (this.isCurrentRouteRestore(restoreSeq, intent) && restoreOpenedUnnamedSession(parsedRoute, readRoute(), placeSessionId(this.state))) this.updateUrl({ replace: true });
    } finally {
      this.routeRestoreDepth = Math.max(0, this.routeRestoreDepth - 1);
      if (this.routeRestoreDepth === 0) this.restoringRouteTerminalId = undefined;
      if (selectedMachineId(this.state) !== machineBeforeRestore) this.schedulePiWebStatusRefresh();
    }
  }

  private isCurrentRouteRestore(restoreSeq: number, intent: number): boolean {
    return restoreSeq === this.routeRestoreSeq && this.navigation.isCurrent(intent);
  }

  private readWorkspaceRouteSurface(route: ParsedAppRoute): WorkspaceRouteSurface {
    if (route.projectId === undefined || route.projectId === "") return emptyWorkspaceRouteSurface();
    return {
      selectedFilePath: readNamespacedString(FILES_ROUTE_NAMESPACE, "file"),
      selectedTerminalId: readNamespacedString(TERMINAL_ROUTE_NAMESPACE, "terminal"),
      workspaceExpanded: readNamespacedString(WORKSPACE_ROUTE_NAMESPACE, "expanded") === "1",
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
    setNamespacedQueryKey(WORKSPACE_ROUTE_NAMESPACE, "expanded", undefined, { replace: true });
  }

  private shouldDeferRemoteRouteRestore(route: ParsedAppRoute, routeMachineHealth = this.state.machineStatuses[route.machineId ?? "local"]): boolean {
    const machineId = route.machineId ?? "local";
    const machine = this.state.selectedMachine;
    if (machineId === "local" || machine?.id !== machineId || machine.kind !== "remote") return false;
    if (routeMachineHealth?.ok !== false) return false;
    if (route.projectId === undefined || route.projectId === "") return this.state.projects.length === 0;
    return this.state.selectedProject?.id !== route.projectId;
  }

  private deferRemoteRouteRestore(route: ParsedAppRoute, intent: number): void {
    this.pendingRemoteRouteRestore = route;
    this.pendingRestoreIntent = intent;
    this.remoteRouteRestoreAttempt = 0;
    this.remoteRouteRestoreNotice = undefined;
    this.setRemoteRouteRestoreMessage(route);
    this.schedulePendingRemoteRouteRestore(retryDelayMs(0, QUIET_WINDOW_MS));
  }

  /**
   * The projects listing answered or moved: a route restore waiting on it can
   * run now instead of waiting out its ladder.
   */
  private onProjectsListingChange(): void {
    this.requestUpdate();
    this.followProjectsOnBoard();
    if (this.state.projectsLoad === "loaded") this.retryPendingRemoteRouteRestoreSoon();
  }

  /**
   * The board lists what the selected machine's projects hold (review
   * 3eeecb09). Once they answer, the board of the machine now browsed is shown
   * and read, which also clears another machine's rows after a switch from
   * the machine list; a project added or closed on the same machine reads it
   * whole. A settle that changed nothing costs nothing: a fresh board is not
   * read again, and a read in flight is joined.
   */
  private followProjectsOnBoard(): void {
    if (this.state.projectsLoad !== "loaded") {
      this.sessionBoards.wake();
      return;
    }
    const machineId = selectedMachineId(this.state);
    const projectIds = this.state.projects.map((project) => project.id).sort().join("\n");
    const previous = this.boardProjects;
    this.boardProjects = { machineId, projectIds };
    const projectsChanged = previous?.machineId === machineId && previous.projectIds !== projectIds;
    void this.loadQuickSwitcherData(projectsChanged);
  }

  /** The selected machine's projects as the board last followed them. */
  private boardProjects: { machineId: string; projectIds: string } | undefined;

  private retryPendingRemoteRouteRestoreSoon(): void {
    if (this.pendingRemoteRouteRestore === undefined) return;
    this.schedulePendingRemoteRouteRestore(0);
  }

  private schedulePendingRemoteRouteRestore(delayMs: number): void {
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
      if (machineId !== "local") {
        // A remote machine's ladder walks its health first; the local
        // machine's listing IS the probe - the web process answers it or it
        // fails, and retrying it is the whole recovery.
        const health = await this.machines.refreshMachineHealth(machineId);
        if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
        if (health?.ok !== true) {
          this.scheduleNextRemoteRouteRestoreAttempt(route);
          return;
        }

        await this.machines.refreshMachineRuntime(machineId);
        if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      }
      await this.projects.loadProjects();
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      // The load's own status is the probe - a leftover banner from another
      // machine is not evidence about this listing, and since the owner's
      // clear-notify call nothing clears state.error at load start.
      if (this.state.projectsLoad !== "loaded") {
        this.scheduleNextRemoteRouteRestoreAttempt(route);
        return;
      }

      await this.withChatScrollTransition(() => this.restoreRouteFor(route, undefined, undefined, this.pendingRestoreIntent));
      if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;
      this.clearPendingRemoteRouteRestore();
      this.rememberCurrentMachineNavigation();
    } finally {
      this.remoteRouteRestoreInProgress = false;
    }
  }

  /**
   * One more try later, on the shared backoff capped at the quiet window. It
   * never gives up while the route is current (B48): the restore ends when
   * the machine answers, or when the reader goes elsewhere.
   */
  private scheduleNextRemoteRouteRestoreAttempt(route: ParsedAppRoute): void {
    this.remoteRouteRestoreAttempt += 1;
    this.setRemoteRouteRestoreMessage(route);
    this.schedulePendingRemoteRouteRestore(retryDelayMs(this.remoteRouteRestoreAttempt, QUIET_WINDOW_MS));
  }

  private setRemoteRouteRestoreMessage(route: ParsedAppRoute): void {
    // A local route waits on the projects listing, which retries by itself
    // and is named by the app row while it goes unanswered (B48); the
    // machine wording would promise a reconnect this ladder never performs.
    if ((route.machineId ?? "local") === "local") return;
    const machineId = route.machineId ?? "local";
    const health = this.state.machineStatuses[machineId];
    if (!remoteReportedDown(health)) return;
    const machineName = this.state.machines.find((machine) => machine.id === machineId)?.name ?? this.state.selectedMachine?.name ?? "Remote machine";
    // The detail is what the health read reported - never this banner's own
    // previous text, which the retry ladder would otherwise paste into itself
    // once per attempt.
    const detail = health?.error;
    const text = `${machineName} is unavailable; reconnecting…${detail === undefined ? "" : ` ${detail}`}`;
    if (text === this.remoteRouteRestoreNotice) return;
    this.remoteRouteRestoreNotice = text;
    this.setState(noticePatch(noticeFromTransport(text, machineId)));
  }

  private pendingRemoteRouteRestoreStillCurrent(route: ParsedAppRoute): boolean {
    const machineId = route.machineId ?? "local";
    return this.pendingRemoteRouteRestore === route
      && this.navigation.isCurrent(this.pendingRestoreIntent)
      && this.state.selectedMachine?.id === machineId
      && this.state.machines.some((machine) => machine.id === machineId);
  }

  private clearPendingRemoteRouteRestore(): void {
    this.clearPendingRemoteRouteRestoreTimer();
    this.pendingRemoteRouteRestore = undefined;
    this.remoteRouteRestoreAttempt = 0;
    this.remoteRouteRestoreNotice = undefined;
  }

  private clearPendingRemoteRouteRestoreTimer(): void {
    if (this.remoteRouteRestoreTimer === undefined) return;
    window.clearTimeout(this.remoteRouteRestoreTimer);
    this.remoteRouteRestoreTimer = undefined;
  }

  /** A restore owns the URL it came from, so the machine move writes none. */
  private async restoreRouteMachine(route: ParsedAppRoute): Promise<void> {
    const routeMachineId = route.machineId ?? "local";
    if (this.state.selectedMachine?.id === routeMachineId) return;
    const machine = this.state.machines.find((candidate) => candidate.id === routeMachineId);
    if (machine === undefined) return;
    await this.machines.selectMachine(machine, { updateUrl: false });
  }

  private routeMatchesCurrentSelection(route: AppRoute): boolean {
    return (route.machineId ?? "local") === (this.state.selectedMachine?.id ?? "local")
      && route.workspaceId !== undefined
      && route.workspaceId !== ""
      && this.state.selectedProject?.id === route.projectId
      && this.state.selectedWorkspace?.id === route.workspaceId
      && placeSessionId(this.state) === route.sessionId;
  }

  private restoreWorkspaceExpandedRoute(route: AppRoute, surface: WorkspaceRouteSurface, mainView: AppState["mainView"]): void {
    const workspace = this.state.selectedWorkspace;
    this.workspacePanelFullscreen = surface.workspaceExpanded === true
      && mainView !== "chat"
      && mainView !== "navigation"
      && route.tool === mainView
      && workspace !== undefined
      && (route.machineId ?? "local") === selectedMachineId(this.state)
      && route.projectId === workspace.projectId
      && route.workspaceId === workspace.id;
  }

  private async refreshRestoredWorkspaceTool(tool: QualifiedContributionId | undefined): Promise<void> {
    if (tool === undefined || tool === "core:workspace.terminal") return;
    await this.invalidateWorkspacePanels(tool);
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

  private updateUrl(options?: { replace?: boolean | undefined; forcePush?: boolean | undefined }) {
    this.rememberCurrentMachineNavigation();
    writeRoute({
      machineId: this.state.selectedMachine?.id,
      projectId: this.state.selectedProject?.id,
      workspaceId: this.state.selectedWorkspace?.id,
      sessionId: placeSessionId(this.state),
      tool: this.state.selectedWorkspace === undefined ? undefined : this.state.workspaceTool,
      view: this.state.mainView === "navigation" ? undefined : this.state.mainView,
    }, options);
    this.syncWorkspaceRouteSurfaceToUrl();
  }

  private currentMachineNavigationSnapshot(): MachineNavigationSnapshot {
    const snapshot = machineNavigationSnapshotFromState(this.state);
    snapshot.surface.workspaceExpanded = this.state.mainView !== "chat" && this.state.mainView !== "navigation" && this.workspacePanelHoldsCanvas();
    snapshot.surface.selectedFilePath = readNamespacedString(FILES_ROUTE_NAMESPACE, "file");
    return snapshot;
  }

  private rememberCurrentMachineNavigation(): void {
    this.machineNavigation.remember(this.currentMachineNavigationSnapshot());
  }

  private syncWorkspaceRouteSurfaceToUrl(): void {
    this.writeWorkspaceRouteSurfaceToUrl(this.currentMachineNavigationSnapshot().surface);
  }

  private writeMachineNavigationSnapshotToUrl(snapshot: MachineNavigationSnapshot, options?: { replace?: boolean | undefined }): void {
    writeRoute(routeFromMachineNavigationSnapshot(snapshot), options);
    this.writeWorkspaceRouteSurfaceToUrl(snapshot.surface);
  }

  private writeWorkspaceRouteSurfaceToUrl(surface: WorkspaceRouteSurface): void {
    setNamespacedQueryKey(FILES_ROUTE_NAMESPACE, "file", surface.selectedFilePath, { replace: true });
    setNamespacedQueryKey(TERMINAL_ROUTE_NAMESPACE, "terminal", surface.selectedTerminalId, { replace: true });
    setNamespacedQueryKey(WORKSPACE_ROUTE_NAMESPACE, "expanded", surface.workspaceExpanded === true ? "1" : undefined, { replace: true });
  }

  private async selectMachineWithMemory(machine: Machine, options: { rememberCurrent?: boolean } = {}): Promise<void> {
    if (this.state.selectedMachine?.id === machine.id) return;
    if (options.rememberCurrent !== false && !this.routeRestoreInProgress) this.rememberCurrentMachineNavigation();
    const seq = ++this.machineNavigationRestoreSeq;
    const snapshot = this.machineNavigation.latest(machine.id) ?? emptyMachineNavigationSnapshot(machine.id);
    await this.restoreRouteFor(routeFromMachineNavigationSnapshot(snapshot), snapshot.surface, snapshot.view);
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

  /**
   * Put a workspace tool on screen. On a desktop the tool lives in the right-hand panel, and a
   * reader who had folded that panel away chose Background in Go to and saw nothing happen:
   * the tool was selected into a panel 0px wide. Every caller here is a request to see the tool,
   * so the panel opens with it. A phone shows the tool as the whole view and has no side panel
   * to open. A route restored at boot sets the tool without coming here, so a remembered fold
   * survives a reload.
   */
  private openWorkspaceTool(tool: QualifiedContributionId) {
    if (tool === "core:workspace.terminal") this.terminalAutoStartWorkspaceId = this.state.selectedWorkspace?.id;
    if (!this.appShell.isMobileNavigationLayout) this.panelCollapse.expandWorkspacePanel();
    if (tool !== this.state.workspaceTool) this.workspacePanelFullscreen = false;
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
      stillWanted: () => { const intent = this.navigation.latest(); return () => this.navigation.isCurrent(intent); },
    });
    this.terminalCommandRunRuntimes.set(key, runtime);
    return runtime;
  }

  /** Opens the terminal a run asked for; a reader who moved on while it was prepared stays where they are (D8). */
  private async openRuntimeTerminal(machineId: string, workspace: Workspace | undefined, options?: { terminalId?: string | undefined }, intent = this.navigation.latest()): Promise<void> {
    if (selectedMachineId(this.state) !== machineId || (workspace !== undefined && (this.state.selectedWorkspace?.id !== workspace.id || this.state.selectedProject?.id !== workspace.projectId))) {
      if (!this.routeRestoreInProgress) this.rememberCurrentMachineNavigation();
      await this.restoreRouteFor({
        machineId,
        projectId: workspace?.projectId,
        workspaceId: workspace?.id,
        sessionId: undefined,
        tool: "core:workspace.terminal",
        view: "core:workspace.terminal",
      }, { selectedTerminalId: options?.terminalId }, "core:workspace.terminal", intent);
      if (!this.navigation.isCurrent(intent)) return;
      if (selectedMachineId(this.state) !== machineId) {
        this.setState(noticePatch(noticeForReader("Machine not found for terminal command run")));
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

  /** The reader chose a view: it supersedes any open still loading (D8). */
  private selectMainView(view: AppState["mainView"]) {
    this.navigation.begin();
    this.showView(view);
  }

  private showView(view: AppState["mainView"], options: { readonly updateUrl?: boolean } = {}) {
    if (view !== "navigation" && view !== "chat") {
      this.openWorkspaceTool(view);
      return;
    }
    this.workspacePanelFullscreen = false;
    this.setState({ mainView: view });
    if (options.updateUrl !== false) this.updateUrl();
  }

  /**
   * Bring a lazily loaded surface in, and say so when it cannot come.
   *
   * The load fails when the tab has outlived the deploy that named the module.
   * Silence there is the worst outcome: a control that does nothing, forever.
   */
  private openLazySurface(surface: LazySurface, title: string): void {
    // One update when the module arrives; the failure message plants itself
    // and retires itself: a retry that succeeds must not leave a banner
    // claiming the opposite of the screen.
    const failure = `${title} could not load. This tab may be running an older version - reload to get it.`;
    void loadSurface(surface).then(
      () => {
        if (this.state.error === failure) this.setState(clearErrorPatch());
        this.requestUpdate();
      },
      () => {
        // The retired-by half must travel with the text, or the banner's
        // lifetime is decided by whatever error was cleared before it. A
        // module fetch failure is a network-shaped error: reader-retired,
        // which the success path's text match then retires on retry.
        this.setState({ ...errorNoticePatch(new Error(failure)) });
      },
    );
  }

  private openSettings(section?: SettingsSection): void {
    // Fire-and-forget like every surface: the element renders with its flag,
    // and the arriving module schedules the update that fills it in.
    this.openLazySurface("settings", "Settings");
    this.settingsOpen = true;
    if (section === undefined) {
      this.settingsSection = undefined;
      this.settingsListFramePushed = true;
      writeSettingsOpen();
      return;
    }
    this.settingsListFramePushed = false;
    this.settingsSection = section;
    writeSettingsSection(section);
  }

  private async refreshFleet(): Promise<void> {
    this.fleetLoading = true;
    this.fleetError = undefined;
    try {
      this.fleetReport = await fleetApi.report();
    } catch (error) {
      this.fleetError = describeError(error);
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
      this.fleetError = describeError(error);
      return undefined;
    } finally {
      void this.refreshFleet();
    }
  }

  private closeSettings(): void {
    this.settingsOpen = false;
    this.settingsSection = undefined;
    this.settingsListFramePushed = false;
    writeSettingsSection(undefined);
  }

  private navigateSettings(section: SettingsSection): void {
    this.settingsSection = section;
    writeSettingsSection(section);
  }

  /**
   * The phone's section list is the drill-down root. The back control pops
   * the drilled frame when this sheet session actually pushed one - history
   * length says nothing about what sits beneath a deep link or a plugin's
   * section entry - and otherwise replaces the frame with the list root.
   *
   * A modal layer opened above the sheet (machine dialog) leaves its own
   * placeholder frame behind when closed by cancel, so the next frame under
   * history.back() is that stray frame, not the section frame: replacing
   * consumes it instead of swallowing the tap.
   */
  private backToSettingsList(): void {
    if (this.settingsListFramePushed && !placeholderFrameOutstanding()) {
      window.history.back();
      return;
    }
    this.settingsSection = undefined;
    writeSettingsOpen({ replace: true });
  }

  private restoreSettingsRoute(): void {
    this.settingsOpen = readSettingsOpen();
    this.settingsSection = readSettingsSection();
    this.settingsListFramePushed = false;
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
    // Not while a route is restoring: a deep link sets the workspace before the
    // session it names has been selected, so the transition saw "workspace, no
    // session, chat" and sent a shared phone link to the picker - at 209ms,
    // after the route had already put the reader in the conversation.
    const restoringRoute = this.routeRestoreInProgress;
    if (!restoringRoute && workspaceViewTransition({ mobileLayout: this.appShell.isMobileNavigationLayout, hasSession: next.selectedSession !== undefined, view: next.mainView }) === "return-to-picker") {
      this.setState({ mainView: "navigation" });
    }
    if (next.selectedWorkspace === undefined) return;
    void this.refreshActiveTerminals(next.selectedWorkspace);
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
      if (this.sessionUnread.projection(machineId) !== undefined) continue;
      if (this.socketKeptRead(machineId) === "read") void this.sessionUnread.ensureLoaded(machineId);
    }
  }

  /**
   * Whether a fact the machine's socket keeps live (its unread set, its pins) may be read now,
   * or is left to the socket's open, which reads both (state-diagram D5, P6 slice a). A need left
   * to a connecting socket arms one fallback for the machine, which asks again once the grace is
   * over, so a socket that never opens does not leave the facts unread.
   */
  private socketKeptRead(machineId: string): AnchoredRead {
    const phase = machineId === selectedMachineId(this.state) ? this.realtime.phaseFor(machineId) : this.machineRealtimeSockets.get(machineId)?.phaseFor(machineId) ?? { kind: "absent" as const };
    const now = Date.now();
    const verdict = anchoredRead(phase, now);
    if (verdict === "await-open") this.armFirstOpenFallback(machineId, graceRemaining(phase, now));
    return verdict;
  }

  /** Ask once more for a machine's socket-kept facts after the grace, while that machine is still one the page shows. */
  private armFirstOpenFallback(machineId: string, delayMs: number): void {
    if (this.firstOpenFallbacks.has(machineId)) return;
    this.firstOpenFallbacks.set(machineId, window.setTimeout(() => {
      this.firstOpenFallbacks.delete(machineId);
      const shown = machineId === selectedMachineId(this.state) || this.state.machines.some((machine) => machine.id === machineId);
      if (!shown) return;
      this.syncSessionUnreadMachines();
      void this.ensureMachinePins(machineId);
    }, delayMs));
  }

  private connectRealtime(): void {
    const machineId = selectedMachineId(this.state);
    // Read once on the first connect too, not only when re-establishing: a
    // fresh page load is exactly when the user is looking for the work the
    // last restart cut off. Re-entries after a machine switch arrive here
    // as well and get re-read semantics, not boot semantics.
    this.refreshInterruptedRuns(machineId);
    this.realtime.connect(
      (event) => { this.handleRealtimeEvent(machineId, event); },
      () => {
        // A self-update restart is the one "reconnecting…" that ends with the
        // socket coming back to the same page: the applying strip's exit is
        // the reconnect itself, and the restart is exactly when the running
        // bundle may have gone stale - the check the visibility hook cannot
        // do, because the reader never left the tab.
        if (this.state.selfUpdateApplying) {
          this.setState({ selfUpdateApplying: false });
          void this.checkClientFreshness();
        }
        this.refreshInterruptedRuns(machineId, { adoptEmpty: false });
        if (this.openMissedSome(machineId)) {
          this.rereadAnnounced(machineId);
          return;
        }
        // The proxies accept the upgrade first and bridge upstream second, so
        // onopen proves the web process is alive - not that this machine's
        // daemon answered anything. Retiring the claim here retracted a
        // daemon-down banner half a second after it was raised, for as long
        // as the outage lasted; the reads below fire the reports that are
        // allowed to retire claims.
        void this.sessionUnread.refresh(machineId);
        this.refreshMachinePins(machineId);
        // Status updates that landed during the gap are gone for good, so this
        // has to overwrite what the browser holds rather than fill gaps: a
        // session that finished while disconnected kept its "working" state
        // until the page was reloaded.
        void this.sessions.hydrateSessionStatuses(machineId, { replaceKnown: true });
        // The list itself can be stale too - sessions created, renamed or
        // archived during the gap were announced on the socket that was down.
        void this.sessions.refreshCurrentWorkspaceSessions(machineId);
        const workspace = this.state.selectedWorkspace;
        if (workspace !== undefined) void this.refreshActiveTerminals(workspace);
      },
      machineId,
      () => { this.rereadAnnounced(machineId); },
    );
  }

  /** The machines a socket of this page has opened for. */
  private readonly machinesHeard = new Set<string>();

  /**
   * Whether this open follows a time the page heard the machine before (state-diagram D5, "A reopen
   * is a miss too"): a reopen of the same socket, or a handoff between the machine's sockets on a
   * machine switch, when frames went to no socket for one handshake. The page's first open of a
   * machine is not: the boot reads its board once already (`loadQuickSwitcherData`).
   */
  private openMissedSome(machineId: string): boolean {
    const heard = this.machinesHeard.has(machineId);
    this.machinesHeard.add(machineId);
    return heard;
  }

  /**
   * A machine's global socket lost an announcement (state-diagram D5, "A lost announcement is
   * noticed"): read again everything its frames keep live, once. Each frame kind and what heals it:
   * `sessions.unread` the unread set; `pins.changed` the pins; `machine.status` (projects and
   * workspaces ride it) a fresh snapshot; `session.name` and `session.created` the board and, on
   * the machine in use, its workspace's sessions; `status.update` and `activity.update` its
   * statuses; terminal frames its terminals; `workspace.changed` its open workspace panels.
   * `notifications.summary` and `session.startup` keep nothing a read could restore.
   */
  private rereadAnnounced(machineId: string): void {
    void this.announcedRereads.request(machineId, () => this.readAnnounced(machineId)).catch(() => undefined);
  }

  /** One pass of `rereadAnnounced`: a burst of losses on a lossy link shares it, and asks for at most one more after it (review of 2dcf8caa). */
  private async readAnnounced(machineId: string): Promise<void> {
    this.refreshMachinePins(machineId);
    this.sessionBoards.missedAnnouncements(machineId);
    const reads: Promise<unknown>[] = [this.sessionUnread.refresh(machineId), this.machineStatus.refresh(machineId)];
    if (machineId === selectedMachineId(this.state)) {
      const workspace = this.state.selectedWorkspace;
      reads.push(this.sessions.hydrateSessionStatuses(machineId, { replaceKnown: true }), this.sessions.refreshCurrentWorkspaceSessions(machineId));
      if (workspace !== undefined) {
        reads.push(this.refreshActiveTerminals(workspace));
        this.applyWorkspaceChanged(machineId, workspace.path);
      }
    }
    await Promise.allSettled(reads);
  }

  private readonly announcedRereads = new TrailingRefreshCoordinator<string>();

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
        () => {
          if (this.openMissedSome(machineId)) {
            this.rereadAnnounced(machineId);
            return;
          }
          void this.sessionUnread.refresh(machineId);
          this.refreshMachinePins(machineId);
        },
        machineId,
        () => { this.rereadAnnounced(machineId); },
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

  private refreshWorkspaceChangedWhileHidden(): void {
    const deferred = this.workspaceChangedWhileHidden;
    this.workspaceChangedWhileHidden = undefined;
    if (refreshOnReturn(deferred, { selectedMachineId: selectedMachineId(this.state), selectedWorkspacePath: this.state.selectedWorkspace?.path })) void this.invalidateWorkspacePanels();
  }

  private applyWorkspaceChanged(machineId: string, cwd: string): void {
    const verdict = workspaceChangeVerdict({
      eventMachineId: machineId,
      eventCwd: cwd,
      selectedMachineId: selectedMachineId(this.state),
      selectedWorkspacePath: this.state.selectedWorkspace?.path,
      visible: document.visibilityState === "visible",
    });
    if (verdict.kind === "refresh") void this.invalidateWorkspacePanels();
    if (verdict.kind === "defer") this.workspaceChangedWhileHidden = verdict.scope;
  }

  private handleMachineActivityEvent(machineId: string, event: BrowserRealtimeEvent): void {
    if (event.type === "session.name" || event.type === "session.created") this.sessionBoards.applyEvent(machineId, event);
    else if (event.type === "pins.changed") this.refreshMachinePins(machineId);
    else if (event.type === "sessions.unread") this.sessionUnread.applyEvent(machineId, event);
    else if (event.type === "machine.status") this.machineStatus.apply(machineId, event.status);
  }

  private handleRealtimeEvent(machineId: string, event: BrowserRealtimeEvent): void {
    if (event.type === "pins.changed") this.refreshMachinePins(machineId);
    else if (event.type === "sessions.unread") this.sessionUnread.applyEvent(machineId, event);
    else if (event.type === "machine.status") this.machineStatus.apply(machineId, event.status);
    else if (event.type === "workspace.changed") this.applyWorkspaceChanged(machineId, event.cwd);
    else if (isTerminalEvent(event)) {
      this.applyTerminalEvent(event);
      if (event.type === "terminal.exited") void this.refreshWorkspaceDeletionRuns();
    } else {
      if (event.type === "session.name" || event.type === "session.created") this.sessionBoards.applyEvent(machineId, event);
      this.sessions.applyGlobalEvent(event);
    }
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
      // A late background failure must not paint its machine's complaint
      // onto the machine the reader has since switched to - the same rule
      // the health, runtime and project refreshes already run.
      if (selectedMachineId(this.state) !== machineId || this.state.selectedWorkspace?.id !== workspace.id) return;
      this.setState(errorNoticePatch(error));
    }
  }

  private handleActivityTransition(previous: AppState, next: AppState) {
    if (sessionWorkSettled(previous, next)) {
      this.refreshSelectedWorkspaceTool(this.state.workspaceTool);
      const sessionId = this.state.selectedSession?.id;
      if (typeof sessionId === "string" && sessionId !== "") {
        this.plugins.emit({ kind: "session-activity-settled", sessionId, machineId: selectedMachineId(this.state) });
      }
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
    const resolved = this.plugins.resolveWorkspacePanelRouteId(tool, selectedMachineId(this.state));
    if (resolved === undefined || resolved === "core:workspace.terminal") return;
    void this.invalidateWorkspacePanels(resolved);
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

  /**
   * Whether the tool panel is actually on screen, which is not the same as
   * "not collapsed": the shell also gives the column up while no workspace is
   * chosen. The edge control has to describe the state the reader sees, or it
   * offers to collapse a panel that is already gone.
   */
  private workspacePanelOnScreen(): boolean {
    return workspacePanelTakesSpace(
      this.panelCollapse.workspacePanelCollapsed,
      this.state.selectedWorkspace !== undefined,
      this.panelCollapse.workspacePanelRequested,
    );
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
        .collapsed=${!this.workspacePanelOnScreen()}
        .resizable=${!this.appShell.isMobileNavigationLayout}
        .panelWidth=${this.panelResize.panelWidth("workspace")}
        .minWidth=${constraints.minWidth}
        .maxWidth=${constraints.maxWidth}
        .onToggle=${() => {
          if (this.workspacePanelOnScreen()) this.panelCollapse.toggleWorkspacePanel();
          else this.panelCollapse.expandWorkspacePanel();
        }}
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
    return this.appShell.isDesktopSideBySideLayout;
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
      if (selectedMachineId(this.state) === machineId) this.sessionCleanupDialog = { ...this.sessionCleanupDialog, loading: false, error: `Failed to preview cleanup: ${describeError(error)}` };
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
      if (selectedMachineId(this.state) === machineId) this.sessionCleanupDialog = { ...this.sessionCleanupDialog, running: false, error: `Failed to run cleanup: ${describeError(error)}` };
    }
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
    return sessionIdsIn(this.sessionStateKinds(), "working");
  }

  /**
   * The category of every session the switcher or the Go to page lists: the board's rows, pinned
   * sessions whose project is closed, and the stepped-into project's own sessions. Built from the
   * board alone, a session being created or a pinned one still loaded wore no mark on the page while
   * its dock said working (B14 review 6bf7aee1).
   */
  private sessionStateKinds(): ReadonlyMap<string, SessionStateBadgeKind> {
    return quickSwitcherSessionStates([...this.quickSwitcherSessions, ...this.quickSwitcherPinnedElsewhere, ...this.state.sessions], this.state.sessionStatuses, this.state.sessionActivities);
  }

  /**
   * Sessions whose agent stopped on an error - an unavailable model, a failed
   * tool. They are listed first because nothing moves until someone looks, not
   * even with an answer typed into them.
   */
  private errorSessionIds(): ReadonlySet<string> {
    return sessionIdsIn(this.sessionStateKinds(), "error");
  }

  private pinnedProjectCache: { machineId: string; ids: ReadonlySet<string> } | undefined;

  private get pinnedProjectIds(): ReadonlySet<string> {
    const machineId = this.browsedMachineId();
    const cached = this.pinnedProjectCache;
    if (cached?.machineId === machineId) return cached.ids;
    const fresh = { machineId, ids: readPinnedProjectIds(machineId) };
    this.pinnedProjectCache = fresh;
    return fresh.ids;
  }

  private togglePinnedProject(projectId: string): void {
    const machineId = this.browsedMachineId();
    const ids = togglePinnedProjectId(this.pinnedProjectIds, projectId);
    this.pinnedProjectCache = { machineId, ids };
    writePinnedProjectIds(machineId, ids);
    this.requestUpdate();
  }

  private togglePinnedSession(session: SessionInfo): void {
    const machineId = this.browsedMachineId();
    const ids = togglePinnedSessionId(this.pinnedSessionIdsFor(machineId), session.id);
    // Optimistic, then the machine's answer: the mark must move under the
    // finger, and the machine owns the set every other device will read.
    this.pinCache = { machineId, ids };
    writePinnedSessionIds(machineId, ids);
    this.requestUpdate();
    void sessionPinsApi.setPinned(session.id, ids.has(session.id), machineId)
      .then((answered) => { this.applyMachinePins(machineId, answered); })
      .catch((error: unknown) => { this.setState(errorNoticePatch(error)); });
  }

  /**
   * Sessions whose agent is blocked on an `ask_user` answer. They cannot make
   * any progress until the user replies, which is why the switcher lists them
   * above work that is merely running.
   */
  private waitingSessionIds(): ReadonlySet<string> {
    return sessionIdsIn(this.sessionStateKinds(), "asking");
  }

  /** True while a modal layer owns the back gesture. */
  private modalLayerOpen(): boolean {
    return this.quickSwitcherOpen
      || this.navigateOpen
      || this.contextSheetOpen
      || this.goToSheetOpen
      || this.state.actionPaletteOpen
      || this.state.commandDialog !== undefined
      || this.state.modelDialog !== undefined
      || this.state.thinkingDialog !== undefined
      || this.state.themeDialog !== undefined
      || this.sessionCleanupDialog !== undefined
      || this.state.treeDialog !== undefined
      || this.state.authDialog !== undefined
      || this.pluginDialogs.length > 0;
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

  /**
   * The add-project dialog is the workspaces plugin's, opened through the
   * dialog seam; the shell's affordances run the plugin's reserved action.
   * Absent plugin means no dialog: the affordances hide with it.
   */
  private openProjectDialog(options: { readonly startSessionAfter?: boolean } = {}): void {
    const action = this.plugins.getActions(this.createPluginRuntimeContext()).find((candidate) => candidate.localId === "add-project");
    if (action === undefined) return;
    this.startSessionAfterAddingProject = options.startSessionAfter === true;
    void action.run();
  }

  private hasAddProjectEntry(): boolean {
    return this.plugins.getActions(this.createPluginRuntimeContext()).some((candidate) => candidate.localId === "add-project");
  }

  private openContextSheet(): void {
    dismissKeyboardIfRaised();
    this.contextSheetOpen = true;
    this.pushModalLayerFrame();
  }

  /**
   * The bar key is a toggle: pressing it while the sheet is open closes what
   * it opened. A key that only opens leaves the reader hunting for the way
   * back out.
   */
  private toggleGoToSheet(): void {
    if (this.goToSheetOpen) { this.goToSheetOpen = false; return; }
    this.openGoToSheet();
  }

  private openGoToSheet(): void {
    dismissKeyboardIfRaised();
    this.goToSheetOpen = true;
    this.pushModalLayerFrame();
  }

  /**
   * The phone's destinations by name: the list, the conversation, then every
   * workspace tool, each marked when it is the view on screen.
   */
  private goToDestinations(): GoToDestination[] {
    const view = this.displayMainView();
    return [
      { id: "navigation", label: "Sessions", icon: renderListIcon(), selected: view === "navigation" },
      { id: "chat", label: "Chat", icon: renderChatIcon(), selected: view === "chat" },
      ...this.shellToolTabs().map((tab) => ({ id: tab.id, label: tab.label, icon: tab.icon, badge: tab.badge, badgeLabel: tab.badgeLabel, selected: tab.selected })),
      { id: GO_TO_ACTIONS, label: "Actions…", icon: renderCommandIcon(), command: true },
    ];
  }

  private goTo(id: string): void {
    if (id === GO_TO_ACTIONS) {
      this.openActionPalette();
      return;
    }
    if (id === "navigation" || id === "chat") {
      this.selectMainView(id);
      return;
    }
    this.openShellToolTab(id);
  }

  /** Ask on the app's own dialog (B40); see askConfirmation. */
  private confirm(request: ConfirmRequest): Promise<boolean> {
    return askConfirmation({ showDialog: (dialog) => this.openPluginDialog(dialog) }, request);
  }

  /**
   * The host half of the plugin dialog seam: the plugin owns the content and
   * its close callbacks; the shell owns the surface, the modal-layer frame,
   * and the back gesture, exactly as for its own dialogs.
   */
  private openPluginDialog(dialog: PluginDialog): PluginDialogHandle {
    const id = ++this.pluginDialogSeq;
    const entry: PluginDialogEntry = {
      id,
      dialog,
      close: () => {
        if (!this.pluginDialogs.some((candidate) => candidate.id === id)) return;
        this.pluginDialogs = this.pluginDialogs.filter((candidate) => candidate.id !== id);
        dialog.onClose?.();
      },
    };
    this.pluginDialogs = [...this.pluginDialogs, entry];
    this.pushModalLayerFrame();
    return { close: entry.close };
  }

  private openNavigate(): void {
    this.navigation.begin();
    void this.loadQuickSwitcherData();
    void this.updateComplete.then(() => { this.navigatePage?.showEverything(); });
    dismissKeyboardIfRaised();
    this.navigateOpen = true;
    this.pushModalLayerFrame();
  }

  /**
   * Entering the navigation view is the same event as opening the page: the
   * list must be asked for, whether the reader arrived by pressing the key or
   * by the shell restoring the view on boot.
   */
  private noteNavigationViewShown(): void {
    if (this.displayMainView() !== "navigation") return;
    if (this.navigationViewLoaded) return;
    this.navigationViewLoaded = true;
    void this.loadQuickSwitcherData();
  }

  private navigationViewLoaded = false;

  private closeNavigate(): void {
    this.startSessionOnProjectChoice = false;
    this.navigateOpen = false;
  }

  /** The facts the navigation surface reads; see `navigateModel`. */
  /**
   * What the navigate page lists. Narrowed to a project it is the project's
   * own sessions; widened to the machine it must actually be the machine's,
   * or the page claims a reach it does not keep - widening used to leave an
   * empty list under "All sessions on this machine".
   */
  private navigateInput(): Omit<NavigateInput, "query"> {
    const state = this.state;
    // The page lists the machine being browsed, so the path must name that
    // machine and its rows must carry it; using the selected machine printed
    // one machine's name over another machine's sessions.
    const machineId = this.browsedMachineId();
    // Rows carry the machine they were fetched for. Listing the selected
    // machine's sessions under another machine's name is how a tap produced
    // "Session not found": the row belonged to one machine and the open ran
    // against another. Browsing elsewhere, only rows fetched for that
    // machine are listed.
    const browsingElsewhere = machineId !== selectedMachineId(state);
    const sessions = browsingElsewhere ? this.quickSwitcherSessions : state.sessions;
    const pinnedIds = this.pinnedSessionIdsFor(machineId);
    return {
      scope: { machineId, projectId: state.selectedProject?.id, folderPath: state.selectedWorkspace?.path, sessionId: state.selectedSession?.id },
      machines: state.machines.map((machine) => ({ id: machine.id, name: machine.name })),
      projects: state.projects.map((project) => ({ id: project.id, name: project.name, path: project.path })),
      folders: state.workspaces.map((workspace) => ({ id: workspace.id, label: workspace.label, path: workspace.path, projectId: workspace.projectId })),
      sessions,
      // Pins answer for the machine, not for the project the reader happens to
      // stand in: a session pinned from the global list vanished from Pinned
      // as soon as the page listed a project's sessions.
      pinned: dedupeById(browsingElsewhere ? [...this.quickSwitcherSessions, ...this.quickSwitcherPinnedElsewhere] : [...this.quickSwitcherSessions, ...sessions, ...this.quickSwitcherPinnedElsewhere])
        .filter((session) => pinnedIds.has(session.id))
        .map((session) => ({ session, machineId })),
      sessionStates: browsingElsewhere ? EMPTY_STATE_MAP : this.sessionStateKinds(),
      pinnedSessionIds: pinnedIds,
      unreadSessionIds: browsingElsewhere ? EMPTY_ID_SET : this.unreadSessionIds,
      interruptedSessionIds: browsingElsewhere ? EMPTY_ID_SET : this.interruptedRunsByMachine.get(selectedMachineId(state)) ?? EMPTY_ID_SET,
      sections: sessionSections(this.plugins.getSessionSections(machineId)),
    };
  }

  /**
   * Leaving navigation means two different things on the two layouts: the
   * overlay closes, while the phone's navigation view has to hand the main
   * area back to the session that is open behind it. One exit for both, or
   * the key that returns does nothing on the layout that needs it most.
   */
  private leaveNavigate(): void {
    this.navigation.begin();
    this.closeNavigate();
    if (this.state.mainView === "navigation" && this.hasChatSubject()) {
      this.setState({ mainView: "chat" });
    }
  }

  private renderNavigatePage(overlay: boolean) {
    return html`<app-navigate-page
      .input=${this.navigateInput()}
      .pinnedProjectIds=${this.pinnedProjectIds}
      ?returnable=${overlay || (this.appShell.isMobileNavigationLayout && this.hasChatSubject())}
      .onClose=${() => { this.leaveNavigate(); }}
      .onOpenGoTo=${this.appShell.isMobileNavigationLayout ? () => { this.toggleGoToSheet(); } : undefined}
      .onChoose=${(level: NavigateLevel, id: string) => { void this.navigateChoose(level, id); }}
      .onWiden=${(level: NavigateLevel) => { void this.navigateWiden(level); }}
      .onOpenSession=${(session: SessionInfo, machineId: string) => { void this.openSessionFromQuickSwitcher(session, machineId); }}
      .opening=${this.navigation.view()}
      .onCreateSession=${() => { this.closeNavigate(); void this.startSessionAndOpenChat(); }}
      .onAddProject=${this.hasAddProjectEntry() ? () => { this.navigation.begin(); this.closeNavigate(); this.openProjectDialog(); } : undefined}
      .machineSessions=${this.quickSwitcherSessions}
      .onOpenSettings=${() => { this.navigation.begin(); this.closeNavigate(); this.openSettings(); }}
      .onReload=${() => { this.hardReloadApp(); }}
      .boardAnswer=${this.quickSwitcherBoardAnswer}
      .loadingChoices=${this.state.projectsLoad !== "loaded" || this.state.isLoadingWorkspaces}
      .canRenameSession=${true}
      .canArchiveSessions=${!this.quickSwitcherBrowsingElsewhere()}
      .canCloseProject=${true}
      .onRowAction=${(kind: NavigateRowKind, id: string, action: NavigateRowActionId) => { void this.runNavigateRowAction(kind, id, action); }}
    ></app-navigate-page>`;
  }

  /**
   * The session a listed row names, from the same sources the list was built
   * from. Looking only in `state.sessions` made every menu action on the
   * desktop rail a no-op: its rows come from the machine listing, so the
   * lookup found nothing and the action returned silently.
   */
  private listedSession(id: string): SessionInfo | undefined {
    return this.state.sessions.find((entry) => entry.id === id)
      ?? this.quickSwitcherSessions.find((entry) => entry.id === id)
      ?? this.quickSwitcherPinnedElsewhere.find((entry) => entry.id === id);
  }

  /**
   * The row menu names an action; the shell performs it against the row's own
   * scope. A row acts on the thing it names, never on the current selection.
   */
  private async runNavigateRowAction(kind: NavigateRowKind, id: string, action: NavigateRowActionId): Promise<void> {
    if (action === "open") {
      if (kind === "session") {
        const session = this.listedSession(id);
        if (session === undefined) return;
        await this.openSessionFromQuickSwitcher(session);
        return;
      }
      await this.navigateChoose(kind === "machine" ? "machine" : "project", id);
      return;
    }
    if (action === "pin" || action === "unpin") {
      if (kind === "project") { this.togglePinnedProject(id); return; }
      const session = this.listedSession(id);
      if (session !== undefined) this.togglePinnedSession(session);
      return;
    }
    if (action === "rename") {
      const session = this.listedSession(id);
      if (session !== undefined) this.renameFromBar = { session, machineId: this.browsedMachineId() };
      return;
    }
    if (action === "archive" || action === "restore" || action === "delete-archived") {
      const session = this.listedSession(id);
      if (session !== undefined) await this.changeArchiveState(action, session);
      return;
    }
    const project = this.state.projects.find((entry) => entry.id === id);
    if (project === undefined) return;
    if (action === "copy-path") {
      await writeClipboardText(project.path);
      return;
    }
    if (!(await this.confirm({ title: `Close ${project.name}?`, message: "This only removes it from PI WEB; the project folder does not change.", confirmLabel: "Close project", tone: "danger" }))) return;
    await this.projects.closeProject(project.id);
  }

  /**
   * Archive, restore or delete for good, then re-read the machine-wide list the page draws.
   * The controller updates the selected project's list; without the re-read an archived row
   * stayed under Recent until something else refreshed the page. Deleting asks first: it
   * removes the transcript file (owner, 2026-09-30: archive first, then delete).
   */
  private async changeArchiveState(action: "archive" | "restore" | "delete-archived", session: SessionInfo): Promise<void> {
    if (action === "delete-archived" && !(await this.confirm({ title: `Delete “${sessionLabel(session)}” permanently?`, message: "The archived session and its transcript file are removed. This cannot be undone.", confirmLabel: "Delete permanently", tone: "danger" }))) return;
    if (action === "archive") await this.sessions.archiveSessions([session]);
    else if (action === "restore") await this.sessions.restoreSession(session);
    else await this.sessions.deleteArchivedSessions([session]);
    await this.loadQuickSwitcherData(true);
  }

  private async navigateChoose(level: NavigateLevel, id: string): Promise<void> {
    if (level === "machine") { this.browseQuickSwitcherMachine(id); return; }
    const startSession = this.startSessionOnProjectChoice;
    this.startSessionOnProjectChoice = false;
    this.navigation.begin();
    const project = this.state.projects.find((entry) => entry.id === id);
    if (project === undefined) return;
    if (!startSession) {
      await this.workspaces.selectProject(project);
      return;
    }
    this.closeNavigate();
    await this.startSessionInProject(project);
  }

  /** Widening drops the level and everything under it; the page stays put. */
  private async navigateWiden(level: NavigateLevel): Promise<void> {
    if (level === "machine") return;
    this.navigation.begin();
    this.workspaces.clearSelection();
    await this.loadQuickSwitcherData();
  }

  private openQuickSwitcher(): void {
    // The composer usually still holds focus, which leaves the on-screen
    // keyboard covering the list this exists to show.
    dismissKeyboardIfRaised();
    this.openLazySurface("quick-switcher", "Session search");
    this.quickSwitcherOpen = true;
    this.quickSwitcherBrowseMachineId = selectedMachineId(this.state);
    this.pushModalLayerFrame();
    // Show what is cached, then refresh behind it. The cache was previously
    // kept for the life of the page, so anything that changed after the first
    // open -- a rename, a new session, one archived on another device -- stayed
    // invisible until a reload.
    void this.loadQuickSwitcherData();
    // The interrupted record is read-once on the daemon and the boot read has
    // already spent it; a later empty read is not a retraction, so the
    // re-read here only picks up markers recorded after the page loaded.
    const machineId = selectedMachineId(this.state);
    if (machineId === "") return;
    // Opening the switcher is also the one moment the user is about to judge
    // every row by its indicator, so reconcile the map against the daemon's
    // catalog now (cheap: a few ms, a few KB): the daemon owns whether a
    // session is still waiting, and the live events that answer it may have
    // been dropped while the socket was down.
    void this.sessions.hydrateSessionStatuses(machineId, { replaceKnown: true });
    this.refreshInterruptedRuns(machineId, { adoptEmpty: false });
  }

  /**
   * Rename a listed session on the machine it lives on, and keep that
   * machine's board in step at once - its listed rows and the pinned rows no
   * open project lists (B49) - through the same change the machine's own
   * announcement makes. When the machine refuses, the board takes the old name
   * back, as the selection does: a read on its way would otherwise keep the
   * refused name over its answer.
   *
   * The board is a separate list from the navigation panel's, so without this
   * the switcher and Pinned go on offering the name the user just renamed away
   * from.
   */
  private async renameListedSession(session: SessionInfo, machineId: string, name: string): Promise<void> {
    this.sessionBoards.applyEvent(machineId, { type: "session.name", sessionId: session.id, name: name.trim() });
    if (await this.sessions.renameSession(session, name, machineId)) return;
    this.sessionBoards.applyEvent(machineId, { type: "session.name", sessionId: session.id, name: session.name });
  }

  /**
   * Find the project a restored route names, when the loaded list does not have
   * it yet.
   *
   * On a reload the route is restored before the project list has arrived, so
   * looking only at what is loaded concludes the project does not exist and
   * drops the reader on "Select or start a session" - having just refreshed a
   * session they were reading. An unloaded list is not evidence of absence.
   *
   * Returns undefined only when the read succeeded and the project genuinely is
   * not there. A failed read answers undefined too, and the caller treats that
   * as "cannot tell" by leaving the selection alone rather than clearing it.
   */
  private async locateRouteProject(projectId: string): Promise<Project | undefined> {
    try {
      const projects = await projectsApi.projects(selectedMachineId(this.state));
      const found = projects.find((candidate) => candidate.id === projectId);
      if (found !== undefined) this.setState({ projects });
      return found;
    } catch {
      return undefined;
    }
  }

  /**
   * Which machine the session-wide list is reading. Empty means "the machine
   * the app is on"; resolving it in one place matters because the staleness
   * guards below compare against it - comparing the raw field discarded every
   * answer whenever the reader had not switched tabs.
   */
  private browsedMachineId(): string {
    return this.quickSwitcherBrowseMachineId === "" ? selectedMachineId(this.state) : this.quickSwitcherBrowseMachineId;
  }

  /**
   * Show the browsed machine's board, and read it unless a complete one was
   * read moments ago; `force` reads it now, after a change this client made.
   * A board without every answer keeps being read by itself while it is the
   * one browsed (B48).
   */
  private async loadQuickSwitcherData(force = false): Promise<void> {
    this.mirrorSessionBoard();
    await this.sessionBoards.browse(this.browsedMachineId(), { force });
    this.mirrorSessionBoard();
  }

  /**
   * The quick switcher's rows: the board's sessions, and the pinned ones no
   * open project lists, while the browsed machine still pins them (B49). On the
   * machine the app is on they land in Pinned; on another machine's tab, whose
   * rows carry no badges, they land by recency. An unpinned one leaves at once
   * rather than at the next read.
   */
  private quickSwitcherSessionsWithPins(): readonly SessionInfo[] {
    if (this.quickSwitcherPinnedElsewhere.length === 0) return this.quickSwitcherSessions;
    const pinnedIds = this.pinnedSessionIdsFor(this.browsedMachineId());
    return dedupeById([...this.quickSwitcherSessions, ...this.quickSwitcherPinnedElsewhere.filter((session) => pinnedIds.has(session.id))]);
  }

  /** The browsed machine's board as it stands: its rows only, and how much of it answered. */
  private mirrorSessionBoard(): void {
    const machineId = this.browsedMachineId();
    const board = this.sessionBoards.board(machineId);
    this.quickSwitcherMachineId = board === undefined ? undefined : machineId;
    this.quickSwitcherSessions = board?.sessions ?? [];
    this.quickSwitcherPinnedElsewhere = board?.pinnedElsewhere ?? [];
    this.quickSwitcherWorkspaces = board?.workspaces ?? [];
    this.quickSwitcherBoardAnswer = this.sessionBoards.answer(machineId);
  }

  /**
   * Status badges, pins and selection all describe sessions on the machine
   * the app is on. Rendering them beside another machine's rows would attach
   * this machine's facts to that machine's sessions, so while the tabs browse
   * elsewhere the rows carry no badges at all - absent, not falsely present.
   */
  private quickSwitcherBrowsingElsewhere(): boolean {
    const selected = selectedMachineId(this.state);
    const requested = this.quickSwitcherBrowseMachineId !== "" && this.quickSwitcherBrowseMachineId !== selected;
    const shown = this.quickSwitcherMachineId !== undefined && this.quickSwitcherMachineId !== selected;
    return requested || shown;
  }

  private browseQuickSwitcherMachine(machineId: string): void {
    if (this.quickSwitcherBrowseMachineId === machineId) return;
    this.navigation.begin();
    this.quickSwitcherBrowseMachineId = machineId;
    this.mirrorSessionBoard();
    void this.loadQuickSwitcherData();
  }

  /**
   * Opening from the sheet lands directly in the conversation. The navigation
   * view is only meaningful on the mobile stacked layout, and returning there
   * after an explicit pick would undo the tap the user just made.
   */
  private async openWorkspaceFromQuickSwitcher(workspace: Workspace): Promise<void> {
    const key = machineWorkspaceKey(this.rowsMachineId(), workspace.projectId, workspace.id);
    if (this.navigation.isOpening(key)) return;
    const seq = this.navigation.begin({ key, label: workspace.label });
    try {
      await this.landOnWorkspace(workspace, seq);
    } catch (error) {
      this.navigation.fail(seq);
      throw error;
    }
  }

  /** The open behind a workspace tap. It settles or fails the tap's intent on every path, so the row never keeps an "Opening" that would swallow the next tap. */
  private async landOnWorkspace(workspace: Workspace, seq: number): Promise<void> {
    const moved = await this.moveToBrowsedMachine({ updateUrl: false });
    if (!moved) {
      this.navigation.fail(seq);
      this.nameMachineAfterSupersededMove();
      return;
    }
    // selectWorkspace's landing guard requires the workspace's own project to
    // be selected; without it the returned session list is discarded and the
    // panel waits on "Loading sessions..." forever.
    const project = this.state.projects.find((candidate) => candidate.id === workspace.projectId)
      ?? await this.locateRouteProject(workspace.projectId);
    if (!this.navigation.isCurrent(seq)) {
      this.nameMachineAfterSupersededMove();
      return;
    }
    if (project === undefined) {
      this.setState(noticePatch(noticeForReader("The project this workspace belongs to is not in the project list.")));
      this.navigation.fail(seq);
      return;
    }
    if (this.state.selectedProject?.id !== project.id) await this.workspaces.selectProject(project, { workspaceId: workspace.id });
    else await this.workspaces.selectWorkspace(workspace);
    if (!this.navigation.isCurrent(seq)) {
      this.nameMachineAfterSupersededMove();
      return;
    }
    this.updateUrl();
    this.navigation.settle(seq);
  }

  /**
   * A tap overtaken after it moved the machine leaves the URL to the intent that took over; it
   * names the machine only when that intent wrote nothing and restores nothing, so a reload stays
   * on the machine the page shows (D8; review 1c0cb377). An open that fails asks again, because the
   * move it overtook left the URL to it (review ca45d6ed).
   */
  private nameMachineAfterSupersededMove(): void {
    const pending = this.navigation.view();
    if (supersededMoveOwesUrl({ restoring: this.routeRestoreDepth > 0, opening: pending !== undefined && pending.phase !== "failed", urlMachineId: readRoute().machineId, pageMachineId: selectedMachineId(this.state) })) this.updateUrl();
  }

  /**
   * Move to the machine the DISPLAYED rows came from before acting on one.
   * Keying this on the requested tab instead of the rows' own machine let a
   * click during a refresh select a session on a machine that had never
   * heard of it - the wrong-machine read the qwen presence lane found.
   */
  private async moveToBrowsedMachine(options: { readonly updateUrl?: boolean } = {}): Promise<boolean> {
    return this.moveToMachine(this.quickSwitcherMachineId ?? this.quickSwitcherBrowseMachineId, options);
  }

  /** The machine the listed rows belong to: the one the list was read from. */
  private rowsMachineId(): string {
    return this.quickSwitcherMachineId ?? this.browsedMachineId();
  }

  /**
   * A tap that goes on to select something passes `updateUrl: false`: the selection writes the one
   * history entry the tap adds, naming where it landed (D8). A move that is the whole action writes it.
   */
  private async moveToMachine(browsed: string, options: { readonly updateUrl?: boolean } = {}): Promise<boolean> {
    if (browsed === "" || browsed === selectedMachineId(this.state)) return true;
    const target = this.state.machines.find((candidate) => candidate.id === browsed);
    if (target === undefined) {
      this.setState(noticePatch(noticeForReader(`The machine this item lives on (${browsed}) is not in the machine list.`)));
      return false;
    }
    await this.machines.selectMachine(target, options);
    return true;
  }

  /**
   * Open a session the reader tapped (D8, B29). The page stays where it is and the tapped row
   * answers until the session has something to show; then the list, the header and the
   * conversation change together. Only the latest intent commits, so a slow read the reader has
   * since walked away from moves nothing.
   *
   * A session browsed on another machine's tab lives on that machine: the app moves there
   * first, then selects, in that order.
   */
  private async openSessionFromQuickSwitcher(session: SessionInfo, machineId = this.rowsMachineId()): Promise<void> {
    const key = machineSessionKey(machineId, session.id);
    if (this.navigation.isOpening(key)) return;
    const seq = this.navigation.begin({ key, label: sessionLabel(session) });
    if (!this.sessions.canOpenAtOnce(session, machineId)) {
      try {
        await this.sessions.readFirstPage(session, machineId);
      } catch (error) {
        if (!isSessionNotFoundError(error)) {
          this.navigation.fail(seq);
          this.nameMachineAfterSupersededMove();
          return;
        }
      }
      if (!this.navigation.isCurrent(seq)) return;
    }
    const machineBefore = selectedMachineId(this.state);
    const moved = await this.moveToMachine(machineId, { updateUrl: false });
    if (!moved) {
      this.navigation.fail(seq);
      this.nameMachineAfterSupersededMove();
      return;
    }
    if (!this.navigation.isCurrent(seq)) {
      if (selectedMachineId(this.state) !== machineBefore) this.nameMachineAfterSupersededMove();
      return;
    }
    this.closeNavigate();
    this.quickSwitcherOpen = false;
    this.showView("chat", { updateUrl: false });
    const selecting = this.sessions.selectSession(session, { updateUrl: false });
    this.updateUrl({ forcePush: true });
    this.navigation.settle(seq);
    await selecting;
    if (this.navigation.isCurrent(seq) && this.state.selectedSession?.id === session.id) await this.focusComposerAfterRender();
  }

  /**
   * A new session is a reader intent (D8): it supersedes an open still loading. `startSession()`
   * stays in flight until the daemon resolves the session; the chat opens as soon as the
   * controller has inserted the temporary row.
   */
  private async startSessionAndOpenChat(shouldComplete: () => boolean = () => true): Promise<void> {
    const seq = this.navigation.begin();
    const current = () => this.navigation.isCurrent(seq) && shouldComplete();
    const start = this.sessions.startSession().catch((error: unknown) => {
      if (current()) this.setState(errorNoticePatch(error));
    });
    if (current()) {
      if (this.state.mainView !== "chat") this.showView("chat");
      await this.focusComposerAfterRender();
    }
    void start;
  }

  private async focusChatComposer(): Promise<void> {
    if (this.state.mainView !== "chat") this.selectMainView("chat");
    await this.focusComposerAfterRender();
  }

  private async focusComposerAfterRender(): Promise<void> {
    await this.updateComplete;
    await nextFrame();
    // The focus request may outlive the dialog transition that scheduled it.
    // Recheck the rendered boundary at the final side-effect point so a newer
    // or surviving modal keeps visual and keyboard focus ownership.
    if (this.isRenderedModalOpen()) return;
    if (this.shouldAutoFocusPrompt()) this.promptEditor?.focusInput();
  }

  private async navigateSessionTree(targetId: string, summaryChoice: SessionTreeSummaryChoice): Promise<SessionTreeNavigateResult> {
    const intent = this.navigation.latest();
    const originMachineId = selectedMachineId(this.state);
    const originSessionId = this.state.selectedSession?.id;
    const result = await this.sessions.navigateTree(targetId, summaryChoice);
    if (!result.cancelled
      && this.navigation.isCurrent(intent)
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
    // The tree navigator is a modal layer: it pushes its own frame so the back
    // gesture closes it instead of restoring a route beneath an open dialog.
    this.pushModalLayerFrame();
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

  private shownWorkspacePanel(): QualifiedWorkspacePanelContribution | undefined {
    return shownWorkspacePanel(this.visibleWorkspacePanels(), this.state.workspaceTool);
  }

  /** The request alone never decides it: see `workspacePanelCanvas.ts`. */
  private workspacePanelHoldsCanvas(): boolean {
    return workspacePanelHoldsCanvas({
      requested: this.workspacePanelFullscreen,
      windowShowsCanvas: this.appShell.isDesktopSideBySideLayout,
      panelOnScreen: this.workspacePanelOnScreen(),
      tool: this.state.workspaceTool,
      shown: this.shownWorkspacePanel(),
    });
  }

  private visibleWorkspacePanels(): QualifiedWorkspacePanelContribution[] {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return [];
    const context = this.createWorkspacePanelContext(workspace);
    return this.plugins.getWorkspacePanels().filter((panel) => panel.visible?.(context) ?? true);
  }

  private workspacePanelEmptyState(): WorkspacePanelEmptyState {
    const project = this.state.selectedProject;
    if (this.state.projectsLoad !== "loaded") return UNKNOWN_YET;
    if (project === undefined) {
      return this.state.projects.length === 0
        ? {
            kind: "message",
            title: "No projects yet",
            body: "Use Actions → Add Project to add a folder. Workspace tools will appear here after you choose a workspace.",
          }
        : {
            kind: "message",
            title: "Select a project",
            body: "Choose a project from the sidebar, then select a workspace to use its tools.",
          };
    }
    if (this.state.isLoadingWorkspaces) return UNKNOWN_YET;
    if (this.state.workspaces.length === 0) {
      return {
        kind: "message",
        title: "No workspaces found",
        body: `${project.name} does not have any available workspaces. Try selecting the project again or re-adding it.`,
      };
    }
    return {
      kind: "message",
      title: "Select a workspace",
      body: `Choose a workspace in ${project.name} to use its tools.`,
    };
  }

  private sessionEmptyMessage(): string {
    if (this.state.projectsLoad !== "loaded") return "";
    if (this.state.selectedWorkspace !== undefined) return "Select or start a session.";
    if (this.state.selectedProject !== undefined) return "Select a workspace to start a session.";
    if (this.state.projects.length === 0) return "Add a project to start a session.";
    return "Open a session on the left, or start a new one.";
  }

  /** The one action that unblocks an empty chat surface, next to its text. */
  private renderEmptyStateAction(): TemplateResult {
    if (this.state.projectsLoad !== "loaded") return html``;
    if (this.state.selectedWorkspace !== undefined && this.canStartSession()) {
      return html`<button @click=${() => { void this.startSessionAndOpenChat(); }}>Start a session</button>`;
    }
    if (this.state.projects.length === 0) {
      return this.hasAddProjectEntry() ? html`<button @click=${() => { this.openProjectDialog({ startSessionAfter: true }); }}>Add a project</button>` : html``;
    }
    if (this.state.selectedWorkspace !== undefined) return html``;
    const recent = this.recentProject();
    if (recent === undefined) return html`<button @click=${() => { this.chooseProjectForNewSession(); }}>New session…</button>`;
    return html`
      <button @click=${() => { void this.startSessionInProject(recent); }}>New session in ${recent.name}</button>
      <button class="empty-link" @click=${() => { this.chooseProjectForNewSession(); }}>Choose another project</button>
    `;
  }

  /**
   * The project of the newest session on this machine, for the first-boot centre's "New session in
   * <project>" (navigation-lists.md section 6). A session's project is the one whose folder holds it.
   */
  private recentProject(): Project | undefined {
    const newest = [...this.quickSwitcherSessions].sort((left, right) => modifiedMs(right.modified) - modifiedMs(left.modified));
    for (const session of newest) {
      const project = this.state.projects.find((candidate) => session.cwd === candidate.path || session.cwd.startsWith(`${candidate.path}/`));
      if (project !== undefined) return project;
    }
    return undefined;
  }

  private async startSessionInProject(project: Project): Promise<void> {
    if (this.state.selectedProject?.id !== project.id) await this.workspaces.selectProject(project);
    if (this.state.selectedProject?.id !== project.id || this.state.selectedWorkspace === undefined) return;
    await this.startSessionAndOpenChat();
  }

  /** The Projects list, where choosing a project starts the new session in it. */
  private chooseProjectForNewSession(): void {
    this.startSessionOnProjectChoice = true;
    this.openNavigateOn("project");
  }

  /** Text-safe badge for the panel row; rich badges stay in list rows. */
  private mobilePanelBadge(panel: QualifiedWorkspacePanelContribution): string | number | undefined {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return undefined;
    const badge: unknown = panel.badge?.(this.createWorkspacePanelContext(workspace));
    if (typeof badge === "number") return badge;
    return typeof badge === "string" ? badge : undefined;
  }

  private workspaceLabelItems(workspace: Workspace): WorkspaceLabelItem[] {
    return this.plugins.getWorkspaceLabelItems(this.createWorkspaceLabelContext(workspace));
  }

  /**
   * One snapshot and action set feeding the workspaces plugin's contributed
   * pickers on both switcher surfaces. The surfaces vary the display and the
   * close-on-pick behavior; the data and the actions are the host's.
   */
  private buildNavSectionContext(surface: "panel" | "sheet"): NavSectionContext {
    const state = this.state;
    const machineId = selectedMachineId(state);
    const snapshot = state.machineStatusSnapshots[machineId];
    const projectById = (projectId: string): Project | undefined => state.projects.find((project) => project.id === projectId);
    const workspaceById = (workspaceId: string): Workspace | undefined => state.workspaces.find((workspace) => workspace.id === workspaceId);
    const closeSheet = surface === "sheet";
    return {
      projects: state.projects.map((project) => ({ id: project.id, name: project.name, path: project.path })),
      projectsLoad: state.projectsLoad,
      workspaces: state.workspaces,
      workspacesLoad: state.isLoadingWorkspaces ? "loading" : "loaded",
      selectedProjectId: state.selectedProject?.id,
      selectedWorkspaceId: state.selectedWorkspace?.id,
      machineId,
      deletingWorkspaceIds: pendingWorkspaceDeletionIds(state.workspaceDeletionRuns),
      statusSnapshot: snapshot === undefined ? undefined : { projects: snapshot.projects, workspaces: snapshot.workspaces },
      labelItems: (workspaceId) => {
        const workspace = workspaceById(workspaceId);
        return workspace === undefined ? [] : this.workspaceLabelItems(workspace);
      },
      display: { hidden: false, collapsible: false, collapsed: false, tiles: false, withCreate: false },
      requestUpdate: () => { this.requestUpdate(); },
      selectProject: (projectId) => {
        const project = projectById(projectId);
        if (project === undefined) return;
        if (closeSheet) this.contextSheetOpen = false;
        void this.withChatScrollTransition(async () => { await this.workspaces.selectProject(project); }, () => true);
      },
      closeProject: (projectId) => { void this.projects.closeProject(projectId); },
      addProject: () => {
        if (closeSheet) this.contextSheetOpen = false;
        this.openProjectDialog();
      },
      selectWorkspace: (workspaceId) => {
        const workspace = workspaceById(workspaceId);
        if (workspace === undefined) return;
        if (closeSheet) this.contextSheetOpen = false;
        void this.withChatScrollTransition(() => this.workspaces.selectWorkspace(workspace), () => true);
      },
      deleteWorkspace: (workspaceId) => {
        const workspace = workspaceById(workspaceId);
        if (workspace === undefined) return;
        void this.deleteWorkspace(workspace);
      },
      workspaceTrust: {
        get: async (workspaceId) => {
          const workspace = workspaceById(workspaceId);
          if (workspace === undefined) throw new Error("This workspace is no longer listed");
          const result = await trustApi.workspaceTrust(workspace.projectId, workspace.id, machineId);
          return { trusted: result.trusted };
        },
        set: async (workspaceId, trusted) => {
          const workspace = workspaceById(workspaceId);
          if (workspace === undefined) throw new Error("This workspace is no longer listed");
          const result = await trustApi.setWorkspaceTrust(workspace.projectId, workspace.id, trusted, machineId);
          return { trusted: result.trusted };
        },
      },
      retryProjectsLoad: () => { void this.projects.loadProjects(); },
      retryWorkspacesLoad: () => { void this.workspaces.refreshSelectedProjectTopology(); },
      toggleCollapsed: () => undefined,
      focusPreviousSection: () => undefined,
      focusNextSection: () => undefined,
      cancelKeyboardNavigation: () => undefined,
    };
  }

  /**
  * The host snapshot a contributed machines section renders. Without the
  * machines plugin no section consumes it; the machine affordances hide and
  * the context bar still names the selected machine.
  */
  private buildMachineSectionContext(surface: "panel" | "sheet"): MachineSectionContext {
    const state = this.state;
    const closeSheet = surface === "sheet";
    const machineById = (machineId: string): Machine | undefined => state.machines.find((machine) => machine.id === machineId);
    const staleMachineNotice = (): void => {
      this.setState(errorNoticePatch(new Error("This machine is no longer listed.")));
    };
    return {
      machines: state.machines.map((machine) => ({
        id: machine.id,
        name: machine.name,
        kind: machine.kind,
        ...(machine.baseUrl === undefined ? {} : { baseUrl: machine.baseUrl }),
        status: state.machineStatuses[machine.id]?.status ?? machine.status ?? "unknown",
      })),
      selectedMachineId: state.selectedMachine?.id,
      machineFlags: Object.fromEntries(state.machines.map((machine) => [machine.id, state.machineStatusSnapshots[machine.id]?.machine ?? {}])),
      display: { hidden: false, collapsible: false, collapsed: false, tiles: false, withCreate: false },
      requestUpdate: () => { this.requestUpdate(); },
      selectMachine: (machineId) => {
        const machine = machineById(machineId);
        if (machine === undefined) return;
        if (closeSheet) this.contextSheetOpen = false;
        this.navigation.begin();
        void this.selectMachineWithMemory(machine);
      },
      addMachine: () => {
        if (closeSheet) this.contextSheetOpen = false;
        this.openMachineDialog();
      },
      removeMachine: (machineId) => {
        const machine = machineById(machineId);
        if (machine === undefined) {
          staleMachineNotice();
          return;
        }
        void this.removeMachine(machine);
      },
      renameMachine: (machineId, name) => {
        const machine = machineById(machineId);
        if (machine === undefined) {
          staleMachineNotice();
          return;
        }
        void this.renameMachine(machine, name);
      },
      refreshMachine: (machineId) => {
        const machine = machineById(machineId);
        if (machine === undefined) {
          staleMachineNotice();
          return;
        }
        this.navigation.begin();
        void this.machines.selectMachine(machine).then(() => Promise.all([this.machines.refreshMachineHealth(), this.machines.refreshMachineRuntime()]));
      },
      openMachine: (machineId) => {
        const machine = machineById(machineId);
        const baseUrl = machine?.kind === "remote" ? machine.baseUrl : undefined;
        if (baseUrl === undefined) {
          staleMachineNotice();
          return;
        }
        window.open(baseUrl, "_blank", "noopener,noreferrer");
      },
      toggleCollapsed: () => undefined,
      focusPreviousSection: () => undefined,
      focusNextSection: () => undefined,
      cancelKeyboardNavigation: () => undefined,
    };
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
    return createPluginWorkspaceFiles(
      workspacesApi,
      workspace,
      machineId,
      () => { void this.invalidateWorkspacePanels(FILES_PANEL_ROUTE_ID); },
      workspaceEffectiveUploadFolder(workspace.effectiveConfig, this.workspaceUploadFolderFallback),
    );
  }

  private createWorkspaceHost(): WorkspaceHost {
    return {
      requestRender: () => { this.requestUpdate(); },
      workspacePanelFullscreen: () => this.workspacePanelHoldsCanvas(),
      workspacePanelFullscreenAvailable: () => this.appShell.isDesktopSideBySideLayout,
      setWorkspacePanelFullscreen: (fullscreen) => {
        if (this.workspacePanelFullscreen === fullscreen) return;
        if (fullscreen && !workspacePanelMayHoldCanvas(this.state.workspaceTool, this.shownWorkspacePanel())) return;
        this.workspacePanelFullscreen = fullscreen;
        if (this.routeRestoreDepth === 0 && this.state.mainView !== "chat" && this.state.mainView !== "navigation") {
          setNamespacedQueryKey(WORKSPACE_ROUTE_NAMESPACE, "expanded", fullscreen ? "1" : undefined);
          this.rememberCurrentMachineNavigation();
        }
      },
      refreshAppData: () => this.refreshAppData(),
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
          sessions: workspaceTerminalSessions(workspace, machineId),
          activeCount: this.state.activeTerminalCount,
          selectedId: this.state.selectedTerminalId,
          autoStart: this.terminalAutoStartWorkspaceId === workspace.id,
          select: (terminalId, options) => { this.selectTerminal(terminalId, options); },
        },
        host: this.createWorkspaceHost(),
        piWebUnstable: { terminalCommandRuns },
        activeTerminalCount: this.state.activeTerminalCount,
        selectedTerminalId: this.state.selectedTerminalId,
        terminalAutoStart: this.terminalAutoStartWorkspaceId === workspace.id,
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
      title: "Refresh current panel",
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
        title: "Open session",
        description: "Search and open a session, or start a new one, without walking the navigation panel",
        // mod+k already opens the action palette (core plugin); mod+p keeps the
        // familiar "quick open" meaning for jumping straight to a session.
        shortcut: "mod+p",
        group: "Sessions",
        run: () => { this.openQuickSwitcher(); },
      },
      {
        id: "app.sessions.new",
        title: "New session",
        description: "Start a session in the selected workspace",
        shortcut: "mod+shift+n",
        group: "Sessions",
        enabled: this.canStartSession(),
        ...(this.canStartSession() ? {} : { disabledReason: "Select a workspace first" }),
        run: () => { void this.startSessionAndOpenChat(); },
      },
      {
        id: "app.sessions.cleanup",
        title: "Clean up sessions",
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
        title: "Reset navigation panel size",
        description: "Restore the navigation panel to its default width",
        group: "View",
        run: () => { this.resetResizablePanel("navigation"); },
      },
      {
        id: "app.layout.reset-workspace-panel-size",
        title: "Reset workspace panel size",
        description: "Restore the workspace panel to its default width",
        group: "View",
        run: () => { this.resetResizablePanel("workspace"); },
      },
      {
        id: "app.layout.reset-panel-sizes",
        title: "Reset panel sizes",
        description: "Restore all side panels to their default widths",
        group: "View",
        run: () => { this.resetResizablePanels(); },
      },
    ];
  }

  private navigationFocusActions(): AppAction[] {
    return [
      { id: "app.navigation.focus-machines", title: "Go to machines", description: "Open navigation on the machines list", shortcut: "mod+g m", group: "Navigation", run: () => { this.openNavigateOn("machine"); } },
      { id: "app.navigation.focus-projects", title: "Go to projects", description: "Open navigation on the projects list", shortcut: "mod+g p", group: "Navigation", run: () => { this.openNavigateOn("project"); } },
      { id: "app.navigation.focus-sessions", title: "Go to sessions", description: "Open navigation on the sessions list", shortcut: "mod+g s", group: "Navigation", run: () => { this.openNavigateOn("sessions"); } },
    ];
  }

  /**
   * Navigation is one page listing one kind, so a shortcut names a kind. The
   * four shortcuts used to focus sections of an accordion panel that the
   * Navigate page replaced; with the panel gone they focused nothing.
   */
  private openNavigateOn(kind: NavigateKind): void {
    this.openNavigate();
    void this.updateComplete.then(() => {
      this.navigatePage?.showKind(kind);
    });
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
      createProject: async (input) => {
        const startSession = this.startSessionAfterAddingProject;
        this.startSessionAfterAddingProject = false;
        const failure = await this.projects.addProject(input.path, input.create, input.trust);
        if (failure === undefined && startSession && this.state.selectedWorkspace !== undefined) void this.startSessionAndOpenChat();
        return failure;
      },
      projectDirectories: (query, signal) => api.projectDirectories(query, selectedMachineId(this.state), { signal }),
      projectTrust: async (path) => await trustApi.projectTrust(path, selectedMachineId(this.state)),
      createMachine: async (input) => {
        const machine = await this.machines.addMachine(input);
        if (machine === undefined) return this.state.error !== "" ? this.state.error : "Adding the machine did not go through.";
        this.schedulePiWebStatusRefresh();
        return undefined;
      },
      removeMachine: (machineId) => {
        const machine = this.state.machines.find((candidate) => candidate.id === machineId);
        if (machine === undefined) {
          this.setState(errorNoticePatch(new Error("This machine is no longer listed.")));
          return;
        }
        void this.removeMachine(machine);
      },
      refreshMachine: (machineId) => {
        const machine = this.state.machines.find((candidate) => candidate.id === machineId);
        if (machine === undefined) {
          this.setState(errorNoticePatch(new Error("This machine is no longer listed.")));
          return;
        }
        this.navigation.begin();
        void this.machines.selectMachine(machine).then(() => Promise.all([this.machines.refreshMachineHealth(), this.machines.refreshMachineRuntime()]));
      },
      openMachine: (machineId) => {
        const machine = this.state.machines.find((candidate) => candidate.id === machineId);
        const baseUrl = machine?.kind === "remote" ? machine.baseUrl : undefined;
        if (baseUrl === undefined) {
          this.setState(errorNoticePatch(new Error("This machine is no longer listed.")));
          return;
        }
        window.open(baseUrl, "_blank", "noopener,noreferrer");
      },
      configureAuth: () => this.auth.openLogin(),
      logoutAuth: () => this.auth.openLogout(),
      openThemePicker: () => { this.openThemeDialog(); },
      openModelPicker: () => this.openModelDialog(),
      openThinkingLevelPicker: () => this.openThinkingDialog(),
      selectMainView: (view) => { this.selectMainView(view); },
      selectWorkspaceTool: (tool) => { this.openWorkspaceTool(tool); },
      openTerminal: (options) => { this.openTerminal(options); },
      refreshFiles: () => this.invalidateWorkspacePanels(FILES_PANEL_ROUTE_ID),
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
      this.setState(noticePatch(noticeForReader("Workspace removal is not available")));
      return;
    }
    if (isWorkspaceDeletionPending(this.state, workspace)) return;
    const removal = workspace.removal;
    const confirmation = workspaceRemovalConfirmation(workspace);
    if (removal === undefined || confirmation === undefined || !(await this.confirm({ ...confirmationText(confirmation), confirmLabel: "Delete workspace", tone: "danger" }))) return;

    const machineId = selectedMachineId(this.state);
    const intent = this.navigation.latest();
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
      if (commandWorkspace !== undefined && this.navigation.isCurrent(intent)) void this.openRuntimeTerminal(machineId, commandWorkspace, { terminalId: run.terminalId }, intent);
    } catch (error) {
      if (selectedMachineId(this.state) === machineId) this.setState(noticePatch(noticeForReader(`Failed to start workspace removal: ${describeError(error)}`)));
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

  /**
   * Read the selected project's workspace deletion runs, on its machine (state-diagram D5, P6
   * slice a). Reads share one flight per machine and project, and a request made while one is on
   * its way is read once more after it; an answer applies only while its machine and project are
   * still the selected ones, so a slow read for one project never lands on another.
   */
  private async refreshWorkspaceDeletionRuns(): Promise<void> {
    const key = workspaceDeletionRunsKey(this.state);
    const project = this.state.selectedProject;
    if (key === undefined || project === undefined) {
      this.setState({ workspaceDeletionRuns: {} });
      this.updateWorkspaceDeletionPolling();
      return;
    }
    const machineId = selectedMachineId(this.state);
    await this.workspaceDeletionRunReads.request(key, () => this.readWorkspaceDeletionRuns(machineId, project.id, key));
  }

  private async readWorkspaceDeletionRuns(machineId: string, projectId: string, key: string): Promise<void> {
    if (workspaceDeletionRunsKey(this.state) !== key) return;
    try {
      const runs = await this.terminalCommandRunsForOrigin("core", machineId).listCommandRuns(workspaceDeletionRunFilter(projectId));
      if (workspaceDeletionRunsKey(this.state) !== key) return;
      this.cancelWorkspaceDeletionRetry();
      const latestRuns = latestWorkspaceDeletionRuns(runs);
      this.setState({ workspaceDeletionRuns: latestRuns });
      for (const run of Object.values(latestRuns)) {
        if (!isWorkspaceDeletionRunPending(run)) await this.handleCompletedWorkspaceDeletionRun(run, machineId);
      }
    } catch (error) {
      console.warn("Failed to refresh workspace deletion runs", error);
      if (workspaceDeletionRunsKey(this.state) === key) this.retryWorkspaceDeletionRuns(key);
    } finally {
      this.updateWorkspaceDeletionPolling();
    }
  }

  /**
   * A failed read leaves the selected project's deletion runs unknown, not empty: the runs shown
   * were cleared when the project was selected, so the poll that a pending run keeps alive is
   * gone too. The read is tried again on the shared backoff (1, 2, 4, 8 s, capped at the quiet
   * window) for as long as the project stays selected (B48).
   */
  private retryWorkspaceDeletionRuns(key: string): void {
    const attempt = this.workspaceDeletionRetry?.key === key ? this.workspaceDeletionRetry.attempt + 1 : 0;
    this.cancelWorkspaceDeletionRetry();
    const timer = window.setTimeout(() => {
      if (workspaceDeletionRunsKey(this.state) !== key) return;
      this.workspaceDeletionRetry = { key, attempt, timer: 0 };
      void this.refreshWorkspaceDeletionRuns();
    }, retryDelayMs(attempt, QUIET_WINDOW_MS));
    this.workspaceDeletionRetry = { key, attempt, timer };
  }

  private cancelWorkspaceDeletionRetry(): void {
    if (this.workspaceDeletionRetry !== undefined) window.clearTimeout(this.workspaceDeletionRetry.timer);
    this.workspaceDeletionRetry = undefined;
  }

  private updateWorkspaceDeletionPolling(): void {
    const hasPendingDeletion = Object.values(this.state.workspaceDeletionRuns).some(isWorkspaceDeletionRunPending);
    if (hasPendingDeletion && this.workspaceDeletionPollTimer === undefined) {
      // Surface backed up: the workspace deletion progress list. The runs
      // endpoint is request-scoped; nothing events a run's completion.
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
      this.setState(noticePatch(noticeForReader("Workspace removal failed. See terminal output.")));
      this.updateWorkspaceDeletionPolling();
    }
  }

  /** Give the restored composer the caret it was tapped for. */
  private async focusPromptEditorSoon(): Promise<void> {
    await this.updateComplete;
    if (this.shouldAutoFocusPrompt()) this.promptEditor?.focusInput();
  }

  /**
   * The add-machine dialog is the machines plugin's, opened through the
   * dialog seam; the shell's affordances run the plugin's reserved action.
   * Absent plugin means no dialog: the affordances hide with it.
   */
  private openMachineDialog(): void {
    const action = this.plugins.getActions(this.createPluginRuntimeContext()).find((candidate) => candidate.localId === "add-machine");
    if (action === undefined) return;
    void action.run();
  }

  private async renameMachine(machine: Machine, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === machine.name) return;
    await this.machines.updateMachine(machine, { name: trimmed });
  }

  private async removeMachine(machine: Machine | undefined = this.state.selectedMachine): Promise<void> {
    if (machine === undefined || machine.kind === "local") return;
    if (!(await this.confirm({ title: `Remove ${machine.name}?`, message: "This only removes it from this PI WEB gateway; nothing on that machine changes.", confirmLabel: "Remove", tone: "danger" }))) return;
    const wasSelected = this.state.selectedMachine?.id === machine.id;
    if (wasSelected) this.rememberCurrentMachineNavigation();
    const fallback = await this.machines.deleteMachine(machine, { selectFallback: !wasSelected });
    if (!this.state.machines.some((candidate) => candidate.id === machine.id)) this.machineNavigation.forget(machine.id);
    if (wasSelected && fallback !== undefined) await this.selectMachineWithMemory(fallback, { rememberCurrent: false });
  }

  private runAction(action: AppAction): void {
    void Promise.resolve()
      .then(() => action.run())
      .catch((error: unknown) => {
        const message = describeError(error);
        console.warn(`Action failed: ${action.id}`, error);
        this.setState(noticePatch(noticeForReader(`Action failed: ${message}`)));
      });
  }

  private async openModelDialog() {
    const [models, catalog] = await Promise.all([this.sessions.listModels(), this.sessions.listModelCatalog()]);
    const selectedValue = this.currentModelValue();    this.setState({
      modelDialog: {
        title: "Select model",
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
        title: "Select theme",
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
   * Apply a theme chosen from the appearance panel and remember it. An
   * explicit pick wins outright: the owner chose Clay Paper, saw "chosen,
   * but following your system" render dark, and reported the light theme
   * as broken - a choice that something else can override is not a choice.
   * Auto pair-following is its own toggle, re-armed deliberately.
   */
  private selectTheme(themeId: QualifiedContributionId): void {
    // The native pro look is a sentinel, not a plugin theme: it never appears
    // in the registry, so it must be handled before the registry lookup.
    if (isNativeThemeId(themeId)) {
      this.themePreference = { themeId, auto: false };
      this.applyPreferredTheme(true);
      return;
    }
    const theme = this.plugins.getThemes().find((candidate) => candidate.id === themeId);
    if (theme === undefined) return;
    this.themePreference = { themeId: theme.id, auto: false };
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
    if (persist) writeStoredThemePreference(this.themePreference);
    if (theme === undefined) {
      // The native look is a pair too: following the system switches between
      // its dark and light sides, and an explicit pick pins one of them.
      const nativeId = this.themePreference.auto
        ? (this.systemPrefersLight() ? CORE_PRO_LIGHT_THEME_ID : CORE_PRO_THEME_ID)
        : (this.themePreference.themeId === CORE_PRO_LIGHT_THEME_ID ? CORE_PRO_LIGHT_THEME_ID : CORE_PRO_THEME_ID);
      if (this.activeThemeId === nativeId) return;
      this.activeThemeId = nativeId;
      if (nativeId === CORE_PRO_LIGHT_THEME_ID) applyNativeProLightTheme();
      else applyNativeProTheme();
      return;
    }
    if (theme.id === this.activeThemeId) return;
    this.activeThemeId = theme.id;
    applyPiWebTheme(theme);
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
        title: "Select thinking level",
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
  private async sendPrompt(text: string, streamingBehavior?: "steer" | "followUp", attachments?: import("../api").PromptAttachment[], delivery?: import("../../../shared/apiTypes").PromptAttachmentDelivery, replay?: import("../pendingOutbox").SendReplay): Promise<boolean> {
    const hasAttachments = attachments !== undefined && attachments.length > 0;
    // Handled locally by the auth flow; nothing to restore.
    if (!hasAttachments && streamingBehavior === undefined && this.auth.handleSlashCommand(text)) return true;
    return await this.sessions.send(text, streamingBehavior, attachments, delivery, replay);
  }

  // Stable handler identities for child components. Inlined arrow closures
  // would be a fresh reference on every render, forcing Lit to re-commit the
  // bindings each time the app re-renders; bound class fields keep them constant.
  private readonly handleSendPrompt = (text: string, streamingBehavior?: "steer" | "followUp", attachments?: import("../api").PromptAttachment[], delivery?: import("../../../shared/apiTypes").PromptAttachmentDelivery, replay?: import("../pendingOutbox").SendReplay): Promise<boolean | undefined> => {
    // Returned, not fired: the composer decides between accepted, refused and the link dropped (keep the outbox row, offer a retry) from what this settles to. Swallowing the promise made every failure look accepted.
    return this.sendPrompt(text, streamingBehavior, attachments, delivery, replay);
  };

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
    const seen = new Set<string>();
    const unique = messages.filter((message) => {
      const key = message.clientMessageId ?? `text:${message.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const texts = unique.map((message) => message.text).filter((text) => text.trim() !== "");
    if (texts.length === 0) return;
    this.promptEditor?.takeBack({ text: texts.join("\n\n"), attachments: [] });
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
  private readonly handleRecallQueuedMessage = (message: QueuedSessionMessage): void => {
    // The composer is filled only once the server confirms the message left the
    // queue, so a recall that lost the race to the agent does not offer the
    // text for a second send.
    void this.sessions.recallQueuedMessage(message).then((recalled) => {
      if (recalled) this.restoreToComposer([message]);
    });
  };

  private readonly handleSubmitAsk = (askId: string, submission: AskUserSubmission): Promise<void> => this.sessions.submitAsk(askId, submission);

  private readonly handleAnswerDialog = (dialogId: string, value: ExtensionDialogAnswer): Promise<void> => this.sessions.answerDialog(dialogId, value);

  private readonly handleCancelDialog = (dialogId: string): Promise<void> => this.sessions.cancelDialog(dialogId);

  private readonly handleDialogKey = (dialogId: string, key: string): Promise<void> => this.sessions.sendDialogKey(dialogId, key);

  /**
   * Put a sent prompt back in the composer so a failed turn can be retried
   * without retyping it or re-picking its images.
   */
  private readonly handleResendMessage = (prompt: RecoveredPrompt): void => {
    this.promptEditor?.takeBack(prompt);
  };

  /**
   * Discard takes the words back rather than destroying them: the row goes, and its text
   * and images land in the composer the way a recalled queued message does, so a thumb
   * that missed Retry costs a tap, not the prompt.
   */
  private readonly handleDiscardMessage = (clientMessageId: string): void => {
    const line = this.state.messages.find((message) => message.meta?.delivery?.clientMessageId === clientMessageId);
    const recovered = line === undefined ? undefined : recoverPromptFromLine(line);
    this.sessions.discardOutgoing(clientMessageId);
    if (recovered !== undefined) this.promptEditor?.takeBack(recovered);
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
      <chat-view .onRetryMessage=${(clientMessageId: string) => { this.promptEditor?.retryOutbox(clientMessageId); }} .onDiscardMessage=${this.handleDiscardMessage} .activityNotes=${this.plugins.getActivityNotes(this.state.selectedMachine?.id)} .sessionId=${session.id} .messages=${state.messages} .messageStart=${state.messagePageStart} .messageEnd=${state.messagePageEnd} .messageTotal=${state.messagePageTotal} .hasMore=${state.messagePageStart > 0} .hasNewer=${state.messagePageEnd < state.messagePageTotal} .newerCount=${state.messagePageTotal - state.messagePageEnd + state.newerPendingCount} .loadingMore=${state.isLoadingEarlierMessages} .onLoadNewer=${() => { void this.sessions.loadNewerMessages(); }} .transcriptLoading=${state.isLoadingTranscript} .transcriptFailed=${state.transcriptFailed} .isSendingPrompt=${state.sendingPrompts[session.id] === true} .isCompacting=${state.status?.isCompacting === true} .pendingMessageCount=${state.status?.pendingMessageCount ?? 0} .clientQueuedMessages=${state.clientQueuedSessionMessages[session.id] ?? []} .status=${state.status} .activity=${state.activity} .pendingAsk=${state.pendingAsk}
        .onDialogKey=${this.handleDialogKey}
        .pendingAsks=${state.pendingAsks} .pendingDialogs=${state.pendingDialogs} .commandLedger=${commandsForSession(state.commandLedger, machineSessionKey(selectedMachineId(state), session.id))} .closedDialogs=${state.closedDialogs} .onAnswerDialog=${this.handleAnswerDialog} .onCancelDialog=${this.handleCancelDialog} .onResendMessage=${this.handleResendMessage} .askDraftSessionId=${machineSessionKey(selectedMachineId(state), session.id)} .onSubmitAsk=${this.handleSubmitAsk} .onClearServerQueue=${this.handleClearServerQueue} .onRecallQueuedMessage=${this.handleRecallQueuedMessage} .onLoadMore=${() => this.withChatPrependTransition(() => this.sessions.loadEarlierMessages())} .onFocusComposer=${() => { void this.focusChatComposer(); }} .onQuoteSelection=${(quoted: string) => { this.createPromptEditor().insertText(quoted); }} .findMessageRenderer=${(tag: string) => this.plugins.findMessageRenderer(tag, selectedMachineId(state))} .findCodeFenceRenderer=${(language: string) => this.plugins.findCodeFenceRenderer(language, selectedMachineId(state))} .machineId=${selectedMachineId(state)} .sessionCwd=${session.cwd}></chat-view>
    `;
  }

  /**
   * The session's own user prompts, most recent first - the history a fresh
   * browser has none of locally. Memoized on the messages reference because
   * the transcript changes on every streaming delta.
   */
  private sessionPromptsMemo: { source: ChatLine[]; prompts: string[] } | undefined;
  private sessionPromptsFor(state: AppState): string[] {
    if (this.sessionPromptsMemo?.source === state.messages) return this.sessionPromptsMemo.prompts;
    const prompts: string[] = [];
    const seen = new Set<string>();
    for (let index = state.messages.length - 1; index >= 0 && prompts.length < PROMPT_HISTORY_PROP_LIMIT; index -= 1) {
      const line = state.messages[index];
      if (line?.role !== "user" || line.meta?.echo === true) continue;
      const text = line.parts.find((part) => part.type === "text")?.text ?? "";
      const trimmed = text.trim();
      if (trimmed === "" || seen.has(trimmed)) continue;
      seen.add(trimmed);
      prompts.push(trimmed);
    }
    this.sessionPromptsMemo = { source: state.messages, prompts };
    return prompts;
  }

  private renderStatusBar(state: AppState) {
    return html`
      <status-bar
        .status=${state.status}
        .failure=${state.status === undefined ? state.transcriptFailed ?? state.statusReadFailed : undefined}
        .onRetry=${() => { void this.retryAfterError(); }}
      ></status-bar>
    `;
  }

  /**
   * What "Retry" means on the shell banner: read the current scope again.
   * The banner reports a failed read of the selection, so the retry is the
   * read the selection needs - not a generic reload that would lose the
   * reader's place.
   */
  private async retryAfterError(): Promise<void> {
    this.bannerDismissedByReader = true;
    this.heldErrorBanner = null;
    this.setState(clearErrorPatch());
    const session = this.state.selectedSession;
    if (session !== undefined) { await this.sessions.selectSession(session); return; }
    await this.machines.loadMachines(selectedMachineId(this.state));
  }

  /**
   * The row when no notice holds it: reconnecting, once the machine in use has
   * gone without an answer for the grace period, and held for the minimum
   * visible time after it recovers. One claim at a time (owner, 2026-09-30).
   */
  private renderAppRow(error: string, retiredBy: RetiredBy) {
    const notice = this.renderErrorBanner(error, retiredBy);
    const row = this.renderUnansweredRow(notice !== null);
    return notice ?? row;
  }

  private renderUnansweredRow(noticeShown: boolean) {
    const messageStatus = messageStatusUnanswered(this.state.messageStatusUnanswered, { machineId: selectedMachineId(this.state), sessionId: this.state.selectedSession?.id });
    const unanswered = [this.machines.unanswered(), targetUnanswered(this.namedTargetInScope()), messageStatus].reduce(earliestUnanswered, this.projects.unanswered());
    const decision = rowDecision({ notice: noticeShown, unanswered, shown: this.unansweredShown, now: Date.now() });
    if (this.reconnectingRecheck !== undefined) window.clearTimeout(this.reconnectingRecheck);
    this.reconnectingRecheck = decision.recheckInMs === undefined ? undefined : window.setTimeout(() => { this.reconnectingRecheck = undefined; this.requestUpdate(); }, decision.recheckInMs);
    if (decision.claim.kind !== "unanswered") {
      this.unansweredShown = undefined;
      return null;
    }
    this.unansweredShown = { at: this.unansweredShown?.at ?? Date.now(), miss: decision.claim.miss };
    return unansweredRow(decision.claim.miss, (machineId) => this.state.machines.find((machine) => machine.id === machineId)?.name ?? machineId);
  }

  private renderErrorBanner(error: string, retiredBy: RetiredBy) {
    // The hold window is an anti-churn device for one context. A scope
    // switch resets only this hold bookkeeping - the banner itself survives
    // the switch by the owner's call (see resetWorkspaceScopedState), so a
    // complaint the reader has not dismissed stays legible in the new
    // context instead of being silently eaten.
    const contextKey = `${selectedMachineId(this.state)}|${this.state.selectedWorkspace?.id ?? ""}`;
    if (contextKey !== this.bannerContextKey) {
      this.bannerContextKey = contextKey;
      this.bannerShownAt = undefined;
      this.lastScheduledError = "";
      this.lastScheduledMachineId = undefined;
      this.heldErrorBanner = null;
    }
    if (this.bannerDismissedByReader) {
      // The reader acted; the hold window exists for replacement churn, not to
      // outvote a dismissal. But a claim that arrived between the dismissal
      // and this render is a new claim - it shows, and the one-shot stays
      // armed until the screen is actually quiet.
      this.bannerShownAt = undefined;
      this.lastScheduledError = "";
      this.lastScheduledMachineId = undefined;
      this.heldErrorBanner = null;
      if (error === "") {
        this.bannerDismissedByReader = false;
        return null;
      }
    }
    const decision = bannerHoldDecision({ shownAt: this.bannerShownAt, now: Date.now(), next: error });
    // A transport claim earns its banner (owner's ruling): a single blip -
    // one poll answering 502 mid-restart - must not flash across the top of
    // the screen. The first sighting waits out a grace window; a claim still
    // standing when it elapses shows as "retrying", and the recovery path
    // withdraws it. Reader-visible claims keep the immediate path below.
    if (error !== "" && normalizeTransientError(error) !== undefined) {
      const isNew = error !== this.lastScheduledError || this.state.errorMachineId !== this.lastScheduledMachineId;
      if (isNew) {
        this.lastScheduledError = error;
        this.lastScheduledMachineId = this.state.errorMachineId;
        this.transientPendingSince = Date.now();
        this.bannerShownAt = undefined;
        if (this.transientGraceTimer !== undefined) window.clearTimeout(this.transientGraceTimer);
        this.transientGraceTimer = window.setTimeout(() => { this.transientGraceTimer = undefined; this.requestUpdate(); }, TRANSIENT_GRACE_MS);
        this.heldErrorBanner = null;
        return null;
      }
      const pendingFor = this.transientPendingSince === undefined ? TRANSIENT_GRACE_MS : Date.now() - this.transientPendingSince;
      if (pendingFor < TRANSIENT_GRACE_MS) return null;
      this.transientPendingSince = undefined;
      if (this.transientGraceTimer !== undefined) { window.clearTimeout(this.transientGraceTimer); this.transientGraceTimer = undefined; }
      if (this.bannerShownAt === undefined) {
        this.bannerShownAt = Date.now();
        this.scheduleTransientErrorDismissal(error, this.state.errorMachineId);
      }
      this.heldErrorBanner = errorBanner(error, () => {
        this.bannerDismissedByReader = true;
        this.bannerShownAt = undefined;
        if (this.transientErrorTimer !== undefined) { window.clearTimeout(this.transientErrorTimer); this.transientErrorTimer = undefined; }
        this.heldErrorBanner = null;
        this.setState(clearErrorPatch());
      }, "reply");
      return this.heldErrorBanner;
    }
    this.transientPendingSince = undefined;
    if (this.transientGraceTimer !== undefined) { window.clearTimeout(this.transientGraceTimer); this.transientGraceTimer = undefined; }
    if (decision.kind === "hold") {
      // The claim was cleared under us (a controller's clearErrorPatch cannot
      // reach these privates); the schedule marker pair resets with it, so a
      // re-raise inside the hold window re-arms instead of inheriting a spent
      // gate.
      this.lastScheduledError = "";
      this.lastScheduledMachineId = undefined;
      if (this.transientErrorTimer !== undefined) {
        window.clearTimeout(this.transientErrorTimer);
        this.transientErrorTimer = undefined;
      }
      if (this.bannerHoldTimer !== undefined) window.clearTimeout(this.bannerHoldTimer);
      this.bannerHoldTimer = window.setTimeout(() => { this.bannerHoldTimer = undefined; this.requestUpdate(); }, decision.retryInMs);
      return this.heldErrorBanner;
    }
    // A replacement starts its own hold window and its own expiry: borrowing
    // the previous banner's timestamps gave the new message a shorter life
    // than the model promised.
    if (error !== this.lastScheduledError || this.state.errorMachineId !== this.lastScheduledMachineId) {
      this.lastScheduledError = error;
      this.lastScheduledMachineId = this.state.errorMachineId;
      this.bannerShownAt = Date.now();
      this.scheduleTransientErrorDismissal(error, this.state.errorMachineId);
    }
    this.heldErrorBanner = errorBanner(error, () => {
      // The reader acted; the 1.5s minimum-visibility window exists for
      // replacement churn, not to outvote a dismissal. The expiry timer goes
      // with it: an identical re-raise in the same batch is a new claim, not
      // something the old schedule may erase.
      this.bannerDismissedByReader = true;
      this.bannerShownAt = undefined;
      if (this.transientErrorTimer !== undefined) {
        window.clearTimeout(this.transientErrorTimer);
        this.transientErrorTimer = undefined;
      }
      this.heldErrorBanner = null;
      this.setState(clearErrorPatch());
    }, retiredBy, () => { void this.retryAfterError(); });
    return this.heldErrorBanner;
  }

  private renderContextBar() {
    return html`
      <app-context-bar
        .session=${this.state.selectedSession}
        .activeSurface=${this.activeSurfaceLabel()}
        .onOpenGoTo=${() => { this.toggleGoToSheet(); }}
        .onRenameRequest=${(session: SessionInfo) => { this.renameFromBar = { session, machineId: selectedMachineId(this.state) }; }}
        ?panelOpen=${this.shellPanelOpen()}
        .toggleTarget=${"menu"}
        .navigationTarget=${this.appShell.isMobileNavigationLayout ? "page" : "panel"}
        ?panelToggleHidden=${panelToggleHiddenState({ mobileLayout: this.appShell.isMobileNavigationLayout, displayView: this.displayMainView() })}
        .onTogglePanel=${this.appShell.isMobileNavigationLayout && this.hasChatSubject() ? () => { this.openNavigate(); } : () => { this.toggleShellPanel(); }}
        .onOpenContext=${() => { this.openContextSheet(); }}
        .onQuickSwitch=${() => { this.openQuickSwitcher(); }}
      ></app-context-bar>
    `;
  }

  /** Whether the collapsible panel is currently presented on this layout. */
  /** The view the shell actually renders: on the phone an empty chat shows the panel. */
  private displayMainView(): AppState["mainView"] {
    return this.appShell.isMobileNavigationLayout && this.state.mainView === "chat" && !this.hasChatSubject() ? "navigation" : this.state.mainView;
  }

  /**
   * Whether the chat surface has something to show: a selected session, or a
   * named one it is waiting on or has an answer about (D8). On the phone every
   * "is there a chat behind this page" decision asks this one question.
   */
  private hasChatSubject(): boolean {
    return placeSessionId(this.state) !== undefined;
  }

  private namedTargetInScope(): ScopedSessionTarget | undefined {
    return targetInScope(this.state);
  }

  private renderNoSession(): TemplateResult {
    const named = this.namedTargetInScope();
    const view = named === undefined ? undefined : sessionTargetView(named.target, this.sessionTargetNames(named));
    if (view === undefined) return html`<div class="empty"><p>${this.sessionEmptyMessage()}</p>${this.renderEmptyStateAction()}</div>`;
    return html`
      <div class="empty session-target" role=${view.role}>
        <p>${view.text}</p>
        ${view.wayBack === undefined ? nothing : html`<button type="button" @click=${() => { this.sessions.forgetNamedSession(); }}>${view.wayBack}</button>`}
      </div>
    `;
  }

  private renderArchivedComposerSlot(session: SessionInfo): TemplateResult {
    return renderArchivedStrip(() => { void this.restoreFromComposerSlot(session); }, this.restoringSessionId === session.id);
  }

  private async restoreFromComposerSlot(session: SessionInfo): Promise<void> {
    if (this.restoringSessionId === session.id) return;
    this.restoringSessionId = session.id;
    this.requestUpdate();
    try {
      await this.changeArchiveState("restore", session);
    } finally {
      this.restoringSessionId = undefined;
      this.requestUpdate();
    }
  }

  private sessionTargetNames(named: ScopedSessionTarget): SessionTargetNames {
    const machine = this.state.machines.find((candidate) => candidate.id === named.machineId)?.name ?? named.machineId;
    return { machine, workspace: this.state.selectedWorkspace?.label ?? (named.workspaceId === undefined ? undefined : named.cwd) };
  }

  private shellPanelOpen(): boolean {
    return this.appShell.isMobileNavigationLayout
      ? this.displayMainView() === "navigation"
      : !this.panelCollapse.navigationPanelCollapsed;
  }

  private toggleShellPanel(): void {
    if (this.appShell.isMobileNavigationLayout) {
      if (!this.hasChatSubject()) {
        this.selectMainView("navigation");
        return;
      }
      this.selectMainView(this.displayMainView() === "navigation" ? "chat" : "navigation");
      return;
    }
    this.panelCollapse.toggleNavigationPanel();
  }

  /** Workspace views as panel rows: one entry, no sheet, no second strip. */
  private activeSurfaceLabel(): string {
    const view = this.displayMainView();
    if (view === "chat" || view === "navigation") return "";
    return this.shellToolTabs().find((tab) => tab.id === view)?.label ?? "";
  }

  private shellToolTabs(): ShellToolTab[] {
    return this.visibleWorkspacePanels().map((panel) => {
      const badge = this.mobilePanelBadge(panel);
      const usableBadge = badge === "" ? undefined : badge;
      return {
        id: panel.id,
        label: panel.title,
        icon: panel.icon ?? renderPluginIcon(),
        ...(usableBadge === undefined ? {} : { badge: usableBadge }),
        selected: this.state.mainView === panel.id,
      };
    });
  }

  /** Resolve the row id back to its typed view; unknown ids are ignored. */
  private openShellToolTab(id: string): void {
    const panel = this.visibleWorkspacePanels().find((candidate) => candidate.id === id);
    if (panel === undefined) return;
    this.selectMainView(panel.id);
  }

  private renderAppRefresh() {
    return html`<app-refresh-control .onReload=${() => { this.hardReloadApp(); }}></app-refresh-control>`;
  }

  /**
   * The chrome's half of a pending open (D8): a line at the top edge, visible whatever scrolled
   * away, and the one spoken announcement, which names the target in every phase.
   */
  private renderNavigationProgress() {
    const pending = this.navigation.view();
    return html`
      ${pending === undefined || pending.phase === "failed" ? nothing : html`<div class="navigation-progress" aria-hidden="true"></div>`}
      <div class="navigation-announcer" role="status" aria-live="polite">${pending === undefined ? "" : openingAnnouncement(pending)}</div>
    `;
  }

  override render() {
    const state = this.state;
    // A phone with no session selected shows the navigation panel wherever the
    // route says chat: the empty "Select or start a session." page is a
    // dead end under touch, and the back gesture from a tool panel lands
    // exactly there. Desktop keeps the empty state - its panel is always
    // on screen.
    const displayView = this.displayMainView();
    return html`
      <div class=${`${this.panelCollapse.shellClass(displayView, state.selectedWorkspace !== undefined)}${this.workspacePanelHoldsCanvas() ? " workspace-panel-fullscreen" : ""}`} style=${this.panelResize.shellStyle({ navigation: this.resizablePanelConstraints("navigation"), workspace: this.resizablePanelConstraints("workspace") })}>
        ${this.renderNavigationProgress()}
        <aside id="navigation-panel">${this.appShell.isMobileNavigationLayout ? null : this.renderNavigatePage(false)}</aside>
        ${this.contextSheetOpen ? null : this.renderNavigationPanelEdgeControl()}
        <main class=${mainViewClass(displayView)}>
          ${this.appShell.isMobileNavigationLayout && displayView === "navigation" ? null : this.renderContextBar()}

          ${this.renderAppRow(state.error, state.errorRetiredBy)}
          ${this.renderStaleClientBanner()}
          ${this.renderSelfUpdateBanner()}
          ${deprecatedAgentInputsBanner(deprecatedAgentInputsWarnings(state.machines, state.machineRuntimes))}
          <div class="mobile-navigation-panel">${this.appShell.isMobileNavigationLayout ? this.renderNavigatePage(false) : null}</div>
          ${state.selectedSession ? html`
            ${this.renderChatView(state, state.selectedSession)}
            ${state.selectedSession.archived === true ? this.renderArchivedComposerSlot(state.selectedSession) : html`<prompt-editor .rowedMessageIds=${rowedClientMessageIds(state.messages, [...(state.status?.queuedMessages ?? []), ...(state.clientQueuedSessionMessages[state.selectedSession.id] ?? [])])} .sessionId=${state.selectedSession.id} .cwd=${composerCwd(state)} .sessionPrompts=${this.sessionPromptsFor(state)} .machineId=${selectedMachineId(state)} .projectId=${state.selectedWorkspace?.projectId} .workspaceId=${state.selectedWorkspace?.id} .canSteer=${state.status?.isStreaming === true} .isCompacting=${state.status?.isCompacting === true} .canStop=${state.status?.isStreaming === true || state.status?.isBashRunning === true || state.status?.isCompacting === true || (state.status?.pendingMessageCount ?? 0) > 0} .status=${state.status} .availableThinkingLevels=${state.availableThinkingLevels} .sending=${state.sendingPrompts[state.selectedSession.id] === true}  .onSend=${this.handleSendPrompt} .onStop=${this.handleStopActiveWork} .onSelectModel=${this.handleSelectModel} .onSelectThinking=${this.handleSelectThinking} .composerContributions=${this.plugins.getComposerContributions(selectedMachineId(state))} .onPluginNotice=${(message: string) => { this.setState(noticePatch(noticeForReader(message))); }}></prompt-editor>`}
            ${this.renderStatusBar(state)}
            ${state.commandDialog !== undefined ? html`<command-picker ?abovedialog=${this.settingsOpen} .title=${state.commandDialog.title} .options=${state.commandDialog.options} .onPick=${(value: string) => this.sessions.respondToCommand(state.commandDialog?.requestId ?? "", value)} .onCancel=${() => { this.sessions.cancelCommand(); }}></command-picker>` : null}
            ${state.modelDialog !== undefined ? html`<model-picker ?abovedialog=${this.settingsOpen} title=${state.modelDialog.title} .options=${state.modelDialog.options} .catalog=${state.modelDialog.catalog} .selectedValue=${state.modelDialog.selectedValue} .onPick=${(value: string) => { void this.pickModel(value); }} .onToggleEnabled=${this.handleToggleModelEnabled} .onCancel=${() => { this.setState({ modelDialog: undefined }); }}></model-picker>` : null}
            ${state.thinkingDialog !== undefined ? html`<command-picker ?abovedialog=${this.settingsOpen} title=${state.thinkingDialog.title} .options=${state.thinkingDialog.options} .selectedValue=${state.thinkingDialog.selectedValue} .onPick=${(value: string) => { void this.pickThinking(value); }} .onCancel=${() => { this.setState({ thinkingDialog: undefined }); }}></command-picker>` : null}
          ` : this.renderNoSession()}
        </main>
        ${this.contextSheetOpen ? null : this.renderWorkspacePanelEdgeControl()}
        ${this.renderWorkspacePanel()}
        ${state.authDialog !== undefined ? html`<auth-dialog .state=${state.authDialog} .onChooseMethod=${(authType: "oauth" | "api_key") => { void this.auth.chooseLoginMethod(authType); }} .onSelectProvider=${(providerId: string, authType: "oauth" | "api_key") => { void this.auth.selectLoginProvider(providerId, authType); }} .onLogoutProvider=${(providerId: string) => { void this.auth.logoutProvider(providerId); }} .onOAuthInput=${(value: string) => { this.auth.updateOAuthInput(value); }} .onOAuthRespond=${(value?: string) => { void this.auth.respondOAuth(value); }} .onOAuthCancel=${() => { void this.auth.cancelOAuth(); }} .onCancel=${() => { this.auth.closeDialog(); }}></auth-dialog>` : null}
        ${this.navigateOpen ? html`<div class="navigate-overlay">${this.renderNavigatePage(true)}</div>` : null}
        ${this.quickSwitcherOpen ? html`<quick-switcher
          .boardAnswer=${this.quickSwitcherBoardAnswer}
          .sessions=${this.quickSwitcherSessionsWithPins()}
          .workspaces=${this.quickSwitcherWorkspaces}
          .selectedSession=${this.quickSwitcherBrowsingElsewhere() ? undefined : state.selectedSession}
          .selectedWorkspace=${this.quickSwitcherBrowsingElsewhere() ? undefined : state.selectedWorkspace}
          .activeSessionIds=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_ID_SET : this.activeSessionIds()}
          .sessionStates=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_STATE_MAP : this.sessionStateKinds()}
          .waitingSessionIds=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_ID_SET : this.waitingSessionIds()}
          .unreadSessionIds=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_ID_SET : this.unreadSessionIds}
          .sessionSections=${sessionSections(this.plugins.getSessionSections(this.rowsMachineId()))}
          .failedSendSessionIds=${this.failedSendSessionIds}
          .interruptedSessionIds=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_ID_SET : this.interruptedRunsByMachine.get(selectedMachineId(state)) ?? EMPTY_ID_SET}
          .errorSessionIds=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_ID_SET : this.errorSessionIds()}
          .pinnedSessionIds=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_ID_SET : this.pinnedSessionIds}
          .projects=${this.quickSwitcherBrowsingElsewhere() ? [] : state.projects}
          .machines=${state.machines}
          .browseMachineId=${this.quickSwitcherBrowseMachineId}
          .browsingElsewhere=${this.quickSwitcherBrowsingElsewhere()}
          .onSelectMachine=${(machineId: string) => { this.browseQuickSwitcherMachine(machineId); }}
          .canStartSession=${!this.quickSwitcherBrowsingElsewhere() && this.canStartSession()}
          .onCreateSession=${() => { void this.startSessionAndOpenChat(); }}
          .onOpenSession=${(session: SessionInfo) => { void this.openSessionFromQuickSwitcher(session); }}
          .opening=${this.navigation.view()}
          .rowsMachineId=${this.rowsMachineId()}
          .onSelectWorkspace=${(workspace: Workspace) => { void this.openWorkspaceFromQuickSwitcher(workspace); }}
          .onBrowse=${() => { this.openNavigateOn("project"); }}
          .onOpenSettings=${() => { this.openSettings(); }}
          .onTogglePin=${(session: SessionInfo) => { void this.moveToBrowsedMachine().then((moved) => { if (moved) this.togglePinnedSession(session); }); }}
          .onRenameSession=${async (session: SessionInfo, name: string) => {
            if (!await this.moveToBrowsedMachine()) return;
            await this.renameListedSession(session, this.browsedMachineId(), name);
          }}
          .onClose=${() => { this.navigation.cancel(); this.quickSwitcherOpen = false; }}
        ></quick-switcher>` : null}
        ${state.actionPaletteOpen ? html`<action-palette .actions=${this.getActions()} .onRun=${(action: AppAction) => { this.setState({ actionPaletteOpen: false }); this.runAction(action); }} .onCancel=${() => { this.setState({ actionPaletteOpen: false }); }}></action-palette>` : null}
        ${this.renderSessionTreeNavigator(state)}
        ${this.sessionCleanupDialog !== undefined ? html`<session-cleanup-dialog .preview=${this.sessionCleanupDialog.preview} .previewRequest=${this.sessionCleanupDialog.previewRequest} .result=${this.sessionCleanupDialog.result} .loading=${this.sessionCleanupDialog.loading === true} .running=${this.sessionCleanupDialog.running === true} .error=${this.sessionCleanupDialog.error ?? ""} .onPreview=${(request: SessionCleanupRequest) => { void this.previewSessionCleanup(request); }} .onRun=${(request: SessionCleanupRequest) => { void this.runSessionCleanup(request); }} .onConfirm=${(request: ConfirmRequest) => this.confirm(request)} .onClose=${() => { this.closeSessionCleanupDialog(); }}></session-cleanup-dialog>` : null}
        ${state.themeDialog !== undefined ? html`<command-picker ?abovedialog=${this.settingsOpen} title=${state.themeDialog.title} .options=${state.themeDialog.options} .selectedValue=${state.themeDialog.selectedValue} .onPick=${(value: string) => { this.pickTheme(value); }} .onCancel=${() => { this.setState({ themeDialog: undefined }); }}></command-picker>` : null}
        ${this.settingsOpen ? html`<settings-dialog .section=${this.settingsSection} .machine=${state.selectedMachine} .machineRuntime=${this.selectedMachineRuntime()} .actions=${this.getDefaultActions()} .onNavigate=${(section: SettingsSection) => { this.navigateSettings(section); }} .onBackToList=${() => { this.backToSettingsList(); }} .pluginSections=${this.plugins.getSettingsSections(selectedMachineId(state))} .pluginRuntimeContext=${this.createPluginRuntimeContext()} .onClose=${() => { this.closeSettings(); }} .onConfigSaved=${(config: PiWebConfigValues) => { this.applyClientConfig(config); }} .onRefreshMachineRuntime=${async (machineId: string) => { await this.machines.refreshMachineRuntime(machineId, { requireSelected: false }); }} .machines=${state.machines} .machineStatuses=${state.machineStatuses} .onAddMachine=${() => { this.openMachineDialog(); }} .onRenameMachine=${async (machine: Machine, name: string) => { await this.renameMachine(machine, name); }} .onRemoveMachine=${(machine: Machine) => { void this.removeMachine(machine); }} .fleetReport=${this.fleetReport} ?fleetLoading=${this.fleetLoading} .fleetError=${this.fleetError} .onRefreshFleet=${() => this.refreshFleet()} .onRunFleet=${(operation: "restart" | "update", machineIds?: readonly string[]) => this.runFleetOperation(operation, machineIds)} .themes=${this.plugins.getThemes()} .selectedThemeId=${this.resolveCurrentThemePreference().selectedTheme?.id} .activeThemeId=${this.activeThemeId} ?followSystemTheme=${this.themePreference.auto} .onSelectTheme=${(themeId: QualifiedContributionId) => { this.selectTheme(themeId); }} .onToggleFollowSystem=${(follow: boolean) => { this.setFollowSystemTheme(follow); }}></settings-dialog>` : null}
        ${this.pluginDialogs.map((entry) => html`<div class=${PLUGIN_DIALOG_CLASS[entry.dialog.presentation ?? "overlay"]}><modal-surface .label=${entry.dialog.label} .onClose=${entry.close}>${entry.dialog.content}</modal-surface></div>`)}
      </div>
      ${this.contextSheetOpen ? html`<context-switcher-sheet
        .title=${[state.selectedMachine?.name, state.selectedProject?.name].filter((part) => part !== undefined && part !== "").join(" · ") || "Projects"}
        .navSections=${this.plugins.getNavSections(selectedMachineId(state))}
        .navSectionContext=${this.buildNavSectionContext("sheet")}
        .onClose=${() => { this.contextSheetOpen = false; }}
      ></context-switcher-sheet>` : null}
      ${this.renameFromBar === undefined ? null : html`<session-rename-dialog
        .sessionName=${this.renameFromBar.session.name ?? ""}
        .onSubmit=${(name: string) => { const target = this.renameFromBar; this.renameFromBar = undefined; if (target !== undefined) void this.renameListedSession(target.session, target.machineId, name); }}
        .onCancel=${() => { this.renameFromBar = undefined; }}
      ></session-rename-dialog>`}
      ${this.goToSheetOpen ? html`<app-go-to-sheet
        .destinations=${this.goToDestinations()}
        .onSelect=${(id: string) => { this.goTo(id); }}
        .onClose=${() => { this.goToSheetOpen = false; }}
      ></app-go-to-sheet>` : null}
    `;
  }

  static override styles = [interactiveSurfaceStyles, sessionStateBadgeStyles, appStyles];
}

/** The Go to sheet's command line: opens the action palette, the touch opener ⌘K never had (B39). */
const GO_TO_ACTIONS = "actions";

const PLUGIN_DIALOG_CLASS: Record<NonNullable<PluginDialog["presentation"]>, string> = {
  overlay: "plugin-dialog",
  fullscreen: "plugin-dialog plugin-dialog-fullscreen",
  alert: "plugin-dialog plugin-dialog-alert",
};

function createPluginRegistry(dialogHost: PluginDialogHost, readPiWebStatus: (machineId: string) => Promise<unknown>): PluginRegistry {
  const registry = new PluginRegistry({
    ui: createPluginHostUi(dialogHost),
    readPiWebStatus,
    fetchJson: (path, init) => request<unknown>(path, (value) => value, {
      ...(init?.method === undefined ? {} : { method: init.method }),
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  });
  registry.register({ id: "core", plugin: corePlugin });
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

/** The selection the workspace listings follow moved: machine, project or workspace, by any writer. */
function listingSelectionChanged(previous: AppState, next: AppState): boolean {
  return selectedMachineId(previous) !== selectedMachineId(next)
    || previous.selectedProject?.id !== next.selectedProject?.id
    || previous.selectedWorkspace?.id !== next.selectedWorkspace?.id;
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

interface RouteScope {
  readonly machineId?: string | undefined;
  readonly projectId?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly sessionId?: string | undefined;
}

/**
 * Whether a restore should name, in the URL, the session it opened: a workspace link on the desktop
 * opens the latest session, and the URL then names it, so it describes the chat on screen and a
 * reload opens the same one after a newer session appears (D8). Only while the URL still holds the
 * route being restored: a machine switch or a terminal run restores a route the URL does not hold
 * yet, and replacing that entry took the reader's previous place out of Back (review 61021b3f).
 */
export function restoreOpenedUnnamedSession(restored: RouteScope, inUrl: RouteScope, shownSessionId: string | undefined): boolean {
  const unnamed = (route: RouteScope): boolean => route.sessionId === undefined || route.sessionId === "";
  const sameMachine = (restored.machineId ?? "local") === (inUrl.machineId ?? "local");
  const samePlace = (restored.projectId ?? "") === (inUrl.projectId ?? "") && (restored.workspaceId ?? "") === (inUrl.workspaceId ?? "");
  return unnamed(restored) && unnamed(inUrl) && sameMachine && samePlace && shownSessionId !== undefined && shownSessionId !== "";
}

/**
 * Whether a tap overtaken after it moved the machine still owes the URL: not while a route
 * restore (Back, a machine switch) runs or another open is on its way, either of which writes the
 * URL itself, and not once the URL names the machine the page is on, because the intent that took
 * over wrote it or a restore put it there.
 */
export function supersededMoveOwesUrl(facts: { readonly restoring: boolean; readonly opening: boolean; readonly urlMachineId: string | undefined; readonly pageMachineId: string }): boolean {
  return !facts.restoring && !facts.opening && (facts.urlMachineId ?? "local") !== facts.pageMachineId;
}

/** Only the fields the strip shows: a byte counter ticking must not re-render. */
export function sameBackgroundTasks(left: readonly SessionBackgroundTaskInfo[], right: readonly SessionBackgroundTaskInfo[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other?.id === entry.id && other.status === entry.status && other.exitCode === entry.exitCode && other.durationMs === entry.durationMs;
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

function isTerminalEvent(event: BrowserRealtimeEvent): event is TerminalUiEvent {
  return event.type === "terminal.created" || event.type === "terminal.exited" || event.type === "terminal.closed";
}

function emptyWorkspaceRouteSurface(): WorkspaceRouteSurface {
  return {};
}

/** The machine and project a workspace deletion runs answer belongs to; undefined with no project selected. */
function workspaceDeletionRunsKey(state: AppState): string | undefined {
  return state.selectedProject === undefined ? undefined : machineScopedKey(selectedMachineId(state), state.selectedProject.id);
}

function machineScopedKey(machineId: string, value: string): string {
  return JSON.stringify([machineId, value]);
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
    case "max": return "Everything the model will spend";
    default: return undefined; // unknown level from a newer pi: no description
  }
}
