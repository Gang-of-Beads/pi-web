import { css, LitElement, html, nothing, type TemplateResult, unsafeCSS } from "lit";
import { PHONE_LAYOUT_MEDIA_QUERY } from "../breakpoints";
import { isTransientNewSessionInfo, writtenSessionIds } from "../sessionPersistence";
import { uiIconStyle, renderCommandIcon, renderGearIcon, renderPluginIcon } from "./uiIcons.js";
import { loadSurface, warmLazySurfaces, type LazySurface } from "./lazySurfaces.js";
import { sessionStateBadgeStyles } from "./sessionStateBadgeStyles.js";
import type { ChatLine } from "./shared";
import { clearErrorPatch, errorNoticePatch, NOTICE_ON_ROW, noticePatch, noticeScope, type NoticeFields, type NoticeScreen } from "../errorNotice";
import { request } from "../api/http";
import { sessionPinsApi, type MachinePins } from "../api/clients";
import { workspaceTerminalSessions } from "../plugins/workspaceTerminalSessions";
import { machineTerminalSessions, runInNewMachineTerminal, RunInNewTerminalFailure, startCommandTypist, type NewTerminalCommand, type RunInNewTerminalReport } from "../plugins/machineTerminalSessions";
import { showCommandNotRun } from "../commandNotRunDialog";
import { scopePages } from "../scopePages";
import { chosenListTiles } from "../listTiles";
import { createPluginHostUi, type PluginDialogHost } from "../plugins/pluginHostUi";
import { describeError, noticeForReader, noticeForSession, RetiredBy } from "../notice";
import { clearPlaceholderFrame, notePlaceholderFrame, placeholderFrameOutstanding } from "../historyWrites";
import { bannerHoldDecision, TRANSIENT_GRACE_MS } from "./bannerHold";
import { routeMatchesUrl } from "../routeMatch";
import { autoFocusesComposer } from "../appShell/appShellController";
import { touchPrimaryPointer } from "../keyboardDismissal";
import { customElement, query, state } from "lit/decorators.js";
import { api, configApi, effectiveWorkspaceUploadFolder, fleetApi, piWebApi, projectsApi, sessionsApi, terminalsApi, trustApi, workspacesApi, workspaceEffectiveUploadFolder, type CommandOption, type ExtensionDialogAnswer, type Machine, type MachineHealth, type PiWebConfigValues, type PiWebShortcutConfig, type Project, type SessionCleanupExecuteResponse, type SessionCleanupPreviewResponse, type SessionCleanupRequest, type SessionInfo, type SessionModel,
  type PromptAttachment, type QueuedSessionMessage, type SessionTreeForkResult, type SessionTreeNavigateResult, type SessionTreeSummaryChoice, type TerminalCommandRun, type TerminalUiEvent, type Workspace } from "../api";
import type { ExtensionUiStanding, MachineConnection, MachineRuntime, PiWebFleetReport, PiWebFleetRunResponse, PiWebListTilesConfig, PluginSurfacePresence } from "../../../shared/apiTypes";
import type { PluginPanelComposer, PluginPanelSession } from "../../../shared/pluginApiTypes";
import { createPanelComposer } from "../panelComposer";
import type { AppAction } from "../actions";
import { composerCwd, initialAppState, type AppState } from "../appState";
import { isSessionNotFoundError } from "../sessionNotFound";
import { renderArchivedStrip } from "./archivedStrip";
import { sessionWorkSettled } from "../sessionWorkSettled";
import type { SessionStateBadgeKind } from "./activityBadge";
import { isSessionActive } from "../../../shared/activity";
import { canonicalJson } from "../../../shared/unknownValues";
import { pageCommandOf, type PageCommandName } from "../../../shared/builtinSlashCommands";
import { lastReplyText } from "../chatMessages";
import { PI_WEB_CAPABILITIES, supportsPiWebCapability } from "../../../shared/capabilities";
import { machineScopedPluginId } from "../../../shared/machinePluginIds";
import { AuthController } from "../controllers/authController";
import { MachineController, remoteReportedDownNotice } from "../controllers/machineController";
import { SessionBoardController, locateSessionOnMachine } from "../controllers/sessionBoardController";
import { browserBoardMemory } from "../sync/boardMemory";
import { boardEventOf, boardSessionsOf, dedupeById, type BoardAnswer } from "../sync/sessionBoard";
import { dataTransferHasFiles, FileDragDepth, fileDropFrameStyle, filesFromDataTransfer } from "../fileDrop";
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
import { setAccessGateOn } from "../accessGate";
import { LOCAL_MACHINE_ID, machineSessionKey, machineWorkspaceKey } from "../machineKeys";
import { askConfirmation, confirmationText, type ConfirmRequest } from "../confirmDialog";
import { modifiedMs, sessionSections } from "../sessionOrder";
import { commandsForSession } from "../commandLedger";
import { routedWorkspaceTool } from "../routedWorkspaceTool";
import { shownWorkspacePanel, workspacePanelHoldsCanvas, workspacePanelMayHoldCanvas } from "../workspacePanelCanvas";
import { sessionCleanupRequestKey } from "../sessionCleanupUi";
import { SessionUnreadController } from "../sessionUnread";
import { heldOpenSessionIn, nextOpenRowHold, type OpenRow } from "../openRowHold";
import { projectFolderFlag } from "../projectFolder";
import { workspaceViewTransition } from "../workspaceViewTransition";
import { RealtimeSocket, type BrowserRealtimeEvent } from "../sessionSocket";
import { refreshOnReturn, workspaceChangeVerdict, type WorkspaceScope } from "../workspaceChange";
import type { PluginMachine, PluginProjectCreateInput, PluginPromptEditor, QualifiedContributionId, QualifiedThemeContribution, QualifiedThemePairContribution, QualifiedWorkspacePanelContribution, QualifiedGlobalPanelContribution, GlobalPanelContext, PluginRuntimeContext, TerminalCommandRunsInternalRuntime, WorkspaceFiles, WorkspaceHost, WorkspaceLabelContext, WorkspaceLabelItem, WorkspacePanelContext, WorkspacePluginBinding, PluginDialog, PluginDialogHandle, NavSectionContext, PluginSettings } from "../plugins/types";
import { CORE_MATERIAL_LIGHT_THEME_ID, isNativeThemeId, applyNativeMaterialLightTheme, CORE_MATERIAL_DARK_THEME_ID, DEFAULT_THEME_PREFERENCE, NATIVE_THEME_CHOICES, applyNativeMaterialDarkTheme, applyPiWebTheme, findThemePairForTheme, readStoredThemePreference, resolveThemePreference, resolvedThemePreferenceId, selectableThemeContributions, serializedThemePreference, writeStoredThemePreference, type ThemePreference, type ThemePreferenceResolution } from "../theme";
import { corePlugin } from "../plugins/core";
import { loadExternalPlugins, type ExternalPluginLoadResult } from "../plugins/external";
import { createPluginLoadRetry } from "../plugins/pluginLoadRetry";
import { sessionSelectionFacts } from "../plugins/sessionSelectionFacts";
import { projectFolderAccess } from "../plugins/projectFolderAccess";
import { PluginRegistry, installPluginRuntimeScope, installWorkspaceLabelScope, installWorkspacePanelScope, type PluginFleetSource } from "../plugins/registry";
import { PluginFleetHost } from "../plugins/pluginFleetHost";
import { runAskedBy, runStartTranscript } from "../plugins/runAskedBy";
import { storedDeviceId } from "../operationLog";
import type { FleetOpenResult } from "../../../shared/pluginApiTypes";
import { fleetOpenVerdict } from "../plugins/fleetOpenVerdict";
import { createPluginWorkspaceBackend } from "../plugins/workspaceBackend";
import { createWorkspaceFiles as createPluginWorkspaceFiles } from "../plugins/workspaceFiles";
import { queryNamespace, readNamespacedString, setNamespacedQueryKey } from "../namespacedQueryArgs";
import { AppShellController } from "../appShell/appShellController";
import { appRowPlace, type AppRowPlace } from "../appShell/appRowPlace";
import { BrowserResumeController } from "../appShell/browserResumeController";
import "./appShell/ContextSwitcherSheet";
import "./appShell/AppGoToSheet";
import "./appShell/AppColumnBar";
import "./appShell/NewSessionProjectSheet";
import "./SessionRenameDialog";
import type { GoToDestination } from "./appShell/AppGoToSheet";
import { PanelCollapseController, mainViewClass, workspacePanelTakesSpace } from "../appShell/panelCollapseController";
import { cornerKeyBars, goToAction, KEYS_AT_CORNER, leadingKeyOf, navigateGridKey, type CornerKeyBars, type GoToAction, type NavigateGridKey } from "../appShell/cornerKeys";
import { PanelResizeController, type PanelResizeConstraints, type ResizablePanelSide } from "../appShell/panelResizeController";
import { readRoute, resolveAppRoute, resolveWorkspacePanelRouteValue, writeRoute, type AppRoute, type ParsedAppRoute } from "../route";
import { readSettingsOpen, readSettingsSection, writeSettingsOpen, writeSettingsSection, type SettingsReveal, type SettingsSection } from "../settingsRoute";
import { clearMachineAccessRoute, readMachineAccessRequestId } from "../machineAccessRoute";
import "./MachineAccessApproval";
import { applyActiveShortcutPreferences } from "../shortcutPreferences";
import { extensionShortcutActions } from "../extensionShortcutActions";
import { createTerminalCommandRunsRuntime } from "../runtime/terminalRuntime";
import { canDeleteWorkspace, isWorkspaceDeletionPending, isWorkspaceDeletionRunPending, latestWorkspaceDeletionRuns, pendingWorkspaceDeletionIds, targetWorkspaceIdForRun, workspaceDeletionRunFilter, workspaceRemovalConfirmation } from "../workspaceDeletion";
import "./SessionCleanupDialog";
import "./ChatView";
import type { ChatView } from "./ChatView";
import "./PromptEditor";
import type { PromptEditor, TakeBackPath } from "./PromptEditor";
import "./StatusBar";
import "./CommandPicker";
import { modelCommandChoice, type ModelPickerMode } from "./ModelPicker";
import "./ActionPalette";
import "./AuthDialog";
import { deepActiveElement, hasRenderedModal, onModalPresenceChange } from "./modalLayerRegistry";
import { InstallAppOfferGate } from "../installAppOfferGate";
import "./WorkspacePanel";
import type { WorkspacePanelEmptyState } from "./WorkspacePanel";
import "./appShell/AppContextBar";
import "./appShell/AppNavigatePage";
import type { AppNavigatePage, NavigateKind } from "./appShell/AppNavigatePage";
import type { NavigateBulkActionId, NavigateBulkActionIds, NavigateBulkGroup, NavigateRowActionId, NavigateRowKind } from "../navigateRowActions";
import type { SelectionOutcome } from "../selectionModel";
import { orderedIds } from "../../../shared/listOrder";
import { sessionLabel } from "../sessionLabels";
import { NavigationIntents, openingAnnouncement } from "../navigationIntent";
import { writeClipboardText } from "../clipboard";
import type { NavigateInput, NavigateLevel } from "../navigateModel";
import { MachineProbeController } from "../controllers/machineProbeController";
import { foregroundMachineList, type MachineListSurface } from "./appShell/machineListPresenceController";
import type { ShellToolTab } from "../appShell/shellToolTabs";
import "./appShell/AppPanelEdgeControl";
import { goToScope, type GoToScope, type NavigateListScope, type ShownPageKind } from "../goToScope";
import { quickSwitcherSessionStates, sessionIdsIn } from "../quickSwitcher";
import { reloadOffer } from "../versionSkew";
import { oneRowPerIdentity } from "../transcriptInvariant";
import { readPinnedSessionIds, togglePinnedSessionId, writePinnedSessionIds } from "../sessionPins";
import { readPinnedProjectIds, togglePinnedProjectId, writePinnedProjectIds } from "../projectPins";
import { markPinsHandedOver, pinsHandedOver } from "../pinHandover";
import { observeTransportRecovery } from "../api/transportHealth";
import { ackWatch } from "../api/ackWatch";
import { dismissKeyboardIfRaised } from "../keyboardDismissal";
import { appRowText, noticeExpiryMs, noticeRowView, syncingRowView, unansweredRowView, type RowView } from "./errorBanner";
import type { RowNames } from "../sync/rowWords";
import type { TransportClaim } from "../api/transportClaim";
import { graceLeftMs, rowDecision, stillUnheard, type HeardClocks, type ShownUnanswered } from "../sync/connectionSummary";
import { messageStatusUnanswered } from "../sendVerification";
import { earliestUnanswered, type Unanswered } from "../sync/scopedResource";
import type { ReadMiss } from "../sync/readPhase";
import type { MessageNote } from "../messageNotes";
import { QUIET_WINDOW_MS, retryDelayMs } from "../sync/readPhase";
import { interruptedRunsReadPlan } from "../interruptedRunsRead";
import { deprecatedAgentInputsBanner, deprecatedAgentInputsWarnings } from "./deprecatedAgentInputsBanner";
import { interactiveSurfaceStyles, attachmentZoomStyles } from "./shared";
import { documentTitleFor } from "../contextName";

export interface PluginDialogEntry {
  readonly id: number;
  readonly dialog: PluginDialog;
  readonly close: () => void;
}

export const appStyles = css`${unsafeCSS(uiIconStyle)}
  .navigation-announcer, .sync-announcer { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .navigation-progress { position: fixed; top: env(safe-area-inset-top); left: 0; right: 0; height: 2px; z-index: calc(var(--pi-layer-dialog) + 5); pointer-events: none; overflow: hidden; }
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

  ${attachmentZoomStyles}
  /* 100dvh is an assumption about what the browser subtracts; --pi-app-visible-height is a measurement. */
  :host { --pi-app-safe-area-bottom: 0px; --pi-app-keyboard-inset: 0px; --pi-app-viewport-offset-top: 0px; position: fixed; top: var(--pi-app-viewport-offset-top); right: 0; left: 0; display: block; height: var(--pi-app-visible-height, calc(100dvh - var(--pi-app-keyboard-inset))); box-sizing: border-box; overflow: hidden; padding: env(safe-area-inset-top) env(safe-area-inset-right) var(--pi-app-safe-area-bottom) env(safe-area-inset-left); color: var(--pi-text); background: var(--pi-bg); font: var(--pi-text-base) var(--pi-font-ui); line-height: inherit; }
  :host([pwa-display-mode]) { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  @media (display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui) {
    :host { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  }
  .shell { --navigation-panel-size: 340px; --workspace-panel-size: 340px; --navigation-panel-width: var(--navigation-panel-size); --workspace-panel-width: var(--workspace-panel-size); --navigation-divider-width: 1px; --workspace-divider-width: 1px; display: grid; grid-template-columns: var(--navigation-panel-width) var(--navigation-divider-width) minmax(320px, 1.35fr) var(--workspace-divider-width) var(--workspace-panel-width); height: 100%; min-height: 0; }
  aside { grid-column: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  aside app-navigation-panel { flex: 1 1 auto; min-height: 0; }
  aside app-navigate-page { flex: 1 1 auto; min-height: 0; }
  /* Over the session, not instead of it: the page covers the screen while it
     is open and the close returns to the conversation underneath. */
  .navigate-overlay { position: fixed; top: var(--pi-app-viewport-offset-top, 0px); right: 0; left: 0; height: var(--pi-app-visible-height, calc(100dvh - var(--pi-app-keyboard-inset))); box-sizing: border-box; padding: env(safe-area-inset-top) env(safe-area-inset-right) var(--pi-app-safe-area-bottom) env(safe-area-inset-left); z-index: var(--pi-layer-overlay); background: var(--pi-bg); }
  header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
  .header-actions { display: flex; align-items: center; gap: var(--pi-space-4); }
  main { grid-column: 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .file-drop-frame { position: fixed; z-index: var(--pi-layer-popover); box-sizing: border-box; display: grid; place-items: center; border: 2px dashed var(--pi-accent); border-radius: var(--pi-radius-lg); background: color-mix(in srgb, var(--pi-accent) 10%, transparent); pointer-events: none; }
  .file-drop-frame span { padding: var(--pi-space-3) var(--pi-space-4); border: 1px solid var(--pi-accent-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text-bright); font-weight: var(--pi-weight-strong); }
  /* A dashed hairline, not the browser's medium default: this rule was
     generalised from a chip that carried its own border width. */
  .empty { border: 1px dashed var(--pi-border); border-radius: var(--pi-radius-lg); padding: var(--pi-space-7); color: var(--pi-muted); }
  /* A page's rows keep the edge of the bar above them, whose keys sit on the conversation gutter (cornerKeys). */
  workspace-panel { grid-column: 5; min-width: 0; min-height: 0; overflow: hidden; --pi-bar-inset: var(--pi-chat-gutter); }
  @media (min-width: 1181px) {
    /* A workspace tool can request the content area without owning or changing
       the surrounding shell. The selected panel keeps its own tabs and state. */
    /* Expanded review tools need the full desktop canvas; their own toolbar
       provides the exit action, so neither app pane remains actionable here. */
    .shell.workspace-panel-fullscreen { grid-template-columns: minmax(0, 1fr); }
    .shell.workspace-panel-fullscreen > aside, .shell.workspace-panel-fullscreen > main,
    .shell.workspace-panel-fullscreen > app-panel-edge-control { display: none; }
    .shell.workspace-panel-fullscreen > workspace-panel { grid-column: 1; }
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; --navigation-divider-width: 0px; }
    .shell.navigation-panel-collapsed > aside { display: none; }
    .shell.workspace-panel-collapsed { --workspace-panel-width: 0px; --workspace-divider-width: 0px; }
    .shell.workspace-panel-collapsed > workspace-panel { display: none; }
  }
  @media (max-width: 1180px) {
    .shell { grid-template-columns: var(--navigation-panel-width) var(--navigation-divider-width) minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; --navigation-divider-width: 0px; }
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
  @media ${unsafeCSS(PHONE_LAYOUT_MEDIA_QUERY)} {
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
  .app-row-layer { position: fixed; top: 0; left: 0; right: 0; z-index: calc(var(--pi-layer-dialog) + 5); padding-top: env(safe-area-inset-top); background: var(--pi-bg); box-shadow: var(--pi-elevation-2); }
  .app-row-layer:empty { display: none; }
  .deprecation-notice { padding: var(--pi-space-5) var(--pi-space-7); border-bottom: 1px solid var(--pi-border); color: var(--pi-warning); }
  .deprecation-notice .deprecation-notice-text { margin: 0; overflow-wrap: anywhere; }
  .deprecation-notice .deprecation-notice-text + .deprecation-notice-text { margin-top: var(--pi-space-2); }

  .reload-banner { display: flex; align-items: center; gap: var(--pi-space-4); flex-wrap: wrap; box-sizing: border-box; margin: 0 var(--pi-chat-gutter) var(--pi-space-5); border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-lg); background: var(--pi-warning-surface); color: var(--pi-warning); padding: var(--pi-space-4) var(--pi-space-6); font-size: var(--pi-text-sm); }
  /* The banner sits in the same column as the transcript controls, which are
     all 44px on a finger; a 32px row here was a second touch floor. */
  .reload-banner button { box-sizing: border-box; min-height: var(--pi-control-height); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; padding: var(--pi-space-2) var(--pi-space-5); }
  @media (pointer: coarse) { .reload-banner button { min-height: var(--pi-control-height-touch); } }
  @media (hover: hover) { .reload-banner button:hover { border-color: var(--pi-accent); } }
`;


const PI_WEB_STATUS_REFRESH_MS = 15 * 60 * 1000;
// Surface backed up: the pi-web runtime status readout (header health, self-
// update banner). Nothing events it; the tab re-reads on this slow cadence.
const EMPTY_ID_SET: ReadonlySet<string> = new Set();

/** What removing a machine changes, said before it happens, by how the machine is reached. */
const REMOVE_MACHINE_WORDS: Readonly<Record<MachineConnection, (name: string) => string>> = {
  browser: (name) => `This removes it from this PI WEB and asks ${name} to forget this page's access; if it cannot be reached now, remove the access in ${name}'s own Settings. Nothing else on that machine changes.`,
  server: () => "This only removes it from this PI WEB gateway; nothing on that machine changes.",
};

/** What the page shows of one machine's pins, from that machine's answer. */
function machinePinView(machineId: string, answered: MachinePins): { machineId: string; ids: ReadonlySet<string>; projects?: ReadonlyMap<string, ReadonlySet<string>>; pinnedProjects?: ReadonlySet<string> } {
  return {
    machineId,
    ids: new Set(answered.global),
    ...(answered.projects === undefined ? {} : { projects: answered.projects }),
    ...(answered.pinnedProjects === undefined ? {} : { pinnedProjects: new Set(answered.pinnedProjects) }),
  };
}

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

const PI_WEB_STATUS_DEFER_MS = 750;
/** A failed status read is asked again this soon: the Updates page hides while the status is unknown, and the periodic refresh is 15 minutes away. */
const PI_WEB_STATUS_RETRY_MS = 15_000;
/** The Go to sheet's command line: opens the action palette on touch, where its keyboard shortcut cannot reach (B39). */
const GO_TO_ACTIONS = "actions";
/** Go to's Settings line: on the phone it is the way to Settings from every screen (owner, 2026-10-04). */
const GO_TO_SETTINGS = "settings";
/** The slots the Terminal pages answer to (route aliases); core never names the plugin. */
const GLOBAL_TERMINAL_SLOT = "core:global.terminal";
const WORKSPACE_TERMINAL_SLOT = "core:workspace.terminal";
const GLOBAL_SHORTCUT_LISTENER_OPTIONS = { capture: true } as const;
const THEME_AUTO_ON_VALUE = "auto:on";
const THEME_AUTO_OFF_VALUE = "auto:off";
const THEME_OPTION_PREFIX = "theme:";

const WORKSPACE_FILES_SLOT: QualifiedContributionId = "core:workspace.files";
const FILES_ROUTE_NAMESPACE = queryNamespace(WORKSPACE_FILES_SLOT);
const TERMINAL_ROUTE_NAMESPACE = queryNamespace("core:workspace.terminal");
const WORKSPACE_ROUTE_NAMESPACE = queryNamespace("core:workspace");
const MIN_RESIZABLE_CHAT_WIDTH_PX = 320;
const PANEL_EDGE_COLUMNS_WIDTH_PX = 2;
import { deliveredClientMessageIds } from "../userMessageRegister";
import { heldWords, loadPayload, type PendingPrompt } from "../pendingOutbox";
import { attachmentShortfallNote, combinedShortfall, returnedAttachments, type AttachmentShortfall } from "../returnedAttachments";
import type { PromptHistoryEntry } from "../promptHistory";
import { returnedWordsNotice, returnWordsToSavedDraft } from "../returnedWords";
import { renamedSessionId } from "../composerScope";
import { fleetReportFromHere, runFleetFromHere, type FleetFanOutApi } from "../fleetFanOut";
import { rowedClientMessageIds } from "../messageDelivery";
import { frontedPageShown } from "../frontedPage";
import { directMachinesOf, setDirectMachines } from "../directMachineUrl";
import { extensionWidgetPanels } from "./ExtensionWidgetPage";

interface SessionCleanupDialogState {
  preview?: SessionCleanupPreviewResponse | undefined;
  previewRequest?: SessionCleanupRequest | undefined;
  result?: SessionCleanupExecuteResponse | undefined;
  loading?: boolean | undefined;
  running?: boolean | undefined;
  error?: string | undefined;
}

/**
 * Why an unanswered batch is unanswered, for the row. A request that got no status reads as the
 * link to this page's server - "Trying to reach" - only while nothing has come from that server
 * since the batch went; once it answers anything, the batch's machine is what is not answering.
 */
