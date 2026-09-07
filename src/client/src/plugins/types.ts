import type { CSSResultGroup, TemplateResult } from "lit";
import type { AppAction } from "../actions";
import type { DeleteWorkspaceFileResponse, FileContentResponse, FileTreeResponse, JsonValue, Machine, MoveWorkspaceFileOptions, MoveWorkspaceFileResponse, RunTerminalCommandInput, TerminalCommandRun, TerminalCommandRunFilter, TerminalCommandRunHandle, TerminalInfo, WriteWorkspaceFileOptions, WriteWorkspaceFileResponse, Workspace } from "../api";
import type { AppState } from "../appState";
import type { SettingsSection } from "../settingsRoute";
import type { FileSuggestion, MachineKind, MachineStatus, WorkspaceUploadBatchProgress, WorkspaceUploadCancelHandle } from "../../../shared/pluginApiTypes";
import type { LocalContributionId, PluginId, QualifiedContributionId } from "./ids";

export type { LocalContributionId, PluginId, QualifiedContributionId } from "./ids";
export type HtmlTemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => TemplateResult;
export type SvgTemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => TemplateResult;

export interface PiWebPluginRegistration {
  id: PluginId;
  plugin: PiWebPlugin;
  machineId?: string;
  sourcePluginId?: PluginId;
  backendRevision?: string;
  machineSpecific?: boolean;
  /** The plugin's own namespaced config block; undefined means unconfigured. */
  settings?: PluginSettings;
}

export interface WorkspacePluginBinding {
  registrationPluginId: PluginId;
  sourcePluginId: PluginId;
  backendRevision?: string;
}

export interface PiWebPlugin {
  apiVersion: 2;
  name: string;
  activate: (context: PluginActivationContext) => PluginActivationResult;
}

/**
 * Facts the host reports to plugins. Read-only announcements, never hooks:
 * a plugin learns that the session changed, it does not get to veto or
 * mutate the change. Every subscription returns its own unsubscribe, and the
 * registry disposes whatever a plugin leaves behind, so a plugin cannot
 * outlive its own teardown.
 */
export type PluginLifecycleEvent =
  | { kind: "session-selected"; sessionId: string; machineId: string | undefined }
  | { kind: "session-left"; sessionId: string }
  | { kind: "connection-changed"; connected: boolean }
  | { kind: "theme-applied"; themeId: string }
  | { kind: "session-activity-settled"; sessionId: string; machineId: string }
  | { kind: "settings-changed"; settings: PluginSettings };

/**
 * A plugin's own namespaced configuration block, delivered opaquely.
 *
 * The core validates it as an opaque namespaced value and never names a
 * plugin's keys in its own contract - voice's azureSpeech/speechToText
 * living inside PiWebConfigValues is exactly the coupling this replaces.
 * Absent means unconfigured, which a plugin must not read as "configured
 * empty".
 */
export type PluginSettings = Readonly<Record<string, unknown>>;

export interface PluginHostUi {
  readonly copyText: (text: string) => Promise<boolean>;
  readonly describeError: (error: unknown) => string;
  readonly surfaceStyles: CSSResultGroup;
  /** The list chrome every built-in list carries, so a contributed list matches them. */
  readonly listStyles: CSSResultGroup;
  readonly breakpoints: PluginBreakpoints;
  /** Sanitized markdown HTML, the same rendering the built-in surfaces trust. */
  readonly renderMarkdownHtml: (markdown: string) => string;
  /** The formatted-text stylesheet, so a plugin's rendered markdown matches
   *  the transcript's instead of becoming a second producer of it. */
  readonly textStyles: CSSResultGroup;
  /** Register a rendered modal layer for document-wide modality, focus, and
   *  isTop coordination with the app's own dialogs. */
  readonly registerModal: (registration: {
    element: HTMLElement;
    paintElement?: HTMLElement;
    focus?: () => void;
    onTopChange?: (isTop: boolean) => void;
  }) => { readonly isTop: boolean; focus(): boolean; unregister(): void };
  /** Present a dialog over the app's modal layer: the host owns the shared
   *  surface, focus, Escape, backdrop, and the back gesture; the plugin owns
   *  only the content and its close callbacks. */
  readonly showDialog: (dialog: PluginDialog) => PluginDialogHandle;
  /** Namespaced query-string state the host keeps coordinated with route
   *  restoration. The namespace is the plugin's wire format for deep links. */
  readonly query: {
    read(namespace: string, key: string): string | undefined;
    write(namespace: string, key: string, value: string | undefined, options?: { replace?: boolean }): void;
  };
}

