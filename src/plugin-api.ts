import type { CSSResultGroup, TemplateResult } from "lit";
import type { ThemeToken, TerminalCommandRun, TerminalInfo, DeleteWorkspaceFileResponse, FileContentResponse, FileTreeResponse, JsonValue, MachineKind, MoveWorkspaceFileOptions, MoveWorkspaceFileResponse, PiWebStatusResponse, TerminalCommandRunHandle, WorkspaceProviderMetadata, WorkspaceRemovalPresentation, WriteWorkspaceFileOptions, WriteWorkspaceFileResponse } from "./shared/pluginApiTypes.js";

export type {
  ThemeToken,
  TerminalInfo,
  FileContentMediaType,
  FileContentResponse,
  FileTreeEntry,
  FileTreeResponse,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MachineKind,
  PiWebComponentStatus,
  PiWebDockerMode,
  PiWebInstallationInfo,
  PiWebInstallationKind,
  PiWebReleaseStatus,
  PiWebServiceComponent,
  PiWebStatusMessage,
  PiWebStatusResponse,
  PiWebStatusSeverity,
  PiWebVersionResponse,
  TerminalCommandRun,
  TerminalCommandRunHandle,
  TerminalCommandRunStatus,
  WorkspaceProviderCapabilities,
  WorkspaceProviderMetadata,
  WorkspaceRemovalPresentation,
  WriteWorkspaceFileOptions,
  WriteWorkspaceFileResponse,
  DeleteWorkspaceFileResponse,
  MoveWorkspaceFileOptions,
  MoveWorkspaceFileResponse,
} from "./shared/pluginApiTypes.js";

export type PluginId = string;
export type LocalContributionId = string;
export type QualifiedContributionId = `${PluginId}:${LocalContributionId}`;
export type HtmlTemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => TemplateResult;
export type SvgTemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => TemplateResult;

export interface PiWebPlugin {
  apiVersion: 2;
  name: string;
  activate: (context: PluginActivationContext) => PluginActivationResult;
}

/** Host-owned frozen values supplied once during browser plugin activation. */
export interface PluginActivationContext {
  readonly apiVersion: 2;
  /** Stable package/source identity, including on federated machines. */
  readonly pluginId: PluginId;
  /** Host-unique identity for qualified contribution references in this runtime. */
  readonly runtimePluginId: PluginId;
  readonly html: HtmlTemplateTag;
  readonly svg: SvgTemplateTag;
  /** Subscribe to a host fact; the returned function unsubscribes. Absent on hosts older than this contract. */
  readonly on?: <K extends PluginLifecycleEventKind>(kind: K, listener: PluginLifecycleListener<K>) => () => void;
  /** This plugin's own configuration block, or undefined when unconfigured. */
  readonly settings?: PluginSettings | undefined;
  /** Call one of this host's JSON endpoints; the host owns path resolution. */
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
   * breakpoints.
   */
  readonly ui?: PluginHostUi;
}

export type PluginLifecycleEvent =
  | { kind: "session-selected"; sessionId: string; machineId: string | undefined }
  | { kind: "session-left"; sessionId: string }
  | { kind: "connection-changed"; connected: boolean }
  | { kind: "theme-applied"; themeId: string }
  | { kind: "settings-changed"; settings: PluginSettings };

/**
 * A plugin's own namespaced configuration block, delivered opaquely. Absent
 * means unconfigured, which a plugin must not read as "configured empty".
 */
export type PluginSettings = Readonly<Record<string, unknown>>;

export interface WorkspaceTerminalSessions {
  list(): Promise<TerminalInfo[]>;
  start(options?: { name?: string; cols?: number; rows?: number }): Promise<TerminalInfo>;
  close(terminalId: string): Promise<void>;
  closeAll(): Promise<void>;
  continue(terminalId: string): Promise<TerminalInfo>;
  connect(terminalId: string, initialSize?: { cols: number; rows: number }): WebSocket;
  listCommandRuns(): Promise<TerminalCommandRun[]>;
  cancelCommandRun(runId: string): Promise<TerminalCommandRun>;
}

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

export interface PluginActivationResult {
  contributions: PluginContributions;
  /** Released when the plugin is unregistered; subscriptions are dropped regardless. */
  dispose?: () => void;
}

/** A settings section a plugin owns inside the core settings shell. */
export interface SettingsSectionContribution {
  id: LocalContributionId;
  title: string;
  order?: number;
  render: (context: PluginRuntimeContext) => TemplateResult;
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
 * A section in the session drawer, beside Activity and Notifications. The
 * shell keeps tab selection, keyboard order and the collapsed state; the
 * plugin brings a label and a body. `available` answering undefined means the
 * section cannot say yet, and the shell shows the tab rather than claiming the
 * feature is missing.
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

/**
 * Claims one custom payload tag in the transcript. The runtime supplies the
 * card chrome so plugin cards keep the corner and settled-outcome contracts;
 * an unclaimed tag renders as an honest unknown card, never as nothing.
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
  tag: string;
  render: (view: MessageRendererViewModel) => TemplateResult;
}

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
  status?: (context: ComposerRuntimeContext) => ComposerStatusLine | undefined;
  run: (context: ComposerRuntimeContext) => void | Promise<void>;
}

export interface PluginMachine {
  id: string;
  name: string;
  kind: MachineKind;
}

export interface PluginRuntimeState {
  /** Identity of the currently selected machine. Undefined only on older hosts or before machines load. */
  selectedMachine?: PluginMachine;
  selectedWorkspace?: Workspace;
  selectedSession?: unknown;
  workspaceTool?: string;
  mainView?: string;
  piWebStatus?: PiWebStatusResponse;
}

