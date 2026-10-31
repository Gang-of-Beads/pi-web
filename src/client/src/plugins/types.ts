import type { CSSResultGroup, TemplateResult } from "lit";
import type { AppAction } from "../actions";
import type { DeleteWorkspaceFileResponse, FileContentResponse, FileTreeResponse, Machine, MoveWorkspaceFileOptions, MoveWorkspaceFileResponse, RunTerminalCommandInput, TerminalCommandRun, TerminalCommandRunFilter, TerminalCommandRunHandle, TerminalInfo, WriteWorkspaceFileOptions, WriteWorkspaceFileResponse, Workspace } from "../api";
import type { AppState } from "../appState";
import type { SettingsSection } from "../settingsRoute";
import type { FileSuggestion, PluginFleet, PluginListModel, PluginMachineFacts, PluginReadFailure, PluginSessionFacts, WorkspaceUploadBatchProgress, WorkspaceUploadCancelHandle } from "../../../shared/pluginApiTypes";
import type { LocalContributionId, PluginId, QualifiedContributionId } from "./ids";
import type { PluginButton, PluginExpandableRow, PluginMessageField, PluginOutputView, PluginPanelComposer, PluginPanelSession, PluginToggle } from "../../../shared/pluginApiTypes";
import type { CodeFenceRendererContribution, ComposerRuntimeContext, ComposerSlot, ComposerStatusLine, ContributionPresentation, GlobalPanelScope, HtmlTemplateTag, ListActionContribution, ListLabelContribution, ListSectionContribution, MessageRendererViewModel, NavProjectSnapshot, NavProjectsLoad, NavSectionDisplay, NavStatusSnapshot, NavWorkspaceTrustActions, PluginBreakpoints, PluginDialog, PluginDialogHandle, PluginLifecycleEventKind, PluginLifecycleListener, PluginProjectCreateInput, PluginProjectFolders, PluginProjectTrustRead, PluginSettings, SessionSectionContribution, SvgTemplateTag, ThemeColorScheme, ThemePairContribution, ThemeTokens, ToolRendererContribution, WorkspaceBackend, WorkspaceLabelItem, WorkspacePanelIcon } from "../../../plugin-api";

export type { ComposerSendResult, ListContext, ListItem, ListItemAction, ListItemContext, ListKind, ListSection } from "../../../shared/pluginApiTypes";

export type { LocalContributionId, PluginId, QualifiedContributionId } from "./ids";

/** Shapes identical to the public plugin API are that API's own declarations, not a mirror of them. */
export type { CodeFenceRendererContribution, ComposerRuntimeContext, ComposerSlot, ComposerStatusLine, ContributionPresentation, FollowingCustomRow, GlobalPanelScope, HtmlTemplateTag, ListActionContribution, ListLabelContribution, ListSectionContribution, MessageRendererViewModel, NavProjectSnapshot, NavProjectsLoad, NavSectionDisplay, NavStatusFlags, NavStatusSnapshot, NavWorkspaceTrustActions, PluginBreakpoints, PluginDialog, PluginDialogHandle, PluginLifecycleEvent, PluginLifecycleEventKind, PluginLifecycleListener, PluginProjectCreateInput, PluginProjectFolderReply, PluginProjectFolders, PluginProjectTrustChoice, PluginProjectTrustRead, PluginSettings, SessionSectionContribution, SessionSectionSubject, SvgTemplateTag, ThemeColorScheme, ThemePairContribution, ThemeTokens, ToolRendererContribution, ToolRendererViewModel, WorkspaceBackend, WorkspaceLabelItem, WorkspaceLabelLinkItem, WorkspaceLabelRenderItem, WorkspaceLabelTextItem, WorkspacePanelIcon } from "../../../plugin-api";

