// Dependency-free DTOs shared by PI WEB's public plugin entrypoints and host protocols.

export type MachineKind = "local" | "remote";

/**
 * Where a page reaches a remote machine from (docs/design/browser-direct-machines.md, owner decision
 * 1b): the browser itself, at the machine's base URL, or through the PI WEB it opened, which forwards.
 */
export type MachineConnection = "browser" | "server";

/**
 * The machine DTOs the server contract hands plugins. They are type-only
 * re-exports: the shapes live beside the host's own client types so one
 * definition serves both, and the re-export keeps the contract's import
 * surface on this file.
 */
export type { Machine, MachineHealth, MachineRuntime, PiWebDeprecatedAgentInput, PiWebRuntimeComponent, PiWebRuntimeResponse } from "./apiTypes.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface WorkspaceProviderCapabilities {
  readonly request: boolean;
  /** True only when this specific workspace advertises removal. */
  readonly remove: boolean;
}

/** Public identity and browser-visible data for the plugin that owns a workspace. */
export interface WorkspaceProviderMetadata {
  readonly pluginId: string;
  readonly capabilities: WorkspaceProviderCapabilities;
  readonly metadata?: JsonObject;
}

/** Provider-authored removal wording exposed to browser plugins. */
export interface WorkspaceRemovalPresentation {
  readonly actionLabel: string;
  readonly confirmation: string;
}

export interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size?: number;
  modifiedAt?: string;
}

export interface FileTreeResponse {
  path: string;
  entries: FileTreeEntry[];
  scannedAt: string;
  truncated: boolean;
}

export type FileContentMediaType = "image" | "html" | "pdf" | "markdown" | "audio" | "video";

export interface FileSuggestion {
  path: string;
  kind: "tracked" | "untracked" | "other";
}

/**
 * One folder to list for the add-project folder browser: a path as the reader entered or chose it
 * (empty means the machine's home folder), or, with `child`, a new folder's name under that path.
 * The machine resolves and joins it with its own path rules; the page never splits or joins paths.
 */
export interface ProjectFolderListingRequest {
  readonly path: string;
  readonly child?: string;
}

/** One step of an absolute path, root first, spelled the way the machine spells it. */
export interface ProjectFolderCrumb {
  readonly name: string;
  readonly path: string;
}

/** A subfolder the folder browser can enter. */
export interface ProjectFolderEntry {
  readonly name: string;
  readonly path: string;
}

/** Why a folder that exists, or might, could not be listed. None of these means the folder is empty. */
export type ProjectFolderUnreadableCause = "not-a-folder" | "denied" | "timed-out" | "failed";

/**
 * What one listing found. `complete` is every subfolder; `truncated` is the first `folders` of
 * `total`; `incomplete` stopped before every linked folder was checked; `missing` is a folder that
 * does not exist yet, which adding the project creates; `unreadable` names why it could not be read.
 */
export type ProjectFolderContents =
  | { readonly kind: "complete"; readonly folders: readonly ProjectFolderEntry[] }
  | { readonly kind: "truncated"; readonly folders: readonly ProjectFolderEntry[]; readonly total: number }
  | { readonly kind: "incomplete"; readonly folders: readonly ProjectFolderEntry[] }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly cause: ProjectFolderUnreadableCause; readonly detail?: string };

/**
 * The machine's answer for one folder: its absolute path, its parent (null at a filesystem root),
 * the path's steps root first, the machine's path separator, and what is inside.
 */
export interface ProjectFolderListing {
  readonly path: string;
  readonly parent: string | null;
  readonly crumbs: readonly ProjectFolderCrumb[];
  readonly separator: string;
  readonly contents: ProjectFolderContents;
}

export interface FileContentResponse {
  path: string;
  language?: string;
  mediaType?: FileContentMediaType;
  mimeType?: string;
  encoding: "utf8";
  size: number;
  modifiedAt: string;
  content: string;
  truncated: boolean;
  binary: boolean;
}

export interface WriteWorkspaceFileOptions {
  createDirs?: boolean;     // default: true — mkdir -p equivalent
  overwrite?: boolean;      // default: true — throw if false and file exists
}

export interface WriteWorkspaceFileResponse {
  path: string;
  size: number;
  modifiedAt: string;
  created: boolean;  // true if the file was created, false if it was overwritten
}

export interface DeleteWorkspaceFileResponse {
  path: string;
  existed: boolean;  // true if the file existed and was deleted, false if it did not exist
}

export interface WorkspaceFileUploadProgress {
  loaded: number;
  total: number;
  percent: number;
  lengthComputable: boolean;
}

