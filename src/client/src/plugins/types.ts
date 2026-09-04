import type { CSSResultGroup, TemplateResult } from "lit";
import type { AppAction } from "../actions";
import type { DeleteWorkspaceFileResponse, FileContentResponse, FileTreeEntry, FileTreeResponse, JsonValue, Machine, MoveWorkspaceFileOptions, MoveWorkspaceFileResponse, RunTerminalCommandInput, TerminalCommandRun, TerminalCommandRunFilter, TerminalCommandRunHandle, TerminalInfo, WriteWorkspaceFileOptions, WriteWorkspaceFileResponse, Workspace } from "../api";
import type { AppState } from "../appState";
import type { SettingsSection } from "../settingsRoute";
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

export interface PluginContributions {
  actions?: PluginAction[];
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
  fileTree: FileTreeEntry[];
  fileTreeFailed: string | undefined;
  expandedDirs: Record<string, FileTreeEntry[]>;
  selectedFilePath: string | undefined;
  selectedFileContent: FileContentResponse | undefined;
  selectedFileLoadError: string | undefined;
  fileTreeStale: boolean;
  activeTerminalCount: number;
  selectedTerminalId: string | undefined;
  terminalAutoStart: boolean;
  workspaceUploadDefaultFolder: string;
  onRefreshFiles: () => void;
  onExpandDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  onStartWorkspaceUpload: (files: readonly File[], options: { destinationFolder: string; createDirs?: boolean; overwrite?: boolean; selectUploadedFile?: boolean }) => { batchId: string; done: Promise<void> } | undefined;
  onCancelWorkspaceUpload: (batchId: string) => void;
  onClearWorkspaceUpload: (batchId: string) => void;
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
export type { ThemeToken };

export type ThemeTokens = Record<ThemeToken, string>;

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