export interface PiWebPluginRegistration {
  id: PluginId;
  plugin: PiWebPlugin;
  machineId?: string;
  sourcePluginId?: PluginId;
  backendRevision?: string;
  machineSpecific?: boolean;
  /** The plugin's own namespaced config block; undefined means unconfigured. */
  settings?: PluginSettings;
  /** The extension commands the package declares it runs in the session on screen (`piWeb.plugins[].sessionCommands`). */
  sessionCommands?: readonly string[];
}

export interface WorkspacePluginBinding {
  registrationPluginId: PluginId;
  sourcePluginId: PluginId;
  backendRevision?: string;
  sessionCommands?: readonly string[];
}

export interface PiWebPlugin {
  apiVersion: 2;
  name: string;
  activate: (context: PluginActivationContext) => PluginActivationResult;
}

/** What a plugin asks the reader to confirm (mirrors plugin-api.ts). */
export interface PluginConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly tone?: "danger" | "default";
}

export interface PluginHostUi {
  readonly copyText: (text: string) => Promise<boolean>;
  readonly describeError: (error: unknown) => string;
  /** Adopt literal css groups into a plugin shadow root through the host's own mechanism. */
  readonly adoptSheets?: (root: ShadowRoot, groups: CSSResultGroup[]) => void;
  readonly surfaceStyles: CSSResultGroup;
  /** The list chrome every built-in list carries, so a contributed list matches them. */
  readonly listStyles: CSSResultGroup;
  readonly renderDisclosureIcon?: (collapsed: boolean) => TemplateResult;
  readonly renderCloseIcon?: () => TemplateResult;
  /** The ⋯ menu's sheet: its toggle, the floating panel, the subject line naming what it acts on and
   *  the scrim a tap elsewhere dismisses it through, so a contributed menu is the built-in one. */
  readonly actionMenuStyles?: CSSResultGroup;
  /** The inline style that stands a ⋯ menu's panel beside its trigger and inside the viewport. */
  readonly placeActionMenu?: (trigger: HTMLElement) => string;
  /** The workspace-panel body baseline (toolbar, list, viewer, empty states),
   *  so a contributed panel body matches the built-in panel instead of
   *  inventing its own chrome. Adopt per element instance in createRenderRoot:
   *  static styles freeze at module load, before the host is remembered. */
  readonly workspacePanelStyles: CSSResultGroup;
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
  /** Ask the reader to confirm on the app's own dialog (B40), never `window.confirm`.
   *  Resolves true only for the confirming key; Cancel, Escape, the backdrop and
   *  the back gesture resolve false. */
  readonly confirm: (request: PluginConfirmRequest) => Promise<boolean>;
  readonly renderList: (model: PluginListModel) => TemplateResult;
  readonly renderButton: (button: PluginButton) => TemplateResult;
  readonly renderOutput: (output: PluginOutputView) => TemplateResult;
  readonly renderMessageField: (field: PluginMessageField) => TemplateResult;
  readonly renderExpandableRow: (row: PluginExpandableRow) => TemplateResult;
  readonly renderToggle: (toggle: PluginToggle) => TemplateResult;
  /** What a failed read means (B48): retry quietly after a delay, or a stated refusal to show. */
  readonly readFailure: (error: unknown, attempt: number) => PluginReadFailure;
  /** Namespaced query-string state the host keeps coordinated with route
   *  restoration. The namespace is the plugin's wire format for deep links. */
  readonly query: {
    read(namespace: string, key: string): string | undefined;
    write(namespace: string, key: string, value: string | undefined, options?: { replace?: boolean }): void;
  };
}