export interface WorkspaceUploadBatchFileProgress extends WorkspaceFileUploadProgress {
  index: number;
  name: string;
  path: string;
  done: boolean;
  error?: string;
}

export interface WorkspaceUploadBatchProgress {
  currentFileIndex: number;
  files: WorkspaceUploadBatchFileProgress[];
  loaded: number;
  total: number;
  percent: number;
  done: boolean;
}

export interface WorkspaceUploadCancelHandle {
  promise: Promise<WriteWorkspaceFileResponse[]>;
  cancel(): void;
}

export interface MoveWorkspaceFileOptions {
  createDirs?: boolean;   // default: true — mkdir -p equivalent for target parent directory
  overwrite?: boolean;    // default: false — throw if target exists (safer default than writeFile)
}

export interface MoveWorkspaceFileResponse {
  fromPath: string;
  toPath: string;
  size: number;
  modifiedAt: string;
}

export type TerminalCommandRunStatus = "queued" | "running" | "succeeded" | "failed";

/** One live or exited terminal in a workspace. */
export interface TerminalInfo {
  id: string;
  cwd: string;
  name: string;
  createdAt: string;
  exited: boolean;
  exitCode?: number;
  commandRunId?: string;
}

export interface TerminalCommandRun {
  id: string;
  origin: string;
  projectId: string;
  workspaceId: string;
  terminalId: string;
  title: string;
  command: string;
  status: TerminalCommandRunStatus;
  exitCode?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  metadata: Record<string, string>;
}

export interface TerminalCommandRunHandle {
  run: TerminalCommandRun;
  completed: Promise<TerminalCommandRun>;
}

export type PiWebServiceComponent = "web" | "sessiond";
export type PiWebStatusSeverity = "info" | "warning" | "error";
export type PiWebInstallationKind = "pi-package" | "npm-global" | "local" | "docker" | "unknown";
export type PiWebDockerMode = "runtime" | "dev";

/** A package manager that owns an install PI WEB cannot update by itself. */
export type PiWebPackageManager = "nix";

export interface PiWebInstallationInfo {
  kind: PiWebInstallationKind;
  path?: string;
  source?: string;
  scope?: "user" | "project";
  npmRoot?: string;
  dockerMode?: PiWebDockerMode;
  /** The manager that placed this install, when one did; the kind is then "unknown". */
  manager?: PiWebPackageManager;
}

/**
 * Whether this component runs under the service its Updates page restart would restart. The
 * services installed for this user may belong to another PI WEB (a second instance started by
 * hand or from a terminal of the first), so only a confirmed match offers the restart.
 *
 * - `runs-under-service`: the component's own process reports the installed service it runs as.
 * - `installation-runs-under-service`: a session daemon that did not report (down, not
 *   answering, or older), while the web process runs under the installed web service the
 *   daemon's service was installed with.
 * - `other-service`: it runs under a service with another name.
 * - `not-under-service-manager`: no service manager started it.
 * - `unknown`: it could not confirm either way (absence is not negation).
 * - `no-service-installed`: no service is installed for this user to restart.
 */
export type PiWebServiceRestartState = "runs-under-service" | "installation-runs-under-service" | "other-service" | "not-under-service-manager" | "unknown" | "no-service-installed";

export interface PiWebComponentStatus {
  component: PiWebServiceComponent;
  label: string;
  runtimeVersion?: string;
  installedVersion?: string;
  /** Version of the Pi coding agent library loaded by this component's process; omitted when the component does not report it. */
  piVersion?: string;
  stale: boolean;
  available: boolean;
  installation?: PiWebInstallationInfo;
  /** Set by the status check where restarts drive this user's service manager; absent elsewhere and from older machines. */
  serviceRestart?: PiWebServiceRestartState;
  error?: string;
}

export interface PiWebReleaseStatus {
  packageName: string;
  latestVersion?: string;
  updateAvailable: boolean;
  checkedAt?: string;
  skipped?: boolean;
  error?: string;
}

export interface PiWebStatusMessage {
  id: string;
  severity: PiWebStatusSeverity;
  title: string;
  body: string;
  command?: string;
}

export interface PiWebVersionResponse {
  packageName: string;
  generatedAt: string;
  components: {
    web: PiWebComponentStatus;
    sessiond: PiWebComponentStatus;
  };
}

export interface PiWebStatusResponse extends PiWebVersionResponse {
  release: PiWebReleaseStatus;
  commands: {
    update?: string;
    restart?: string;
    restartWeb?: string;
    restartSessiond?: string;
    status?: string;
  };
  messages: PiWebStatusMessage[];
  /** The machine's user-scope pi packages and their newest versions; absent from a PI WEB that does not report them, which says nothing about updates. */
  piPackages?: PiPackageUpdates;
}