/** A dialog a plugin asks the host to present over the app's modal layer. */
export interface PluginDialog {
  /** Accessible name applied to the host's shared modal surface. */
  readonly label: string;
  /** The dialog body, rendered as the shared surface's light children. */
  readonly content: TemplateResult;
  /** Called once for every close: Escape, backdrop, close(), or unregistration. */
  readonly onClose?: () => void;
}

export interface PluginDialogHandle {
  /** Close the dialog exactly as a host dismissal would. */
  readonly close: () => void;
}

export interface PluginBreakpoints {
  readonly coarseOrMobile: string;
  readonly mobileNavigation: string;
  readonly desktopSideBySide: string;
}

export type PluginLifecycleEventKind = PluginLifecycleEvent["kind"];

export type PluginLifecycleListener<K extends PluginLifecycleEventKind> =
  (event: Extract<PluginLifecycleEvent, { kind: K }>) => void;

export interface PluginActivationContext {
  readonly apiVersion: 2;
  /** Subscribe to a host fact; the returned function unsubscribes. */
  readonly on?: <K extends PluginLifecycleEventKind>(kind: K, listener: PluginLifecycleListener<K>) => () => void;
  /** This plugin's own configuration block, or undefined when unconfigured. */
  readonly settings?: PluginSettings | undefined;
  /**
   * Call one of this host's JSON endpoints. Plugins do not build browser URLs
   * themselves: the host owns the single place an application path becomes an
   * absolute one, and a plugin reaching around it would be the second
   * producer of that decision.
   */
  readonly fetchJson?: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
  /**
   * Call one of this plugin's own declared daemon operations. The plugin names
   * the operation; the host builds the path, so a plugin never spells out a
   * URL and cannot drift from where the host actually serves it.
   */
  readonly callOperation?: (operation: string, input?: unknown) => Promise<unknown>;
  /**
   * Host utilities a plugin surface needs but must not reimplement: the same
   * clipboard fallback chain, the same words for a failure, the same
   * interactive-surface styles every built-in surface carries, and the same
   * breakpoints. A plugin copying any of these becomes a second producer of a
   * decision the host already made.
   */
  readonly ui?: PluginHostUi;
  /** Stable package/source identity, including on federated machines. */
  readonly pluginId: PluginId;
  /** Host-unique identity for qualified contribution references in this runtime. */
  readonly runtimePluginId: PluginId;
  readonly html: HtmlTemplateTag;
  readonly svg: SvgTemplateTag;
}

export interface PluginActivationResult {
  contributions: PluginContributions;
  /** Released when the plugin is unregistered; subscriptions are dropped regardless. */
  dispose?: () => void;
}

/**
 * A settings section a plugin owns inside the core settings shell. The shell
 * keeps navigation and persistence; the plugin only renders its body.
 */
export interface SettingsSectionContribution {
  id: LocalContributionId;
  title: string;
  order?: number;
  render: (context: PluginRuntimeContext) => TemplateResult;
}

export interface QualifiedSettingsSectionContribution extends SettingsSectionContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