export interface PluginActivationContext {
  readonly apiVersion: 2;
  /** Subscribe to a host fact; the returned function unsubscribes. */
  readonly on?: <K extends PluginLifecycleEventKind>(kind: K, listener: PluginLifecycleListener<K>) => () => void;
  readonly sessions?: PluginSessionFacts;
  readonly machines?: PluginMachineFacts;
  /** The host's machines, session boards and navigation, per plugin: its subscriptions are dropped with it. */
  readonly fleet?: PluginFleet;
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
   * The PI WEB status of the machine this registration belongs to (its components and their
   * versions, the release check, the update commands), read once for the page and every plugin. Absent on hosts older than this contract; read
   * `api/pi-web/status` through `fetchJson` there, which answers for the machine serving the page.
   */
  readonly readPiWebStatus?: () => Promise<unknown>;
  readonly openPage?: (pageId: QualifiedContributionId) => void;
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

/**
 * What the host feeds a contributed navigation section. The snapshot and the
 * actions are the host's; a section renders them through its own rows and
 * never calls a PI WEB API or spells a URL.
 */
export interface NavSectionContext {
  readonly projects: readonly NavProjectSnapshot[];
  readonly projectsLoad: NavProjectsLoad;
  /**
   * Why the projects have not loaded, in the words of the server that said so (a remote machine whose
   * access gate refused this server's token, say); absent while a read is pending or has simply had no
   * answer, which the host's app row speaks for.
   */
  readonly projectsProblem?: string;
  readonly workspaces: readonly Workspace[];
  /** The listing's state: the empty claim may only speak after `loaded`. */
  readonly workspacesLoad: NavProjectsLoad;
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
  readonly retryWorkspacesLoad: () => void;
  readonly toggleCollapsed: () => void;
  readonly focusPreviousSection: () => void | Promise<void>;
  readonly focusNextSection: () => void | Promise<void>;
  readonly cancelKeyboardNavigation: () => void | Promise<void>;
}

/** Slot ids the shell reserves for context-navigation sections. */
export type ReservedNavSectionId = "projects" | "workspaces";

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

export interface PluginContributions {
  actions?: PluginAction[];
  navSections?: NavSectionContribution[];
  workspacePanels?: WorkspacePanelContribution[];
  globalPanels?: GlobalPanelContribution[];
  workspaceLabels?: WorkspaceLabelContribution[];
  themes?: ThemeContribution[];
  themePairs?: ThemePairContribution[];
  composer?: ComposerContribution[];
  settingsSections?: SettingsSectionContribution[];
  messageRenderers?: MessageRendererContribution[];
  codeFenceRenderers?: CodeFenceRendererContribution[];
  toolRenderers?: ToolRendererContribution[];
  activityNotes?: ActivityNoteContribution[];
  sessionSections?: SessionSectionContribution[];
  messageActions?: MessageActionContribution[];
  listLabels?: ListLabelContribution[];
  listActions?: ListActionContribution[];
  listSections?: ListSectionContribution[];
}

export interface QualifiedListLabelContribution extends ListLabelContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

export interface QualifiedListActionContribution extends ListActionContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

export interface QualifiedListSectionContribution extends ListSectionContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

/** One transcript message as a plugin action may act on it (mirrors plugin-api.ts). */
export interface MessageActionRow {
  readonly machineId: string;
  readonly sessionId: string;
  readonly cwd: string | undefined;
  readonly messageId: string;
  readonly role: MessageActionRole;
  readonly text: string;
  readonly streaming: boolean;
  readonly requestUpdate: () => void;
}

export type MessageActionRole = "assistant" | "user";

/** A button on transcript messages of the roles it names (mirrors plugin-api.ts). */
export interface MessageActionContribution {
  id: LocalContributionId;
  title: string;
  icon: TemplateResult;
  roles: readonly MessageActionRole[];
  order?: number;
  available?: (row: MessageActionRow) => boolean;
  presentation?: (row: MessageActionRow) => ContributionPresentation | undefined;
  run: (row: MessageActionRow) => void | Promise<void>;
}

export interface QualifiedMessageActionContribution extends MessageActionContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

/**
 * A short line the activity dock shows beside the session's own state, for
 * work the shell does not own. "idle" is about the assistant's turn; a plugin
 * that knows something is still running - background tasks, a queue, an
 * external job - says so here rather than teaching the shell its domain.
 */
export interface ActivityNoteContribution {
  id: LocalContributionId;
  order?: number;
  /** The note, or undefined when this plugin has nothing to add right now. */
  note: (context: ActivityNoteContext) => string | undefined;
}

export interface ActivityNoteContext {
  sessionId: string;
  machineId: string;
  sessionCwd: string | undefined;
  /** The session status frame the shell already holds, unread by the shell's own dock. */
  status: unknown;
  /** Whether the assistant's own turn is idle, which is when a note is worth showing. */
  idle: boolean;
}

export interface QualifiedActivityNoteContribution extends ActivityNoteContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

export interface MessageRendererContribution {
  id: LocalContributionId;
  /** The custom payload tag this renderer claims. */
  tag: string;
  render: (view: MessageRendererViewModel) => TemplateResult;
}

export interface QualifiedCodeFenceRendererContribution extends CodeFenceRendererContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

export interface QualifiedToolRendererContribution extends ToolRendererContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

export interface QualifiedMessageRendererContribution extends MessageRendererContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
}