/** How a pi package source names its code: a registry package, a repository, or a path on the machine. */
export type PiPackageSourceKind = "npm" | "git" | "local";

/**
 * One package's update fact. `newer` and `current` compare the installed version with the newest
 * the source allows; `checking` waits for its source's first answer; `pinned` sources fix their
 * version and are not queried; `local` paths cannot be asked; `missing` is configured but not
 * installed yet; `failed` carries the check's own words.
 */
export type PiPackageUpdateState = "newer" | "current" | "checking" | "pinned" | "local" | "missing" | "failed";

/** A PI WEB process that loads server plugins: the web/API process or the session daemon. */
export type PiPackageServerProcess = "web" | "sessiond";

export interface PiPackageUpdate {
  source: string;
  displayName: string;
  kind: PiPackageSourceKind;
  installed?: string;
  available?: string;
  state: PiPackageUpdateState;
  error?: string;
  /** The processes that load a PI WEB server plugin the installed package brings; each needs a restart after an update. */
  serverPluginProcesses: PiPackageServerProcess[];
}

/**
 * Whether the machine listed its packages, or why there is nothing to compare: it skips update
 * checks, it has no active agent profile, or listing failed. A reader that does not know the value
 * reads the whole block as not reported, never as "none installed".
 */
export type PiPackageListing = "listed" | "skipped" | "no-profile" | "failed";

/**
 * The pi package update check of one machine, for its active agent profile's user scope.
 * `checking` is true while a check runs; `checkedAt` is absent until one finished. `listingError`
 * is a failed listing in the machine's own words. `unreadable` names the entries the reading page
 * could not read, such as a state a newer machine adds, so each still shows as a package; a machine
 * never sends it.
 */
export interface PiPackageUpdates {
  listing: PiPackageListing;
  checkedAt?: string;
  checking: boolean;
  listingError?: string;
  packages: PiPackageUpdate[];
  unreadable?: string[];
}

/**
 * Every custom property a theme may set.
 *
 * The legacy half is a closed union: a theme missing one is a compile error,
 * in a plugin package exactly as in the app, because an incomplete theme
 * renders as half of another one, which is worse than not shipping. The
 * semantic surface half is optional by design - a theme that does not know
 * the ladder gets core-derived stops from its own legacy trio.
 */
/**
 * Shape and typography stops a theme may pin. Optional by design: a theme
 * that omits them inherits the core's current shape - the rounded sans
 * Material scale - so a flat or mono theme MUST set these to keep its look. Radii follow the published scale; there is no
 * density or border-width token yet.
 */
export type ShapeTypographyToken =
  | "--pi-font-ui"
  | "--pi-font-display"
  | "--pi-font-mono"
  | "--pi-radius-xs"
  | "--pi-radius-sm"
  | "--pi-radius-md"
  | "--pi-radius-lg"
  | "--pi-radius-xl";

export type ThemeToken =
  | LegacyThemeToken
  | SemanticSurfaceToken
  | ForegroundToken
  | ShapeTypographyToken
  | MessageRoleToken;

/**
 * Conversation message colours by who wrote the message. Optional: a theme that omits one gets it
 * derived from its own tokens when it is applied (user from the selection colour and accent border,
 * assistant from the surface, system from the purple family), so packs written before these tokens
 * keep their user and assistant look and still get a system message that reads apart from the
 * assistant's (owner, 2026-10-16).
 */
export type MessageRoleToken =
  | "--pi-msg-user-bg"
  | "--pi-msg-user-border"
  | "--pi-msg-user-header-bg"
  | "--pi-msg-assistant-bg"
  | "--pi-msg-assistant-border"
  | "--pi-msg-assistant-header-bg"
  | "--pi-msg-system-bg"
  | "--pi-msg-system-border"
  | "--pi-msg-system-header-bg";

/**
 * Foregrounds a theme may name for a filled surface it owns. Optional by
 * design: a theme that omits one keeps the previous fallback, which is why
 * adding this cannot break a theme that already shipped.
 *
 * --pi-on-accent exists because the background colour was standing in for the
 * label on an accent fill, and a background is chosen to sit behind content,
 * not to carry a label: the shipped dark theme measured 3.74:1 on its own
 * primary buttons.
 */
export type ForegroundToken = "--pi-on-accent";

