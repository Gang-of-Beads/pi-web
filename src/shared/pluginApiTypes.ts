// Dependency-free DTOs shared by PI WEB's public plugin entrypoints and host protocols.

export type MachineKind = "local" | "remote";

export type MachineStatus = "unknown" | "online" | "offline" | "error";

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

export interface PiWebInstallationInfo {
  kind: PiWebInstallationKind;
  path?: string;
  source?: string;
  scope?: "user" | "project";
  npmRoot?: string;
  dockerMode?: PiWebDockerMode;
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
export type ThemeToken =
  | LegacyThemeToken
  | SemanticSurfaceToken;

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