export interface ComposerContribution {
  id: LocalContributionId;
  slot: ComposerSlot;
  title: string;
  icon?: TemplateResult;
  order?: number;
  /**
   * Whether this control belongs in the composer at all. A capability the
   * machine does not have is absent, not greyed out: a disabled control is a
   * promise the product cannot keep, and the reader cannot tell it apart from
   * one that is merely busy. Use `enabled` for "not right now".
   */
  available?: (context: ComposerRuntimeContext) => boolean;
  enabled?: (context: ComposerRuntimeContext) => boolean;
  disabledReason?: (context: ComposerRuntimeContext) => string | undefined;
  /** Rendered live under the input while defined; undefined renders nothing. */
  status?: (context: ComposerRuntimeContext) => ComposerStatusLine | undefined;
  /**
   * The control's live state, read on every redraw (after `requestUpdate`): `pressed` draws it as
   * a toggle, and `title` and `icon` replace the declared ones while the state lasts. One that
   * throws is logged and the control is drawn with its declared title and icon. Ignored by hosts
   * older than this member, which draw the declared title and icon.
   */
  presentation?: (context: ComposerRuntimeContext) => ContributionPresentation | undefined;
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

export interface WorkspaceHost {
  requestRender(): void;
  /** Whether the shown page holds the whole app canvas now. False for a
   *  page that did not declare `fullscreen`, and on a window too narrow to
   *  show it (the request is kept; the page returns to the canvas when the
   *  window widens). */
  workspacePanelFullscreen(): boolean;
  /** Ask for the whole app canvas, or give it back. The host ignores the ask
   *  from a page that did not declare `fullscreen`, and gives the canvas
   *  back itself when the reader leaves the page. */
  setWorkspacePanelFullscreen(fullscreen: boolean): void;
  /** Whether the window is wide enough to show a page on the whole canvas
   *  (the desktop side-by-side layout). A page that declared `fullscreen`
   *  draws its enter control only while this is true. Hosts older than this
   *  method lack it: offer no enter control there. */
  workspacePanelFullscreenAvailable?(): boolean;
  /** Re-read what the app shows about this machine, project and workspaces
   *  after the panel changed it on disk (a worktree added, a checkout gone):
   *  the host owns the catalog, so the panel reports and never edits it. */
  refreshAppData?(): void | Promise<void>;
  /** Whether this page is on screen now (`PluginRegistry.isPageShown`); the registry binds it to the page. */
  shown?(): boolean;
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
  /** Give a shell a new name; the daemon keeps it, so every page that lists the shell reads it (R12). */
  rename(terminalId: string, name: string): Promise<TerminalInfo>;
  connect(terminalId: string, initialSize?: { cols: number; rows: number }): WebSocket;
  /** Command runs belonging to this workspace, and the ability to stop one. */
  listCommandRuns(): Promise<TerminalCommandRun[]>;
  cancelCommandRun(runId: string): Promise<TerminalCommandRun>;
}

/**
 * The machine's own terminals, in its home folder (docs/design/go-to-scopes.md): sessions without
 * command runs, whose records stay project-scoped.
 */
export type MachineTerminalSessions = Omit<WorkspaceTerminalSessions, "listCommandRuns" | "cancelCommandRun">;

/** The terminal capability a global page is handed: the machine's home folder, never a project's. */
export interface GlobalPanelTerminal {
  sessions: MachineTerminalSessions;
  selectedId: string | undefined;
  autoStart: boolean;
  select: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => void;
  /** Show the global Terminal page, on `terminalId` when given. */
  open(options?: { terminalId?: string | undefined }): void;
  /** Start a shell in the home folder, type `command` into it, and show it on the global Terminal page. */
  runInNewTerminal(input: { title: string; command: string }): Promise<void>;
}

/**
 * What a global page is handed: the machine on screen, never a project. It has no workspace, no
 * files and no prompt editor, so a global page cannot reach a project by accident.
 */
export interface GlobalPanelContext {
  machine: PluginMachine;
  state: AppState;
  host: WorkspaceHost;
  terminal: GlobalPanelTerminal;
  checkForPiWebUpdates: () => Promise<void>;
  openUpdateCommandSetting: () => void;
  /** The page's own plugin's fleet; the registry hands each page its plugin's, so its subscriptions go with that plugin. */
  fleet?: PluginFleet;
}

/**
 * A page about the machine on screen, which needs no project (docs/design/go-to-scopes.md, owner
 * 2026-10-05). Go to lists it while no project is in scope, and in a project's scope when its
 * plugin brings no project page of its own.
 */
export interface GlobalPanelContribution {
  id: LocalContributionId;
  title: string;
  icon?: WorkspacePanelIcon;
  order?: number;
  /** Slots the host opens by name, e.g. `core:global.terminal`; the host never names a plugin. */
  routeAliases?: string[];
  /** `fleet`: one page about every machine, from the gateway's own registration only, active on any selected machine. */
  scope?: GlobalPanelScope;
  visible?: (context: GlobalPanelContext) => boolean;
  /**
   * The agent-side surface this page fronts, by the name its server plugin declares in
   * `agentFacts.surfaces`. Go to leaves the page out while the session on screen reports that
   * surface absent (nothing it loaded registers the surface's tools); a failed load, or no answer,
   * keeps it.
   */
  fronts?: string;
  badge?: (context: GlobalPanelContext) => string | number | TemplateResult | undefined;
  toolbar?: (context: GlobalPanelContext) => TemplateResult;
  render: (context: GlobalPanelContext) => TemplateResult;
}

export interface QualifiedGlobalPanelContribution extends Omit<GlobalPanelContribution, "toolbar"> {
  id: QualifiedContributionId;
  /** The page's controls; undefined when its plugin's `toolbar` threw, and the page then draws without them. */
  toolbar?: (context: GlobalPanelContext) => TemplateResult | undefined;
  pluginId: PluginId;
  localId: LocalContributionId;
  machineId?: string;
  sourcePluginId?: PluginId;
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
  /** Folder access bound to the machine selected now, for the add-project dialog. */
  projectFolders?: () => PluginProjectFolders;
  /**
   * Machine management capabilities the host offers over its core selection
   * engine. Absent where the host offers no such management; the machines
   * plugin's palette actions omit the matching entries rather than guessing.
   */
  removeMachine?: (machineId: string) => void | Promise<void>;
  refreshMachine?: (machineId: string) => void | Promise<void>;
  /** Open a remote machine's PI WEB in a new tab; remote machines only. */
  openMachine?: (machineId: string) => void | Promise<void>;
  /** Open the host's rename dialog for a machine. */
  renameMachine?: (machineId: string) => void;
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

/**
 * Local ids of the actions the shell runs from keys it draws itself: `add-project` from its
 * Add project keys, `add-machine` from Add machine, and `restart-pi-web` from the version strip that
 * asks for a restart after an update was installed. A plugin claims the key by contributing its
 * action under that id; the shell names the slot, never the plugin.
 */
export type ReservedActionId = "add-project" | "add-machine" | "restart-pi-web";

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
  /** The session on screen while it is this workspace's; its `runCommand` only for a plugin that declared `sessionCommands`. Absent with no session open, while the session is another workspace's, and while its folder is not known yet. */
  session?: PluginPanelSession;
  /** The draft and Send of the session on screen; absent with no session open or an archived one. */
  composer?: PluginPanelComposer;
  piWebUnstable?: Pick<PiWebUnstableRuntimeContext, "terminalCommandRuns">;
  activeTerminalCount: number;
  selectedTerminalId: string | undefined;
  terminalAutoStart: boolean;
  onSelectTerminal: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => void;
}

export interface WorkspacePanelContribution {
  id: LocalContributionId;
  title: string;
  icon?: WorkspacePanelIcon;
  order?: number;
  /** Former URL tool/view values that should resolve to this panel. */
  routeAliases?: string[];
  visible?: (context: WorkspacePanelContext) => boolean;
  /**
   * The agent-side surface this page fronts, by the name its server plugin declares in
   * `agentFacts.surfaces`. Go to leaves the page out while the session on screen reports that
   * surface absent (nothing it loaded registers the surface's tools); a failed load, or no answer,
   * keeps it.
   */
  fronts?: string;
  badge?: (context: WorkspacePanelContext) => string | number | TemplateResult | undefined;
  onInvalidate?: (context: WorkspacePanelContext) => void | Promise<void>;
  /** No longer drawn: the host draws no title row under the app bar. */
  summary?: (context: WorkspacePanelContext) => string | undefined;
  /** The panel's controls, drawn at the top of its page and always visible. */
  toolbar?: (context: WorkspacePanelContext) => TemplateResult;
  /** The page can take the whole app canvas on a wide window, hiding the
   *  app's other columns. The host draws no control for it: the page draws
   *  its own enter control (while `host.workspacePanelFullscreenAvailable()`)
   *  and its own exit control (while `host.workspacePanelFullscreen()`), and
   *  asks through `host.setWorkspacePanelFullscreen`. A page that does not
   *  declare it is never shown on the whole canvas, whatever a link says. */
  fullscreen?: boolean;
  render: (context: WorkspacePanelContext) => TemplateResult;
}

export interface QualifiedWorkspacePanelContribution extends Omit<WorkspacePanelContribution, "toolbar"> {
  id: QualifiedContributionId;
  /** The panel's controls; undefined when its plugin's `toolbar` threw, and the page then draws without them. */
  toolbar?: (context: WorkspacePanelContext) => TemplateResult | undefined;
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

export interface WorkspaceLabelContribution {
  id: LocalContributionId;
  order?: number;
  visible?: (context: WorkspaceLabelContext) => boolean;
  items: (context: WorkspaceLabelContext) => WorkspaceLabelItem[];
}

import type { ThemeToken } from "../../../shared/pluginApiTypes";
import type { ForegroundToken, LegacyThemeToken, MessageRoleToken, SemanticSurfaceToken, ShapeTypographyToken } from "../../../shared/pluginApiTypes";
export type { ThemeToken, LegacyThemeToken, SemanticSurfaceToken, ForegroundToken, ShapeTypographyToken, MessageRoleToken };

export interface ThemeContribution {
  id: LocalContributionId;
  /** Prefer this available concrete theme; tokens remain the fallback for other hosts. */
  replacedBy?: QualifiedContributionId;
  name: string;
  description?: string;
  order?: number;
  colorScheme: ThemeColorScheme;
  tokens: ThemeTokens;
  /**
   * The tab icon while this theme is active: inline SVG markup or an image
   * URL. Without one the host typesets the product's pi glyph in the theme's
   * accent, so a theme only declares this when it wants its own mark.
   */
  icon?: string;
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