/** The original color contract; every theme sets all of these. */
export type LegacyThemeToken =
  | "--pi-bg"
  | "--pi-surface"
  | "--pi-surface-hover"
  | "--pi-terminal-bg"
  | "--pi-terminal-text"
  | "--pi-border"
  | "--pi-border-muted"
  | "--pi-text"
  | "--pi-text-secondary"
  | "--pi-text-bright"
  | "--pi-muted"
  | "--pi-dim"
  | "--pi-accent"
  | "--pi-accent-border"
  | "--pi-selection-bg"
  | "--pi-success"
  | "--pi-success-border"
  | "--pi-success-bg"
  | "--pi-success-surface"
  | "--pi-success-ring"
  | "--pi-warning"
  | "--pi-warning-border"
  | "--pi-warning-surface"
  | "--pi-danger"
  | "--pi-purple"
  | "--pi-purple-border"
  | "--pi-purple-surface"
  | "--pi-overlay"
  | "--pi-shadow-soft"
  | "--pi-shadow"
  | "--pi-shadow-strong"
  | "--pi-bg-overlay-soft"
  | "--pi-bg-overlay"
  | "--pi-success-bg-overlay"
  | "--pi-terminal-selection";

/**
 * The semantic surface ladder. A theme may set these stops explicitly; when it
 * does not, the core derives them from the legacy trio, so packs written
 * before the ladder keep rendering on a coherent ladder.
 */
export type SemanticSurfaceToken =
  | "--pi-surface-canvas"
  | "--pi-surface-panel"
  | "--pi-surface-card"
  | "--pi-surface-raised"
  | "--pi-surface-active";

/**
 * What a failed read means to a plugin, under the host's rule that a surface never gives up
 * (docs/design/state-diagram.md, B48; owner, 2026-09-30 and again 2026-10-13: "we keep trying; never
 * show the reader an error they cannot fix").
 * - `retry`: no answer (the link, a deadline, a machine that did not answer) or a server error. Read
 *   again after `delayMs`; keep what is known for the same key; say at most that it is reconnecting.
 *   `reason` is a server's own words when one answered with an error, for a quiet line, never a red one.
 * - `final`: a refusal the server stated (signed out, forbidden, gone). It ends retrying and is
 *   shown as itself, in `words`.
 */
export type PluginReadFailure =
  | { readonly kind: "retry"; readonly delayMs: number; readonly reason?: string }
  | { readonly kind: "final"; readonly words: string };

/**
 * A status page's list, drawn by the host (`PluginHostUi.renderList`).
 *
 * Every plugin used to write its own row markup, so the same "running" read in
 * five colours and the rows had no dividers (owner, 2026-10-06). The plugin now
 * says what its rows are and the host draws them: one grouped list, one row
 * anatomy, one colour per tone, one box for an empty page. See
 * docs/design/plugin-list-component.md.
 */
export interface PluginListModel {
  /** Whether the plugin has read what it lists. Rows are drawn in any state; an empty page says this state's words. */
  readonly read: PluginListRead;
  readonly groups: readonly PluginListGroup[];
  /** The plugin's words for each state of an empty page; absence is not negation. */
  readonly words: PluginListWords;
  /** Lines under the groups, such as "3 older runs not shown". */
  readonly notes?: readonly string[];
}

export type PluginListRead = "reading" | "ready" | "failed";

export interface PluginListWords {
  /** Read, and there is nothing. */
  readonly empty: string;
  /** Not read yet. */
  readonly reading: string;
  /** The read failed and nothing was read before. */
  readonly failed: string;
  /** The read failed while rows from an earlier read are kept: said above them. */
  readonly stale: string;
}

export interface PluginListGroup {
  readonly id: string;
  /** The section title above the group. */
  readonly heading?: string;
  readonly rows: readonly PluginListRow[];
  /** Buttons in the group's last row. */
  readonly actions?: readonly PluginListAction[];
  /** One button at the right of the heading line. Optional: an older host draws the heading alone. */
  readonly headingAction?: PluginListAction;
}

export interface PluginListRow {
  readonly id: string;
  /** Wraps to two lines. */
  readonly title: string;
  /** A tone dot and a word on the right. */
  readonly status?: PluginListStatus;
  /** A muted value on the right, for a row without a status. */
  readonly value?: string;
  /** One muted line under the title. */
  readonly detail?: string;
  /** Present: the row opens, drawn by the element `renderExpandableRow` uses. An older host draws the row flat. */
  readonly expansion?: PluginRowExpansion;
  /**
   * One button at the row's right end, for what acts on this row alone; a screen reader names it by
   * its label followed by the row's title. The row's status or value then leads its detail line. A
   * row that opens or carries a `toggle` does not draw it. Arrives
   * with `ui.renderToggle`; an older host leaves it out.
   */
  readonly action?: PluginButton;
  /**
   * A checkbox at the row's right end; the whole row is its label, the title its name and the
   * detail its description. A row that opens does not draw it. Arrives with `ui.renderToggle`; an
   * older host leaves it out.
   */
  readonly toggle?: PluginListRowToggle;
}