/** One project as the navigation sections render it. */
export interface NavProjectSnapshot {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

/** Whether the projects reaching the navigation sections have loaded, and how the latest load ended. */
export type NavProjectsLoad = "unloaded" | "loading" | "loaded" | "failed";

/** Activity flags for one node, keyed by qualified flag id; absent means not set. */
export type NavStatusFlags = Readonly<Record<string, boolean>>;

/** The slice of the host's machine status the navigation sections render. */
export interface NavStatusSnapshot {
  readonly projects: Readonly<Record<string, NavStatusFlags>>;
  readonly workspaces: Readonly<Record<string, NavStatusFlags>>;
}

/** Shell chrome the host keeps; the section body applies it to its own rows. */
export interface NavSectionDisplay {
  /** The shell hides non-visible sections rather than removing them. */
  readonly hidden: boolean;
  readonly collapsible: boolean;
  readonly collapsed: boolean;
  /** Rows render as a responsive tile grid instead of full-width rows. */
  readonly tiles: boolean;
  /** Whether a create control belongs in this section body right now. */
  readonly withCreate: boolean;
}

/**
 * What the host feeds a contributed navigation section. The snapshot and the
 * actions are the host's; a section renders them through its own rows and
 * never calls a PI WEB API or spells a URL.
 */
export interface NavSectionContext {
  readonly projects: readonly NavProjectSnapshot[];
  readonly projectsLoad: NavProjectsLoad;
  readonly workspaces: readonly Workspace[];
  readonly selectedProjectId?: string | undefined;
  readonly selectedWorkspaceId?: string | undefined;
  readonly machineId: string;
  readonly deletingWorkspaceIds: readonly string[];
  readonly statusSnapshot: NavStatusSnapshot | undefined;
  /** Label items for one workspace, looked up by id; the host owns the label contributions. */
  readonly labelItems: (workspaceId: string) => WorkspaceLabelItem[];
  readonly display: NavSectionDisplay;
  /** Sections are asked during render; late reads reach the screen through this. */
  readonly requestUpdate: () => void;
  readonly selectProject: (projectId: string) => void;
  /** Absent where a close affordance would not belong. */
  readonly closeProject?: (projectId: string) => void;
  /** Absent where a create control would not belong. */
  readonly addProject?: () => void;
  readonly selectWorkspace: (workspaceId: string) => void;
  /** Absent when the host offers no workspace removal. */
  readonly deleteWorkspace?: (workspaceId: string) => void;
  /** Host-provided trust reads and writes; absent means the rows omit trust. */
  readonly workspaceTrust?: NavWorkspaceTrustActions | undefined;
  readonly retryProjectsLoad: () => void;
  readonly toggleCollapsed: () => void;
  readonly focusPreviousSection: () => void | Promise<void>;
  readonly focusNextSection: () => void | Promise<void>;
  readonly cancelKeyboardNavigation: () => void | Promise<void>;
}

/** Host-provided trust reads and writes for the listed workspaces. */
export interface NavWorkspaceTrustActions {
  get(workspaceId: string): Promise<{ trusted: boolean }>;
  set(workspaceId: string, trusted: boolean): Promise<{ trusted: boolean }>;
}

/**
 * A section of the app's context navigation: the projects and workspaces
 * pickers. The shell reserves the slot vocabulary, keeps the section order,
 * the keyboard machine and the collapse state; the plugin brings the body.
 * The reserved ids are `projects` and `workspaces` - a contribution with an
 * unknown id has no slot and does not render.
 */
export interface NavSectionContribution {
  id: LocalContributionId;
  order?: number;
  /** Focus the section's first selectable row; false means nothing to focus. */
  focus?: () => Promise<boolean>;
  render: (context: NavSectionContext) => TemplateResult;
}

export interface QualifiedNavSectionContribution extends NavSectionContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

/** One machine as a contributed machines section renders it. The host folds the health check into `status`. */
export interface NavMachineSnapshot {
  readonly id: string;
  readonly name: string;
  readonly kind: MachineKind;
  /** Present on remote machines; the row label renders it after the kind. */
  readonly baseUrl?: string;
  readonly status: MachineStatus;
}

/**
 * What the host feeds a contributed machines section. The roster and the
 * activity flags are the host's; the section renders them through its own
 * rows and never calls a PI WEB API or spells a URL. Action callbacks are
 * absent where the host offers no such affordance, and rows omit the
 * matching menu entries rather than guessing.
 */
export interface MachineSectionContext {
  readonly machines: readonly NavMachineSnapshot[];
  readonly selectedMachineId: string | undefined;
  /** Machine-level activity flags per machine id; absent means no snapshot yet. */
  readonly machineFlags: Readonly<Record<string, NavStatusFlags>>;
  readonly display: NavSectionDisplay;
  /** Sections are asked during render; late reads reach the screen through this. */
  readonly requestUpdate: () => void;
  readonly selectMachine: (machineId: string) => void;
  /** Absent where a create control would not belong. */
  readonly addMachine?: () => void;
  /** Absent when the host offers no machine removal; local rows never offer it. */
  readonly removeMachine?: (machineId: string) => void;
  /** Absent when the host offers no rename. */
  readonly renameMachine?: (machineId: string, name: string) => void;
  /** Absent when the host offers no health re-check. */
  readonly refreshMachine?: (machineId: string) => void;
  /** Open a remote machine's PI WEB; absent means rows omit the open entry. */
  readonly openMachine?: (machineId: string) => void;
  readonly toggleCollapsed: () => void;
  readonly focusPreviousSection: () => void | Promise<void>;
  readonly focusNextSection: () => void | Promise<void>;
  readonly cancelKeyboardNavigation: () => void | Promise<void>;
}

/**
 * The machines section of the app's context navigation. The shell reserves
 * the `machines` slot, keeps the section order, the keyboard machine and the
 * collapse state; the plugin brings the body. A contribution with an unknown
 * id has no slot and does not render.
 */
export interface MachineSectionContribution {
  id: LocalContributionId;
  order?: number;
  /** Focus the section's first selectable row; false means nothing to focus. */
  focus?: () => Promise<boolean>;
  render: (context: MachineSectionContext) => TemplateResult;
}

export interface QualifiedMachineSectionContribution extends MachineSectionContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

export interface PluginContributions {
  actions?: PluginAction[];
  navSections?: NavSectionContribution[];
  machineSections?: MachineSectionContribution[];
  workspacePanels?: WorkspacePanelContribution[];
  workspaceLabels?: WorkspaceLabelContribution[];
  themes?: ThemeContribution[];
  themePairs?: ThemePairContribution[];
  composer?: ComposerContribution[];
  settingsSections?: SettingsSectionContribution[];
  messageRenderers?: MessageRendererContribution[];
  drawerSections?: DrawerSectionContribution[];
}

/**
 * A section in the session drawer, beside Activity and Notifications.
 *
 * The drawer is where a session's side channels live, and a feature that owns
 * one - goals is the first - had to be built into the chat view to get there.
 * A contributed section brings its own tab label and body; the shell keeps tab
 * selection, keyboard order and the collapsed state, so a plugin cannot make
 * its section behave unlike its neighbours.
 *
 * `available` is what decides whether the tab appears at all. A section that
 * cannot say yet answers undefined, and the shell shows the tab rather than
 * claiming the feature is missing.
 */
export interface DrawerSectionContext {
  sessionId: string;
  machineId: string;
  workspacePath: string | undefined;
  sessionCwd: string | undefined;
  /**
   * Sections are asked during render, so a read that lands after the ask
   * reaches the screen only through this. The host supplies it; a section
   * whose data arrives later calls it instead of waiting for an unrelated
   * rerender to carry the answer.
   */
  requestUpdate: () => void;
  /**
   * Run a slash command in the focused session, exactly as a person would
   * have typed it. Sections that act through the session's own command
   * surface keep the audit trail and focus rules a private channel would
   * bypass. Absent means the host offers no session to run one in.
   */
  runCommand?: ((command: string) => Promise<void>) | undefined;
}

export interface DrawerSectionContribution {
  id: LocalContributionId;
  title: string;
  order?: number;
  available?: (context: DrawerSectionContext) => boolean | undefined;
  badge?: (context: DrawerSectionContext) => string | number | undefined;
  render: (context: DrawerSectionContext) => TemplateResult;
}

export interface QualifiedDrawerSectionContribution extends DrawerSectionContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

/**
 * A message renderer claims one custom payload tag in the transcript.
 *
 * The transcript asks the registry before its built-in renderers and falls
 * back to the honest card when nobody claims a tag, so an unknown payload
 * renders as unknown rather than disappearing. A renderer receives a frozen
 * view model and returns a body only: the runtime supplies the card chrome,
 * which is what keeps the corner and settled-outcome contracts true for
 * plugin cards by construction rather than by each plugin remembering.
 *
 * Claims are resolved first-writer-wins in registration order, and the
 * registry refuses a second claim on a tag so a silent override cannot
 * happen.
 */
export interface MessageRendererViewModel {
  readonly sessionId: string;
  readonly messageId: string;
  readonly tag: string;
  readonly payload: unknown;
  readonly streaming: boolean;
  readonly createdAt: string | undefined;
}

export interface MessageRendererContribution {
  id: LocalContributionId;
  /** The custom payload tag this renderer claims. */
  tag: string;
  render: (view: MessageRendererViewModel) => TemplateResult;
}

export interface QualifiedMessageRendererContribution extends MessageRendererContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

/**
 * A composer contribution owns one unit of composer behavior: an action
 * rendered in a slot beside the send button, an optional live status line
 * under the input, and an optional draft transformer.
 *
 * Draft mutation goes through the transformer seam so plugin-inserted text
 * and keyboard-typed text share one producer; a plugin never reaches into
 * the editor's state. Status lines exist because voice renders
 * Listening/Transcribing/permission-refused inside the composer, and an
 * action slot alone cannot say those things.
 */
export type ComposerSlot = "leading" | "trailing";

export interface ComposerRuntimeContext {
  sessionId: string | undefined;
  machineId: string | undefined;
  draft: string;
  busy: boolean;
  insertText: (text: string) => void;
  replaceDraft: (text: string) => void;
  notify: (message: string, severity: "info" | "warning" | "error") => void;
  /** Ask the composer to redraw after state only the plugin can see changed. */
  requestUpdate: () => void;
}

export interface ComposerStatusLine {
  text: string;
  severity: "info" | "problem";
}

export interface ComposerContribution {
  id: LocalContributionId;
  slot: ComposerSlot;
  title: string;
  icon?: TemplateResult;
  order?: number;
  enabled?: (context: ComposerRuntimeContext) => boolean;
  disabledReason?: (context: ComposerRuntimeContext) => string | undefined;
  /** Rendered live under the input while defined; undefined renders nothing. */
  status?: (context: ComposerRuntimeContext) => ComposerStatusLine | undefined;
  run: (context: ComposerRuntimeContext) => void | Promise<void>;
}

export interface QualifiedComposerContribution extends ComposerContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

export interface PluginMachine {
  id: string;
  name: string;
  kind: Machine["kind"];
}

export interface WorkspaceFiles {
  readFile(path: string): Promise<FileContentResponse>;
  listFiles(path: string): Promise<FileTreeResponse>;
  writeFile(path: string, content: string | Uint8Array, options?: WriteWorkspaceFileOptions): Promise<WriteWorkspaceFileResponse>;
  deleteFile(path: string): Promise<DeleteWorkspaceFileResponse>;
  moveFile(fromPath: string, toPath: string, options?: MoveWorkspaceFileOptions): Promise<MoveWorkspaceFileResponse>;
  /** Browser-ready URL for streaming or downloading a workspace file. */
  previewUrl(path: string, options?: { modifiedAt?: string; download?: boolean }): string;
  /** The file endpoint's preview thresholds for the inline-vs-stream decision. */
  readonly limits: { readonly inlinePreviewBytes: number; readonly streamPreviewBytes: number };
  /** The workspace's configured default upload folder, workspace-relative. */
  readonly uploadFolder: string;
  /** Upload a batch of files sequentially with progress and cancellation. */
  uploadFiles(files: readonly File[], options?: {
    destinationFolder?: string;
    createDirs?: boolean;
    overwrite?: boolean;
    onProgress?: (progress: WorkspaceUploadBatchProgress) => void;
  }): WorkspaceUploadCancelHandle;
}

export interface WorkspaceBackend {
  request(operation: string, input: JsonValue): Promise<JsonValue>;
}

export interface WorkspaceHost {
  requestRender(): void;
  /** Whether the active workspace panel currently owns the full app canvas. */
  workspacePanelFullscreen(): boolean;
  /** Move the active workspace panel into or out of the main content area. */
  setWorkspacePanelFullscreen(fullscreen: boolean): void;
}

export interface WorkspaceContext {
  machine: PluginMachine;
  workspace: Workspace;
  state: AppState;
  files: WorkspaceFiles;
  backend?: WorkspaceBackend;
  host: WorkspaceHost;
}

export type WorkspaceTerminalCommandInput = Omit<RunTerminalCommandInput, "workspace">;

export interface WorkspacePanelTerminal {
  open(options?: { terminalId?: string | undefined }): void;
  runCommand(input: WorkspaceTerminalCommandInput): Promise<TerminalCommandRunHandle>;
  /**
   * The pty capability itself stays with the host, which owns the daemon that
   * spawns it; a plugin that draws terminals asks for sessions and a stream
   * rather than building routes or sockets of its own.
   */
  sessions: WorkspaceTerminalSessions;
  activeCount: number;
  selectedId: string | undefined;
  autoStart: boolean;
  select: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => void;
}

export interface WorkspaceTerminalSessions {
  list(): Promise<TerminalInfo[]>;
  start(options?: { name?: string; cols?: number; rows?: number }): Promise<TerminalInfo>;
  close(terminalId: string): Promise<void>;
  closeAll(): Promise<void>;
  continue(terminalId: string): Promise<TerminalInfo>;
  connect(terminalId: string, initialSize?: { cols: number; rows: number }): WebSocket;
  /** Command runs belonging to this workspace, and the ability to stop one. */
  listCommandRuns(): Promise<TerminalCommandRun[]>;
  cancelCommandRun(runId: string): Promise<TerminalCommandRun>;
}

export interface PiWebUnstableRuntimeContext {
  terminalCommandRuns: TerminalCommandRunsInternalRuntime;
  openSettings?: (section?: SettingsSection) => void;
}

export interface TerminalCommandRunsInternalRuntime {
  runCommand(input: RunTerminalCommandInput): Promise<TerminalCommandRunHandle>;
  listCommandRuns(filter?: TerminalCommandRunFilter): Promise<TerminalCommandRun[]>;
  getCommandRun(runId: string): Promise<TerminalCommandRun | undefined>;
  open(options?: { terminalId?: string | undefined }): void;
}

/** The add-machine dialog's submitted answer. */
export interface MachineCreateInput {
  readonly name: string;
  readonly baseUrl: string;
  readonly token?: string;
}

/** The add-project dialog's submitted answer. */
export interface PluginProjectCreateInput {
  readonly path: string;
  readonly create?: boolean;
  readonly trust?: PluginProjectTrustChoice;
}

/** The dialog's trust checkbox answer; `changed` is false for the pre-filled value. */
export interface PluginProjectTrustChoice {
  readonly trusted: boolean;
  readonly changed: boolean;
}

/** Server-resolved existing trust for one raw path. */
export interface PluginProjectTrustRead {
  readonly path: string;
  readonly decision: boolean | null;
  readonly trusted: boolean;
}

export interface PluginPromptEditor {
  insertText(text: string): void;
  getText(): string;
  getSelection(): { start: number; end: number; text: string } | null;
}

export interface PluginRuntimeContext {
  state: AppState;
  prompt: PluginPromptEditor;
  piWebUnstable?: PiWebUnstableRuntimeContext;
  openActionPalette: () => void;
  focusPrompt: () => void;
  addProject: () => void | Promise<void>;
  /**
   * Create a project from the add-project dialog's answer. Resolves to the
   * reason the submit did not go through, or undefined when it did; the host
   * owns the project's placement in app state and the trust choice's write.
   */
  createProject: (input: PluginProjectCreateInput) => Promise<string | undefined>;
  /**
   * Create a machine from the add-machine dialog's answer. Resolves to the
   * reason the submit did not go through, or undefined when it did; the host
   * owns the machine's placement in app state and the selection that follows.
   * Absent where the host offers no machine creation.
   */
  createMachine?: (input: MachineCreateInput) => Promise<string | undefined>;
  /** Directory suggestions below the typed path, on the selected machine. */
  projectDirectories: (query: string, signal: AbortSignal) => Promise<FileSuggestion[]>;
  /** Server-resolved existing trust for a raw path, on the selected machine. */
  projectTrust: (path: string) => Promise<PluginProjectTrustRead>;
  addMachine: () => void | Promise<void>;
  refreshSelectedMachine: () => void | Promise<void>;
  removeSelectedMachine: () => void | Promise<void>;
  openSelectedMachine: () => void | Promise<void>;
  configureAuth: () => void | Promise<void>;
  logoutAuth: () => void | Promise<void>;
  openThemePicker: () => void;
  openModelPicker: () => void | Promise<void>;
  openThinkingLevelPicker: () => void | Promise<void>;
  selectMainView: (view: AppState["mainView"]) => void;
  selectWorkspaceTool: (tool: QualifiedContributionId) => void;
  openTerminal: (options?: { terminalId?: string | undefined }) => void;
  refreshFiles: () => void | Promise<void>;
  /** Invalidate plugin workspace-panel data for the selected workspace. */
  refreshWorkspacePanels: (panelId?: QualifiedContributionId) => void | Promise<void>;
  refreshAppData: () => void | Promise<void>;
  checkForPiWebUpdates?: () => void | Promise<void>;
  reloadPage: () => void;
  deleteWorkspace: (workspace?: Workspace) => void | Promise<void>;
  startSession: () => void | Promise<void>;
  archiveSession: () => void | Promise<void>;
  reloadSession: () => void | Promise<void>;
  deleteCachedNewSession: () => void | Promise<void>;
  stopActiveWork: () => void | Promise<void>;
}

export interface PluginAction {
  id: LocalContributionId;
  title: string;
  description?: string;
  shortcut?: string;
  /** Former qualified action ids whose saved shortcut preference should still apply. */
  shortcutAliases?: QualifiedContributionId[];
  group?: string;
  enabled?: (context: PluginRuntimeContext) => boolean;
  /** Explain why a disabled action is visible but unavailable. */
  disabledReason?: (context: PluginRuntimeContext) => string | undefined;
  run: (context: PluginRuntimeContext) => void | Promise<void>;
}

export interface QualifiedPluginAction extends AppAction {
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
}

export interface WorkspacePanelContext extends WorkspaceContext {
  prompt: PluginPromptEditor;
  terminal: WorkspacePanelTerminal;
  piWebUnstable?: Pick<PiWebUnstableRuntimeContext, "terminalCommandRuns">;
  activeTerminalCount: number;
  selectedTerminalId: string | undefined;
  terminalAutoStart: boolean;
  onSelectTerminal: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => void;
}

export type WorkspacePanelIcon = TemplateResult;

export interface WorkspacePanelContribution {
  id: LocalContributionId;
  title: string;
  icon?: WorkspacePanelIcon;
  order?: number;
  /** Former URL tool/view values that should resolve to this panel. */
  routeAliases?: string[];
  visible?: (context: WorkspacePanelContext) => boolean;
  badge?: (context: WorkspacePanelContext) => string | number | TemplateResult | undefined;
  onInvalidate?: (context: WorkspacePanelContext) => void | Promise<void>;
  render: (context: WorkspacePanelContext) => TemplateResult;
}

export interface QualifiedWorkspacePanelContribution extends WorkspacePanelContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

export interface WorkspaceLabelContext extends WorkspaceContext {
  machine: PluginMachine;
  workspace: Workspace;
  state: AppState;
  files: WorkspaceFiles;
  host: WorkspaceHost;
}

export type WorkspaceLabelItem = WorkspaceLabelTextItem | WorkspaceLabelLinkItem | WorkspaceLabelRenderItem;

export interface WorkspaceLabelTextItem {
  type: "text";
  text: string;
  title?: string;
}

export interface WorkspaceLabelLinkItem {
  type: "link";
  text: string;
  href: string;
  title?: string;
  target?: "_blank" | "_self";
}

export interface WorkspaceLabelRenderItem {
  type: "render";
  render: () => TemplateResult;
}

export interface WorkspaceLabelContribution {
  id: LocalContributionId;
  order?: number;
  visible?: (context: WorkspaceLabelContext) => boolean;
  items: (context: WorkspaceLabelContext) => WorkspaceLabelItem[];
}

export type ThemeColorScheme = "dark" | "light";

import type { ThemeToken } from "../../../shared/pluginApiTypes";
import type { LegacyThemeToken, SemanticSurfaceToken } from "../../../shared/pluginApiTypes";
export type { ThemeToken, LegacyThemeToken, SemanticSurfaceToken };

export type ThemeTokens = Record<LegacyThemeToken, string> & Partial<Record<SemanticSurfaceToken, string>>;

export interface ThemeContribution {
  id: LocalContributionId;
  name: string;
  description?: string;
  order?: number;
  colorScheme: ThemeColorScheme;
  tokens: ThemeTokens;
}

export interface ThemePairContribution {
  id: LocalContributionId;
  name: string;
  description?: string;
  order?: number;
  light: LocalContributionId;
  dark: LocalContributionId;
}

export interface QualifiedThemeContribution extends ThemeContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
}

export interface QualifiedThemePairContribution extends Omit<ThemePairContribution, "id" | "light" | "dark"> {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  light: QualifiedContributionId;
  dark: QualifiedContributionId;
}

export interface QualifiedWorkspaceLabelContribution extends WorkspaceLabelContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
}
