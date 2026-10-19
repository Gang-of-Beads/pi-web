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
export type ProjectFolderContents = {
    readonly kind: "complete";
    readonly folders: readonly ProjectFolderEntry[];
} | {
    readonly kind: "truncated";
    readonly folders: readonly ProjectFolderEntry[];
    readonly total: number;
} | {
    readonly kind: "incomplete";
    readonly folders: readonly ProjectFolderEntry[];
} | {
    readonly kind: "missing";
} | {
    readonly kind: "unreadable";
    readonly cause: ProjectFolderUnreadableCause;
    readonly detail?: string;
};
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
    createDirs?: boolean;
    overwrite?: boolean;
}
export interface WriteWorkspaceFileResponse {
    path: string;
    size: number;
    modifiedAt: string;
    created: boolean;
}
export interface DeleteWorkspaceFileResponse {
    path: string;
    existed: boolean;
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
    createDirs?: boolean;
    overwrite?: boolean;
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
export type ShapeTypographyToken = "--pi-font-ui" | "--pi-font-display" | "--pi-font-mono" | "--pi-radius-xs" | "--pi-radius-sm" | "--pi-radius-md" | "--pi-radius-lg" | "--pi-radius-xl";
export type ThemeToken = LegacyThemeToken | SemanticSurfaceToken | ForegroundToken | ShapeTypographyToken | MessageRoleToken;
/**
 * Conversation message colours by who wrote the message. Optional: a theme that omits one gets it
 * derived from its own tokens when it is applied (user from the selection colour and accent border,
 * assistant from the surface, system from the purple family), so packs written before these tokens
 * keep their user and assistant look and still get a system message that reads apart from the
 * assistant's (owner, 2026-10-16).
 */
export type MessageRoleToken = "--pi-msg-user-bg" | "--pi-msg-user-border" | "--pi-msg-user-header-bg" | "--pi-msg-assistant-bg" | "--pi-msg-assistant-border" | "--pi-msg-assistant-header-bg" | "--pi-msg-system-bg" | "--pi-msg-system-border" | "--pi-msg-system-header-bg";
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
export type LegacyThemeToken = "--pi-bg" | "--pi-surface" | "--pi-surface-hover" | "--pi-terminal-bg" | "--pi-terminal-text" | "--pi-border" | "--pi-border-muted" | "--pi-text" | "--pi-text-secondary" | "--pi-text-bright" | "--pi-muted" | "--pi-dim" | "--pi-accent" | "--pi-accent-border" | "--pi-selection-bg" | "--pi-success" | "--pi-success-border" | "--pi-success-bg" | "--pi-success-surface" | "--pi-success-ring" | "--pi-warning" | "--pi-warning-border" | "--pi-warning-surface" | "--pi-danger" | "--pi-purple" | "--pi-purple-border" | "--pi-purple-surface" | "--pi-overlay" | "--pi-shadow-soft" | "--pi-shadow" | "--pi-shadow-strong" | "--pi-bg-overlay-soft" | "--pi-bg-overlay" | "--pi-success-bg-overlay" | "--pi-terminal-selection";
/**
 * The semantic surface ladder. A theme may set these stops explicitly; when it
 * does not, the core derives them from the legacy trio, so packs written
 * before the ladder keep rendering on a coherent ladder.
 */
export type SemanticSurfaceToken = "--pi-surface-canvas" | "--pi-surface-panel" | "--pi-surface-card" | "--pi-surface-raised" | "--pi-surface-active";
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
export type PluginReadFailure = {
    readonly kind: "retry";
    readonly delayMs: number;
    readonly reason?: string;
} | {
    readonly kind: "final";
    readonly words: string;
};
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
}
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
 * Why a workspace file call was refused, as the code the workspace file routes answer with (B16).
 * Relays and workspace tasks used to compare the refusal's words ("Path does not exist", "Path is
 * not a directory") to tell an absent file from a failure.
 */
export type WorkspaceFileRefusal = "path-missing" | "path-not-a-directory";
/**
 * How the host last found a machine (issue #57). `checking`: nothing is known yet, or the host is
 * not looking right now; `daemonDown`: the machine's PI WEB answered with a component down or an
 * error; `unknown`: an answer came back that cannot say. None of them is an empty machine.
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
 * machine refused to say (signed out, forbidden); `notListed` the machine cannot locate sessions
 * (an older PI WEB) and its listing lacks this one, which does not make it gone; `folderMissing`
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
    openSession(target: {
        readonly machineId: string;
        readonly sessionId: string;
    }): Promise<FleetOpenResult>;
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
export interface SessionRunEndedFact {
    readonly session: SessionFactScope;
    readonly outcome: SessionRunOutcome;
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