/** A labelled checkbox the way Settings draws its checkboxes (`PluginHostUi.renderToggle`, a list row's `toggle`). */
export interface PluginToggle {
  readonly label: string;
  /** One muted line under the label. */
  readonly description?: string;
  /** Controlled: after a click the checkbox shows the reader's choice until the plugin draws again, and then this. */
  readonly checked: boolean;
  /** Called with the state the reader asked for. */
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  /** A change the reader made is being saved: the checkbox is disabled, dimmed under the host's spinner, and aria-busy. */
  readonly busy?: boolean;
}

/** A row's checkbox: the row's title and detail are its label and description. */
export type PluginListRowToggle = Omit<PluginToggle, "label" | "description">;

export interface PluginListStatus {
  readonly label: string;
  readonly tone: PluginListTone;
}

/** One colour per meaning on every status page: good is green, attention amber, problem red, neutral muted. */
export type PluginListTone = "good" | "attention" | "problem" | "neutral";

/** A button the way the host draws buttons (`PluginHostUi.renderButton`, a list's actions). */
export interface PluginButton {
  readonly label: string;
  readonly run: () => void;
  readonly primary?: boolean;
  readonly disabled?: boolean;
  /** Danger ink: for what stops or removes something. */
  readonly tone?: "danger";
  /** Work the press started is in flight: a spinner before the label, the button disabled and aria-busy. The width does not change. */
  readonly busy?: boolean;
}

export interface PluginListAction extends PluginButton {
  readonly id: string;
}

/**
 * A row that opens. Controlled: the plugin owns which rows are open and keys that by its own
 * scope (machine + session + row), so an open row never survives into another session's list.
 */
export interface PluginRowExpansion {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /**
   * Called only while expanded: what the plugin draws under the row header, a `TemplateResult`
   * made with `context.html`. Typed `unknown` because these shared declarations stay free of lit.
   */
  readonly body: () => unknown;
}

/** A row that opens, on its own (`PluginHostUi.renderExpandableRow`): the list row's anatomy, its header the disclosure. */
export interface PluginExpandableRow extends PluginRowExpansion {
  readonly title: string;
  readonly status?: PluginListStatus;
  readonly value?: string;
  readonly detail?: string;
}

/** A monospace text view with its own scroll, held at the bottom until the reader scrolls up (`PluginHostUi.renderOutput`). */
export interface PluginOutputView {
  /** Accessible name of the scroll region. */
  readonly label: string;
  /** The list's three read states: an empty view says this state's words; a failed refresh keeps the text under the stale line. */
  readonly read: PluginListRead;
  /** Drawn as text, never HTML; terminal escape sequences are removed. */
  readonly text: string;
  readonly words: PluginListWords;
  /** One muted line above the text when the plugin cut it, in the plugin's words. */
  readonly cutAbove?: string;
  /** `tail` (default): at most 12 lines tall, then it scrolls. `fill`: takes its container's height (a fullscreen dialog). */
  readonly size?: "tail" | "fill";
}

/** One line of text and the composer's send key at its far right (`PluginHostUi.renderMessageField`). */
export interface PluginMessageField {
  /** Accessible name of the field. */
  readonly label: string;
  readonly placeholder: string;
  /** Accessible name of the send key; "Send" when absent. */
  readonly sendLabel?: string;
  readonly disabled?: boolean;
  /** Called with the trimmed text. Resolve true to clear the field (the words were taken), false to keep them. A rejection keeps them. */
  readonly send: (text: string) => Promise<boolean>;
}

/**
 * The session on screen as a workspace page may act on it (`WorkspacePanelContext.session`): present
 * when the plugin declared `sessionCommands` in its package and a session is open.
 */
export interface PluginPanelSession {
  readonly id: string;
  /**
   * Run one of this plugin's declared extension commands in this session, as typing it would. It
   * runs at most once; while the machine cannot be reached the promise stays pending, like a message.
   */
  readonly runCommand: (request: PluginSessionCommandRequest) => Promise<PluginSessionCommandOutcome>;
}

/** What `ComposerRuntimeContext.send` did. May gain members: treat an unknown value as not sent. */
export type ComposerSendResult = "sent" | "empty" | "left" | "not-stored";

/**
 * The draft and Send of the session on screen as a workspace page may use them
 * (`WorkspacePanelContext.composer`): present while a session is open, for any plugin. It belongs to
 * the machine and session on screen when the context was made; once another session is on screen,
 * its writes and sends are answered "left" and do nothing. It works whether or not the composer is
 * drawn: on a phone a page replaces the chat, and the session's stored draft is used instead.
 */
