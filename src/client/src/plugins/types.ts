import type { CSSResultGroup, TemplateResult } from "lit";
import type { AppAction } from "../actions";
import type { DeleteWorkspaceFileResponse, FileContentResponse, FileTreeResponse, JsonValue, Machine, MoveWorkspaceFileOptions, MoveWorkspaceFileResponse, RunTerminalCommandInput, TerminalCommandRun, TerminalCommandRunFilter, TerminalCommandRunHandle, TerminalInfo, WriteWorkspaceFileOptions, WriteWorkspaceFileResponse, Workspace } from "../api";
import type { AppState } from "../appState";
import type { SettingsSection } from "../settingsRoute";
import type { FileSuggestion, PluginListModel, WorkspaceUploadBatchProgress, WorkspaceUploadCancelHandle } from "../../../shared/pluginApiTypes";
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
  /** How the host presents the dialog. `overlay` (default) is the shared
   *  centered surface; `fullscreen` presents the content edge-to-edge like a
   *  page, so a surface authored against a large canvas survives direct load
   *  and refresh instead of being squeezed into a card. The content MUST
   *  work at both presentations unless it pins one explicitly. Fullscreen
   *  covers the backdrop entirely, so the content MUST provide its own close
   *  control - Escape and the backdrop are overlay affordances only. */
  /** `alert` is the compact centered card a confirmation uses: at most 480px wide and
   *  never touching a phone's edges, like the app's own small dialogs. */
  readonly presentation?: "overlay" | "fullscreen" | "alert";
  /** Called once for every close: Escape, backdrop, close(), or unregistration.
   *  On a fullscreen presentation only close() and unregistration fire. */
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
  /** Short-viewport line (keyboard up, landscape phones): vertical chrome shrinks. */
  readonly shortViewport: string;
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
  activityNotes?: ActivityNoteContribution[];
  sessionSections?: SessionSectionContribution[];
}

/**
 * A section in every list of sessions (the Navigate page, the session search). A session lands in
 * the first section, by `order`, that claims it; core's are Pinned (100), Active (500) and Archived
 * (900), so a plugin picks an order between them. Inside a section, sessions order by what they need
 * from the reader, then by their last activity; a section does not choose its own order.
 */
export interface SessionSectionContribution {
  id: LocalContributionId;
  title: string;
  order: number;
  /** Folded until the reader opens it, the first time a list shows it. */
  foldedByDefault?: boolean;
  /** Whether the session belongs here. A claim that throws claims nothing. */
  claims: (subject: SessionSectionSubject) => boolean;
}

/** What a section's claim sees of a session. */
export interface SessionSectionSubject {
  readonly sessionId: string;
  readonly machineId: string;
  readonly cwd: string;
  readonly name: string | undefined;
  readonly pinned: boolean;
  readonly archived: boolean;
}

export interface QualifiedSessionSectionContribution extends SessionSectionContribution {
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

/** A custom row after the one being drawn: its tag, what it is, and its payload (`MessageRendererViewModel.followingRows`). */
export interface FollowingCustomRow {
  readonly tag: string;
  readonly kind: "message" | "entry";
  readonly payload: unknown;
}

/**
 * A message renderer claims one custom payload tag in the transcript.
 *
 * The transcript asks the registry before its built-in renderers; when nobody
 * claims a tag it draws the extension's own pi drawing or pi's default (the type
 * and the content), so an unclaimed row never disappears. The tag's custom
 * entries reach the renderer too (`kind`). A renderer receives a frozen
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
  /**
   * Put text in the composer for the reader to edit and send. A card that
   * knows what a reply should say can offer it without sending anything in
   * the reader's name.
   */
  readonly insertIntoComposer?: ((text: string) => void) | undefined;
  /**
   * Send text to this session as the reader, exactly as typing it would. The
   * only channel a browser has into a running agent: a card that needs to act
   * says what it is sending and sends that.
   */
  readonly sendMessage?: ((text: string) => void | Promise<void>) | undefined;
  /**
   * What the reader said after this message: the texts of the later user messages in the
   * transcript as loaded, oldest first. A card that asks for a reply can tell it was answered
   * from this, rather than from its own memory, which a reload or a session switch erases.
   * Only what is loaded: a transcript whose newest messages are not loaded yet says less.
   */
  readonly followingUserTexts?: readonly string[] | undefined;
  /**
   * The custom rows after this one in the transcript as loaded, oldest first: what the session's
   * extensions recorded later (a reply one journaled, a result one posted), so a card can tell what
   * became of what it shows from the extension's own records rather than from what the reader typed.
   * Only what is loaded, as for `followingUserTexts`. Absent on hosts older than the field.
   */
  readonly followingRows?: readonly FollowingCustomRow[] | undefined;
  /**
   * What the row is: an extension's custom message, or a custom session entry an extension
   * registered a pi renderer for (`pi.registerEntryRenderer`). Absent on hosts older than entry rows,
   * where every row is a message.
   */
  readonly kind?: "message" | "entry" | undefined;
  /**
   * The lines the extension's own pi renderer draws for this row, as pi's terminal shows it. Absent
   * means no drawing is available: the session's runtime was not open when the row was read, no
   * extension registered a renderer for the type, or it drew nothing. A plugin may show the lines,
   * or draw the row its own way.
   */
  readonly drawn?: readonly string[] | undefined;
}

export interface MessageRendererContribution {
  id: LocalContributionId;
  /** The custom payload tag this renderer claims. */
  tag: string;
  render: (view: MessageRendererViewModel) => TemplateResult;
}

/**
 * Claims one fenced code language in the transcript. The host parses and
 * sanitizes the markdown as before; once a code block has settled, the
 * claimant is handed the fence's source text and returns a DOM node the
 * transcript shows in the block's place, keeping the source block underneath
 * for copy. A thrown error or rejected promise leaves the plain code block
 * standing - a diagram that fails to draw is still readable text, never an
 * empty hole. One plugin per language per machine; a second claim is a
 * registration error, not a silent override.
 */
export interface CodeFenceRendererContribution {
  id: LocalContributionId;
  /** The info-string language this renderer claims, lowercase (e.g. "mermaid"). */
  language: string;
  render: (source: string) => Node | Promise<Node>;
}

export interface QualifiedCodeFenceRendererContribution extends CodeFenceRendererContribution {
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

export interface QualifiedGlobalPanelContribution extends GlobalPanelContribution {
  id: QualifiedContributionId;
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
  /**
   * Machine management capabilities the host offers over its core selection
   * engine. Absent where the host offers no such management; the machines
   * plugin's palette actions omit the matching entries rather than guessing.
   */
  removeMachine?: (machineId: string) => void | Promise<void>;
  refreshMachine?: (machineId: string) => void | Promise<void>;
  /** Open a remote machine's PI WEB in a new tab; remote machines only. */
  openMachine?: (machineId: string) => void | Promise<void>;
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
import type { ForegroundToken, LegacyThemeToken, SemanticSurfaceToken, ShapeTypographyToken } from "../../../shared/pluginApiTypes";
export type { ThemeToken, LegacyThemeToken, SemanticSurfaceToken, ForegroundToken, ShapeTypographyToken };

export type ThemeTokens = Record<LegacyThemeToken, string> & Partial<Record<SemanticSurfaceToken | ForegroundToken | ShapeTypographyToken, string>>;

export interface ThemeContribution {
  id: LocalContributionId;
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