function outboxMiss(entry: { readonly machineId: string; readonly since: number; readonly miss: ReadMiss }, heard: HeardClocks): ReadMiss {
  return entry.miss.kind === "link-down" && heard.link > entry.since ? { kind: "machine-unanswering", machineId: entry.machineId } : entry.miss;
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
  @query("#navigation-panel app-navigate-page, .mobile-navigation-panel app-navigate-page") private inPageNavigatePage?: AppNavigatePage;
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
  @state() private unreadSessionIds: ReadonlySet<string> = this.sessionUnread.unreadSessionIds(selectedMachineId(this.state), this.state.sessions);
  /** The open session whose row keeps its unread place until the reader leaves it (`openRowHold.ts`). */
  @state() private openRowHold: OpenRow | undefined;
  private unreadConnected = false;
  private committedChatIdentity: string | undefined;
  private readyChatIdentity: string | undefined;

  private readonly sessions: SessionController = new SessionController(
    () => this.state,
    (patch) => { this.setState(patch); },
    (options) => { this.updateUrl(options); },
    new SessionStorageSessionSelectionMemory(),
    {
      urlSessionId: () => readRoute().sessionId,
      onStreamFrame: (scope, event) => { this.pluginFleet.streamFrame(scope.machineId, scope.sessionId, event); },
      onStreamLost: (scope) => { this.pluginFleet.streamLost(scope.machineId, scope.sessionId); },
      onSelectedSessionReady: ({ machineId, session }) => {
        void this.commitReadyChatAfterRender(machineId, session);
      },
      replacePromptEditorText: async ({ machineId, sessionId, text, mode }) => {
        await this.updateComplete;
        if (selectedMachineId(this.state) !== machineId || this.state.selectedSession?.id !== sessionId) return;
        if (mode === "paste") this.promptEditor?.pasteText(text);
        else this.promptEditor?.replaceText(text);
      },
      returnToComposer: (scope, words) => { this.returnWords(scope, words); },
      returnQueuedToComposer: (scope, messages, lines) => this.returnQueued(scope, messages, lines),
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
    { opensPreferredSession: () => !this.appShell.isMobileNavigationLayout, rememberedSessions: (machineId, path) => boardSessionsOf(this.sessionBoards.known(machineId), path) },
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
    memory: browserBoardMemory(),
  });
  private readonly unsubscribeSessionBoards = this.sessionBoards.subscribe(() => {
    this.mirrorSessionBoard();
    this.pluginFleet.changed();
  });
  private readonly piWebStatusController = new PiWebStatusController(
    () => this.state,
    (patch) => { this.setState(patch); },
    {
      onRefreshError: (machineId, error) => {
        console.warn(`Failed to refresh PI WEB status for ${machineId}`, error);
        this.schedulePiWebStatusRefresh(PI_WEB_STATUS_RETRY_MS);
      },
    },
  );
  private workspaceUploadFolderFallback = effectiveWorkspaceUploadFolder(undefined);
  private readonly keyboard = new KeyboardShortcutDispatcher();
  private readonly realtime = new RealtimeSocket();
  private readonly machineRealtimeSockets = new Map<string, RealtimeSocket>();
  /** What `connection-changed` last told plugins, for which machine; undefined until the first open. */
  private announcedConnection: { readonly machineId: string; readonly connected: boolean } | undefined;
  private readonly activeTerminalIds = new Set<string>();
  private readonly machineNavigation = new SessionStorageMachineNavigationMemory();
  private readonly terminalSelection = new SessionStorageTerminalSelectionMemory();
  private readonly appShell = new AppShellController(this);
  private readonly machineProbes = new MachineProbeController(this, () => this.state.machines);
  private readonly browserResume = new BrowserResumeController({
    onResumeSignal: () => { this.handleBrowserResumeSignal(); },
    refreshAfterResume: () => this.refreshAfterBrowserResume(),
    onRefreshError: (error) => { console.warn("Failed to refresh after browser resume", error); },
  });
  private readonly panelCollapse = new PanelCollapseController(this);
  private readonly panelResize = new PanelResizeController(this);
  private readonly systemLightThemeMedia = typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia("(prefers-color-scheme: light)") : undefined;
  private terminalAutoStartWorkspaceId: string | undefined;
  /** Tiles per row in the Navigate lists, per layout, from PI WEB's config (listTiles.ts). */
  @state() private listTiles: PiWebListTilesConfig | undefined;
  /** The machine terminal the global Terminal page shows, with its machine; kept in the tab, as a global page has no workspace route. */
  @state() private selectedMachineTerminal: { readonly machineId: string; readonly terminalId: string } | undefined;
  private piWebStatusTimer: number | undefined;
  private piWebStatusDeferredTimer: number | undefined;
  private workspaceDeletionPollTimer: number | undefined;
  private restoringSessionId: string | undefined;
  private livenessTimer: number | undefined;
  /** The unanswered row on screen and the machine whose row it is: its hold never carries over to another machine's row (r66). */
  private unansweredShown: { readonly machineId: string; readonly row: ShownUnanswered } | undefined;
  /** When the page last came into view, undefined while hidden: the row's grace counts only time in view (`graceLeftMs`). */
  private lookingSince: number | undefined;
  private workspaceChangedWhileHidden: WorkspaceScope | undefined;
  private reconnectingRecheck: ReturnType<typeof setTimeout> | undefined;
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
  /** What browser plugins read of the fleet, and the facts they hear (issue #57). Declared before the registry, which opens one per plugin as it registers. */
  private readonly pluginFleet: PluginFleetHost = new PluginFleetHost({
    roster: () => ({ loaded: this.state.machinesLoad === "loaded", machines: this.state.machines, selectedMachineId: selectedMachineId(this.state) }),
    reachability: (machine) => this.machineProbes.confirmedView(machine),
    watchReachability: (owner, wanted) => { this.machineProbes.setVisible(owner, wanted); },
    boards: this.sessionBoards,
    locateSession: (machineId, sessionId) => locateSessionOnMachine(sessionId, machineId),
    openSession: (machineId, session) => this.openSessionFromQuickSwitcher(session, machineId),
    navigationIntent: () => {
      const intent = this.navigation.latest();
      return () => this.navigation.isCurrent(intent);
    },
    holdsStream: (machineId, sessionId) => selectedMachineId(this.state) === machineId && this.state.selectedSession?.id === sessionId,
    runStartTranscript: (machineId, sessionId) => (this.showsLoadedTranscript(machineId, sessionId) ? runStartTranscript(this.state.messages) : "unseen"),
    askedBy: (machineId, sessionId, atStart) => (this.showsLoadedTranscript(machineId, sessionId) ? runAskedBy(this.state.messages, storedDeviceId(), atStart) : "unknown"),
    management: {
      addMachine: () => {
        const action = this.plugins.getReservedAction(this.createPluginRuntimeContext(), "add-machine");
        if (action === undefined) return false;
        this.runAction(action);
        return true;
      },
      renameMachine: (machine) => { this.renamingMachine = machine; },
      removeMachine: (machine) => { void this.removeMachine(machine); },
      openMachine: (machine) => { if (machine.baseUrl !== undefined) window.open(machine.baseUrl, "_blank", "noopener,noreferrer"); },
      refreshMachine: (machine) => {
        void this.machines.endRefusalPause(machine).then(() => {
          this.machineProbes.wake();
          return Promise.all([this.machines.refreshMachineHealth(machine.id), this.machines.refreshMachineRuntime(machine.id)]);
        });
      },
    },
    facts: { emit: (kind, fact) => { this.plugins.emitFact(kind, fact); } },
  });
  private readonly plugins = createPluginRegistry({ showDialog: (dialog) => this.openPluginDialog(dialog) }, (machineId) => this.piWebStatusController.read(machineId), (pageId) => { this.goTo(pageId); }, this.pluginFleet);
  private readonly loadedMachinePluginIds = new Set<string>();
  /** Plugins this browser could not load or register, per machine id, then source plugin id, for their Settings cards (B38). */
  private pluginLoadFailures: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map();
  private readonly machinePluginLoadPromises = new Map<string, Promise<void>>();
  private gatewayPluginLoadPromise: Promise<void> | undefined;
  private readonly pluginRetry = createPluginLoadRetry((attempt) => this.retryMissingPlugins(attempt));
  private themePreference: ThemePreference = readStoredThemePreference() ?? DEFAULT_THEME_PREFERENCE;
  @state() private activeThemeId: QualifiedContributionId | undefined;
  /** The stored spelling of the preference the applied look was painted for; see themePaint. */
  private paintedPreference: string | undefined;
  /**
   * Whether the gateway's plugins have had their first load. Until then a plugin theme that is not
   * registered yet keeps the look index.html painted from the last visit instead of falling back to
   * Material for a moment (#76); after it, a theme that is still missing falls back to the side of
   * Material the system prefers.
   */
  private themePluginsSettled = false;
  /** Whether this PI WEB shares one theme across its browsers (config `theme`); undefined until the config is read. */
  @state() private sharedTheme: boolean | undefined;
  @state() private sharedThemeError = "";
  private sharedThemeWrites: Promise<void> = Promise.resolve();
  private sharedThemeWritesPending = 0;
  private sharedThemeWritesStarted = 0;
  @state() private isRefreshingApp = false;
  private transientErrorTimer: number | undefined;
  private bannerShownAt: number | undefined;
  private bannerHoldTimer: number | undefined;
  /** When a transport claim first appeared and was held back (grace before show). */
  private transientPendingSince: number | undefined;
  private transientGraceTimer: number | undefined;
  private heldErrorBanner: RowView | null = null;
  /** Whose notice the held banner is: a hold redraws it only where that notice may speak (`noticeScope`). */
  private heldNoticeScope: Pick<NoticeFields, "errorRetiredBy" | "errorMachineId" | "errorSessionId"> | undefined;
  /**
   * The app row's view for this render, decided once at the top of `render` because two places
   * draw from it: the row's place draws a notice's text, and the top bar draws a sync state.
   */
  private appRowView: RowView | null = null;
  private lastScheduledError = "";
  private lastScheduledMachineId: string | undefined = undefined;
  private lastScheduledSessionId: string | undefined = undefined;
  private bannerContextKey = "";
  private appRowInset = 0;
  @state() private quickSwitcherOpen = false;
  /** The one navigation surface; see `navigateModel`. */
  @state() private navigateOpen = false;
  /** How the Navigate page leaves selecting, while it is selecting; the back gesture takes it first. */
  private navigateSelectionExit: (() => void) | undefined;
  @state() private contextSheetOpen = false;
  @state() private goToSheetOpen = false;
  /** Go to opened inside the page column, on the wide layout (`columnGoTo`). */
  @state() private columnGoToOpen = false;
  /** Whether the column list was open at the last render; closing it hands the focus on (followCornerKeyFocus). */
  private columnListWasOpen = false;
  /** What the Navigate page that opened Go to listed; undefined when a chat or plugin page opened it. */
  private goToOpenedFrom: NavigateListScope | undefined;
  /** Whether any modal layer is open; the app row then rides above it. */
  @state() private modalPresent = false;
  private stopModalPresence: (() => void) | undefined;
  private readonly installOffer = new InstallAppOfferGate({
    runningInstalled: () => this.appShell.isPwaDisplayMode,
    modalOpen: () => this.isRenderedModalOpen(),
    showDialog: (dialog) => this.openPluginDialog(dialog),
  });
  private stopInstallOfferWatch: (() => void) | undefined;
  /** New session with no project open asks where it starts (`NewSessionProjectSheet`). */
  @state() private newSessionSheetOpen = false;
  /** The first-boot centre's Add a project: the added project opens with a new session. */
  private startSessionAfterAddingProject = false;
  /** The session the rename dialog names, with the machine it lives on: a row of a browsed machine is renamed there. */
  @state() private renameFromBar: { session: SessionInfo; machineId: string } | undefined;
  @state() private renamingMachine: Machine | undefined;
  /** How much of the browsed machine's board has answered; the lists claim emptiness only for a complete one. */
  @state() private quickSwitcherBoardAnswer: BoardAnswer = "none";
  /** Changes the reader asked for from the list that are still on their way; the list applies their result without motion (cached-first-and-motion.md). */
  @state() private readerListChanges = 0;
  @state() private quickSwitcherSessions: readonly SessionInfo[] = [];
  /** Pinned sessions of the browsed machine that no open project lists (B49). */
  @state() private quickSwitcherPinnedElsewhere: readonly SessionInfo[] = [];
  /**
   * Pins for the machine on screen. A pin is keyed by machine because session
   * ids are unique per machine; the cache is re-read whenever the selection
   * moves, so machine A's pins can never mark or act on machine B's rows.
   */
  @state() private pinCache: { machineId: string; ids: ReadonlySet<string>; projects?: ReadonlyMap<string, ReadonlySet<string>>; pinnedProjects?: ReadonlySet<string> } | undefined;
  private pinReadsInFlight = new Set<string>();
  private pinsAdopted = new Set<string>();
  private projectPinsAdopted = new Set<string>();
  /**
   * Each machine's last answer. The page shows one machine's pins at a time; browsing another and
   * coming back used to rebuild the view from this browser alone, without the machine's project
   * pins and pinned projects, and no read followed (the machine was already adopted), so a project
   * pinned after coming back was written to this browser only.
   */
  private readonly machinePinAnswers = new Map<string, MachinePins>();

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
    const known = this.machinePinAnswers.get(machineId);
    const view = known === undefined ? { machineId, ids: readPinnedSessionIds(machineId) } : machinePinView(machineId, known);
    this.pinCache = view;
    void this.ensureMachinePins(machineId);
    return view.ids;
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
      const answered = this.pinsAdopted.has(machineId) || local.size === 0 || pinsHandedOver("sessions", machineId)
        ? await sessionPinsApi.pins(machineId)
        : await sessionPinsApi.adopt([...local], machineId);
      this.pinsAdopted.add(machineId);
      markPinsHandedOver("sessions", machineId);
      this.applyMachinePins(machineId, await this.adoptLocalProjectPins(machineId, answered));
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

  /**
   * This browser's pinned projects from before the machine kept them (R11), handed to a machine
   * that keeps them once, so none is lost; a machine that keeps none leaves them in this browser.
   */
  private async adoptLocalProjectPins(machineId: string, answered: MachinePins): Promise<MachinePins> {
    if (answered.pinnedProjects === undefined || this.projectPinsAdopted.has(machineId) || pinsHandedOver("projects", machineId)) return answered;
    const local = [...readPinnedProjectIds(machineId)].filter((id) => !(answered.pinnedProjects ?? []).includes(id));
    const adopted = local.length === 0 ? answered : await sessionPinsApi.adoptProjects(local, machineId);
    this.projectPinsAdopted.add(machineId);
    markPinsHandedOver("projects", machineId);
    return adopted;
  }

  private applyMachinePins(machineId: string, answered: MachinePins): void {
    writePinnedSessionIds(machineId, new Set(answered.global));
    if (answered.pinnedProjects !== undefined) writePinnedProjectIds(machineId, new Set(answered.pinnedProjects));
    this.machinePinAnswers.set(machineId, answered);
    if (this.pinCache?.machineId === machineId) this.pinCache = machinePinView(machineId, answered);
    this.requestUpdate();
  }

  /**
   * A project's own pins on a machine (B49), from the machine's last answer; undefined until it
   * answered, or when it keeps no project pins, so nothing offers a pin it could not keep.
   */
  private projectPinnedSessionIdsFor(machineId: string, projectId: string | undefined): ReadonlySet<string> | undefined {
    if (projectId === undefined) return undefined;
    const cached = this.pinCache;
    if (cached?.machineId !== machineId || cached.projects === undefined) return undefined;
    return cached.projects.get(projectId) ?? EMPTY_ID_SET;
  }
  @state() private quickSwitcherWorkspaces: readonly Workspace[] = [];
  private readonly fileDrag = new FileDragDepth();
  /** Where the dashed "Drop files to attach" frame stands while files are dragged over the chat. */
  @state() private fileDropFrame: string | undefined;
  private quickSwitcherMachineId: string | undefined;
  @state() private staleClientServerVersion: string | undefined;
  @state() private sessionCleanupDialog: SessionCleanupDialogState | undefined;
  @state() private pluginDialogs: readonly PluginDialogEntry[] = [];
  private pluginDialogSeq = 0;
  private commandNotRunDialog: PluginDialogHandle | undefined;
  /** The last composer picker asked for; an older one's late read opens nothing (beginPickerRequest). */
  private pickerRequestSeq = 0;
  @state() private settingsOpen = readSettingsOpen();
  @state() private machineAccessRequestId = readMachineAccessRequestId();
  @state() private reloadAfterSettings = false;
  private settingsListFramePushed = false;
  @state() private settingsSection: SettingsSection | undefined = readSettingsSection();
  /** A Settings field a page linked to, until the dialog has shown it. */
  @state() private settingsReveal: SettingsReveal | undefined;
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

  /**
   * Close the topmost modal layer; popstate is the only caller. The checks follow paint order: the
   * sheets render above the dialog stack, and plugin dialogs (a confirm among them) render above
   * every core dialog, so a confirm opened from the cleanup dialog answers Back before the cleanup
   * dialog does (review 1005 navigation P1-2).
   */
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
    if (this.pluginDialogs.length > 0) {
      const top = this.pluginDialogs[this.pluginDialogs.length - 1];
      if (top !== undefined) top.close();
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
    // The navigation page is the outermost layer: everything above it has
    // already answered the gesture, so back leaves the page it was opened on.
    if (this.navigateSelectionExit !== undefined) { this.navigateSelectionExit(); return; }
    if (this.navigateOpen) this.closeNavigate();
  }
  private readonly onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      void this.sessionUnread.refreshAll();
      void this.sessions.recheckTranscript();
    }
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
    this.pluginRetry.wake();
    this.projects.wake();
    this.workspaces.wake();
    this.machines.wake();
    this.machineProbes.wake();
    this.sessionBoards.wake();
    this.realtime.reconnectNow();
    this.sessions.reconnectSocketNow();
    this.checkSocketLiveness();
    void this.sessions.recheckTranscript();
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
    this.lookingSince = document.visibilityState === "visible" ? Date.now() : undefined;
    this.requestUpdate();
    if (document.visibilityState === "visible") {
      this.realtime.reconnectNow();
      this.sessions.reconnectSocketNow();
      this.sessions.kickOutbox();
      this.pluginRetry.wake();
      void this.sessions.recheckTranscript();
      this.projects.wake();
      this.workspaces.wake();
      this.machines.wake();
      this.sessionBoards.wake();
      this.refreshWorkspaceChangedWhileHidden();
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

  /**
   * Esc that nothing on the page used, pressed in the chat view, goes to the shown session's
   * extensions that listen for terminal input (pi's `onTerminalInput`; owner 2026-10-10: only Esc).
   * It listens after every surface had the key: a modal, the completion list or a row that used Esc
   * marked it handled, and it is not passed on. Only a key from the chat view, the composer or no
   * focused element counts; the navigation lists and settings keep their own. An open Go to list in
   * the page column takes it first, from any focus: the list is no modal layer, and Escape is how
   * the keyboard leaves it.
   */
  private readonly onUnclaimedKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || this.isRenderedModalOpen()) return;
    if (this.columnGoToOpen) {
      this.columnGoToOpen = false;
      return;
    }
    const session = this.state.selectedSession;
    const status = this.state.status;
    if (session === undefined || status?.sessionId !== session.id || status.extensionUi?.terminalInput !== true || this.displayMainView() !== "chat") return;
    const fromChat = event.target === this.ownerDocument.body || event.composedPath().some((target) => target === this.chatView || target === this.promptEditor);
    if (!fromChat) return;
    void api.sendTerminalInput(session, "escape", selectedMachineId(this.state)).catch((error: unknown) => {
      this.setState(errorNoticePatch(error));
    });
  };

  protected override willUpdate(): void {
    this.toggleAttribute("pwa-display-mode", this.appShell.isPwaDisplayMode);
    if (this.columnGoToOpen && !(this.columnGoTo() && this.workspacePanelOnScreen())) this.columnGoToOpen = false;
    if (this.goToSheetOpen && this.columnGoTo()) this.goToSheetOpen = false;
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
    this.syncAppRowInset();
    if (supportsPiWebCapability(this.state.machineRuntimes[LOCAL_MACHINE_ID], PI_WEB_CAPABILITIES.accessToken)) setAccessGateOn(true);
    this.pluginFleet.changed();
    if (this.columnListWasOpen && !this.columnGoToOpen) this.followCornerKeyFocus("goTo");
    this.columnListWasOpen = this.columnGoToOpen;
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
      this.promptEditor.settleOutbox(deliveredClientMessageIds(this.state.messages));
    }
    // Lit has now committed the selected chat and app-shell visibility state.
    // Recheck after every rendered transition; the unread controller
    // deduplicates acknowledgements for the observed completion order.
    const chatIdentity = selectedChatIdentity(this.state);
    this.committedChatIdentity = chatIdentity;
    this.syncSelectedSessionReadState();
    this.syncFleetOnSettingsSection();
    this.syncDocumentTitle();
  }

  /**
   * The tab says which context is focused. A reader with several PI WEB tabs
   * open cannot tell them apart from the product name they all share. An
   * extension's `ctx.ui.setTitle` names the tab while its session is open in
   * the chat view, as it names pi's terminal, with the π mark and the bound
   * every tab title keeps; leaving the session restores ours.
   */
  private syncDocumentTitle(): void {
    const state = this.state;
    const title = documentTitleFor({
      mainView: state.mainView,
      selectedMachine: state.selectedMachine,
      selectedProject: state.selectedProject,
      selectedWorkspace: state.selectedWorkspace,
      selectedSession: state.selectedSession,
      extensionTitle: this.openSessionStanding(state)?.title,
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

  /**
   * Mark the open session read once the reader can see it. The open row's hold is taken first:
   * it is decided on the unread set as it stands, so an acknowledgement made before it would leave
   * the row nothing to hold (`openRowHold.ts`).
   */
  private syncSelectedSessionReadState(): void {
    this.syncOpenRowHold();
    const session = this.state.selectedSession;
    if (session === undefined) return;
    const machineId = selectedMachineId(this.state);
    if (!this.isSessionSeen(machineId, session)) return;
    void this.sessionUnread.acknowledge(machineId, session);
  }

  private syncOpenRowHold(): void {
    const session = this.state.selectedSession;
    const open = session === undefined ? undefined : { machineId: selectedMachineId(this.state), sessionId: session.id };
    const next = nextOpenRowHold(this.openRowHold, open, this.unreadSessionIds);
    if (next !== this.openRowHold) this.openRowHold = next;
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
   *
   * A failed read says nothing in the app row (owner, 2026-10-04): the next
   * reconnect reads the record again by itself, and while the link is down the
   * row already says it is reconnecting. Its old notice told the reader to
   * reconnect, which is the page's job.
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
      if (plan.failed) return;
      this.interruptedRunsBootReadByMachine.add(machineId);
      if (plan.adoptMarkers && ids !== undefined) {
        this.interruptedRunsByMachine.set(machineId, ids);
      }
    });
  }

  /**
   * The "Reload to get the new version" strip above the session view. The tab keeps running the bundle it loaded, however many times the server
   * underneath is upgraded; every client-side fix shipped in between is
   * invisible here, and gets reported as still broken. The server states its
   * version; a mismatch is an offer to reload - the reader's move, never an
   * automatic one.
   */
  private renderStaleClientBanner(): TemplateResult | null {
    if (this.staleClientServerVersion === undefined) return null;
    return html`
      <div class="reload-banner" role="status" aria-live="polite">
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
    this.stopModalPresence = onModalPresenceChange(() => {
      const present = hasRenderedModal(this.ownerDocument);
      if (present !== this.modalPresent) this.modalPresent = present;
      this.installOffer.noteModalChange();
    });
    this.stopInstallOfferWatch = this.installOffer.watch();
    // Past first paint, fetch the dialogs nobody has opened yet, so an open is
    // instant without the entry bundle carrying them.
    warmLazySurfaces();
    // Recovery is noticed by whichever channel succeeds next, which is often
    // not the one that failed; the realtime socket alone was leaving a banner
    // on screen until the page was reloaded by hand.
    observeTransportRecovery((machineId) => { this.clearTransientError(machineId); });
    this.lookingSince = document.visibilityState === "visible" ? 0 : undefined;
    ackWatch.watch(() => { this.requestUpdate(); });
    this.realtime.watchPhase(() => {
      this.requestUpdate();
      this.announceConnection();
    });
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
    window.addEventListener("keydown", this.onUnclaimedKey);
    window.addEventListener("dragover", this.refuseStrayFileDrop);
    window.addEventListener("drop", this.refuseStrayFileDrop);
    this.systemLightThemeMedia?.addEventListener("change", this.onSystemLightThemeChange);
    this.applyPreferredTheme(false);
    this.connectRealtime();
    this.syncSessionUnreadMachines();
    // Surface backed up: the pi-web runtime status readout (PI_WEB_STATUS_REFRESH_MS).
    this.piWebStatusTimer = window.setInterval(() => { this.schedulePiWebStatusRefresh(); }, PI_WEB_STATUS_REFRESH_MS);
    document.addEventListener("visibilitychange", this.onDocumentVisibilityChange);
    this.sessions.startOutbox();
    // Surface backed up: every socket's liveness (SOCKET_LIVENESS_CHECK_MS).
    this.livenessTimer = window.setInterval(() => { this.checkSocketLiveness(); }, SOCKET_LIVENESS_CHECK_MS);
    window.addEventListener("online", this.onBrowserOnline);
    window.addEventListener("pointerdown", this.onInteractionLivenessProbe, { passive: true, capture: true });
    void this.loadClientConfig();
    void this.checkClientFreshness();
    void this.ensureGatewayPluginsLoaded();
    void this.loadProjectsAndRestoreRoute()
      .then((restored) => { if (restored) this.installOffer.noteSettled(); })
      .finally(() => { this.schedulePiWebStatusRefresh(); });
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
    this.lastScheduledSessionId = undefined;
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
    // Expiry is the retirement model's (noticeExpiryMs): a notice about an
    // operation and a self-healing transport claim leave by themselves; a
    // composed claim about a machine stays until that machine answers.
    const retiredBy = this.state.errorRetiredBy;
    const sessionId = this.state.errorSessionId;
    const expiry = noticeExpiryMs(retiredBy, this.state.errorClaim, error, sessionId);
    if (expiry === undefined) return;
    this.transientErrorTimer = window.setTimeout(() => {
      this.transientErrorTimer = undefined;
      // Only clear what we scheduled for: a newer message must not be
      // swallowed. The schedule marker resets with the text, so a same-batch
      // re-raise of identical wording re-arms its own expiry instead of
      // inheriting a spent gate.
      this.lastScheduledError = "";
      this.lastScheduledMachineId = undefined;
      this.lastScheduledSessionId = undefined;
      // Only clear what we scheduled for - and "what" is the claim, not the
      // wording: two machines down in a row can produce identical text, and
      // the first machine's timer must not delete the second machine's claim
      // that never answered once.
      if (this.state.error === error && this.state.errorMachineId === machineId && this.state.errorRetiredBy === retiredBy && this.state.errorSessionId === sessionId) {
        this.setState(clearErrorPatch());
      }
    }, expiry);
  }

  override disconnectedCallback(): void {
    this.stopModalPresence?.();
    this.stopInstallOfferWatch?.();
    setAccessGateOn(false);
    if (this.appRowInset !== 0) this.ownerDocument.documentElement.style.removeProperty("--pi-app-row-inset");
    this.appRowInset = 0;
    observeTransportRecovery(undefined);
    ackWatch.watch(undefined);
    this.realtime.watchPhase(undefined);
    this.announcedConnection = undefined;
    this.navigation.dispose();
    if (this.transientErrorTimer !== undefined) window.clearTimeout(this.transientErrorTimer);
    if (this.bannerHoldTimer !== undefined) window.clearTimeout(this.bannerHoldTimer);
    if (this.transientGraceTimer !== undefined) window.clearTimeout(this.transientGraceTimer);
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
    window.removeEventListener("keydown", this.onUnclaimedKey);
    window.removeEventListener("dragover", this.refuseStrayFileDrop);
    window.removeEventListener("drop", this.refuseStrayFileDrop);
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
    if (this.reconnectingRecheck !== undefined) globalThis.clearTimeout(this.reconnectingRecheck);
    this.reconnectingRecheck = undefined;
    this.projects.dispose();
    this.workspaces.dispose();
    this.machines.dispose();
    this.unsubscribeSessionBoards();
    this.sessionBoards.dispose();
    if (this.livenessTimer !== undefined) window.clearInterval(this.livenessTimer);
    this.livenessTimer = undefined;
    window.removeEventListener("online", this.onBrowserOnline);
    this.pluginRetry.dispose();
    window.removeEventListener("pointerdown", this.onInteractionLivenessProbe, { capture: true });
    document.removeEventListener("visibilitychange", this.onDocumentVisibilityChange);
    this.sessions.stopOutbox();
    this.clearPendingRemoteRouteRestore();
    super.disconnectedCallback();
  }

  private setState(patch: Partial<AppState>) {
    if (patch.messages !== undefined) patch = { ...patch, messages: oneRowPerIdentity(patch.messages) };
    if (!patchChangesState(this.state, patch)) return;
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    if (patch.machines !== undefined) setDirectMachines(directMachinesOf(patch.machines));
    if (selectedChatIdentity(previous) !== selectedChatIdentity(this.state)) {
      this.committedChatIdentity = undefined;
      this.readyChatIdentity = undefined;
      this.endMessageStatusClaimOffScreen();
    }
    this.announceSessionSelection(previous, this.state);
    this.releaseHeldStream(previous, this.state);
    if (previous.sessionStatuses !== this.state.sessionStatuses) this.pluginFleet.knownStatuses(selectedMachineId(this.state), Object.values(this.state.sessionStatuses));
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
   *
   * Resolves true once the boot route is restored, which is when the app has settled on a view. It
   * resolves false when the restore gave up (the roster never answered) or was handed to the retry
   * loop, which reports its own finish.
   */
  private async loadProjectsAndRestoreRoute(): Promise<boolean> {
    const intent = this.navigation.latest();
    this.restoreSettingsRoute();
    const route = readRoute();
    await this.machines.loadMachines(route.machineId, () => this.navigation.isCurrent(intent) && readRoute().machineId === route.machineId);
    if (this.state.machinesLoad !== "loaded" && (route.machineId ?? "local") !== "local") {
      const answered = await this.machines.rosterAnswered(() => this.navigation.isCurrent(intent) && readRoute().machineId === route.machineId);
      if (!answered) return false;
    }
    return this.restoreBootRoute(route, intent);
  }

  /**
   * `intent` is the reader's latest intent when the boot restore began; every step and deferral keeps it (D8).
   * Resolves true when the route was restored now, false when it was deferred to the retry loop.
   */
  private async restoreBootRoute(route: ParsedAppRoute, intent: number): Promise<boolean> {
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
      return false;
    }
    await this.withChatScrollTransition(() => this.restoreRouteFor(effectiveRoute, undefined, undefined, intent));
    if (this.shouldDeferRemoteRouteRestore(effectiveRoute, initialRouteMachineHealth)) {
      this.deferRemoteRouteRestore(effectiveRoute, intent);
      return false;
    }
    this.clearPendingRemoteRouteRestore();
    this.rememberCurrentMachineNavigation();
    return true;
  }

  /**
   * Both sockets verify themselves; a stale one closes and reconnects, and the
   * reconnect is what refetches whatever was missed. The session socket also asks
   * for what was missed, without reconnecting, after its quiet window T of silence
   * (B7). Skipped while the tab is hidden, where the resume path takes over.
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
      this.sessions.catchUp(),
      this.sessions.verifyUnansweredSends(),
      this.refreshMachineStatusSnapshots(),
      this.refreshWorkspaceDeletionRuns(),
      this.refreshCurrentWorkspaceSurface(),
      this.workspaces.refreshSelectedProjectTopology(),
      // A projects listing that failed while the browser slept recovers here
      // instead of waiting for a manual reload.
      this.projects.loadProjects(),
      this.loadClientConfig(),
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

  /**
   * The shared theme is adopted only from this fresh gateway read: Settings hands applyClientConfig
   * a merged copy whose `theme` dates from when it opened, and a read issued while this browser's
   * own theme write is queued, or overlapping one that starts later, may predate that write and
   * would undo the pick it carries, so such a read does not adopt the theme.
   */
  private async loadClientConfig(): Promise<void> {
    const writesStarted = this.sharedThemeWritesStarted;
    const quiet = this.sharedThemeWritesPending === 0;
    try {
      const config = (await configApi.config()).effectiveConfig;
      this.applyClientConfig(config);
      if (quiet && this.sharedThemeWritesPending === 0 && writesStarted === this.sharedThemeWritesStarted) {
        this.adoptSharedTheme(config.theme);
      }
    } catch (error) {
      console.warn("Failed to load PI WEB config", error);
    }
  }

  private applyClientConfig(config: PiWebConfigValues): void {
    this.shortcutConfig = config.shortcuts ?? {};
    this.listTiles = config.listTiles;
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
    if (resolved !== undefined && resolved === this.workspaceTerminalPage() && workspace !== undefined) await this.refreshActiveTerminals(workspace);
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
      const route = resolveAppRoute(parsedRoute, (value) => this.resolvePageRouteId(value));
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
      this.installOffer.noteSettled();
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
    const machineName = this.state.machines.find((machine) => machine.id === machineId)?.name ?? this.state.selectedMachine?.name ?? "Remote machine";
    // The reason is what the health read reported - never this banner's own
    // previous text, which the retry ladder would otherwise paste into itself
    // once per attempt.
    const notice = remoteReportedDownNotice(this.state.machineStatuses[machineId], { id: machineId, name: machineName });
    if (notice === undefined || notice.text === this.remoteRouteRestoreNotice) return;
    this.remoteRouteRestoreNotice = notice.text;
    this.setState(noticePatch(notice));
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
    if (tool === undefined || tool === this.workspaceTerminalPage()) return;
    await this.invalidateWorkspacePanels(tool);
  }

  private resolveRestoredMainView(view: AppState["mainView"] | undefined): AppState["mainView"] | undefined {
    if (view === undefined || view === "chat" || view === "navigation") return view;
    return resolveWorkspacePanelRouteValue(view, (value) => this.resolvePageRouteId(value));
  }

  /** The project Terminal page on the selected machine, through its slot. */
  private workspaceTerminalPage(): QualifiedContributionId | undefined {
    return this.plugins.resolveWorkspacePanelRouteId(WORKSPACE_TERMINAL_SLOT, selectedMachineId(this.state));
  }

  /** A route's page: a project page, else a global page, on the selected machine. */
  private resolvePageRouteId(value: string): QualifiedContributionId | undefined {
    const machineId = selectedMachineId(this.state);
    return this.plugins.resolveWorkspacePanelRouteId(value, machineId) ?? this.plugins.resolveGlobalPanelRouteId(value, machineId);
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
      tool: this.state.selectedWorkspace === undefined && !this.isGlobalPage(this.state.workspaceTool) ? undefined : this.shownWorkspaceToolId(),
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

  /**
   * Move to a machine and back to where the reader last was there. A tap made while that restore runs
   * overtakes it: the restore then writes no entry of its own, so the history keeps the tap's entry last
   * and the URL names the tapped place, not the remembered one (D8; review ae155c79 DeepSeek §3).
   */
  private async selectMachineWithMemory(machine: Machine, options: { rememberCurrent?: boolean } = {}): Promise<void> {
    if (this.state.selectedMachine?.id === machine.id) return;
    if (options.rememberCurrent !== false && !this.routeRestoreInProgress) this.rememberCurrentMachineNavigation();
    const seq = ++this.machineNavigationRestoreSeq;
    const intent = this.navigation.latest();
    const snapshot = this.machineNavigation.latest(machine.id) ?? emptyMachineNavigationSnapshot(machine.id);
    await this.restoreRouteFor(routeFromMachineNavigationSnapshot(snapshot), snapshot.surface, snapshot.view, intent);
    if (seq !== this.machineNavigationRestoreSeq || this.state.selectedMachine?.id !== machine.id) return;
    if (!this.navigation.isCurrent(intent)) {
      this.nameMachineAfterSupersededMove();
      return;
    }
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
  /**
   * Show a page by id or by slot alias. The id is resolved at the door: a stored alias matched no
   * page, so "Go to terminal" drew Files and named nothing (review triage, go-to-global-pages).
   */
  private openWorkspaceTool(requested: QualifiedContributionId) {
    if (requested === WORKSPACE_TERMINAL_SLOT) this.terminalAutoStartWorkspaceId = this.state.selectedWorkspace?.id;
    const tool = this.resolvePageRouteId(requested) ?? requested;
    if (!this.appShell.isMobileNavigationLayout) this.panelCollapse.expandWorkspacePanel();
    if (tool !== this.state.workspaceTool) this.workspacePanelFullscreen = false;
    this.setState({ workspaceTool: tool, mainView: tool });
    this.updateUrl();
    this.refreshSelectedWorkspaceTool(tool);
  }

  private openTerminal(options?: { terminalId?: string | undefined }): void {
    if (options?.terminalId !== undefined) this.selectTerminal(options.terminalId, { replace: true });
    this.openWorkspaceTool(WORKSPACE_TERMINAL_SLOT);
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

  private readonly fleetFanOutApi: FleetFanOutApi = {
    report: () => fleetApi.report(),
    run: (operation, machineIds) => fleetApi.run(operation, machineIds),
    health: (machineId) => api.health(machineId),
    runtime: (machineId) => api.runtime(machineId, true),
    start: (machineId, operation) => fleetApi.start(machineId, operation),
  };

  private async refreshFleet(): Promise<void> {
    this.fleetLoading = true;
    this.fleetError = undefined;
    try {
      this.fleetReport = await fleetReportFromHere(this.fleetFanOutApi, this.state.machines);
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
      return await runFleetFromHere(this.fleetFanOutApi, this.state.machines, operation, machineIds);
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
    this.settingsReveal = undefined;
    this.settingsListFramePushed = false;
    writeSettingsSection(undefined);
    this.leftSettings();
  }

  /**
   * Every way out of Settings ends here: its close key, Escape and the back gesture (which closes
   * it through the URL, review 1005 navigation P1-1). A plugin turned on or off in Settings changes
   * which code this page runs, and the page cannot load or unload a plugin in place. Owner,
   * 2026-10-04: the page reloads itself when Settings closes, rather than asking the reader to.
   * Drafts, form answers and the outbox survive it in local storage; composer attachments and a
   * half-typed extension input do not.
   */
  private leftSettings(): void {
    if (this.reloadAfterSettings) this.hardReloadApp();
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
    if (!this.settingsOpen) this.leftSettings();
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

  /**
   * The documented `connection-changed` fact: the selected machine's announcements socket opened or
   * went away, for that machine. Nothing is said before it first opens, which is not a drop.
   */
  private announceConnection(): void {
    const machineId = selectedMachineId(this.state);
    const connected = this.realtime.phaseFor(machineId).kind === "open";
    const announced = this.announcedConnection;
    if (announced === undefined ? !connected : announced.machineId === machineId && announced.connected === connected) return;
    this.announcedConnection = { machineId, connected };
    this.plugins.emit({ kind: "connection-changed", machineId, connected });
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
        this.refreshInterruptedRuns(machineId, { adoptEmpty: false });
        void this.sessions.askAgainForUnnamedStarts(machineId);
        if (this.openMissedSome(machineId)) {
          this.rereadAnnounced(machineId);
          return;
        }
        // This runs once the machine's first frame arrived (RealtimeSocket
        // prove), yet it still retires no claim itself: the reads below fire
        // the reports that are allowed to retire claims, each for the fact it
        // read.
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
   * `sessions.unread` the unread set; `pins.changed` the pins; `plugins.changed` the plugin manifest; `machine.status` (projects and
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
    this.pluginFleet.forgetMachine(machineId);
    this.refreshMachinePins(machineId);
    this.followPluginChanges(machineId);
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
      .filter((machine) => shouldRefreshMachineActivity(machine, this.state.machineStatuses[machine.id]))
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
    this.pluginFleet.machineFrame(machineId, event);
    this.applyBoardEvent(machineId, event);
    if (event.type === "pins.changed") this.refreshMachinePins(machineId);
    else if (event.type === "plugins.changed") this.followPluginChanges(machineId);
    else if (event.type === "sessions.unread") this.sessionUnread.applyEvent(machineId, event);
    else if (event.type === "machine.status") this.machineStatus.apply(machineId, event.status);
  }

  private handleRealtimeEvent(machineId: string, event: BrowserRealtimeEvent): void {
    this.pluginFleet.machineFrame(machineId, event);
    if (event.type === "pins.changed") this.refreshMachinePins(machineId);
    else if (event.type === "plugins.changed") this.followPluginChanges(machineId);
    else if (event.type === "sessions.unread") this.sessionUnread.applyEvent(machineId, event);
    else if (event.type === "machine.status") this.machineStatus.apply(machineId, event.status);
    else if (event.type === "workspace.changed") this.applyWorkspaceChanged(machineId, event.cwd);
    else if (isTerminalEvent(event)) {
      this.applyTerminalEvent(event);
      if (event.type === "terminal.exited") void this.refreshWorkspaceDeletionRuns();
    } else {
      this.applyBoardEvent(machineId, event);
      this.sessions.applyGlobalEvent(event);
    }
  }

  private applyBoardEvent(machineId: string, event: BrowserRealtimeEvent): void {
    const boardEvent = boardEventOf(event);
    if (boardEvent !== undefined) this.sessionBoards.applyEvent(machineId, boardEvent);
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

  /** Leaving a session ends the page's hold on its stream, so a run of it still open is no longer heard throughout. */
  private releaseHeldStream(previous: AppState, next: AppState): void {
    const left = previous.selectedSession;
    if (left === undefined) return;
    const machineId = selectedMachineId(previous);
    if (machineId !== selectedMachineId(next) || left.id !== next.selectedSession?.id) this.pluginFleet.streamLost(machineId, left.id);
  }

  private announceSessionSelection(previous: AppState, next: AppState): void {
    const facts = sessionSelectionFacts({ machineId: selectedMachineId(previous), session: previous.selectedSession }, { machineId: selectedMachineId(next), session: next.selectedSession });
    for (const fact of facts) this.plugins.emit(fact);
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
    this.mirrorSessionBoard();
    const pendingMachineId = this.pendingRemoteRouteRestore?.machineId ?? "local";
    if (pendingMachineId !== (next.selectedMachine?.id ?? "local")) this.clearPendingRemoteRouteRestore();
    this.sessions.clearActiveSession();
    this.realtime.close();
    this.connectRealtime();
    this.activeTerminalIds.clear();
    this.sessionCleanupDialog = undefined;
    this.setState({ piWebStatus: undefined });
    this.schedulePiWebStatusRefresh();
    void this.loadPluginsForSelectedMachine();
  }

  private refreshSelectedWorkspaceTool(tool: QualifiedContributionId): void {
    const resolved = this.plugins.resolveWorkspacePanelRouteId(tool, selectedMachineId(this.state));
    if (resolved === undefined || resolved === this.workspaceTerminalPage()) return;
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
        .tool=${this.shownWorkspaceToolId()}
        .panels=${this.visibleWorkspacePanels()}
        .globalPanels=${this.activeGlobalPanels()}
        .globalContext=${this.createGlobalPanelContext()}
        ?covered=${this.columnGoTo() && this.columnGoToOpen}
      >${this.columnGoTo() ? html`<app-column-bar
        slot="bar"
        .pageTitle=${this.columnGoToOpen ? "Go to" : this.pageTitleOf(this.shownPageId())}
        .leadingKey=${leadingKeyOf(this.cornerKeys(), "column")}
        ?goToKey=${this.cornerKeys().goTo === "column"}
        .onNavigationKey=${() => { this.openNavigationFromCanvas(); }}
        .onBack=${() => { this.goBackToGoTo(); }}
        .onGoTo=${() => { this.openGoTo(); }}
      ></app-column-bar>${this.columnGoToOpen ? html`<app-go-to-sheet slot="cover" placement="column" .destinations=${this.goToDestinations()} .onSelect=${(id: string) => { this.goTo(id); }} .onClose=${() => { this.columnGoToOpen = false; }}></app-go-to-sheet>` : null}` : null}</workspace-panel>
    `;
  }

  private renderNavigationPanelEdgeControl() {
    const constraints = this.resizablePanelConstraints("navigation");
    return html`
      <app-panel-edge-control
        side="navigation"
        controls="navigation-panel"
        resizeLabel="Resize navigation panel"
        .resizable=${!this.appShell.isMobileNavigationLayout}
        .panelWidth=${this.panelResize.panelWidth("navigation")}
        .minWidth=${constraints.minWidth}
        .maxWidth=${constraints.maxWidth}
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
   * chosen. Go to has to describe the state the reader sees, or it offers to
   * fold a column that is already gone.
   */
  private workspacePanelOnScreen(): boolean {
    return workspacePanelTakesSpace(
      this.panelCollapse.workspacePanelCollapsed,
      this.workspaceColumnHasContent(),
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
        .resizable=${!this.appShell.isMobileNavigationLayout}
        .panelWidth=${this.panelResize.panelWidth("workspace")}
        .minWidth=${constraints.minWidth}
        .maxWidth=${constraints.maxWidth}
        .onResizeStart=${() => this.startPanelResize("workspace")}
        .onResize=${(width: number) => { this.panelResize.resizePanel("workspace", width, { persist: false }); }}
        .onResizeEnd=${() => { this.panelResize.persistPanelSizes(); }}
        .onReset=${() => { this.resetResizablePanel("workspace"); }}
      ></app-panel-edge-control>
    `;
  }

  private startPanelResize(side: ResizablePanelSide): number {
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
   * The Navigate page the reader is looking at: the overlay while it is open, else the page drawn in
   * place, which is the whole screen when no session is open. Asking only the overlay made New
   * session with no project open do nothing on that screen (owner, 8505, 2026-10-13).
   */
  private shownNavigatePage(): AppNavigatePage | undefined {
    return this.navigateOpen ? this.navigatePage : this.inPageNavigatePage;
  }

  /**
   * The project a new session starts in, or undefined when the reader is asked (owner, 2026-10-14:
   * the reader must always know which project a new session goes to; New session under All
   * projects started in the project selected before, unseen). Every entry asks this one place, and
   * each names its answer before it is pressed. A list narrowed to a project starts there. A list
   * of all projects, a page browsing another machine (2026-10-09 on 8504: the session was created
   * on the machine left behind), or no project open has none: the reader chooses (R18).
   */
  private newSessionTarget(listedProjectId = this.listedProjectId()): Project | undefined {
    if (this.quickSwitcherBrowsingElsewhere() || listedProjectId === undefined) return undefined;
    return this.state.projects.find((project) => project.id === listedProjectId);
  }

  /**
   * The project the sessions on screen are narrowed to: the shown list's, or, with none on screen,
   * the open project's. A list kept in the page but not drawn - the phone's while a chat is open, a
   * collapsed desktop panel - is not on screen, and its narrowing is not what the reader sees.
   */
  private listedProjectId(): string | undefined {
    const page = this.shownNavigatePage();
    if (page !== undefined && page.getClientRects().length > 0) return page.listedProjectId;
    return this.canStartSession() ? this.state.selectedProject?.id : undefined;
  }

  /** New session from any entry: in the target project, or the picker when there is none. */
  private startNewSession(listedProjectId?: string): void {
    const target = this.newSessionTarget(listedProjectId);
    if (target === undefined) {
      this.chooseProjectForNewSession();
      return;
    }
    this.closeNavigate();
    void this.asReaderListChange(() => this.startSessionInProject(target));
  }

  /**
   * Add project on the Navigate page adds to the machine on screen: a browsed machine is moved to
   * first, and its plugins, which own the dialog, are awaited, since the move returns before they load.
   */
  private async addProjectOnShownMachine(): Promise<void> {
    this.navigation.begin();
    if (!(await this.moveToMachine(this.browsedMachineId()))) return;
    await this.loadPluginsForSelectedMachine();
    this.closeNavigate();
    this.openProjectDialog();
  }

  /** The projects a machine listed last: the selected machine's own list, or the one read while browsing it. */
  private projectsListedOn(machineId: string): readonly Project[] {
    return machineId === selectedMachineId(this.state) ? this.state.projects : this.projects.listed(machineId) ?? [];
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
    return quickSwitcherSessionStates([...this.quickSwitcherSessions, ...this.quickSwitcherPinnedElsewhere, ...this.state.sessions, ...this.sessions.pendingStartRowsOn(selectedMachineId(this.state))], this.state.sessionStatuses, this.state.sessionActivities);
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

  /**
   * The pinned projects of the machine being browsed, in the reader's order (R11): the machine's,
   * once it answered with them; until then, or from a machine that keeps none, this browser's.
   */
  private get pinnedProjectIds(): ReadonlySet<string> {
    const machineId = this.browsedMachineId();
    const machine = this.machinePinnedProjects(machineId);
    if (machine !== undefined) return machine;
    const cached = this.pinnedProjectCache;
    if (cached?.machineId === machineId) return cached.ids;
    const fresh = { machineId, ids: readPinnedProjectIds(machineId) };
    this.pinnedProjectCache = fresh;
    return fresh.ids;
  }

  private machinePinnedProjects(machineId: string): ReadonlySet<string> | undefined {
    this.pinnedSessionIdsFor(machineId);
    const cached = this.pinCache;
    return cached?.machineId === machineId ? cached.pinnedProjects : undefined;
  }

  /**
   * The reader dragged the projects into a new order (R11): the pinned ones are written to the
   * machine's pin file (or this browser's, for a machine that keeps none); the rest to its
   * projects file.
   */
  private reorderProjects(pinned: boolean, order: readonly string[]): void {
    if (!pinned) {
      void this.projects.reorderProjects(order);
      return;
    }
    const machineId = this.browsedMachineId();
    const ids = new Set(orderedIds([...this.pinnedProjectIds], order));
    this.showPinnedProjects(machineId, ids, (target) => sessionPinsApi.setPinnedProjectOrder([...ids], target));
  }

  private togglePinnedProject(projectId: string): void {
    const machineId = this.browsedMachineId();
    const ids = togglePinnedProjectId(this.pinnedProjectIds, projectId);
    this.showPinnedProjects(machineId, ids, (target) => sessionPinsApi.setProjectPinnedFlag(projectId, ids.has(projectId), target));
  }

  /**
   * Show the pinned projects at once, then write them where they live: the machine, which answers
   * with the set every device reads; or this browser, for a machine that keeps none. A write the
   * machine refused is followed by a read, so the mark never stays on a pin it does not hold.
   */
  private showPinnedProjects(machineId: string, ids: ReadonlySet<string>, write: (machineId: string) => Promise<MachinePins>): void {
    const cached = this.pinCache;
    if (cached?.machineId === machineId && cached.pinnedProjects !== undefined) {
      this.pinCache = { ...cached, pinnedProjects: ids };
      write(machineId)
        .then((answered) => { this.applyMachinePins(machineId, answered); })
        .catch(() => { this.refreshMachinePins(machineId); });
      return;
    }
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
   * The reader dragged the Pinned section into a new order (R11): the global pins on the machine-wide
   * list, the project's own where the list stands in a project that keeps them (B49), as the section
   * shows them. Optimistic, then the machine's answer, as a pin toggle is.
   */
  private reorderPinnedSessions(order: readonly string[], scopeProjectId: string | undefined): void {
    const machineId = this.browsedMachineId();
    const projectPins = this.projectPinnedSessionIdsFor(machineId, scopeProjectId);
    const cached = this.pinCache;
    if (projectPins === undefined || scopeProjectId === undefined) {
      const ids = new Set(orderedIds([...this.pinnedSessionIdsFor(machineId)], order));
      this.pinCache = cached?.machineId === machineId ? { ...cached, ids } : { machineId, ids };
      writePinnedSessionIds(machineId, ids);
    } else if (cached?.projects !== undefined) {
      this.pinCache = { ...cached, projects: new Map([...cached.projects, [scopeProjectId, new Set(orderedIds([...projectPins], order))]]) };
    }
    this.requestUpdate();
    const projectId = projectPins === undefined ? undefined : scopeProjectId;
    void sessionPinsApi.setOrder(order, machineId, projectId)
      .then((answered) => { this.applyMachinePins(machineId, answered); })
      .catch((error: unknown) => { this.setState(errorNoticePatch(error)); });
  }

  /** The project pin's toggle: optimistic, then the machine's answer, as the global pin's. */
  private toggleProjectPinnedSession(session: SessionInfo, projectId: string): void {
    const machineId = this.browsedMachineId();
    const cached = this.pinCache;
    const current = this.projectPinnedSessionIdsFor(machineId, projectId);
    const projects = cached?.projects;
    if (cached === undefined || projects === undefined || current === undefined) return;
    const next = togglePinnedSessionId(current, session.id);
    this.pinCache = { ...cached, projects: new Map([...projects, [projectId, next]]) };
    this.requestUpdate();
    void sessionPinsApi.setProjectPinned(session.id, projectId, next.has(session.id), machineId)
      .then((answered) => { this.applyMachinePins(machineId, answered); })
      .catch((error: unknown) => { this.setState(errorNoticePatch(error)); });
  }

  /**
   * Sessions whose agent is blocked on an extension dialog. They cannot make
   * any progress until the user replies, which is why the switcher lists them
   * above work that is merely running.
   */
  private waitingSessionIds(): ReadonlySet<string> {
    return sessionIdsIn(this.sessionStateKinds(), "asking");
  }

  private foregroundMachineList(): MachineListSurface | undefined {
    return foregroundMachineList({ blockingPage: this.machineAccessRequestId !== undefined, settings: this.settingsOpen, navigationOverlay: this.navigateOpen });
  }

  /** True while a modal layer owns the back gesture. */
  private modalLayerOpen(): boolean {
    return this.quickSwitcherOpen
      || this.navigateSelectionExit !== undefined
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
    const action = this.plugins.getReservedAction(this.createPluginRuntimeContext(), "add-project");
    if (action === undefined) return;
    this.startSessionAfterAddingProject = options.startSessionAfter === true;
    void action.run();
  }

  private hasAddProjectEntry(): boolean {
    return this.plugins.getReservedAction(this.createPluginRuntimeContext(), "add-project") !== undefined;
  }

  private hasAddMachineEntry(): boolean {
    return this.plugins.getReservedAction(this.createPluginRuntimeContext(), "add-machine") !== undefined;
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
  private toggleGoToSheet(openedFrom?: NavigateListScope): void {
    if (this.goToSheetOpen) { this.goToSheetOpen = false; return; }
    this.goToOpenedFrom = openedFrom;
    this.openGoToSheet();
  }

  private openGoToSheet(): void {
    dismissKeyboardIfRaised();
    this.goToSheetOpen = true;
    this.pushModalLayerFrame();
  }

  /**
   * Go to's destinations: the pages of the scope the reader is looking at (goToScope), each marked
   * when it is the page shown, then Actions… and Settings. The session list and the chat are not
   * among them (owner, 2026-10-14): the grid key and the way back reach them. A plugin page that
   * needs a project has no button while no project is in scope.
   */
  private goToDestinations(): GoToDestination[] {
    const pages = this.shellToolTabs(this.currentGoToScope());
    return [
      ...pages.map((tab) => ({ id: tab.id, label: tab.label, icon: tab.icon, badge: tab.badge, badgeLabel: tab.badgeLabel, selected: tab.selected })),
      { id: GO_TO_ACTIONS, label: "Actions…", icon: renderCommandIcon(), command: true },
      { id: GO_TO_SETTINGS, label: "Settings", icon: renderGearIcon(), command: true },
    ];
  }

  /** Go to's command lines by id; a destination that is not one of them is a view. */
  private readonly goToCommands: ReadonlyMap<string, () => void> = new Map([
    [GO_TO_ACTIONS, () => { this.openActionPalette(); }],
    [GO_TO_SETTINGS, () => { this.navigation.begin(); this.closeNavigate(); this.openSettings(); }],
  ]);

  /**
   * Every view destination closes the Navigate overlay first, as Settings does: a view chosen
   * under the overlay changed nothing the reader could see (owner report 2026-10-05).
   */
  private goTo(id: string): void {
    const command = this.goToCommands.get(id);
    if (command !== undefined) {
      command();
      return;
    }
    this.closeNavigate();
    this.openShellToolTab(id);
  }

  /**
   * The wide layout, where pages sit in their own column beside the chat: Go to belongs to that
   * column (owner, 2026-10-14). A touch screen under TOUCH_DESKTOP_MIN_PX is the phone's layout.
   */
  private columnGoTo(): boolean {
    return this.appShell.isDesktopSideBySideLayout && !this.appShell.isMobileNavigationLayout;
  }

  /** Which bar carries each corner key now (cornerKeys). */
  private cornerKeys(): CornerKeyBars {
    return cornerKeyBars({
      pagesInColumn: this.columnGoTo(),
      navigationPanelOpen: !this.appShell.isMobileNavigationLayout && !this.panelCollapse.navigationPanelCollapsed,
      columnOnScreen: this.columnGoTo() && this.workspacePanelOnScreen(),
      columnHoldsCanvas: this.workspacePanelHoldsCanvas(),
      pageShown: this.pageShown(),
    });
  }

  /** Whether a page, not the Go to list, fills the place pages show in: the column, or the main area where pages replace the chat. */
  private pageShown(): boolean {
    if (this.columnGoTo()) return this.workspacePanelOnScreen() && !this.columnGoToOpen && this.shownPageId() !== undefined;
    const view = this.displayMainView();
    return view !== "chat" && view !== "navigation";
  }

  /**
   * Go to, in the window's top-right corner, mirrors the grid key in the top-left (owner,
   * 2026-10-16): with no page or list on screen it opens the Go to list (the page column with the
   * list over it on the wide layout, the menu sheet elsewhere); with one on screen it closes it,
   * and the next Go to starts from the list again.
   */
  private openGoTo(): void {
    const run: Record<GoToAction, () => void> = {
      foldColumn: () => { this.foldColumn(); },
      openColumnList: () => { this.openColumnList(); },
      closePage: () => {
        this.selectMainView("chat");
        this.followCornerKeyFocus("goTo");
      },
      toggleSheet: () => { this.toggleGoToSheet(); },
    };
    run[goToAction({ pagesInColumn: this.columnGoTo(), columnOnScreen: this.workspacePanelOnScreen(), pageShown: this.pageShown() })]();
  }

  private foldColumn(): void {
    this.goToOpenedFrom = undefined;
    this.columnGoToOpen = false;
    this.panelCollapse.toggleWorkspacePanel();
    this.followCornerKeyFocus("goTo");
  }

  /** Back over a page: the Go to list it was opened from, in the column or as the menu sheet. */
  private goBackToGoTo(): void {
    this.goToOpenedFrom = undefined;
    if (this.columnGoTo()) {
      this.columnGoToOpen = true;
      return;
    }
    this.openGoToSheet();
  }

  /**
   * The menu sheet's grid key: the sheet closes and navigation opens as the grid key opens it on this
   * layout. Over the Navigate overlay navigation is already open, so only the sheet closes.
   */
  private openNavigationFromMenu(): void {
    this.goToSheetOpen = false;
    if (this.navigateOpen) return;
    if (!this.appShell.isMobileNavigationLayout) {
      this.panelCollapse.expandNavigationPanel();
      return;
    }
    if (this.displayMainView() !== "navigation") this.pressConversationGridKey();
  }

  /**
   * The menu sheet's Go to key closes the menu and, like Go to over a page, the page under it; over
   * the Navigate overlay the page waits under the overlay, so only the menu closes.
   */
  private closeMenu(): void {
    this.goToSheetOpen = false;
    if (this.pageShown() && !this.navigateOpen) this.selectMainView("chat");
    this.followCornerKeyFocus("goTo");
  }

  /** The page column with the Go to list over it, opening the column first when it is away. */
  private openColumnList(): void {
    this.goToOpenedFrom = undefined;
    this.panelCollapse.expandWorkspacePanel();
    this.columnGoToOpen = true;
    this.followCornerKeyFocus("goTo");
  }

  /** The grid key over the list on a page holding the whole canvas: the page gives the canvas back and the navigation panel opens beside it. */
  private openNavigationFromCanvas(): void {
    this.columnGoToOpen = false;
    this.setWorkspacePanelFullscreen(false);
    this.panelCollapse.expandNavigationPanel();
    this.followCornerKeyFocus("grid");
  }

  /**
   * A corner key the reader pressed can leave its bar: the bar folds away, or the key moves to the
   * bar now at its corner, and the keyboard focus fell to the page body (review of 791c27fe), or
   * stayed on a key its folded bar hides. Once the bars have rendered, focus follows to the key now
   * holding that corner, unless it already went somewhere visible.
   */
  private followCornerKeyFocus(key: keyof CornerKeyBars): void {
    void this.updateComplete.then(async () => {
      const bars = [...this.renderRoot.querySelectorAll<LitElement>("app-context-bar, app-navigate-page, app-column-bar")];
      await Promise.all(bars.map((bar) => bar.updateComplete));
      const focused = deepActiveElement(this.ownerDocument);
      if (focused !== null && focused !== this.ownerDocument.body && focused.getClientRects().length > 0) return;
      const visibleKey = (name: keyof CornerKeyBars) => bars
        .flatMap((bar) => [...(bar.shadowRoot?.querySelectorAll<HTMLElement>(`[data-corner-key="${name}"]`) ?? [])])
        .find((candidate) => candidate.getClientRects().length > 0);
      KEYS_AT_CORNER[key].map(visibleKey).find((candidate) => candidate !== undefined)?.focus();
    });
  }

  /** The page the column draws: a global page by its id, else the workspace page the panel falls back to as it does. */
  private shownPageId(): string | undefined {
    const shown = this.shownWorkspaceToolId();
    return this.activeGlobalPanels().some((panel) => panel.id === shown) ? shown : this.shownWorkspacePanel()?.id;
  }

  /** A page's name by its id, for the bar that names it. */
  private pageTitleOf(id: string | undefined): string {
    return [...this.visibleWorkspacePanels(), ...this.activeGlobalPanels()].find((panel) => panel.id === id)?.title ?? "";
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
    const projectPinnedIds = this.projectPinnedSessionIdsFor(machineId, state.selectedProject?.id);
    return {
      scope: { machineId, projectId: state.selectedProject?.id, folderPath: state.selectedWorkspace?.path, sessionId: state.selectedSession?.id },
      machines: state.machines.map((machine) => ({ id: machine.id, name: machine.name, reachability: this.machineProbes.view(machine) })),
      projects: projectChoices(browsingElsewhere ? this.projects.listed(machineId) ?? [] : state.projects),
      folders: [...state.workspaces, ...(this.quickSwitcherMachineId === machineId ? this.quickSwitcherWorkspaces : [])].map((workspace) => ({ id: workspace.id, label: workspace.label, path: workspace.path, projectId: workspace.projectId })),
      sessions,
      // Pins answer for the machine, not for the project the reader happens to
      // stand in: a session pinned from the global list vanished from Pinned
      // as soon as the page listed a project's sessions.
      pinned: dedupeById(browsingElsewhere ? [...this.quickSwitcherSessions, ...this.quickSwitcherPinnedElsewhere] : [...this.quickSwitcherSessions, ...sessions, ...this.quickSwitcherPinnedElsewhere])
        .filter((session) => pinnedIds.has(session.id))
        .map((session) => ({ session, machineId })),
      sessionStates: browsingElsewhere ? EMPTY_STATE_MAP : this.sessionStateKinds(),
      pinnedSessionIds: pinnedIds,
      projectPinnedSessionIds: projectPinnedIds,
      unreadSessionIds: browsingElsewhere ? EMPTY_ID_SET : this.unreadSessionIds,
      writtenSessionIds: browsingElsewhere ? EMPTY_ID_SET : writtenSessionIds(state.sessionStatuses),
      heldOpenSessionId: heldOpenSessionIn(this.openRowHold, machineId),
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

  /**
   * Go to on the navigation page: on a phone it opens the sheet over the page; on the page that
   * covers a desktop window it closes the page and opens the list where Go to opens it, so the
   * top-right corner holds Go to there too (review of 791c27fe). The desktop panel has none: Go to
   * stands in another bar at the window's corner.
   */
  private navigateGoToKey(overlay: boolean): ((scope: NavigateListScope) => void) | undefined {
    if (this.appShell.isMobileNavigationLayout) return (scope) => { this.toggleGoToSheet(scope); };
    if (!overlay) return undefined;
    return (scope) => {
      this.leaveNavigate();
      if (this.columnGoTo()) this.openColumnList();
      else this.toggleGoToSheet(scope);
    };
  }

  private renderNavigatePage(overlay: boolean) {
    const gridKey = navigateGridKey({ overlay, phone: this.appShell.isMobileNavigationLayout, hasChatSubject: this.hasChatSubject() });
    const onClose: Record<NavigateGridKey, () => void> = {
      return: () => { this.leaveNavigate(); },
      stay: () => { this.leaveNavigate(); },
      fold: () => { this.toggleShellPanel(); },
    };
    return html`<app-navigate-page
      .input=${this.navigateInput()}
      .pinnedProjectIds=${this.pinnedProjectIds}
      .gridKey=${gridKey}
      .onClose=${onClose[gridKey]}
      .onOpenGoTo=${this.navigateGoToKey(overlay)}
      .foreground=${this.foregroundMachineList() === (overlay ? "overlay" : "navigation")}
      .onMachinesVisibilityChange=${(owner: HTMLElement, visible: boolean) => { this.machineProbes.setVisible(owner, visible); }}
      .onChoose=${(level: NavigateLevel, id: string) => { void this.navigateChoose(level, id); }}
      .onWiden=${(level: NavigateLevel) => { void this.navigateWiden(level); }}
      .onOpenSession=${(session: SessionInfo, machineId: string) => { void this.openSessionFromQuickSwitcher(session, machineId); }}
      .opening=${this.navigation.view()}
      .onCreateSession=${(projectId: string | undefined) => { this.startNewSession(projectId); }}
      .newSessionTargetName=${(projectId: string | undefined) => (projectId === undefined ? undefined : this.newSessionTarget(projectId)?.name)}
      .onContinueFrom=${(session: SessionInfo, machineId: string) => { void this.continueInNewSession(session, machineId); }}
      .onAddProject=${this.hasAddProjectEntry() ? () => { void this.addProjectOnShownMachine(); } : undefined}
      .onAddMachine=${this.hasAddMachineEntry() ? () => { this.openMachineDialog(); } : undefined}
      .machineSessions=${this.withCreatingRows(this.quickSwitcherSessions, this.browsedMachineId())}
      .tilesPerRow=${chosenListTiles(this.listTiles, this.appShell.isMobileNavigationLayout ? "phone" : "desktop")}
      .onOpenSettings=${this.appShell.isMobileNavigationLayout ? undefined : () => { this.navigation.begin(); this.closeNavigate(); this.openSettings(); }}
      .boardAnswer=${this.quickSwitcherBoardAnswer}
      .loadingChoices=${this.navigateChoicesLoading()}
      .projectsProblem=${this.navigateChoicesLoading() ? this.projects.refusal(this.browsedMachineId()) : undefined}
      .canRenameSession=${true}
      .canArchiveSessions=${!this.quickSwitcherBrowsingElsewhere()}
      .canCloseProject=${!this.quickSwitcherBrowsingElsewhere()}
      .canManageMachines=${true}
      .onRowAction=${(kind: NavigateRowKind, id: string, action: NavigateRowActionId) => { void this.asReaderListChange(() => this.runNavigateRowAction(kind, id, action)); }}
      .readerChanging=${this.readerListChanges > 0}
      .onBulkAction=${(group: NavigateBulkGroup, action: NavigateBulkActionId, ids: readonly string[]) => this.asReaderListChange(() => this.runNavigateBulkAction(group, action, ids))}
      .onSelectingChange=${(exit: (() => void) | undefined) => { this.noteNavigateSelecting(exit); }}
      .onReorderPins=${(order: readonly string[], scopeProjectId: string | undefined) => { this.reorderPinnedSessions(order, scopeProjectId); }}
      .onReorderProjects=${(pinned: boolean, order: readonly string[]) => { this.reorderProjects(pinned, order); }}
      .onReorderMachines=${(order: readonly string[]) => { void this.machines.reorderMachines(order); }}
      .canReorderProjects=${!this.quickSwitcherBrowsingElsewhere()}
    >${this.renderAppRowSlot(overlay ? "navigate-overlay" : "navigation-view")}</app-navigate-page>`;
  }

  /** Whether the choices the page lists are still being read: the browsed machine's projects, or the selected machine's. */
  private navigateChoicesLoading(): boolean {
    if (this.state.machinesLoad !== "loaded") return true;
    const machineId = this.browsedMachineId();
    if (machineId !== selectedMachineId(this.state)) return this.projects.listed(machineId) === undefined;
    return this.state.projectsLoad !== "loaded" || this.state.isLoadingWorkspaces;
  }

  /** Run a change the reader asked for from the list, so the list knows the rows it moves are the reader's doing. */
  private async asReaderListChange<Result>(change: () => Promise<Result>): Promise<Result> {
    this.readerListChanges += 1;
    try {
      return await change();
    } finally {
      this.readerListChanges -= 1;
    }
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
      ?? this.quickSwitcherPinnedElsewhere.find((entry) => entry.id === id)
      ?? this.sessions.pendingStartRowsOn(this.browsedMachineId()).find((entry) => entry.id === id);
  }

  /** A machine row's own actions; Open is the shared one. */
  private readonly machineRowActions: Partial<Record<NavigateRowActionId, (machine: Machine) => void | Promise<void>>> = {
    rename: (machine) => { this.renamingMachine = machine; },
    "remove-machine": (machine) => this.removeMachine(machine),
  };

  /**
   * The row menu names an action; the shell performs it against the row's own
   * scope. A row acts on the thing it names, never on the current selection.
   */

  private async runNavigateRowAction(kind: NavigateRowKind, id: string, action: NavigateRowActionId): Promise<void> {
    const machineAction = kind === "machine" ? this.machineRowActions[action] : undefined;
    if (machineAction !== undefined) {
      const machine = this.state.machines.find((entry) => entry.id === id);
      if (machine !== undefined) await machineAction(machine);
      return;
    }
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
    if (action === "pin-project" || action === "unpin-project") {
      const session = this.listedSession(id);
      const projectId = this.state.selectedProject?.id;
      if (session !== undefined && projectId !== undefined) this.toggleProjectPinnedSession(session, projectId);
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
    if (action === "copy-path") {
      const listed = this.projectsListedOn(this.browsedMachineId()).find((entry) => entry.id === id);
      if (listed !== undefined) await writeClipboardText(listed.path);
      return;
    }
    const project = this.state.projects.find((entry) => entry.id === id);
    if (project === undefined) return;
    if (!(await this.confirm({ title: `Close ${project.name}?`, message: "This only removes it from PI WEB; the project folder does not change.", confirmLabel: "Close project", tone: "danger" }))) return;
    await this.projects.closeProject(project.id);
  }

  /**
   * The Navigate page started or ended selecting rows (state diagram D9). Starting pushes a
   * history frame, so the back gesture leaves the selection before it leaves the page.
   */
  private noteNavigateSelecting(exit: (() => void) | undefined): void {
    const entering = exit !== undefined && this.navigateSelectionExit === undefined;
    this.navigateSelectionExit = exit;
    if (entering) this.pushModalLayerFrame();
  }

  /**
   * A bulk action on the rows selected on the Navigate page, through the calls the row menu
   * uses for one row. A destructive one asks first; declining answers "cancelled", and the page
   * keeps the selection.
   */
  private async runNavigateBulkAction(group: NavigateBulkGroup, action: NavigateBulkActionId, ids: readonly string[]): Promise<SelectionOutcome> {
    const executors: Readonly<Record<string, ((ids: readonly string[]) => Promise<SelectionOutcome>) | undefined>> = this.navigateBulkExecutors()[group];
    const run = executors[action];
    return run === undefined ? "done" : run(ids);
  }

  private navigateBulkExecutors(): { readonly [Group in NavigateBulkGroup]: Readonly<Record<NavigateBulkActionIds[Group], (ids: readonly string[]) => Promise<SelectionOutcome>>> } {
    const sessionsOf = (ids: readonly string[]) => ids.flatMap((id) => { const session = this.listedSession(id); return session === undefined ? [] : [session]; });
    const reread = async (): Promise<SelectionOutcome> => { await this.loadQuickSwitcherData(true); return "done"; };
    return {
      live: {
        archive: async (ids) => { await this.sessions.archiveSessions(sessionsOf(ids)); return reread(); },
        pin: (ids) => { for (const session of sessionsOf(ids)) this.togglePinnedSession(session); return Promise.resolve("done"); },
        unpin: (ids) => { for (const session of sessionsOf(ids)) this.togglePinnedSession(session); return Promise.resolve("done"); },
        "mark-read": async (ids) => {
          const machineId = this.browsedMachineId();
          await Promise.all(sessionsOf(ids).map((session) => this.sessionUnread.acknowledge(machineId, session)));
          return "done";
        },
      },
      archived: {
        restore: async (ids) => { for (const session of sessionsOf(ids)) await this.sessions.restoreSession(session); return reread(); },
        "delete-archived": async (ids) => {
          const sessions = sessionsOf(ids);
          if (!(await this.confirm({ title: `Delete ${String(sessions.length)} archived session${sessions.length === 1 ? "" : "s"} permanently?`, message: "The archived sessions and their transcript files are removed. This cannot be undone.", confirmLabel: "Delete permanently", tone: "danger" }))) return "cancelled";
          await this.sessions.deleteArchivedSessions(sessions);
          return reread();
        },
      },
      projects: {
        pin: (ids) => { for (const id of ids) this.togglePinnedProject(id); return Promise.resolve("done"); },
        unpin: (ids) => { for (const id of ids) this.togglePinnedProject(id); return Promise.resolve("done"); },
        "close-project": async (ids) => {
          if (!(await this.confirm({ title: `Close ${String(ids.length)} project${ids.length === 1 ? "" : "s"}?`, message: "This only removes them from PI WEB; the project folders do not change.", confirmLabel: "Close projects", tone: "danger" }))) return "cancelled";
          for (const id of ids) await this.projects.closeProject(id);
          return "done";
        },
      },
    };
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
    if (level === "machine") { this.switchToMachine(id); return; }
    this.navigation.begin();
    const machineId = this.browsedMachineId();
    const chosen = this.projectsListedOn(machineId).find((entry) => entry.id === id);
    if (chosen === undefined || !(await this.moveToMachine(machineId, { updateUrl: false }))) return;
    const project = this.state.projects.find((entry) => entry.id === id) ?? chosen;
    await this.workspaces.selectProject(project);
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
    this.projects.browse(selectedMachineId(this.state));
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
   * Which machine the session-wide list is reading: always the machine the app is on (owner,
   * 2026-10-13: choosing a machine switches to it, and the lists show that machine). The staleness
   * guards below compare against it.
   */
  private browsedMachineId(): string {
    return selectedMachineId(this.state);
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

  /**
   * What a machine-wide list shows (the Navigate page, the quick switcher): the board's rows, and
   * this page's new sessions still being created on that machine, which the board cannot list yet;
   * the project's own list shows them the same way.
   */
  private withCreatingRows(sessions: readonly SessionInfo[], machineId: string): readonly SessionInfo[] {
    const creating = this.sessions.pendingStartRowsOn(machineId);
    return creating.length === 0 ? sessions : dedupeById([...creating, ...sessions]);
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
   * the app is on. Just after a machine switch the rows on screen can still be
   * the previous machine's board until the new one is read; rendering badges
   * beside them would attach this machine's facts to that machine's sessions,
   * so those rows carry none - absent, not falsely present.
   */
  private quickSwitcherBrowsingElsewhere(): boolean {
    return this.quickSwitcherMachineId !== undefined && this.quickSwitcherMachineId !== selectedMachineId(this.state);
  }

  /** Choosing a machine switches the app to it; its lists follow (owner, 2026-10-13). */
  private switchToMachine(machineId: string): void {
    this.navigation.begin();
    void this.moveToMachine(machineId);
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
      this.setState(noticePatch(noticeForReader("This folder's project is not in the project list.")));
      this.navigation.fail(seq);
      this.updateUrl();
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
    return this.moveToMachine(this.quickSwitcherMachineId ?? "", options);
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

  private async continueInNewSession(session: SessionInfo, machineId: string): Promise<void> {
    const forked = await this.sessions.continueInNewSession(session, machineId);
    if (forked !== undefined) await this.openSessionFromQuickSwitcher(forked, machineId);
  }

  /**
   * Open a session the reader tapped (D8, B29). The page stays where it is and the tapped row
   * answers until the session has something to show; then the list, the header and the
   * conversation change together. Only the latest intent commits, so a slow read the reader has
   * since walked away from moves nothing. The tap's opening look stays until the session is open:
   * its transcript, status and thinking levels each answered or failed (owner, 2026-10-14).
   *
   * A session browsed on another machine's tab lives on that machine: the app moves there
   * first, then selects, in that order.
   */
  private async openSessionFromQuickSwitcher(session: SessionInfo, machineId = this.rowsMachineId()): Promise<FleetOpenResult> {
    const key = machineSessionKey(machineId, session.id);
    if (this.navigation.isOpening(key)) return "superseded";
    const seq = this.navigation.begin({ key, label: sessionLabel(session) });
    if (!this.sessions.canOpenAtOnce(session, machineId)) {
      try {
        await this.sessions.readFirstPage(session, machineId);
      } catch (error) {
        if (!isSessionNotFoundError(error)) {
          this.navigation.fail(seq);
          this.nameMachineAfterSupersededMove();
          return "machineUnreachable";
        }
      }
      if (!this.navigation.isCurrent(seq)) return "superseded";
    }
    const machineBefore = selectedMachineId(this.state);
    const moved = await this.moveToMachine(machineId, { updateUrl: false });
    if (!moved) {
      this.navigation.fail(seq);
      this.nameMachineAfterSupersededMove();
      return "machineUnknown";
    }
    if (!this.navigation.isCurrent(seq)) {
      if (selectedMachineId(this.state) !== machineBefore) this.nameMachineAfterSupersededMove();
      return "superseded";
    }
    await this.sessions.placePendingStartRow(session, () => this.navigation.isCurrent(seq));
    if (!this.navigation.isCurrent(seq)) return "superseded";
    this.closeNavigate();
    this.quickSwitcherOpen = false;
    this.showView("chat", { updateUrl: false });
    const selecting = this.sessions.selectSession(session, { updateUrl: false });
    this.updateUrl({ forcePush: true });
    await this.sessions.untilSelectionSettles({ machineId: selectedMachineId(this.state), cwd: session.cwd, sessionId: session.id });
    this.navigation.settle(seq);
    await selecting;
    await this.sessions.untilGoneLocated();
    const verdict = fleetOpenVerdict({
      current: this.navigation.isCurrent(seq),
      machineId,
      sessionId: session.id,
      selectedMachineId: selectedMachineId(this.state),
      selectedSessionId: this.state.selectedSession?.id,
      sessionTarget: this.state.sessionTarget,
    });
    if (verdict === "opened") await this.focusComposerAfterRender();
    return verdict;
  }

  /**
   * A new session is a reader intent (D8): it supersedes an open still loading. It opens as an empty
   * draft chat; the session is created on the machine by its first message.
   */
  private async startSessionAndOpenChat(shouldComplete: () => boolean = () => true): Promise<void> {
    const seq = this.navigation.begin();
    this.sessions.startSession();
    if (!this.navigation.isCurrent(seq) || !shouldComplete()) return;
    if (this.state.mainView !== "chat") this.showView("chat");
    await this.focusComposerAfterRender();
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
        .onAbort=${() => this.abortTreeAndReturnQueued()}
        .onCancel=${() => { this.closeSessionTreeNavigator(); }}
      ></session-tree-navigator>
    `;
  }

  private shownWorkspacePanel(): QualifiedWorkspacePanelContribution | undefined {
    return shownWorkspacePanel(this.visibleWorkspacePanels(), this.shownWorkspaceToolId());
  }

  /**
   * The page id the chosen tool stands for. The tool can be a slot the core names, such as the
   * workspace files slot a fresh page starts on, and a slot is not a page id until the plugin
   * that claims it is loaded, so every comparison against page ids reads it through here.
   */
  private shownWorkspaceToolId(): QualifiedContributionId {
    return this.resolvePageRouteId(this.state.workspaceTool) ?? this.state.workspaceTool;
  }

  /** The request alone never decides it: see `workspacePanelCanvas.ts`. */
  private workspacePanelHoldsCanvas(): boolean {
    return workspacePanelHoldsCanvas({
      requested: this.workspacePanelFullscreen,
      windowShowsCanvas: this.appShell.isDesktopSideBySideLayout,
      panelOnScreen: this.workspacePanelOnScreen(),
      tool: this.shownWorkspaceToolId(),
      shown: this.shownWorkspacePanel(),
    });
  }

  /** The machine on screen's global pages, visible or not: the panel renders a chosen one either way. */
  private activeGlobalPanels(): QualifiedGlobalPanelContribution[] {
    return this.plugins.getActiveGlobalPanels(selectedMachineId(this.state));
  }

  /** The global pages Go to offers on the machine on screen (docs/design/go-to-scopes.md). */
  private visibleGlobalPanels(): QualifiedGlobalPanelContribution[] {
    const context = this.createGlobalPanelContext();
    const surfaces = this.openSessionSurfaces();
    return this.activeGlobalPanels().filter((panel) => (panel.visible?.(context) ?? true) && frontedPageShown(panel.fronts, surfaces));
  }

  /** Whether `id` is a global page of the machine on screen; another machine's page id is not. */
  private isGlobalPage(id: string): boolean {
    return this.activeGlobalPanels().some((panel) => panel.id === id);
  }

  /** The right-hand column has a page to show: a workspace's, or a chosen global page. One predicate for the column and its edge control. */
  private workspaceColumnHasContent(): boolean {
    return this.state.selectedWorkspace !== undefined || this.isGlobalPage(this.state.workspaceTool);
  }

  /**
   * What a global page is handed: the machine, never a project. Its terminals are the machine's,
   * in the home folder; the one on screen is kept in the tab.
   */
  private createGlobalPanelContext(): GlobalPanelContext {
    const machine = pluginMachineFromState(this.state);
    const sessions = machineTerminalSessions(machine.id);
    const selected = this.selectedMachineTerminal;
    return {
      machine,
      state: this.state,
      host: this.createWorkspaceHost(),
      terminal: {
        sessions,
        selectedId: selected?.machineId === machine.id ? selected.terminalId : undefined,
        autoStart: true,
        select: (terminalId) => { this.selectedMachineTerminal = terminalId === undefined ? undefined : { machineId: machine.id, terminalId }; },
        open: (options) => { this.openGlobalTerminal(machine.id, options?.terminalId); },
        runInNewTerminal: async (input) => { await this.runInNewMachineTerminal(machine.id, input); },
      },
      checkForPiWebUpdates: () => this.piWebStatusController.checkForUpdates(),
      openUpdateCommandSetting: () => {
        this.settingsReveal = "update-command";
        this.openSettings("general");
      },
    };
  }

  /**
   * A global page's command in a new home-folder shell: the page opens as soon as the shell exists,
   * so the tap answers at once. The machine's session daemon types the command when it can
   * (startCommandTypist); what became of a command that did not run as asked is said in the app row,
   * or, for a command this page could not type, in its own dialog with the command
   * (reportRunInNewTerminal; review triage, go-to-global-pages: Run used to stay silent). A runtime
   * held without the capability is read again first, and kept: it may date from before the daemon
   * was updated, or from a moment the machine did not answer (reviews b5709bee P2-2, d3c7f62a P2-4).
   * The Terminal page opens only while the command's machine is still the one on screen: a reader
   * who moved on stays where they are (D8), and another machine's page is never shown for it.
   */
  private async runInNewMachineTerminal(machineId: string, input: NewTerminalCommand): Promise<void> {
    const runtime = await this.startCommandRuntime(machineId);
    const openIfStillHere = (terminalId: string | undefined): void => {
      if (selectedMachineId(this.state) === machineId) this.openGlobalTerminal(machineId, terminalId);
    };
    try {
      await runInNewMachineTerminal(machineId, input, startCommandTypist(runtime), openIfStillHere);
    } catch (error) {
      const report: RunInNewTerminalReport = error instanceof RunInNewTerminalFailure ? error.report : { kind: "row", text: `${input.title} did not run: ${error instanceof Error ? error.message : "the terminal failed"}` };
      this.reportRunInNewTerminal(machineId, report);
      throw error;
    }
  }

  private async startCommandRuntime(machineId: string): Promise<MachineRuntime | undefined> {
    const cached = this.state.machineRuntimes[machineId];
    if (startCommandTypist(cached) === "daemon") return cached;
    try {
      const read = await api.runtime(machineId, true);
      this.setState({ machineRuntimes: { ...this.state.machineRuntimes, [read.machineId]: read } });
      return read;
    } catch {
      return cached;
    }
  }

  /**
   * A command this page could not type gets one dialog: a newer one replaces it, so the open dialog
   * is always the latest press's shell (review d3c7f62a, P2-6). Its Open Terminal moves to the
   * command's machine first, as a session opened from another machine's list does (moveToMachine).
   */
  private reportRunInNewTerminal(machineId: string, report: RunInNewTerminalReport): void {
    if (report.kind === "row") {
      this.setState(noticePatch(noticeForReader(report.text)));
      return;
    }
    this.commandNotRunDialog?.close();
    this.commandNotRunDialog = showCommandNotRun({
      showDialog: (dialog) => this.openPluginDialog(dialog),
      copyText: (text) => writeClipboardText(text),
      openTerminal: () => { void this.openMachineShell(machineId, report.terminalId); },
    }, report.outcome, report.input, this.machineName(machineId));
  }

  private async openMachineShell(machineId: string, terminalId: string): Promise<void> {
    if (!await this.moveToMachine(machineId)) return;
    if (selectedMachineId(this.state) !== machineId) return;
    await this.loadPluginsForSelectedMachine();
    if (selectedMachineId(this.state) === machineId) this.openGlobalTerminal(machineId, terminalId);
  }

  /** The global Terminal page, on `terminalId` when given; reached by its slot name, never a plugin id. */
  private openGlobalTerminal(machineId: string, terminalId: string | undefined): void {
    if (terminalId !== undefined) this.selectedMachineTerminal = { machineId, terminalId };
    const page = this.plugins.resolveGlobalPanelRouteId(GLOBAL_TERMINAL_SLOT, machineId);
    if (page === undefined) {
      this.setState(noticePatch(noticeForReader("This machine has no global Terminal page to show the shell on")));
      return;
    }
    this.selectMainView(page);
  }

  /**
   * Go to's scope now (goToScope): the Navigate page's switch when one opened it, else what is
   * open - a project's session or page, or a global page, or nothing.
   */
  private currentGoToScope(): GoToScope {
    const mobile = this.appShell.isMobileNavigationLayout;
    const view = this.displayMainView();
    const shownPageId = mobile ? (view === "chat" || view === "navigation" ? undefined : view) : this.shownWorkspaceToolId();
    return goToScope({
      workspaceProjectId: this.state.selectedWorkspace?.projectId,
      openedFrom: this.goToOpenedFrom,
      sessionOnScreen: this.hasChatSubject() && (!mobile || view === "chat"),
      shownPage: this.shownPageKind(shownPageId),
    });
  }

  private shownPageKind(id: string | undefined): ShownPageKind {
    if (id === undefined) return undefined;
    if (this.isGlobalPage(id)) return "global";
    return this.state.selectedWorkspace === undefined ? undefined : "project";
  }

  private visibleWorkspacePanels(): QualifiedWorkspacePanelContribution[] {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return [];
    const context = this.createWorkspacePanelContext(workspace);
    const surfaces = this.openSessionSurfaces();
    const declared = this.plugins.getWorkspacePanels().filter((panel) => (panel.visible?.(context) ?? true) && frontedPageShown(panel.fronts, surfaces));
    const fronted = new Set([...declared, ...this.visibleGlobalPanels()].flatMap((panel) => (panel.fronts === undefined ? [] : [panel.fronts])));
    return [...declared, ...extensionWidgetPanels(this.openSessionStanding(this.state)?.widgets, fronted)];
  }

  /**
   * Why the selected machine's projects are not listed, when a server said so: the list shows the
   * reason instead of nothing (absence is not negation). Silence adds nothing; the app row speaks for it.
   */
  private projectsRefusal(): { projectsProblem?: string } {
    if (this.state.projectsLoad === "loaded") return {};
    const refusal = this.projects.refusal(selectedMachineId(this.state));
    return refusal === undefined ? {} : { projectsProblem: refusal };
  }

  private workspacePanelEmptyState(): WorkspacePanelEmptyState {
    const project = this.state.selectedProject;
    if (this.state.projectsLoad !== "loaded") return UNKNOWN_YET;
    if (project === undefined) {
      return this.state.projects.length === 0
        ? {
            kind: "message",
            title: "No projects yet",
            body: "Use Actions → Add Project to add a folder. A project's tools appear here once you choose it.",
          }
        : {
            kind: "message",
            title: "Select a project",
            body: "Choose a project from the sidebar to use its tools.",
          };
    }
    if (this.state.isLoadingWorkspaces) return UNKNOWN_YET;
    if (this.state.workspaces.length === 0) {
      return {
        kind: "message",
        title: "Project folder not available",
        body: `${project.name}'s folder could not be opened. Try selecting the project again or re-adding it.`,
      };
    }
    return {
      kind: "message",
      title: "Open the project",
      body: `Open ${project.name} to use its tools.`,
    };
  }

  private sessionEmptyMessage(): string {
    if (this.state.projectsLoad !== "loaded") return "";
    if (this.state.selectedWorkspace !== undefined) return "Select or start a session.";
    if (this.state.selectedProject !== undefined) return "Open the project to start a session.";
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

  /** Where the open session will start, while it has not: its project and machine, said in its title and its empty state. */
  private startsIn(): { project: string; machine: string } | undefined {
    const session = this.state.selectedSession;
    if (!isTransientNewSessionInfo(session, this.state.status)) return undefined;
    const project = this.state.selectedProject?.name;
    return project === undefined ? undefined : { project, machine: this.machineName(selectedMachineId(this.state)) };
  }

  /** Ask which project a new session starts in: the machine's projects, or a new one. */
  private chooseProjectForNewSession(): void {
    this.newSessionSheetOpen = true;
  }

  private renderNewSessionSheet(): TemplateResult | null {
    if (!this.newSessionSheetOpen) return null;
    const close = (): void => {
      this.newSessionSheetOpen = false;
      this.closeNavigate();
    };
    return html`<new-session-project-sheet
      .projects=${this.state.projects}
      .projectsLoad=${this.state.projectsLoad}
      .lastUsedId=${this.recentProject()?.id}
      ?canAddProject=${this.hasAddProjectEntry()}
      .onChoose=${(project: Project) => { close(); void this.startSessionInProject(project); }}
      .onAddProject=${() => { close(); this.openProjectDialog({ startSessionAfter: true }); }}
      .onClose=${() => { this.newSessionSheetOpen = false; }}
    ></new-session-project-sheet>`;
  }

  /** Text-safe badge for a page line; rich badges stay in list rows. */
  private pageBadge(panel: QualifiedWorkspacePanelContribution | QualifiedGlobalPanelContribution): string | number | undefined {
    const badge: unknown = this.isGlobalPage(panel.id) ? this.globalPageBadge(panel.id) : this.projectPageBadge(panel.id);
    if (typeof badge === "number") return badge;
    return typeof badge === "string" ? badge : undefined;
  }

  private globalPageBadge(id: QualifiedContributionId): unknown {
    return this.plugins.getGlobalPanels().find((panel) => panel.id === id)?.badge?.(this.createGlobalPanelContext());
  }

  private projectPageBadge(id: QualifiedContributionId): unknown {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return undefined;
    return this.plugins.getWorkspacePanels().find((panel) => panel.id === id)?.badge?.(this.createWorkspacePanelContext(workspace));
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
      projects: projectChoices(state.projects),
      projectsLoad: state.projectsLoad,
      ...this.projectsRefusal(),
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
      () => { void this.refreshWorkspaceFilesPage(); },
      workspaceEffectiveUploadFolder(workspace.effectiveConfig, this.workspaceUploadFolderFallback),
    );
  }

  private setWorkspacePanelFullscreen(fullscreen: boolean): void {
    if (this.workspacePanelFullscreen === fullscreen) return;
    if (fullscreen && !workspacePanelMayHoldCanvas(this.shownWorkspaceToolId(), this.shownWorkspacePanel())) return;
    this.workspacePanelFullscreen = fullscreen;
    if (this.routeRestoreDepth === 0 && this.state.mainView !== "chat" && this.state.mainView !== "navigation") {
      setNamespacedQueryKey(WORKSPACE_ROUTE_NAMESPACE, "expanded", fullscreen ? "1" : undefined);
      this.rememberCurrentMachineNavigation();
    }
  }

  private createWorkspaceHost(): WorkspaceHost {
    return {
      requestRender: () => { this.requestUpdate(); },
      workspacePanelFullscreen: () => this.workspacePanelHoldsCanvas(),
      workspacePanelFullscreenAvailable: () => this.appShell.isDesktopSideBySideLayout,
      setWorkspacePanelFullscreen: (fullscreen) => { this.setWorkspacePanelFullscreen(fullscreen); },
      refreshAppData: () => this.refreshAppData(),
    };
  }

  private createWorkspacePanelContext(workspace: Workspace): WorkspacePanelContext {
    const machine = pluginMachineFromState(this.state);
    const machineId = machine.id;
    const createContext = (binding: WorkspacePluginBinding): WorkspacePanelContext => {
      const terminalCommandRuns = this.terminalCommandRunsForOrigin(binding.registrationPluginId, machineId);
      const backend = createPluginWorkspaceBackend(binding, workspace, machineId);
      const session = this.pluginPanelSession(binding, machineId);
      const composer = this.pluginPanelComposer(binding);
      return installWorkspacePanelScope({
        machine,
        workspace,
        state: this.state,
        files: this.createWorkspaceFiles(workspace, machineId),
        ...(backend === undefined ? {} : { backend }),
        ...(session === undefined ? {} : { session }),
        ...(composer === undefined ? {} : { composer }),
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

  /** The session on screen for a page whose plugin declared session commands; none for any other page. */
  private pluginPanelSession(binding: WorkspacePluginBinding, machineId: string): PluginPanelSession | undefined {
    const declared = binding.sessionCommands;
    const session = this.state.selectedSession;
    if (declared === undefined || session === undefined) return undefined;
    return { id: session.id, runCommand: (request) => this.sessions.runPluginCommand(machineId, declared, request) };
  }

  /** The draft and Send of the session on screen for any page, bound to that session; none with no session open or an archived one, which has no composer. */
  private pluginPanelComposer(binding: WorkspacePluginBinding): PluginPanelComposer | undefined {
    const session = this.state.selectedSession;
    if (session === undefined || session.archived === true) return undefined;
    return createPanelComposer({
      bound: { machineId: selectedMachineId(this.state), sessionId: session.id },
      via: binding.sourcePluginId,
      shownScope: () => {
        const shown = this.state.selectedSession;
        return shown === undefined ? undefined : { machineId: selectedMachineId(this.state), sessionId: shown.id };
      },
      mountedComposer: () => this.promptEditor,
      sessionCwd: () => composerCwd(this.state),
      sessionActivity: () => this.state.status,
      onOutgoingWritten: this.handleOutgoingWritten,
    });
  }

  /** Refresh the page that claims the workspace files slot; with no such page there is nothing to refresh. */
  private async refreshWorkspaceFilesPage(): Promise<void> {
    const page = this.plugins.resolveWorkspacePanelRouteId(WORKSPACE_FILES_SLOT, selectedMachineId(this.state));
    if (page !== undefined) await this.invalidateWorkspacePanels(page);
  }

  private invalidateWorkspacePanels(panelId?: QualifiedContributionId): Promise<void> {
    const workspace = this.state.selectedWorkspace;
    if (workspace === undefined) return Promise.resolve();
    return this.plugins.invalidateWorkspacePanels(this.createWorkspacePanelContext(workspace), panelId);
  }

  /** The key a search box names in its placeholder: none on the phone layout, where nobody presses it. */
  private openerShortcutOf(actionId: string): string | undefined {
    return this.appShell.isMobileNavigationLayout ? undefined : this.shortcutOf(actionId);
  }

  /** The key the reader has bound to an action now, or undefined when it has none. */
  private shortcutOf(actionId: string): string | undefined {
    return this.getActions().find((action) => action.id === actionId)?.shortcut;
  }

  private getActions(): AppAction[] {
    return applyActiveShortcutPreferences(this.getDefaultActions(), this.shortcutConfig);
  }

  private getDefaultActions(): AppAction[] {
    const actions = [...this.plugins.getActions(this.createPluginRuntimeContext()), ...this.workspaceSurfaceActions(), ...this.sessionActions(), ...this.navigationFocusActions(), ...this.panelLayoutActions()];
    return [...actions, ...this.extensionShortcutActionsFor(actions)];
  }

  /**
   * The open session's pi extension shortcuts (slice 4), from the status read for that session
   * only: another session's shortcuts are never offered. A key PI WEB or the reader already uses
   * stays theirs.
   */
  private extensionShortcutActionsFor(actions: readonly AppAction[]): AppAction[] {
    const session = this.state.selectedSession;
    const status = this.state.status;
    if (session === undefined || status?.sessionId !== session.id) return [];
    const shortcuts = status.extensionShortcuts ?? [];
    if (shortcuts.length === 0) return [];
    const machineId = selectedMachineId(this.state);
    const taken = applyActiveShortcutPreferences([...actions], this.shortcutConfig).flatMap((action) => (action.shortcut === undefined ? [] : [action.shortcut]));
    return extensionShortcutActions(shortcuts, taken, async (key) => {
      try {
        await api.runExtensionShortcut(session, key, machineId);
      } catch (error) {
        this.setState(errorNoticePatch(error));
      }
    });
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
        // VS Code's keys (owner, 2026-10-08): mod+p is quick open, straight to a
        // session; mod+shift+p opens the action palette (core plugin).
        shortcut: "mod+p",
        group: "Sessions",
        run: () => { this.openQuickSwitcher(); },
      },
      {
        id: "app.sessions.new",
        title: "New session",
        description: "Start a session in the project the list shows, or choose one",
        shortcut: "mod+shift+n",
        group: "Sessions",
        run: () => { this.startNewSession(); },
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
        title: "Reset side panel size",
        description: "Restore the side panel to its default width",
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
      if (!this.themePluginsSettled) {
        this.themePluginsSettled = true;
        this.applyPreferredTheme(false);
      }
    });
    this.gatewayPluginLoadPromise = load;
    return load;
  }

  private loadExternalPlugins(attempt = 0): Promise<boolean> {
    return this.registerExternalPlugins("PI WEB plugins", "local", () => loadExternalPlugins("pi-web-plugins/manifest.json", {
      shouldLoadPlugin: (entry) => !this.plugins.hasPlugin(entry.id),
      attempt,
    }));
  }

  /** The plugins each machine's manifest loaded into this page, so a toggle can dispose exactly those and never a core one. */
  private readonly externalPluginIds = new Map<string, Set<string>>();
  private readonly pluginFollows = new Map<string, Promise<void>>();

  /**
   * A machine said its running plugins changed (B19 slice C): read its manifest again, load what
   * was turned on and dispose what was turned off, one follow per machine at a time. A remote
   * machine whose plugins this page never loaded has nothing on the page to follow.
   */
  private followPluginChanges(machineId: string): void {
    const previous = this.pluginFollows.get(machineId) ?? Promise.resolve();
    const next = previous.then(() => this.reconcilePagePlugins(machineId)).catch((error: unknown) => { console.warn(`Could not follow the plugin change on ${machineId}`, error); });
    this.pluginFollows.set(machineId, next);
  }

  private async reconcilePagePlugins(machineId: string): Promise<void> {
    if (machineId === LOCAL_MACHINE_ID) {
      await this.registerExternalPlugins("PI WEB plugins", LOCAL_MACHINE_ID, () => loadExternalPlugins("pi-web-plugins/manifest.json", {
        shouldLoadPlugin: (entry) => !this.plugins.hasPlugin(entry.id),
      }));
      return;
    }
    const machine = this.state.machines.find((candidate) => candidate.id === machineId);
    if (machine?.kind !== "remote" || !this.loadedMachinePluginIds.has(machineId)) return;
    await this.registerExternalPlugins(`PI WEB plugins from ${machine.name}`, machineId, () => loadExternalPlugins(`api/machines/${encodeURIComponent(machineId)}/pi-web-plugins/manifest.json`, {
      machineId,
      shouldLoadPlugin: (entry) => !this.plugins.hasPlugin(machineScopedPluginId(machineId, entry.id))
        && this.plugins.shouldLoadRemotePlugin(entry.id, entry.machineSpecific),
    }));
  }

  /**
   * Dispose what this machine's manifest loaded and no longer lists, and forget the load failures of
   * plugins it no longer lists (a plugin that failed and was then turned off has nothing to fail);
   * a load that read no manifest disposes and forgets nothing.
   */
  private disposeUnlistedPlugins(machineId: string, listed: readonly string[] | undefined): void {
    if (listed === undefined) return;
    const keep = new Set(listed);
    const loaded = this.externalPluginIds.get(machineId) ?? new Set<string>();
    for (const pluginId of [...loaded]) {
      if (keep.has(pluginId)) continue;
      this.plugins.disposePlugin(pluginId);
      loaded.delete(pluginId);
    }
    const runtimeIdOf = (sourceId: string): string => (machineId === LOCAL_MACHINE_ID ? sourceId : machineScopedPluginId(machineId, sourceId));
    for (const sourceId of [...(this.pluginLoadFailures.get(machineId)?.keys() ?? [])]) {
      if (!keep.has(runtimeIdOf(sourceId))) this.setPluginLoadFailure(machineId, sourceId, undefined);
    }
  }

  /** A plugin already running gets its machine's changed settings; one whose settings are unchanged hears nothing. */
  private followPluginSettings(settingsById: ReadonlyMap<string, PluginSettings | undefined> | undefined): void {
    for (const [pluginId, settings] of settingsById ?? []) {
      if (!this.plugins.hasPlugin(pluginId)) continue;
      if (JSON.stringify(canonicalJson(this.plugins.pluginSettings(pluginId) ?? {})) === JSON.stringify(canonicalJson(settings ?? {}))) continue;
      this.plugins.applyPluginSettings(pluginId, settings ?? {});
    }
  }

  /** Whether the machine in Settings applies a plugin toggle live, so the page follows it and needs no reload. */
  private settingsMachineFollowsToggles(): boolean {
    return supportsPiWebCapability(this.selectedMachineRuntime(), PI_WEB_CAPABILITIES.livePluginToggle);
  }

  /** One retry of every plugin still missing: this machine's, then the selected remote machine's. */
  private async retryMissingPlugins(attempt: number): Promise<boolean> {
    const local = await this.loadExternalPlugins(attempt);
    if (local) this.gatewayPluginLoadPromise = Promise.resolve();
    const machine = this.state.selectedMachine;
    if (machine?.kind !== "remote" || this.loadedMachinePluginIds.has(machine.id)) return local;
    await this.loadPluginsForMachine(machine, attempt);
    return local && this.loadedMachinePluginIds.has(machine.id);
  }

  /** Whether a plugin that may draw this machine's messages failed to load in this tab. */
  private pluginsIncomplete(machineId: string): boolean {
    return [machineId, "local"].some((id) => (this.pluginLoadFailures.get(id)?.size ?? 0) > 0);
  }

  private async loadPluginsForSelectedMachine(): Promise<void> {
    await this.ensureGatewayPluginsLoaded();
    const machine = this.state.selectedMachine;
    if (machine?.kind !== "remote") return;
    await this.loadPluginsForMachine(machine);
  }

  private async loadPluginsForMachine(machine: Machine, attempt = 0): Promise<void> {
    await this.ensureGatewayPluginsLoaded();
    if (machine.kind !== "remote" || this.loadedMachinePluginIds.has(machine.id)) return;
    const runtime = this.state.machineRuntimes[machine.id];
    if (runtime?.ok === true && !supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.pluginLifecycle)) {
      console.warn(`PI WEB plugins from ${machine.name} require a matching plugin lifecycle capability; update and restart PI WEB on that machine`);
      return;
    }
    const existing = this.machinePluginLoadPromises.get(machine.id);
    if (existing !== undefined) return existing;

    const load = this.registerExternalPlugins(`PI WEB plugins from ${machine.name}`, machine.id, () => loadExternalPlugins(`api/machines/${encodeURIComponent(machine.id)}/pi-web-plugins/manifest.json`, {
      machineId: machine.id,
      shouldLoadPlugin: (entry) => !this.plugins.hasPlugin(machineScopedPluginId(machine.id, entry.id))
        && this.plugins.shouldLoadRemotePlugin(entry.id, entry.machineSpecific),
      attempt,
    }))
      .then((loaded) => { if (loaded) this.loadedMachinePluginIds.add(machine.id); })
      .finally(() => { this.machinePluginLoadPromises.delete(machine.id); });
    this.machinePluginLoadPromises.set(machine.id, load);
    await load;
  }

  private async registerExternalPlugins(label: string, machineId: string, load: () => Promise<ExternalPluginLoadResult>): Promise<boolean> {
    try {
      const result = await load();
      this.disposeUnlistedPlugins(machineId, result.listed);
      let complete = result.failures.length === 0;
      for (const failure of result.failures) {
        console.warn(`Failed to load PI WEB plugin ${failure.entry.id} (${failure.entry.module})`, failure.error);
        this.notePluginLoadFailure(machineId, failure.entry.id, failure.error);
      }
      for (const registration of result.registrations) {
        if (this.plugins.hasPlugin(registration.id)) continue;
        try {
          this.plugins.register(registration);
          this.externalPluginIds.set(machineId, new Set([...(this.externalPluginIds.get(machineId) ?? []), registration.id]));
          this.setPluginLoadFailure(machineId, registration.sourcePluginId ?? registration.id, undefined);
        } catch (error) {
          complete = false;
          console.warn(`Failed to register PI WEB plugin ${registration.id}`, error);
          this.notePluginLoadFailure(machineId, registration.sourcePluginId ?? registration.id, error);
        }
      }
      this.followPluginSettings(result.settings);
      this.applyPreferredTheme(false);
      this.requestUpdate();
      if (!complete) this.pluginRetry.failed();
      return complete;
    } catch (error) {
      console.warn(`Failed to load ${label}`, error);
      this.pluginRetry.failed();
      return false;
    }
  }

  private notePluginLoadFailure(machineId: string, pluginId: string, error: unknown): void {
    this.setPluginLoadFailure(machineId, pluginId, describeError(error));
  }

  /** Record or clear one plugin's load failure; each change is a new map, so the open Settings sees it. */
  private setPluginLoadFailure(machineId: string, pluginId: string, failure: string | undefined): void {
    if (failure === undefined && this.pluginLoadFailures.get(machineId)?.has(pluginId) !== true) return;
    const failures = new Map(this.pluginLoadFailures.get(machineId));
    if (failure === undefined) failures.delete(pluginId);
    else failures.set(pluginId, failure);
    const next = new Map(this.pluginLoadFailures);
    next.set(machineId, failures);
    this.pluginLoadFailures = next;
    this.requestUpdate();
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
      createProject: (input) => this.createProjectOn(selectedMachineId(this.state), input),
      projectDirectories: (query, signal) => api.projectDirectories(query, selectedMachineId(this.state), { signal }),
      projectTrust: async (path) => await trustApi.projectTrust(path, selectedMachineId(this.state)),
      projectFolders: () => projectFolderAccess({
        machine: { id: selectedMachineId(this.state), name: this.state.selectedMachine?.name },
        projects: projectsApi,
        trust: trustApi,
        create: (machineId, input) => this.createProjectOn(machineId, input),
      }),
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
        const intent = this.navigation.begin();
        void (async () => {
          await this.machines.endRefusalPause(machine);
          if (!this.navigation.isCurrent(intent)) return;
          await this.machines.selectMachine(machine);
          if (!this.navigation.isCurrent(intent)) return;
          await Promise.all([this.machines.refreshMachineHealth(), this.machines.refreshMachineRuntime()]);
        })();
      },
      renameMachine: (machineId) => {
        const machine = this.state.machines.find((candidate) => candidate.id === machineId);
        if (machine === undefined) {
          this.setState(errorNoticePatch(new Error("This machine is no longer listed.")));
          return;
        }
        this.renamingMachine = machine;
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
      refreshFiles: () => this.refreshWorkspaceFilesPage(),
      refreshWorkspacePanels: (panelId) => this.invalidateWorkspacePanels(panelId),
      refreshAppData: () => this.refreshAppData(),
      checkForPiWebUpdates: () => this.piWebStatusController.checkForUpdates(),
      reloadPage: () => { this.hardReloadApp(); },
      deleteWorkspace: (workspace) => this.deleteWorkspace(workspace),
      startSession: () => this.withChatScrollTransition(() => this.startSessionAndOpenChat()),
      archiveSession: () => this.sessions.archiveSession(),
      reloadSession: () => this.sessions.reloadSession(),
      deleteCachedNewSession: () => this.sessions.deleteCachedNewSession(),
      stopActiveWork: () => this.stopAndReturnQueued(),
    }, createContext);
    return createContext("core");
  }

  /**
   * Add a project on one machine from the add-project dialog's answer. The session the entry point
   * asked for starts only while that machine is still the selected one, so it never opens in
   * another machine's workspace.
   */
  private async createProjectOn(machineId: string, input: PluginProjectCreateInput): Promise<string | undefined> {
    const startSession = this.startSessionAfterAddingProject;
    this.startSessionAfterAddingProject = false;
    const failure = await this.projects.addProject(input.path, input.create, input.trust, machineId);
    if (failure === undefined && startSession && selectedMachineId(this.state) === machineId && this.state.selectedWorkspace !== undefined) void this.startSessionAndOpenChat();
    return failure;
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

  /**
   * The add-machine dialog is the machines plugin's, opened through the
   * dialog seam; the shell's affordances run the plugin's reserved action.
   * Absent plugin means no dialog: the affordances hide with it.
   */
  private openMachineDialog(): void {
    const action = this.plugins.getReservedAction(this.createPluginRuntimeContext(), "add-machine");
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
    if (!(await this.confirm({ title: `Remove ${machine.name}?`, message: REMOVE_MACHINE_WORDS[machine.connectFrom ?? "server"](machine.name), confirmLabel: "Remove", tone: "danger" }))) return;
    const wasSelected = this.state.selectedMachine?.id === machine.id;
    if (wasSelected) this.rememberCurrentMachineNavigation();
    const fallback = await this.machines.deleteMachine(machine, { selectFallback: !wasSelected });
    if (!this.state.machines.some((candidate) => candidate.id === machine.id)) {
      this.machineNavigation.forget(machine.id);
      this.machineProbes.forget(machine);
    }
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

  /**
   * A composer picker reads before it opens, and is still wanted only for the session, the view and
   * the moment it was asked for. The model picker read its lists while the reader moved on, then
   * opened over what came next, with another session's list (owner report 2026-10-06): a newer
   * picker, a navigation, another session or another view since the tap drops it. A pending session
   * that got its real id while the picker read is the same session (composerScope.renamedSessionId).
   */
  private beginPickerRequest(): () => boolean {
    const request = ++this.pickerRequestSeq;
    const intent = this.navigation.latest();
    const view = this.displayMainView();
    const machineId = selectedMachineId(this.state);
    const sessionId = this.state.selectedSession?.id;
    return () => request === this.pickerRequestSeq
      && this.navigation.isCurrent(intent)
      && this.displayMainView() === view
      && this.selectedSessionKey() === (sessionId === undefined ? undefined : machineSessionKey(machineId, renamedSessionId(machineId, sessionId)));
  }

  private selectedSessionKey(): string | undefined {
    const session = this.state.selectedSession;
    return session === undefined ? undefined : machineSessionKey(selectedMachineId(this.state), session.id);
  }

  /**
   * The model picker for the open session. `/model <text>` passes its text: a choice it names alone is selected
   * without the picker (modelCommandChoice); `/scoped-models` opens the All models list, where the scope is edited.
   */
  private async openModelDialog(request: { text?: string; mode?: ModelPickerMode } = {}) {
    const stillWanted = this.beginPickerRequest();
    await this.sessions.untilStarted();
    const [models, catalog] = await Promise.all([this.sessions.listModels(), this.sessions.listModelCatalog()]);
    if (!stillWanted()) return;
    const options = this.modelDialogOptions(models);
    const choice = request.text === undefined || request.text === "" ? undefined : modelCommandChoice(request.text, options, catalog);
    if (choice?.kind === "select") {
      await this.pickModel(choice.value);
      return;
    }
    const selectedValue = this.currentModelValue();
    this.pushModalLayerFrame();
    this.setState({
      modelDialog: {
        title: "Select model",
        ...(selectedValue !== undefined ? { selectedValue } : {}),
        options,
        catalog,
        ...(choice === undefined ? {} : { query: choice.query }),
        ...(request.mode === undefined ? {} : { mode: request.mode }),
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
    const registeredThemes = this.plugins.getThemes();
    const themes = selectableThemeContributions(registeredThemes);
    const resolution = this.resolveCurrentThemePreference(registeredThemes);
    const selectedThemeId = this.selectedThemePreferenceId();
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
          ...NATIVE_THEME_CHOICES.map((theme) => ({
            value: `${THEME_OPTION_PREFIX}${theme.id}`,
            label: this.themeOptionLabel(theme, selectedThemeId),
            description: [theme.colorScheme, "auto pair", theme.description].join(" · "),
          })),
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
    const resolvedId = resolvedThemePreferenceId(themeId, this.plugins.getThemes());
    if (isNativeThemeId(resolvedId)) {
      this.themePreference = { themeId: resolvedId, auto: false };
      this.applyPreferredTheme(true);
      this.shareThemePreference();
      return;
    }
    const theme = this.plugins.getThemes().find((candidate) => candidate.id === resolvedId);
    if (theme === undefined) return;
    this.themePreference = { themeId: theme.id, auto: false };
    this.applyPreferredTheme(true);
    this.shareThemePreference();
  }

  /** A browser that opens this PI WEB takes its shared theme; a matching choice changes nothing. */
  private adoptSharedTheme(theme: PiWebConfigValues["theme"]): void {
    this.sharedTheme = theme !== undefined;
    if (theme === undefined || (theme.themeId === this.themePreference.themeId && theme.auto === this.themePreference.auto)) return;
    this.themePreference = { themeId: theme.themeId, auto: theme.auto };
    this.applyPreferredTheme(true);
  }

  private shareThemePreference(): void {
    if (this.sharedTheme === true) this.writeSharedTheme(this.themePreference);
  }

  private setSharedTheme(share: boolean): void {
    this.sharedTheme = share;
    this.writeSharedTheme(share ? this.themePreference : null);
  }

  /**
   * Writes run one at a time, so the last choice made is the one the config keeps. The page already
   * shows that choice, so only the last pending write may settle the switch; when it fails, the
   * gateway's config is read again so the switch and theme show what it actually holds.
   */
  private writeSharedTheme(theme: ThemePreference | null): void {
    const value = theme === null ? null : { themeId: theme.themeId, auto: theme.auto };
    this.sharedThemeWritesPending += 1;
    this.sharedThemeWritesStarted += 1;
    this.sharedThemeWrites = this.sharedThemeWrites.then(async () => {
      try {
        const response = await configApi.saveSharedTheme(value);
        this.sharedThemeError = "";
        if (this.sharedThemeWritesPending === 1) this.sharedTheme = response.config.theme !== undefined;
        this.sharedThemeWritesPending -= 1;
      } catch (error) {
        this.sharedThemeError = `${value === null ? "Sharing the theme could not be turned off" : "The shared theme was not saved"}: ${describeError(error)}`;
        this.sharedThemeWritesPending -= 1;
        if (this.sharedThemeWritesPending === 0) await this.loadClientConfig();
      }
    });
  }

  /**
   * Follow the system's light/dark preference, using the pair the chosen theme
   * belongs to. Without a pair there is nothing to switch between, so the
   * switch is left off rather than silently doing nothing.
   */
  private setFollowSystemTheme(follow: boolean): void {
    this.themePreference = { themeId: this.themePreference.themeId, auto: follow };
    this.applyPreferredTheme(true);
    this.shareThemePreference();
  }

  private pickTheme(value: string) {
    this.setState({ themeDialog: undefined });
    if (value === THEME_AUTO_ON_VALUE || value === THEME_AUTO_OFF_VALUE) {
      this.setFollowSystemTheme(value === THEME_AUTO_ON_VALUE);
      return;
    }
    if (!value.startsWith(THEME_OPTION_PREFIX)) return;
    const themeId = value.slice(THEME_OPTION_PREFIX.length);
    const chosen = [...NATIVE_THEME_CHOICES, ...this.plugins.getThemes()].find((candidate) => candidate.id === themeId);
    if (chosen !== undefined) this.selectTheme(chosen.id);
  }

  private applyPreferredTheme(persist: boolean): void {
    const resolvedId = resolvedThemePreferenceId(this.themePreference.themeId, this.plugins.getThemes());
    if (resolvedId !== this.themePreference.themeId) {
      this.themePreference = { ...this.themePreference, themeId: resolvedId };
      persist = true;
    }
    const resolution = this.resolveCurrentThemePreference();
    const theme = resolution.activeTheme;
    if (persist) writeStoredThemePreference(this.themePreference);
    const preference = serializedThemePreference(this.themePreference);
    if (theme === undefined) {
      const native = isNativeThemeId(this.themePreference.themeId);
      if (!native && !this.themePluginsSettled) return;
      const followsSystem = this.themePreference.auto || !native;
      const nativeId = followsSystem
        ? (this.systemPrefersLight() ? CORE_MATERIAL_LIGHT_THEME_ID : CORE_MATERIAL_DARK_THEME_ID)
        : (this.themePreference.themeId === CORE_MATERIAL_LIGHT_THEME_ID ? CORE_MATERIAL_LIGHT_THEME_ID : CORE_MATERIAL_DARK_THEME_ID);
      if (this.activeThemeId === nativeId && this.paintedPreference === preference) return;
      this.activeThemeId = nativeId;
      this.paintedPreference = preference;
      if (nativeId === CORE_MATERIAL_LIGHT_THEME_ID) applyNativeMaterialLightTheme({ preference, followsSystem });
      else applyNativeMaterialDarkTheme({ preference, followsSystem });
      this.plugins.emit({ kind: "theme-applied", themeId: nativeId });
      return;
    }
    if (theme.id === this.activeThemeId && this.paintedPreference === preference) return;
    this.activeThemeId = theme.id;
    this.paintedPreference = preference;
    applyPiWebTheme(theme, { preference, followsSystem: this.themePreference.auto && resolution.selectedThemePair !== undefined });
    this.plugins.emit({ kind: "theme-applied", themeId: theme.id });
  }

  private resolveCurrentThemePreference(themes = this.plugins.getThemes()): ThemePreferenceResolution {
    return resolveThemePreference({
      themes,
      themePairs: this.plugins.getThemePairs(),
      preference: this.themePreference,
      prefersLight: this.systemPrefersLight(),
    });
  }

  private selectedThemePreferenceId(): QualifiedContributionId | undefined {
    const themes = this.plugins.getThemes();
    const id = resolvedThemePreferenceId(this.themePreference.themeId, themes);
    return isNativeThemeId(id) || themes.some((theme) => theme.id === id) ? id : undefined;
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

  private themeOptionLabel(theme: Pick<QualifiedThemeContribution, "id" | "name">, selectedThemeId: QualifiedContributionId | undefined): string {
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

  /** The thinking-level picker for the open session; `/thinking <level>` sets a level the model offers without it. */
  private async openThinkingDialog(level?: string) {
    const stillWanted = this.beginPickerRequest();
    await this.sessions.untilStarted();
    const levels = await this.sessions.listThinkingLevels();
    if (!stillWanted()) return;
    if (level !== undefined && levels.includes(level)) {
      await this.pickThinking(level);
      return;
    }
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

  /** A pi built-in the page handles (builtinSlashCommands.ts): it runs here, for the open session, and never reaches the outbox. */
  private readonly handleLocalCommand = (text: string): boolean => {
    const command = pageCommandOf(text);
    if (command === undefined) return false;
    this.pageCommands[command.name](command.argument);
    return true;
  };

  private readonly pageCommands: Readonly<Record<PageCommandName, (argument: string) => void>> = {
    login: (provider) => { void this.auth.openLogin(provider === "" ? undefined : provider); },
    logout: (provider) => { void this.auth.openLogout(provider === "" ? undefined : provider); },
    settings: () => { this.openSettings(); },
    hotkeys: () => { this.openSettings("shortcuts"); },
    model: (text) => { void this.openModelDialog({ text }); },
    "scoped-models": () => { void this.openModelDialog({ mode: "all" }); },
    thinking: (level) => { void this.openThinkingDialog(level === "" ? undefined : level); },
    resume: () => { this.openNavigateOn("sessions"); },
    copy: () => { void this.copyLastReply(); },
  };

  /**
   * `/copy`: the last reply of the open session, as its own copy button copies it. A transcript
   * still opening, or a window walked back into history with newer messages not loaded, does not
   * hold the last reply, so it says so instead of copying an older one. A copy that worked says
   * nothing, and a failure speaks only in the session where /copy was typed, for a moment (owner,
   * 2026-10-20); the session is read before the clipboard answers, so a switch meanwhile does not
   * move the failure into the session switched to.
   */
  private async copyLastReply(): Promise<void> {
    const session = this.state.selectedSession;
    if (session === undefined) return;
    const machineId = selectedMachineId(this.state);
    const fail = (words: string): void => { this.setState(noticePatch(noticeForSession(words, machineId, session.id))); };
    const unread = copyUnavailable(this.state);
    if (unread !== undefined) {
      fail(COPY_UNAVAILABLE_WORDS[unread]);
      return;
    }
    const text = lastReplyText(this.state.messages);
    if (text === undefined) {
      fail("There is no reply to copy yet.");
      return;
    }
    if (!await writeClipboardText(text)) fail("Could not copy the last reply: the browser refused the clipboard.");
  }

  /**
   * A message renderer's own send and insert (a card's own Send and Edit in composer). The chat
   * view passed both to renderers but nothing bound them, so a card's buttons were always
   * disabled. A send goes like the composer's: a steer while a turn runs,
   * a follow-up otherwise; its row in the transcript carries the delivery state.
   */
  private readonly handleRendererSend = (text: string): Promise<void> => {
    void this.promptEditor?.sendText(text, this.state.status?.isStreaming === true ? "steer" : "followUp");
    return Promise.resolve();
  };

  private readonly handleMessageActionFailed = (title: string, error: unknown): void => {
    this.setState(noticePatch(noticeForReader(`${title} failed: ${describeError(error)}`)));
  };

  private readonly handleRendererInsert = (text: string): void => {
    this.createPromptEditor().insertText(text);
  };

  /**
   * Put messages that left the queue back where they can be edited and sent
   * again.
   *
   * Recalling one, clearing the queue and pressing stop are the same
   * transition with three triggers - a message the server was holding is no
   * longer held - and the product owes the sender the same thing in all three:
   * the text and its attachments, not a deletion. Keeping that in one place is
   * what stops the next caller from being the one that forgets. Attachments
   * come from this browser's own copy, else from the message's line, and what
   * neither holds is said (returnedAttachments). A command this page sent for a plugin was never
   * the reader's words, so it does not come back to the composer.
   */
  private async returnQueued(queuedScope: { machineId: string; sessionId: string }, messages: readonly QueuedSessionMessage[], lines: readonly ChatLine[]): Promise<void> {
    const scope = renamedReturnScope(queuedScope);
    const seen = new Set<string>();
    const unique = messages.filter((message) => {
      if (this.sessions.isPluginCommand(message.commandClientMessageId)) return false;
      const key = message.clientMessageId ?? `text:${message.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const sessionKey = machineSessionKey(scope.machineId, scope.sessionId);
    const returned = (await Promise.all(unique.map(async (message) => ({ text: message.text, ...returnedAttachments(await this.knownAttachments(sessionKey, message.clientMessageId, lines), message.imageCount) }))))
      .filter((message) => message.text.trim() !== "" || message.attachments.length > 0 || message.shortfall !== undefined);
    if (returned.length === 0) return;
    const shortfall = combinedShortfall(returned.map((message) => message.shortfall));
    this.returnWords(scope, {
      text: returned.map((message) => message.text).filter((text) => text.trim() !== "").join("\n\n"),
      attachments: returned.flatMap((message) => message.attachments),
      ...(shortfall === undefined ? {} : { shortfall }),
    });
    if (this.shouldAutoFocusPrompt()) this.promptEditor?.focusInput();
  }

  /** A queued message's attachments as a copy in hand holds them: this browser's own, else its line (also when this browser's copy cannot be read); undefined when neither does. */
  private async knownAttachments(sessionKey: string, clientMessageId: string | undefined, lines: readonly ChatLine[]): Promise<PromptAttachment[] | undefined> {
    if (clientMessageId === undefined) return undefined;
    const held = heldWords(sessionKey, clientMessageId);
    const loaded = held === undefined ? undefined : await loadPayload(held);
    if (loaded?.kind === "ready") return loaded.record.attachments ?? [];
    const line = lines.find((candidate) => (candidate.meta?.delivery?.clientMessageId ?? candidate.meta?.clientMessageId ?? candidate.meta?.echoClientMessageId) === clientMessageId);
    return line === undefined ? undefined : recoverPromptFromLine(line)?.attachments;
  }

  /**
   * Words that come back go to the composer showing their session, else to its saved draft; what did
   * not come back is said either way. A session that got its real id meanwhile is the same session.
   */
  private returnWords(returnScope: { machineId: string; sessionId: string }, words: { text: string; attachments: readonly PromptAttachment[]; shortfall?: AttachmentShortfall; notice?: string }): void {
    const scope = renamedReturnScope(returnScope);
    const editor = this.promptEditor;
    if (selectedMachineId(this.state) === scope.machineId && this.state.selectedSession?.id === scope.sessionId && editor) {
      editor.takeBack(words);
      return;
    }
    const stored = returnWordsToSavedDraft(machineSessionKey(scope.machineId, scope.sessionId), words);
    const note = returnedWordsNotice(stored, words.notice ?? attachmentShortfallNote(words.shortfall));
    if (note !== undefined) this.setState(noticePatch(noticeForReader(note)));
  }

  /** Whether the page shows this session with its transcript loaded, the only transcript a run's asker is read from. */
  private showsLoadedTranscript(machineId: string, sessionId: string): boolean {
    return selectedMachineId(this.state) === machineId && this.state.selectedSession?.id === sessionId && !this.state.isOpeningSession;
  }

  /** Whether the page shows this session now, under the id it has after any await (renameComposerScope). */
  private showsReturnScope(returnScope: { machineId: string; sessionId: string }): boolean {
    const scope = renamedReturnScope(returnScope);
    return selectedMachineId(this.state) === scope.machineId && this.state.selectedSession?.id === scope.sessionId;
  }

  private selectedReturnScope(): { machineId: string; sessionId: string } | undefined {
    const session = this.state.selectedSession;
    return session === undefined ? undefined : { machineId: selectedMachineId(this.state), sessionId: session.id };
  }

  /** Stop cancels the turn, so the queue written for that turn goes with it, back to the composer. */
  private stopAndReturnQueued(): Promise<void> {
    return this.discardAndReturnQueued(() => this.sessions.stopActiveWork());
  }

  /** Aborting a tree navigation empties the queue as Stop does, and hands it back the same way. */
  private abortTreeAndReturnQueued(): Promise<void> {
    return this.discardAndReturnQueued(() => this.sessions.abortTreeNavigation());
  }

  /**
   * The scope and transcript are read before the discard is awaited: the reader may switch sessions
   * while it runs, and the returned words belong to the session they were queued in.
   */
  private async discardAndReturnQueued(discard: () => Promise<QueuedSessionMessage[]>): Promise<void> {
    const scope = this.selectedReturnScope();
    const lines = this.state.messages;
    const discarded = await discard();
    if (scope !== undefined) await this.returnQueued(scope, discarded, lines);
  }

  private readonly handleStopActiveWork = (): void => {
    void this.stopAndReturnQueued();
  };

  private readonly handleClearServerQueue = (queued: QueuedSessionMessage[]): void => {
    const scope = this.selectedReturnScope();
    if (scope !== undefined) void this.returnQueued(scope, queued, this.state.messages);
    void this.sessions.clearServerQueue();
  };

  /**
   * Take a message back: written into this device's outbox as the next operation of its session,
   * so it reaches the machine after everything sent before it. The words come from wherever this
   * device holds them, else from the row or the queue entry (a message sent from another device).
   */
  private readonly handleTakeBack = async (clientMessageId: string, queued: QueuedSessionMessage | undefined): Promise<void> => {
    const session = this.state.selectedSession;
    const editor = this.promptEditor;
    if (session === undefined || editor === undefined) return;
    const machineId = selectedMachineId(this.state);
    const scope = { machineId, sessionId: session.id, cwd: session.cwd };
    const sessionKey = machineSessionKey(machineId, session.id);
    const held = heldWords(sessionKey, clientMessageId);
    const line = this.state.messages.find((message) => message.meta?.delivery?.clientMessageId === clientMessageId);
    const recovered = line === undefined ? undefined : recoverPromptFromLine(line);
    const known = await this.knownAttachments(sessionKey, clientMessageId, this.state.messages);
    const text = held?.text ?? recovered?.text ?? queued?.text ?? "";
    const { attachments, shortfall } = returnedAttachments(known, queued?.imageCount ?? (known === undefined ? held?.attachmentRef?.count : undefined));
    const kind = queued?.kind ?? line?.meta?.delivery?.kind ?? held?.behavior;
    const path = await editor.takeBackMessage({ clientMessageId, text, attachments, scope, ...(shortfall === undefined ? {} : { shortfall }), ...(kind === undefined ? {} : { kind }) });
    if (this.showsReturnScope(scope)) this.afterTakeBack[path](clientMessageId);
  };

  /** What the row does after a take-back: gone at once when it never left, "Taking back…" while the machine is asked. */
  private readonly afterTakeBack: Readonly<Record<TakeBackPath, (clientMessageId: string) => void>> = {
    withdrawnHere: (clientMessageId) => { this.sessions.withdrawRow(clientMessageId); },
    sentToMachine: (clientMessageId) => { this.sessions.markTakingBack(clientMessageId); },
    notWritten: () => undefined,
  };

  private readonly handleOutgoingWritten = (record: PendingPrompt): void => {
    this.sessions.showOutgoing(record);
  };

  private readonly handleAnswerDialog = (dialogId: string, value: ExtensionDialogAnswer): Promise<void> => this.sessions.answerDialog(dialogId, value);

  private readonly handleCancelDialog = (dialogId: string): Promise<void> => this.sessions.cancelDialog(dialogId);

  private readonly handleDialogKey = (dialogId: string, key: string): Promise<void> => this.sessions.sendDialogKey(dialogId, key);
  private readonly handleDialogLine = (dialogId: string, line: number, text: string): Promise<void> => this.sessions.selectDialogLine(dialogId, line, text);
  private readonly handleDialogWidth = (dialogId: string, width: number): Promise<void> => this.sessions.resizeDialogScreen(dialogId, width);

  /**
   * Put a sent prompt back in the composer so a failed turn can be retried
   * without retyping it or re-picking its images.
   */
  private readonly handleResendMessage = (prompt: RecoveredPrompt): void => {
    this.promptEditor?.takeBack(prompt);
  };

  private readonly handleSelectModel = (): void => {
    void this.openModelDialog();
  };

  /**
   * The answer is the toggled session's catalog, so it lands only in a picker still showing that
   * session: one reopened for another session meanwhile kept the other's list (review triage,
   * model default).
   */
  private readonly handleToggleModelEnabled = async (provider: string, modelId: string, enabled: boolean): Promise<void> => {
    const sessionKey = this.selectedSessionKey();
    const catalog = await this.sessions.setModelEnabled(provider, modelId, enabled);
    const dialog = this.state.modelDialog;
    if (catalog === undefined || dialog === undefined || this.selectedSessionKey() !== sessionKey) return;
    // The fresh catalog's enabled rows are the session's Enabled list in
    // order, so rebuilding both data sets keeps the dialog's modes and pi's
    // persisted scope consistent without another round trip.
    this.setState({ modelDialog: { ...dialog, catalog, options: this.modelDialogOptions(catalog.filter((entry) => entry.enabled)) } });
  };

  private readonly handleSelectThinking = (): void => {
    void this.openThinkingDialog();
  };

  /** Whether a dropped file has a composer to go to: an open session that is not archived. */
  private canTakeDroppedFiles(): boolean {
    const session = this.state.selectedSession;
    return session !== undefined && session.archived !== true && this.promptEditor !== undefined;
  }

  private readonly handleChatDragEnter = (event: DragEvent): void => {
    if (event.dataTransfer === null || !dataTransferHasFiles(event.dataTransfer) || !this.canTakeDroppedFiles()) return;
    if (this.fileDrag.enter() && event.currentTarget instanceof HTMLElement) this.fileDropFrame = fileDropFrameStyle(event.currentTarget.getBoundingClientRect());
  };

  private readonly handleChatDragOver = (event: DragEvent): void => {
    if (event.dataTransfer === null || !dataTransferHasFiles(event.dataTransfer) || !this.canTakeDroppedFiles()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  private readonly handleChatDragLeave = (): void => {
    if (this.fileDropFrame !== undefined && this.fileDrag.leave()) this.fileDropFrame = undefined;
  };

  /** A drop the composer already took is not attached twice: it prevented the default. */
  private readonly handleChatDrop = (event: DragEvent): void => {
    this.fileDrag.reset();
    this.fileDropFrame = undefined;
    if (event.defaultPrevented || !this.canTakeDroppedFiles()) return;
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    void this.promptEditor?.attachFiles(files);
  };

  /** A file dropped where nothing takes it would open in place of the app (`fileDrop.ts`). */
  private readonly refuseStrayFileDrop = (event: DragEvent): void => {
    if (event.type === "drop") {
      this.fileDrag.reset();
      this.fileDropFrame = undefined;
    }
    if (event.defaultPrevented || event.dataTransfer === null || !dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
  };

  private renderChatView(state: AppState, session: SessionInfo) {
    return html`
      <chat-view .startsIn=${this.startsIn()} .messageNotes=${this.selectedSessionNotes(state)} .activityNotes=${this.plugins.getActivityNotes(this.state.selectedMachine?.id)} .sessionId=${session.id} .messages=${state.messages} .messageStart=${state.messagePageStart} .messageEnd=${state.messagePageEnd} .messageTotal=${state.messagePageTotal} .hasMore=${state.messagePageStart > 0} .hasNewer=${state.messagePageEnd < state.messagePageTotal} .newerCount=${state.messagePageTotal - state.messagePageEnd + state.newerPendingCount} .loadingMore=${state.isLoadingEarlierMessages} .onLoadNewer=${() => { void this.sessions.loadNewerMessages(); }} .transcriptLoading=${state.isOpeningSession} .transcriptFailed=${state.transcriptFailed} .isSendingPrompt=${state.sendingPrompts[session.id] === true} .isCompacting=${state.status?.isCompacting === true} .pendingMessageCount=${state.status?.pendingMessageCount ?? 0} .status=${state.status} .activity=${state.activity}
        .onDialogKey=${this.handleDialogKey}
        .onDialogLine=${this.handleDialogLine}
        .onDialogWidth=${this.handleDialogWidth}
        .pendingDialogs=${state.pendingDialogs} .commandLedger=${commandsForSession(state.commandLedger, machineSessionKey(selectedMachineId(state), session.id))} .onAnswerDialog=${this.handleAnswerDialog} .onCancelDialog=${this.handleCancelDialog} .onResendMessage=${this.handleResendMessage} .cardDraftSessionId=${machineSessionKey(selectedMachineId(state), session.id)} .onClearServerQueue=${this.handleClearServerQueue} .isPluginCommand=${(commandClientMessageId: string | undefined) => this.sessions.isPluginCommand(commandClientMessageId)} .onTakeBack=${this.handleTakeBack} .onLoadMore=${() => this.withChatPrependTransition(() => this.sessions.loadEarlierMessages())} .onFocusComposer=${() => { void this.focusChatComposer(); }} .onQuoteSelection=${(quoted: string) => { this.createPromptEditor().insertText(quoted); }} .onSendMessage=${this.handleRendererSend} .onInsertIntoComposer=${this.handleRendererInsert} .findMessageRenderer=${(tag: string) => this.plugins.findMessageRenderer(tag, selectedMachineId(state))} ?pluginsIncomplete=${this.pluginsIncomplete(selectedMachineId(state))} .findCodeFenceRenderer=${(language: string) => this.plugins.findCodeFenceRenderer(language, selectedMachineId(state))} .findToolRenderer=${(toolName: string) => this.plugins.findToolRenderer(toolName, selectedMachineId(state))} .messageActions=${this.plugins.getMessageActions(selectedMachineId(state))} .pluginName=${(pluginId: string) => this.plugins.pluginName(pluginId, selectedMachineId(state))} .onMessageActionFailed=${this.handleMessageActionFailed} .machineId=${selectedMachineId(state)} ?machineSocketConnecting=${this.realtime.phaseFor(selectedMachineId(state)).kind === "connecting"} .sessionCwd=${session.cwd}></chat-view>
    `;
  }

  private sessionPromptsMemo: { source: ChatLine[]; prompts: PromptHistoryEntry[] } | undefined;
  /**
   * The session's own user messages as history, newest first - the history a fresh browser has none
   * of locally: words alone once each, and a message with images with them. Memoized on the messages
   * reference because the transcript changes on every streaming delta.
   */
  private sessionPromptsFor(state: AppState): PromptHistoryEntry[] {
    if (this.sessionPromptsMemo?.source === state.messages) return this.sessionPromptsMemo.prompts;
    const prompts: PromptHistoryEntry[] = [];
    const seen = new Set<string>();
    for (let index = state.messages.length - 1; index >= 0 && prompts.length < PROMPT_HISTORY_PROP_LIMIT; index -= 1) {
      const line = state.messages[index];
      if (line?.role !== "user" || line.meta?.echo === true) continue;
      const trimmed = (line.parts.find((part) => part.type === "text")?.text ?? "").trim();
      const images = recoverPromptFromLine(line)?.attachments ?? [];
      if (images.length > 0) {
        prompts.push({ text: trimmed, attachments: { kept: "transcript", attachments: images } });
        continue;
      }
      if (trimmed === "" || seen.has(trimmed)) continue;
      seen.add(trimmed);
      prompts.push({ text: trimmed });
    }
    this.sessionPromptsMemo = { source: state.messages, prompts };
    return prompts;
  }

  /** What the session on screen reports about declared surfaces; undefined is unknown. */
  private openSessionSurfaces(): PluginSurfacePresence | undefined {
    const session = this.state.selectedSession;
    if (session === undefined || this.state.status?.sessionId !== session.id) return undefined;
    return this.state.status.pluginSurfaces;
  }

  /**
   * What the open session's extensions left standing, only while the status in hand is that
   * session's: a value read for one session never draws under another.
   */
  private openSessionStanding(state: AppState): ExtensionUiStanding | undefined {
    const session = state.selectedSession;
    if (session === undefined || state.status?.sessionId !== session.id) return undefined;
    return state.status.extensionUi;
  }

  private renderStatusBar(state: AppState) {
    return html`
      <status-bar
        .status=${state.status}
        .failure=${state.status === undefined ? state.transcriptFailed ?? state.statusReadFailed : undefined}
      ></status-bar>
    `;
  }

  private appRowPlace(): AppRowPlace {
    return appRowPlace({
      modalPresent: this.modalPresent,
      navigateOpen: this.navigateOpen,
      phoneNavigationView: this.appShell.isMobileNavigationLayout && this.displayMainView() === "navigation",
    });
  }

  private renderAppRowAt(place: AppRowPlace) {
    return this.appRowPlace() === place ? appRowText(this.appRowView) : null;
  }

  private renderAppRowSlot(place: AppRowPlace) {
    const row = this.renderAppRowAt(place);
    return row === null ? null : html`<div slot="app-row">${row}</div>`;
  }

  private renderAppRowLayer() {
    const row = this.renderAppRowAt("dialog-layer");
    return row === null ? null : html`<div class="app-row-layer" data-live-behind-modal>${row}</div>`;
  }

  /**
   * What the app row shows this render: the notice when one holds it, else the machine in use
   * going unanswered past the grace period or catching up (both the top bar), held for the minimum
   * visible time after it recovers. One claim at a time (owner, 2026-09-30).
   */
  private renderAppRow(error: string, claim: TransportClaim | undefined): RowView | null {
    const notice = NOTICE_ON_ROW[noticeScope(this.state, this.noticeScreen())] ? this.renderErrorBanner(error, claim) : null;
    const row = this.renderUnansweredRow(notice !== null);
    return notice ?? row;
  }

  /** The machine and session on screen, where a scoped notice may speak. */
  private noticeScreen(): NoticeScreen {
    return { machineId: selectedMachineId(this.state), sessionId: this.state.selectedSession?.id };
  }

  private renderUnansweredRow(noticeShown: boolean): RowView | null {
    const machineId = selectedMachineId(this.state);
    const messageStatus = messageStatusUnanswered(this.state.messageStatusUnanswered, { machineId, sessionId: this.state.selectedSession?.id });
    const heard: HeardClocks = { link: ackWatch.heardAt(), machine: (machineId) => this.realtime.heardAt(machineId) };
    const sources = [this.projects.unanswered(), this.machines.unanswered(), targetUnanswered(this.namedTargetInScope()), messageStatus, this.realtime.unanswered(machineId), ackWatch.waiting()];
    const outbox: Unanswered[] = this.state.outboxUnanswered.map((entry) => ({ since: entry.since, miss: outboxMiss(entry, heard) }));
    const unanswered = [...sources.map((source) => stillUnheard(source, heard)), ...outbox].reduce(earliestUnanswered, undefined);
    const now = Date.now();
    const shown = this.unansweredShown?.machineId === machineId ? this.unansweredShown.row : undefined;
    const decision = rowDecision({ notice: noticeShown, unanswered, shown, behind: this.state.streamBehind, lookingSince: this.lookingSince, now });
    if (this.reconnectingRecheck !== undefined) globalThis.clearTimeout(this.reconnectingRecheck);
    this.reconnectingRecheck = decision.recheckInMs === undefined ? undefined : globalThis.setTimeout(() => { this.reconnectingRecheck = undefined; this.requestUpdate(); }, decision.recheckInMs);
    if (decision.claim.kind === "syncing") {
      this.unansweredShown = undefined;
      return syncingRowView(this.machineName(decision.claim.machineId));
    }
    if (decision.claim.kind !== "unanswered") {
      this.unansweredShown = undefined;
      return null;
    }
    const { miss } = decision.claim;
    this.unansweredShown = { machineId, row: { at: shown?.at ?? Date.now(), miss } };
    const named = this.unansweredMachineNames(miss, now);
    return unansweredRowView(miss, (machineId) => (miss.kind === "machine-unanswering" && machineId === miss.machineId ? named : this.machineName(machineId)));
  }

  /**
   * Every machine "Trying to sync with" is about, named (owner, 2026-10-14: name every machine): the one
   * the row's claim names, and each other machine whose outbox has gone unanswered past the grace.
   */
  private unansweredMachineNames(miss: ReadMiss, now: number): string {
    if (miss.kind !== "machine-unanswering") return "";
    const lookingSince = this.lookingSince ?? now;
    const others = this.state.outboxUnanswered.flatMap((entry) => (entry.miss.kind === "machine-unanswering" && graceLeftMs(entry.since, lookingSince, now) <= 0 ? [entry.miss.machineId] : []));
    return [...new Set([miss.machineId, ...others])].map((machineId) => this.machineName(machineId)).join(", ");
  }

  /** The open session's message notes; another session's never render here. */
  private selectedSessionNotes(state: AppState): readonly MessageNote[] {
    const session = state.selectedSession;
    if (session === undefined) return [];
    const sessionKey = machineSessionKey(selectedMachineId(state), session.id);
    return state.messageNotes.filter((note) => note.sessionKey === sessionKey);
  }

  /** A machine as the row names it: its name, or its id while the machines are unread. */
  private machineName(machineId: string): string {
    return this.state.machines.find((machine) => machine.id === machineId)?.name ?? machineId;
  }

  /** The machines a row sentence names: the one serving this page, and the one the notice is about. */
  private rowNames(): RowNames {
    const about = this.state.errorMachineId === "page" ? "local" : this.state.errorMachineId;
    return { page: this.machineName("local"), machine: this.machineName(about) };
  }

  private renderErrorBanner(error: string, claim: TransportClaim | undefined): RowView | null {
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
      this.lastScheduledSessionId = undefined;
      this.heldErrorBanner = null;
    }
    const decision = bannerHoldDecision({ shownAt: this.bannerShownAt, now: Date.now(), next: error });
    // A transport claim earns its banner (owner's ruling): a single blip -
    // one poll answering 502 mid-restart - must not flash across the top of
    // the screen. The first sighting waits out a grace window; a claim still
    // standing when it elapses shows as "retrying", and the recovery path
    // withdraws it. Reader-visible claims keep the immediate path below.
    if (error !== "" && claim !== undefined) {
      const isNew = error !== this.lastScheduledError || this.state.errorMachineId !== this.lastScheduledMachineId;
      if (isNew) {
        this.lastScheduledError = error;
        this.lastScheduledMachineId = this.state.errorMachineId;
        this.lastScheduledSessionId = this.state.errorSessionId;
        this.transientPendingSince = Date.now();
        this.bannerShownAt = undefined;
        if (this.transientGraceTimer !== undefined) window.clearTimeout(this.transientGraceTimer);
        this.transientGraceTimer = window.setTimeout(() => { this.transientGraceTimer = undefined; this.requestUpdate(); }, TRANSIENT_GRACE_MS);
        this.heldErrorBanner = null;
        return null;
      }
      if (this.transientPendingSince !== undefined) {
        if (this.lookingSince === undefined) return null;
        const graceLeft = graceLeftMs(this.transientPendingSince, this.lookingSince, Date.now());
        if (graceLeft > 0) {
          if (this.transientGraceTimer !== undefined) window.clearTimeout(this.transientGraceTimer);
          this.transientGraceTimer = window.setTimeout(() => { this.transientGraceTimer = undefined; this.requestUpdate(); }, graceLeft);
          return null;
        }
      }
      this.transientPendingSince = undefined;
      if (this.transientGraceTimer !== undefined) { window.clearTimeout(this.transientGraceTimer); this.transientGraceTimer = undefined; }
      if (this.bannerShownAt === undefined) {
        this.bannerShownAt = Date.now();
        this.scheduleTransientErrorDismissal(error, this.state.errorMachineId);
      }
      this.heldErrorBanner = noticeRowView(error, claim, this.rowNames());
      this.heldNoticeScope = { errorRetiredBy: this.state.errorRetiredBy, errorMachineId: this.state.errorMachineId, errorSessionId: this.state.errorSessionId };
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
      this.lastScheduledSessionId = undefined;
      if (this.transientErrorTimer !== undefined) {
        window.clearTimeout(this.transientErrorTimer);
        this.transientErrorTimer = undefined;
      }
      if (this.bannerHoldTimer !== undefined) window.clearTimeout(this.bannerHoldTimer);
      this.bannerHoldTimer = window.setTimeout(() => { this.bannerHoldTimer = undefined; this.requestUpdate(); }, decision.retryInMs);
      const held = this.heldNoticeScope;
      return held === undefined || NOTICE_ON_ROW[noticeScope(held, this.noticeScreen())] ? this.heldErrorBanner : null;
    }
    // A replacement starts its own hold window and its own expiry: borrowing
    // the previous banner's timestamps gave the new message a shorter life
    // than the model promised.
    if (error !== this.lastScheduledError || this.state.errorMachineId !== this.lastScheduledMachineId || this.state.errorSessionId !== this.lastScheduledSessionId) {
      this.lastScheduledError = error;
      this.lastScheduledMachineId = this.state.errorMachineId;
      this.lastScheduledSessionId = this.state.errorSessionId;
      this.bannerShownAt = Date.now();
      this.scheduleTransientErrorDismissal(error, this.state.errorMachineId);
    }
    this.heldErrorBanner = noticeRowView(error, undefined, this.rowNames(), this.state.errorRetiredBy === RetiredBy.reply);
    this.heldNoticeScope = { errorRetiredBy: this.state.errorRetiredBy, errorMachineId: this.state.errorMachineId, errorSessionId: this.state.errorSessionId };
    return this.heldErrorBanner;
  }

  private renderContextBar() {
    return html`
      <app-context-bar
        .session=${this.state.selectedSession}
        .activeSurface=${this.columnGoTo() ? "" : this.activeSurfaceLabel()}
        .startsIn=${this.startsIn()?.project ?? ""}
        .onOpenGoTo=${() => { this.openGoTo(); }}
        .onRenameRequest=${(session: SessionInfo) => { this.renameFromBar = { session, machineId: selectedMachineId(this.state) }; }}
        ?panelOpen=${this.shellPanelOpen()}
        .toggleTarget=${"menu"}
        .navigationTarget=${this.appShell.isMobileNavigationLayout ? "page" : "panel"}
        .leadingKey=${leadingKeyOf(this.cornerKeys(), "conversation")}
        ?goToKeyHidden=${this.cornerKeys().goTo !== "conversation"}
        ?goToCloses=${this.pageShown() && !this.columnGoTo()}
        .onBack=${() => { this.goBackToGoTo(); }}
        .onTogglePanel=${() => { this.pressConversationGridKey(); }}
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

  /** The conversation bar's grid key: Navigate over the chat on a phone with a chat behind it, the panel or the navigation view otherwise. */
  private pressConversationGridKey(): void {
    if (this.appShell.isMobileNavigationLayout && this.hasChatSubject()) this.openNavigate();
    else this.toggleShellPanel();
  }

  private toggleShellPanel(): void {
    if (this.appShell.isMobileNavigationLayout) {
      this.selectMainView(this.hasChatSubject() && this.displayMainView() === "navigation" ? "chat" : "navigation");
    } else {
      this.panelCollapse.toggleNavigationPanel();
    }
    this.followCornerKeyFocus("grid");
  }

  /** Workspace views as panel rows: one entry, no sheet, no second strip. */
  private activeSurfaceLabel(): string {
    const view = this.displayMainView();
    if (view === "chat" || view === "navigation") return "";
    return this.pageTitleOf(view);
  }

  /** The pages a scope offers, as Go to's lines (scopePages). */
  private shellToolTabs(scope: GoToScope): ShellToolTab[] {
    return scopePages(scope, this.visibleWorkspacePanels(), this.visibleGlobalPanels()).map((panel) => {
      const badge = this.pageBadge(panel);
      const usableBadge = badge === "" ? undefined : badge;
      return {
        id: panel.id,
        label: panel.title,
        icon: panel.icon ?? renderPluginIcon(),
        ...(usableBadge === undefined ? {} : { badge: usableBadge }),
        selected: (this.columnGoTo() ? this.shownPageId() : this.state.mainView) === panel.id,
      };
    });
  }

  /** Resolve the row id back to its typed view; unknown ids are ignored. */
  private openShellToolTab(id: string): void {
    const panel = [...this.visibleWorkspacePanels(), ...this.visibleGlobalPanels()].find((candidate) => candidate.id === id);
    if (panel === undefined) {
      this.setState(noticePatch(noticeForReader("That page is not available here")));
      return;
    }
    this.selectMainView(panel.id);
  }

  /**
   * The line at the top edge, visible whatever scrolled away, drawn once for either reason: the
   * chrome's half of a pending open (D8), or the app row in a sync state (owner, 2026-10-19: the bar
   * replaces "Trying to reach", "Trying to sync with" and "Syncing with"). Each reason keeps its own
   * spoken announcement: the open names its target in every phase, and the sync state says its sentence.
   */
  private renderNavigationProgress() {
    const pending = this.navigation.view();
    const row = this.appRowView;
    const syncSentence = row?.kind === "bar" ? row.sentence : "";
    const navigating = pending !== undefined && pending.phase !== "failed";
    return html`
      ${navigating || syncSentence !== "" ? html`<div class="navigation-progress" aria-hidden="true"></div>` : nothing}
      <div class="navigation-announcer" role="status" aria-live="polite" data-live-behind-modal>${pending === undefined ? "" : openingAnnouncement(pending)}</div>
      <div class="sync-announcer" role="status" aria-live="polite" data-live-behind-modal>${syncSentence}</div>
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
    this.appRowView = this.renderAppRow(state.error, state.errorClaim);
    return html`
      <div class=${`${this.panelCollapse.shellClass(displayView, this.workspaceColumnHasContent())}${this.workspacePanelHoldsCanvas() ? " workspace-panel-fullscreen" : ""}`} style=${this.panelResize.shellStyle({ navigation: this.resizablePanelConstraints("navigation"), workspace: this.resizablePanelConstraints("workspace") })}>
        ${this.renderNavigationProgress()}
        <aside id="navigation-panel">${this.appShell.isMobileNavigationLayout ? null : this.renderNavigatePage(false)}</aside>
        ${this.contextSheetOpen || this.panelCollapse.navigationPanelCollapsed ? null : this.renderNavigationPanelEdgeControl()}
        <main class=${mainViewClass(displayView)} @dragenter=${this.handleChatDragEnter} @dragover=${this.handleChatDragOver} @dragleave=${this.handleChatDragLeave} @drop=${this.handleChatDrop}>
          ${this.appShell.isMobileNavigationLayout && displayView === "navigation" ? null : this.renderContextBar()}

          ${this.renderAppRowAt("main")}
          ${this.renderStaleClientBanner()}
          ${deprecatedAgentInputsBanner(deprecatedAgentInputsWarnings(state.machines, state.machineRuntimes))}
          <div class="mobile-navigation-panel">${this.appShell.isMobileNavigationLayout ? this.renderNavigatePage(false) : null}</div>
          ${state.selectedSession ? html`
            ${this.renderChatView(state, state.selectedSession)}
            ${state.selectedSession.archived === true ? this.renderArchivedComposerSlot(state.selectedSession) : html`<prompt-editor .rowedMessageIds=${rowedClientMessageIds(state.messages, state.status?.queuedMessages ?? [])} .sessionId=${state.selectedSession.id} .cwd=${composerCwd(state)} .sessionPrompts=${this.sessionPromptsFor(state)} .machineId=${selectedMachineId(state)} .projectId=${state.selectedWorkspace?.projectId} .workspaceId=${state.selectedWorkspace?.id} .canSteer=${state.status?.isStreaming === true} .isCompacting=${state.status?.isCompacting === true} .canStop=${isSessionActive(state.status, state.activity)} .status=${state.status} .availableThinkingLevels=${state.availableThinkingLevels} .sending=${state.sendingPrompts[state.selectedSession.id] === true}  .onLocalCommand=${this.handleLocalCommand} .onOutgoingWritten=${this.handleOutgoingWritten} .onStop=${this.handleStopActiveWork} .onSelectModel=${this.handleSelectModel} .onSelectThinking=${this.handleSelectThinking} .composerContributions=${this.plugins.getComposerContributions(selectedMachineId(state))} .onPluginNotice=${(message: string) => { this.setState(noticePatch(noticeForReader(message))); }}></prompt-editor>`}
            ${this.renderStatusBar(state)}
            ${this.fileDropFrame === undefined ? nothing : html`<div class="file-drop-frame" style=${this.fileDropFrame} aria-hidden="true"><span>Drop files to attach</span></div>`}
            ${state.commandDialog !== undefined ? html`<command-picker ?abovedialog=${this.settingsOpen} .title=${state.commandDialog.title} .options=${state.commandDialog.options} .onPick=${(value: string) => this.sessions.respondToCommand(state.commandDialog?.requestId ?? "", value)} .onCancel=${() => { this.sessions.cancelCommand(); }}></command-picker>` : null}
            ${state.modelDialog !== undefined ? html`<model-picker ?abovedialog=${this.settingsOpen} title=${state.modelDialog.title} .options=${state.modelDialog.options} .catalog=${state.modelDialog.catalog} .selectedValue=${state.modelDialog.selectedValue} .onPick=${(value: string) => { void this.pickModel(value); }} .onToggleEnabled=${this.handleToggleModelEnabled} .initialQuery=${state.modelDialog.query ?? ""} .initialMode=${state.modelDialog.mode ?? "enabled"} .onCancel=${() => { this.setState({ modelDialog: undefined }); }}></model-picker>` : null}
            ${state.thinkingDialog !== undefined ? html`<command-picker ?abovedialog=${this.settingsOpen} title=${state.thinkingDialog.title} .options=${state.thinkingDialog.options} .selectedValue=${state.thinkingDialog.selectedValue} .onPick=${(value: string) => { void this.pickThinking(value); }} .onCancel=${() => { this.setState({ thinkingDialog: undefined }); }}></command-picker>` : null}
          ` : this.renderNoSession()}
        </main>
        ${this.contextSheetOpen || !this.workspacePanelOnScreen() ? null : this.renderWorkspacePanelEdgeControl()}
        ${this.renderWorkspacePanel()}
        ${state.authDialog !== undefined ? html`<auth-dialog .state=${state.authDialog} .onChooseMethod=${(authType: "oauth" | "api_key") => { void this.auth.chooseLoginMethod(authType); }} .onSelectProvider=${(providerId: string, authType: "oauth" | "api_key") => { void this.auth.selectLoginProvider(providerId, authType); }} .onLogoutProvider=${(providerId: string) => { void this.auth.logoutProvider(providerId); }} .onOAuthInput=${(value: string) => { this.auth.updateOAuthInput(value); }} .onOAuthRespond=${(value?: string) => { void this.auth.respondOAuth(value); }} .onOAuthCancel=${() => { void this.auth.cancelOAuth(); }} .onCancel=${() => { this.auth.closeDialog(); }}></auth-dialog>` : null}
        ${this.navigateOpen ? html`<div class="navigate-overlay">${this.renderNavigatePage(true)}</div>` : null}
        ${this.quickSwitcherOpen ? html`<quick-switcher
          .boardAnswer=${this.quickSwitcherBoardAnswer}
          .sessions=${this.withCreatingRows(this.quickSwitcherSessionsWithPins(), this.rowsMachineId())}
          .workspaces=${this.quickSwitcherWorkspaces}
          .selectedSession=${this.quickSwitcherBrowsingElsewhere() ? undefined : state.selectedSession}
          .selectedWorkspace=${this.quickSwitcherBrowsingElsewhere() ? undefined : state.selectedWorkspace}
          .activeSessionIds=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_ID_SET : this.activeSessionIds()}
          .sessionStates=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_STATE_MAP : this.sessionStateKinds()}
          .waitingSessionIds=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_ID_SET : this.waitingSessionIds()}
          .unreadSessionIds=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_ID_SET : this.unreadSessionIds}
          .openerShortcut=${this.openerShortcutOf("app.sessions.quick-switch")}
          .heldOpenSessionId=${this.quickSwitcherBrowsingElsewhere() ? undefined : heldOpenSessionIn(this.openRowHold, selectedMachineId(state))}
          .sessionSections=${sessionSections(this.plugins.getSessionSections(this.rowsMachineId()))}
          .interruptedSessionIds=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_ID_SET : this.interruptedRunsByMachine.get(selectedMachineId(state)) ?? EMPTY_ID_SET}
          .errorSessionIds=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_ID_SET : this.errorSessionIds()}
          .pinnedSessionIds=${this.quickSwitcherBrowsingElsewhere() ? EMPTY_ID_SET : this.pinnedSessionIds}
          .projects=${this.quickSwitcherBrowsingElsewhere() ? [] : state.projects}
          .machines=${state.machines}
          .browseMachineId=${selectedMachineId(state)}
          .browsingElsewhere=${this.quickSwitcherBrowsingElsewhere()}
          .onSelectMachine=${(machineId: string) => { this.switchToMachine(machineId); }}
          .canStartSession=${!this.quickSwitcherBrowsingElsewhere()}
          .newSessionIn=${this.newSessionTarget()?.name}
          .onCreateSession=${() => { this.startNewSession(); }}
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
        ${state.actionPaletteOpen ? html`<action-palette .actions=${this.getActions()} .openerShortcut=${this.openerShortcutOf("core:actions.show")} .onRun=${(action: AppAction) => { this.setState({ actionPaletteOpen: false }); this.runAction(action); }} .onCancel=${() => { this.setState({ actionPaletteOpen: false }); }}></action-palette>` : null}
        ${this.renderSessionTreeNavigator(state)}
        ${this.sessionCleanupDialog !== undefined ? html`<session-cleanup-dialog .preview=${this.sessionCleanupDialog.preview} .previewRequest=${this.sessionCleanupDialog.previewRequest} .result=${this.sessionCleanupDialog.result} .loading=${this.sessionCleanupDialog.loading === true} .running=${this.sessionCleanupDialog.running === true} .error=${this.sessionCleanupDialog.error ?? ""} .onPreview=${(request: SessionCleanupRequest) => { void this.previewSessionCleanup(request); }} .onRun=${(request: SessionCleanupRequest) => { void this.runSessionCleanup(request); }} .onConfirm=${(request: ConfirmRequest) => this.confirm(request)} .onClose=${() => { this.closeSessionCleanupDialog(); }}></session-cleanup-dialog>` : null}
        ${state.themeDialog !== undefined ? html`<command-picker ?abovedialog=${this.settingsOpen} title=${state.themeDialog.title} .options=${state.themeDialog.options} .selectedValue=${state.themeDialog.selectedValue} .onPick=${(value: string) => { this.pickTheme(value); }} .onCancel=${() => { this.setState({ themeDialog: undefined }); }}></command-picker>` : null}
        ${this.settingsOpen ? html`<settings-dialog .accessGate=${supportsPiWebCapability(state.machineRuntimes[LOCAL_MACHINE_ID], PI_WEB_CAPABILITIES.accessToken)} .section=${this.settingsSection} .reveal=${this.settingsReveal} .onRevealed=${() => { this.settingsReveal = undefined; }} .machine=${state.selectedMachine} .machineRuntime=${this.selectedMachineRuntime()} .actions=${this.getDefaultActions()} .onNavigate=${(section: SettingsSection) => { this.navigateSettings(section); }} .onBackToList=${() => { this.backToSettingsList(); }} .pluginSections=${this.plugins.getSettingsSections(selectedMachineId(state))} .pluginRuntimeContext=${this.createPluginRuntimeContext()} .onClose=${() => { this.closeSettings(); }} .onConfigSaved=${(config: PiWebConfigValues) => { this.applyClientConfig(config); }} ?reloadOnClose=${this.reloadAfterSettings} .onPluginsChanged=${() => { if (!this.settingsMachineFollowsToggles()) this.reloadAfterSettings = true; }} .onRefreshMachineRuntime=${async (machineId: string) => { await this.machines.refreshMachineRuntime(machineId, { requireSelected: false }); }} .machines=${state.machines} .machineAvailability=${Object.fromEntries(state.machines.map((machine) => [machine.id, this.machineProbes.view(machine)]))} .machinesForeground=${this.foregroundMachineList() === "settings"} .onMachinesVisibilityChange=${(owner: HTMLElement, visible: boolean) => { this.machineProbes.setVisible(owner, visible); }} .onAddMachine=${() => { this.openMachineDialog(); }} .pluginLoadFailures=${this.pluginLoadFailures} .onRenameMachine=${async (machine: Machine, name: string) => { await this.renameMachine(machine, name); }} .onRemoveMachine=${(machine: Machine) => { void this.removeMachine(machine); }} .fleetReport=${this.fleetReport} ?fleetLoading=${this.fleetLoading} .fleetError=${this.fleetError} .onRefreshFleet=${() => this.refreshFleet()} .onRunFleet=${(operation: "restart" | "update", machineIds?: readonly string[]) => this.runFleetOperation(operation, machineIds)} .themes=${selectableThemeContributions(this.plugins.getThemes())} .selectedThemeId=${this.selectedThemePreferenceId()} .activeThemeId=${this.activeThemeId} ?followSystemTheme=${this.themePreference.auto} .onSelectTheme=${(themeId: QualifiedContributionId) => { this.selectTheme(themeId); }} .onToggleFollowSystem=${(follow: boolean) => { this.setFollowSystemTheme(follow); }} .sharedTheme=${this.sharedTheme} .sharedThemeError=${this.sharedThemeError} .onToggleSharedTheme=${(share: boolean) => { this.setSharedTheme(share); }}></settings-dialog>` : null}
        ${this.pluginDialogs.map((entry) => html`<div class=${PLUGIN_DIALOG_CLASS[entry.dialog.presentation ?? "overlay"]}><modal-surface .label=${entry.dialog.label} .onClose=${entry.close}>${entry.dialog.content}</modal-surface></div>`)}
      </div>
      ${this.renderNewSessionSheet()}
      ${this.contextSheetOpen ? html`<context-switcher-sheet
        .title=${[state.selectedMachine?.name, state.selectedProject?.name].filter((part) => part !== undefined && part !== "").join(" · ") || "Projects"}
        .navSections=${this.plugins.getNavSections(selectedMachineId(state))}
        .navSectionContext=${this.buildNavSectionContext("sheet")}
        .onClose=${() => { this.contextSheetOpen = false; }}
      ></context-switcher-sheet>` : null}
      ${this.renamingMachine === undefined ? null : html`<session-rename-dialog
        .subject=${"machine"}
        .currentName=${this.renamingMachine.name}
        .onSubmit=${async (name: string) => { const machine = this.renamingMachine; this.renamingMachine = undefined; if (machine !== undefined) await this.renameMachine(machine, name); }}
        .onCancel=${() => { this.renamingMachine = undefined; }}
      ></session-rename-dialog>`}
      ${this.renameFromBar === undefined ? null : html`<session-rename-dialog
        .currentName=${this.renameFromBar.session.name ?? ""}
        .onSubmit=${(name: string) => { const target = this.renameFromBar; this.renameFromBar = undefined; if (target !== undefined) void this.renameListedSession(target.session, target.machineId, name); }}
        .onCancel=${() => { this.renameFromBar = undefined; }}
      ></session-rename-dialog>`}
      ${this.goToSheetOpen ? html`<app-go-to-sheet
        .destinations=${this.goToDestinations()}
        .onSelect=${(id: string) => { this.goTo(id); }}
        .onClose=${() => { this.goToSheetOpen = false; }}
        .onNavigation=${() => { this.openNavigationFromMenu(); }}
        .onGoTo=${() => { this.closeMenu(); }}
      ></app-go-to-sheet>` : null}
      ${this.renderAppRowLayer()}
      ${this.machineAccessRequestId === undefined ? nothing : html`<machine-access-approval class="page-scroller" .requestId=${this.machineAccessRequestId} .onDone=${this.closeMachineAccessApproval}></machine-access-approval>`}
    `;
  }

  private readonly closeMachineAccessApproval = (): void => {
    clearMachineAccessRoute();
    this.machineAccessRequestId = undefined;
  };

  /**
   * While a dialog is open the app row rides above it (owner, 2026-10-04), and every dialog
   * surface moves down by the row's height so the row never covers a dialog's header or its
   * close key. ModalSurface reads the inset from the document, through every shadow root.
   */
  private syncAppRowInset(): void {
    if (!this.modalPresent && this.appRowInset === 0) return;
    const layer = this.renderRoot.querySelector(".app-row-layer");
    const height = layer === null ? 0 : Math.round(layer.getBoundingClientRect().height);
    if (height === this.appRowInset) return;
    this.appRowInset = height;
    const style = this.ownerDocument.documentElement.style;
    if (height > 0) style.setProperty("--pi-app-row-inset", `${String(height)}px`);
    else style.removeProperty("--pi-app-row-inset");
  }

  static override styles = [interactiveSurfaceStyles, sessionStateBadgeStyles, appStyles];
}


const PLUGIN_DIALOG_CLASS: Record<NonNullable<PluginDialog["presentation"]>, string> = {
  overlay: "plugin-dialog",
  fullscreen: "plugin-dialog plugin-dialog-fullscreen",
  alert: "plugin-dialog plugin-dialog-alert",
};

function createPluginRegistry(dialogHost: PluginDialogHost, readPiWebStatus: (machineId: string) => Promise<unknown>, openPage: (pageId: QualifiedContributionId) => void, fleet: PluginFleetSource): PluginRegistry {
  const registry = new PluginRegistry({
    ui: createPluginHostUi(dialogHost),
    readPiWebStatus,
    openPage,
    fleet,
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

/** A remote whose web answered with its session daemon down keeps its activity socket, which reconnects once the daemon is back. */
function shouldRefreshMachineActivity(machine: Machine, health: MachineHealth | undefined): boolean {
  if (machine.kind === "local") return true;
  const status = health?.status ?? machine.status;
  if (status === "error") return health?.web?.available === true;
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

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
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

/** The scope words return to, under the id its session has now (renameComposerScope). */
function renamedReturnScope(scope: { machineId: string; sessionId: string }): { machineId: string; sessionId: string } {
  return { machineId: scope.machineId, sessionId: renamedSessionId(scope.machineId, scope.sessionId) };
}

function machineScopedKey(machineId: string, value: string): string {
  return JSON.stringify([machineId, value]);
}

function omitWorkspaceDeletionRun(runs: Record<string, TerminalCommandRun>, workspaceId: string): Record<string, TerminalCommandRun> {
  return Object.fromEntries(Object.entries(runs).filter(([candidate]) => candidate !== workspaceId));
}

function projectChoices(projects: readonly Project[]) {
  return projects.map((project) => ({ id: project.id, name: project.name, path: project.path, ...projectFolderFlag(project) }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => { resolve(); }));
}

/** Why the open transcript cannot answer `/copy`: still opening, or walked back with newer messages not loaded. */
type CopyUnavailable = "opening" | "olderWindow";

const COPY_UNAVAILABLE_WORDS: Readonly<Record<CopyUnavailable, string>> = {
  opening: "The session is still opening; try /copy again in a moment.",
  olderWindow: "Newer messages are not loaded here: scroll to the newest message, then type /copy again.",
};

function copyUnavailable(state: AppState): CopyUnavailable | undefined {
  if (state.isOpeningSession) return "opening";
  return state.messagePageEnd < state.messagePageTotal ? "olderWindow" : undefined;
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