export interface PluginPanelComposer {
  /** The session's draft: the composer's while it shows the session, else the stored one. Still that session's draft once another session is on screen. */
  readonly draft: () => string;
  /** Replace the session's draft, as `ComposerRuntimeContext.replaceDraft` does; the reader finds it in the composer. */
  readonly setDraft: (text: string) => PluginPanelDraftWrite;
  /** Append to the session's draft after a space, as `ComposerRuntimeContext.insertText` does. */
  readonly insertText: (text: string) => PluginPanelDraftWrite;
  /**
   * Send words to the session as the reader, through this device's outbox like the Send button: at
   * most once, kept sending while the machine cannot be reached, a steer while a turn runs and a
   * follow-up otherwise. The message records which plugin sent it ("Sent with <plugin name>").
   * With `text`, those words go and the draft is left alone; without, the session's draft and its
   * attachments go and are cleared, as Send does. Words that would run a command (a first character
   * `/`, or a `!` shell command) are not sent and answer "command": a page runs its declared
   * extension commands with `session.runCommand`.
   */
  readonly send: (text?: string) => Promise<PluginPanelSendResult>;
}

/** `written`; `left`: another session is on screen and nothing was written; `not-stored`: this browser could not store the draft. */
export type PluginPanelDraftWrite = "written" | "left" | "not-stored";

/**
 * What `PluginPanelComposer.send` did: the composer control's answers, and `command` for words that
 * would run a command, which were not sent (the draft is untouched). May gain members: treat an
 * unknown value as not sent.
 */
export type PluginPanelSendResult = ComposerSendResult | "command";

export interface PluginSessionCommandRequest {
  /** The session the page's rows were read for; a different session on screen at call time is refused. */
  readonly sessionId: string;
  /** The command's name without the slash, one of the plugin's `sessionCommands`. */
  readonly name: string;
  /** The words after the name, on one line. */
  readonly args?: string;
}

/**
 * - `ran`: the command's handler returned; `notices` are what it told the reader while it ran, oldest first (may be empty).
 * - `waiting`: the machine has it and no answer came within 10 seconds (the session is compacting, the
 *   handler waits on a dialog, or the machine's PI WEB is older), or another tab of this browser
 *   profile sent it and heard the machine's answer. Final: read your own state for the rest.
 * - `refused`: not run, by the host's admission or the machine; `words` say why.
 * - `unknown`: the machine took it and its answer was lost. Read your own state.
 */
export type PluginSessionCommandOutcome =
  | { readonly kind: "ran"; readonly notices: readonly PluginSessionCommandNotice[] }
  | { readonly kind: "waiting" }
  | { readonly kind: "refused"; readonly reason: PluginCommandRefusal; readonly words: string }
  | { readonly kind: "unknown"; readonly words: string };

export interface PluginSessionCommandNotice {
  readonly level: "info" | "warning" | "error";
  readonly message: string;
}

/**
 * Why a plugin's command was not run. `not-declared`: not in the package's `sessionCommands`.
 * `not-extension-command`: the session has no extension command by that name (a built-in, a skill, a
 * prompt template, or a name two extensions share). `commands-unknown`: the session's commands could
 * not be read. `session-changed`: another session is on screen. `no-session`: none is. `args-not-one-line`:
 * the words carry a line break. `not-stored`: this browser could not keep it to send. `machine-refused`:
 * the machine said no. Later releases may add reasons: treat one you do not know as a refusal.
 */
export type PluginCommandRefusal =
  | "not-declared"
  | "not-extension-command"
  | "commands-unknown"
  | "session-changed"
  | "no-session"
  | "args-not-one-line"
  | "not-stored"
  | "machine-refused";

/**
 * Why a workspace file call was refused, as the code the workspace file routes answer with (B16).
 * Relays and workspace tasks used to compare the refusal's words ("Path does not exist", "Path is
 * not a directory") to tell an absent file from a failure.
 */
export type WorkspaceFileRefusal = "path-missing" | "path-not-a-directory";

/**
 * How the host last found a machine (issue #57). `checking`: the host is not checking right now, or
 * the machine has not answered since the host started checking it (a state remembered from earlier,
 * in this browser or from before the checks paused, is not an answer); `daemonDown`: the machine's
 * PI WEB answered with a component down or an error; `unknown`: an answer came back that cannot
 * say. None of them is an empty machine.
 */
export type FleetReachability = "checking" | "online" | "daemonDown" | "offline" | "unknown";

/** One configured machine as the fleet lists it. */
export interface FleetMachine {
  readonly id: string;
  readonly name: string;
  readonly kind: MachineKind;
  /** The machine the app is on now. */
  readonly selected: boolean;
  readonly reachability: FleetReachability;
  /** The host's words for a reachability that is not `online` or `checking`, when it has some. */
  readonly reason?: string;
}