export interface PluginPromptEditor {
  /** Insert text at the current cursor position. Replaces any selection.
   *  If the editor is not focused, focuses it first.
   *  No-op if the editor is not mounted. */
  insertText(text: string): void;
  /** Get the current prompt text content. Returns "" if the editor is not mounted. */
  getText(): string;
  /** Get the current selection range, or null if no selection or editor not mounted. */
  getSelection(): { start: number; end: number; text: string } | null;
}

export interface PluginRuntimeContext {
  state: PluginRuntimeState;
  prompt: PluginPromptEditor;
  openActionPalette: () => void;
  focusPrompt: () => void;
  addProject: () => void | Promise<void>;
  configureAuth: () => void | Promise<void>;
  logoutAuth: () => void | Promise<void>;
  openThemePicker: () => void;
  selectMainView: (view: string) => void;
  selectWorkspaceTool: (tool: QualifiedContributionId) => void;
  openTerminal: (options?: { terminalId?: string | undefined }) => void;
  refreshFiles: () => void | Promise<void>;
  /** Invalidate plugin workspace-panel data for the selected workspace, optionally targeting one qualified panel id. */
  refreshWorkspacePanels: (panelId?: QualifiedContributionId) => void | Promise<void>;
  refreshAppData: () => void | Promise<void>;
  /** Force a fresh PI WEB release check on the selected machine. Optional for compatibility with older hosts. */
  checkForPiWebUpdates?: () => void | Promise<void>;
  reloadPage: () => void;
  startSession: () => void | Promise<void>;
  archiveSession: () => void | Promise<void>;
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

/** Host-resolved workspace snapshot exposed to browser plugin callbacks. */
export interface Workspace {
  readonly id: string;
  readonly projectId: string;
  readonly path: string;
  readonly label: string;
  readonly isMain: boolean;
  readonly provider?: WorkspaceProviderMetadata;
  readonly removal?: WorkspaceRemovalPresentation;
}

export interface WorkspaceFiles {
  /** Read a file from the workspace. Works for local and federated machines. */
  readFile(path: string): Promise<FileContentResponse>;
  /** List the entries of a workspace directory. Pass "" for the workspace root.
   *  Works for local and federated machines. Rejects when the directory does not
   *  exist or cannot be read, matching readFile error behavior. */
  listFiles(path: string): Promise<FileTreeResponse>;
  /** Write content to a workspace file. Creates intermediate directories by default.
   *  Works for local and federated machines. Auto-refreshes the file explorer after success. */
  writeFile(path: string, content: string | Uint8Array, options?: WriteWorkspaceFileOptions): Promise<WriteWorkspaceFileResponse>;
  /** Delete a file from the workspace. Idempotent — returns { existed: false } if file doesn't exist.
   *  Deletes the entry itself (for symlinks, removes the symlink not the target). */
  deleteFile(path: string): Promise<DeleteWorkspaceFileResponse>;
  /** Move or rename a file within the workspace. Unix mv semantics.
   *  Default overwrite: false (safer than writeFile). Auto-refreshes the file explorer after success. */
  moveFile(fromPath: string, toPath: string, options?: MoveWorkspaceFileOptions): Promise<MoveWorkspaceFileResponse>;
}

export type WorkspacePanelFiles = WorkspaceFiles;

/** JSON-only request path to the server module that currently owns this workspace. */
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

export type WorkspacePanelHost = WorkspaceHost;

export interface WorkspaceContext {
  machine: PluginMachine;
  workspace: Workspace;
  state?: PluginRuntimeState;
  files: WorkspaceFiles;
  /** Present only when this browser entry has a paired active server backend. */
  backend?: WorkspaceBackend;
  host: WorkspaceHost;
}

export interface WorkspaceTerminalCommandInput {
  title: string;
  command: string;
  metadata?: Record<string, string>;
  open?: boolean;
}

export interface WorkspacePanelTerminal {
  open(options?: { terminalId?: string | undefined }): void;
  runCommand(input: WorkspaceTerminalCommandInput): Promise<TerminalCommandRunHandle>;
  /** The pty capability itself, scoped by the host to this workspace. */
  sessions: WorkspaceTerminalSessions;
  activeCount: number;
  selectedId: string | undefined;
  autoStart: boolean;
  select: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => void;
}

export interface WorkspacePanelContext extends WorkspaceContext {
  prompt: PluginPromptEditor;
  terminal: WorkspacePanelTerminal;
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
  /** Called when the host invalidates workspace-panel data. */
  onInvalidate?: (context: WorkspacePanelContext) => void | Promise<void>;
  render: (context: WorkspacePanelContext) => TemplateResult;
}

export interface WorkspaceLabelContext extends WorkspaceContext {
  machine: PluginMachine;
  workspace: Workspace;
  state?: PluginRuntimeState;
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