export interface FleetMachinesSnapshot {
  /** False until the machine list first answers: an empty `machines` then says nothing. */
  readonly loaded: boolean;
  readonly machines: readonly FleetMachine[];
}

/**
 * How much of one machine's session board answered: `unloaded` nobody asked yet, `loading` asked
 * and no answer yet (a lost read is read again by itself), `partial` some listings answered and the
 * rest are read again, `complete` every listing answered, `failed` the machine refused or is no
 * longer in the machine list. Only `complete` lets an absent session mean "not there".
 */
export type FleetCoverage = "unloaded" | "loading" | "partial" | "complete" | "failed";

/** One session on one machine, identified by the pair (`machineId`, `sessionId`). */
export interface FleetSession {
  readonly machineId: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly title: string;
  /** When the session last changed, ISO 8601. */
  readonly updatedAt: string;
  /** The project and workspace whose folder holds it, when the board lists them. */
  readonly projectId?: string;
  readonly workspaceId?: string;
  /** Whether a turn runs, when the page has heard; absent means not known. */
  readonly streaming?: boolean;
  readonly archived?: boolean;
  /** The row comes from this browser's memory of the board, for a listing that did not answer now (`partial`, or `failed` keeping the last rows). */
  readonly remembered?: boolean;
}

export interface FleetSessionsSnapshot {
  readonly machineId: string;
  readonly coverage: FleetCoverage;
  /** Rows for `partial` and `complete`; `failed` may carry the last rows this page held for the machine. */
  readonly sessions: readonly FleetSession[];
  /** Why the board `failed`. */
  readonly error?: string;
}

/**
 * What became of `openSession`, the app's own verdict once the open settled: `opened` the session
 * is on screen; `machineUnknown` the loaded machine list does not have the machine (removed, or
 * never listed); `machinesUnloaded` the machine list had not loaded within the wait (10 s), so
 * nothing was decided; `machineUnreachable` the machine did not answer for the session;
 * `sessionGone` the machine says the session does not exist (the app shows that); `refused` the
 * machine refused to say (signed out, forbidden); `notListed` the session cannot be found from here
 * although that does not make it gone: the machine cannot locate sessions (an older PI WEB) and its
 * listing lacks this one, or the id names a new session this page is not starting; `folderMissing`
 * the session exists but its folder does not, so the app does not open it; `superseded` another
 * navigation, including an open already under way, took over. May gain members: treat an unknown
 * value as unknown.
 */
export type FleetOpenResult = "opened" | "machineUnknown" | "machinesUnloaded" | "machineUnreachable" | "sessionGone" | "refused" | "notListed" | "folderMissing" | "superseded";

/**
 * What a machine management call did: the host's own UI took over, the loaded machine list does
 * not have the machine, the machine list has not loaded yet (call again once
 * `onDidChangeMachines` reports it loaded), or the host cannot do that for it. May gain members.
 */
export type FleetMachineActionResult = "started" | "machineUnknown" | "machinesUnloaded" | "unsupported";

/**
 * The configured machines and their session boards, as the host already holds them (issue #57).
 * Reads are synchronous snapshots, frozen all the way down (rows and arrays too) and shared by every
 * plugin; `onDidChange*` listeners are called with the new snapshot and return their unsubscribe,
 * and every subscription is dropped with the plugin. While a plugin
 * listens to a machine's sessions the host keeps that board read, and while it listens to the
 * machines the host keeps checking their reachability: subscribe while the page is shown.
 */
export interface PluginFleet {
  machines(): FleetMachinesSnapshot;
  onDidChangeMachines(listener: (snapshot: FleetMachinesSnapshot) => void): () => void;
  sessions(machineId: string): FleetSessionsSnapshot;
  onDidChangeSessions(machineId: string, listener: (snapshot: FleetSessionsSnapshot) => void): () => void;
  /**
   * Read the machine's board whole now; resolves when the read settles, rejects with the signal's
   * reason when aborted. A machine not in the machine list is not read: the call resolves at once.
   */
  refreshSessions(machineId: string, signal?: AbortSignal): Promise<void>;
  /** Open a session through the host's own navigation, moving to its machine first; before the machine list first loads it waits for it, up to 10 s. */
  openSession(target: { readonly machineId: string; readonly sessionId: string }): Promise<FleetOpenResult>;
  /** Open the host's add-machine dialog. */
  addMachine(): FleetMachineActionResult;
  /** Open the host's rename dialog for the machine. */
  renameMachine(machineId: string): FleetMachineActionResult;
  /** Ask the reader on the host's dialog, then remove the machine; the local machine is `unsupported`. */
  removeMachine(machineId: string): FleetMachineActionResult;
  /** Open a remote machine's own PI WEB in a new tab; the local machine is `unsupported`. */
  openMachine(machineId: string): FleetMachineActionResult;
  /** Check the machine's reachability again now, without selecting it. */
  refreshMachine(machineId: string): FleetMachineActionResult;
}

/**
 * Where a session fact happened. `machineId` and `sessionId` are always known; the folder, project
 * and workspace are present when the page knows them, and absent means not known.
 */
export interface SessionFactScope {
  readonly machineId: string;
  readonly sessionId: string;
  readonly cwd?: string;
  readonly projectId?: string;
  readonly workspaceId?: string;
}

export interface SessionCreatedFact {
  readonly session: SessionFactScope;
}

export interface SessionRenamedFact {
  readonly session: SessionFactScope;
  /** The new name; undefined when the name was cleared. */
  readonly name: string | undefined;
}

/** `/new` ran on `from` and its runtime moved on to `to`. */
export interface SessionReplacedFact {
  readonly from: SessionFactScope;
  readonly to: SessionFactScope;
  readonly reason: "new";
}

export interface SessionRunStartedFact {
  readonly session: SessionFactScope;
}

/**
 * How a run ended, as far as the page can tell, in the words of the server facts and the
 * transcript: `stopped` the reader's Stop cut it, `interrupted` it was cut otherwise (a reply pi
 * marks interrupted, or its runtime closed under it), `failed` the run ended on an error pi did not
 * retry (its last reply's stopReason "error", or an error activity when it settled; an error the
 * run went on past is not one), `completed` the run began and ended on the session's own stream, the
 * stream had no gap while it ran (a lost connection, frames not replayed, the page leaving the
 * session), and its last reply finished, `unknown` otherwise. May gain members: treat an unknown
 * value as unknown.
 */
export type SessionRunOutcome = "completed" | "stopped" | "interrupted" | "failed" | "unknown";

/**
 * Which device sent the newest user message the run took, that is one the agent had not yet taken
 * when the page saw the run start: this browser profile (every tab of it), another one, or
 * `unknown`. Unknown covers a run whose start the page did not see, a run that took no user
 * message (one an extension started), a message from the terminal or an extension, a session not
 * on screen or whose transcript was not loaded, and a machine too old to record the device. May
 * gain members: treat an unknown value as unknown.
 */
export type SessionRunAskedBy = "this-device" | "another-device" | "unknown";

export interface SessionRunEndedFact {
  readonly session: SessionFactScope;
  readonly outcome: SessionRunOutcome;
  /** Absent when the page's PI WEB predates the member: treat it as unknown. */
  readonly askedBy?: SessionRunAskedBy;
}

export interface MachineAddedFact {
  readonly machine: FleetMachine;
}

export interface MachineRemovedFact {
  readonly machineId: string;
  readonly name: string;
}

/** The machine's answered reachability changed; `checking` is not an answer and changes nothing here. */
export interface MachineReachabilityChangedFact {
  readonly machine: FleetMachine;
  readonly previous: FleetReachability;
}

/**
 * Session facts, read-only announcements (`emit`): delivered after the producer has moved on, never
 * awaited, a listener that throws is logged and does not stop the others, and nothing is replayed
 * to a late subscriber - read the fleet for state. Delivered only for what the page hears: the
 * announcements of each listed machine not known to be down, and the stream of the session on screen.
 */
export interface PluginSessionFacts {
  /** A session was created on a machine whose announcements the page holds. */
  onDidCreate(listener: (fact: SessionCreatedFact) => void): () => void;
  onDidRename(listener: (fact: SessionRenamedFact) => void): () => void;
  /** Heard on the stream of the session on screen only. */
  onDidReplace(listener: (fact: SessionReplacedFact) => void): () => void;
  /** A run started that the page saw start: a run already going when the page began hearing its machine has no start. */
  onDidStartRun(listener: (fact: SessionRunStartedFact) => void): () => void;
  /** A run the page saw going ended. */
  onDidEndRun(listener: (fact: SessionRunEndedFact) => void): () => void;
}

/** Machine facts, with the same delivery rules as session facts. */
export interface PluginMachineFacts {
  /** A machine joined the machine list after it first loaded. */
  onDidAdd(listener: (fact: MachineAddedFact) => void): () => void;
  onDidRemove(listener: (fact: MachineRemovedFact) => void): () => void;
  /** While any listener is subscribed, the host keeps checking every machine's reachability: one read per machine per check interval (15 s), as the Machines list does. */
  onDidChangeReachability(listener: (fact: MachineReachabilityChangedFact) => void): () => void;
}
