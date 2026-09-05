import type { JsonObject, JsonPrimitive, JsonValue, WorkspaceRemovalPresentation } from "./shared/pluginApiTypes.js";

export type { JsonObject, JsonPrimitive, JsonValue, WorkspaceRemovalPresentation };

type MaybePromise<T> = T | Promise<T>;

/** Public server entry exported by a package's `serverModule`. */
export interface PiWebServerPlugin {
  apiVersion: 1;
  name: string;
  activate(context: ServerPluginActivationContext): MaybePromise<ServerPluginActivation>;
}

/** Host-owned frozen values supplied during server plugin activation. */
export interface ServerPluginActivationContext {
  readonly apiVersion: 1;
  readonly pluginId: string;
  readonly packageRoot: string;
  readonly logger: ServerPluginLogger;
  readonly settings: JsonObject;
  /**
   * Durable per-plugin storage. Missing is not empty: `read` answers
   * undefined for a key that was never written, and a corrupt document reads
   * as undefined rather than throwing.
   */
  readonly storage: ServerPluginStorage;
  /**
   * Execute an argv-based command through host-owned output and time bounds.
   * The caller must forward the signal for its current bounded operation.
   */
  readonly execFile: (request: ServerPluginExecFileRequest) => Promise<ServerPluginExecFileResult>;
  /**
   * Host-provided services the plugin may consume. Every port is optional: a
   * host that cannot supply one leaves it undefined, and the plugin degrades
   * honestly through its health report. Ports are contract types, not core
   * internals — a plugin never imports the host to narrow them.
   */
  readonly ports?: ServerPluginHostPorts;
  /**
   * Signal for this activation invocation. It is aborted when activation times
   * out or settles; it is not a plugin-lifetime shutdown signal.
   */
  readonly signal: AbortSignal;
}

/** Host-owned durable storage scoped to one plugin's own directory. */
export interface ServerPluginStorage {
  readonly directory: string;
  readonly read: (key: string) => Promise<JsonValue | undefined>;
  readonly write: (key: string, value: JsonValue) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
}

/** Host-owned logger supplied through the frozen activation context. */
export interface ServerPluginLogger {
  readonly debug: (message: string, details?: JsonObject) => void;
  readonly info: (message: string, details?: JsonObject) => void;
  readonly warn: (message: string, details?: JsonObject) => void;
  readonly error: (message: string, details?: JsonObject) => void;
}

export interface ServerPluginExecFileRequest {
  file: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  /** Environment keys removed after host defaults and plugin overrides merge. */
  unsetEnv?: readonly string[];
  /** Requested timeout; the host may apply a lower maximum. */
  timeoutMs?: number;
  signal: AbortSignal;
}

export interface ServerPluginExecFileResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

/**
 * Signals passed to lifecycle callbacks are scoped to that single invocation
 * and are aborted when it times out or settles. They are not plugin-lifetime
 * shutdown signals; the host invokes `stop()` explicitly during shutdown.
 */
/**
 * A named JSON operation the host exposes as
 * `api/plugins/<pluginId>/<operation>`. The plugin declares the name; it never
 * picks a path, and an undeclared name is refused rather than answered.
 */
export type ServerPluginOperation = (input: unknown, context: { signal: AbortSignal }) => JsonValue | Promise<JsonValue>;

/**
 * Facts about the agent-side feature this plugin fronts: the tools that prove
 * its surface is backed, and the markers its injected turns carry. The host
 * used to hold these as constants and had to be edited whenever the feature
 * changed.
 */
export interface ServerPluginAgentFacts {
  surfaces?: readonly { surface: string; tools: readonly string[] }[];
  injectedTurns?: readonly { id: string; marker: string; producer: string }[];
}

export interface ServerPluginActivation {
  workspaceProvider?: WorkspaceProvider;
  operations?: Readonly<Record<string, ServerPluginOperation>>;
  /**
   * Routes the plugin answers at core-shaped paths. The host owns path
   * resolution and mounts each route under both `/api` and
   * `/api/machines/local`; a route whose path is named by the federated route
   * table inherits that entry's transport bounds. A route handler is not
   * bounded by the lifecycle timeout — its signal is request cancellation.
   */
  routes?: readonly ServerPluginRouteContribution[];
  agentFacts?: ServerPluginAgentFacts;
  /** Initialize resources within one host-bounded start invocation. */
  start?(signal: AbortSignal): MaybePromise<void>;
  /** Release resources within one host-bounded stop invocation. */
  stop?(signal: AbortSignal): MaybePromise<void>;
  /** Inspect health within one host-bounded health invocation. */
  health?(signal: AbortSignal): MaybePromise<ServerPluginHealth>;
}

export interface ServerPluginHealth {
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
  details?: JsonObject;
}

/**
 * A declared route the host mounts. The plugin never picks a URL prefix: the
 * path is a core-shaped template the host mounts, and an undeclared or
 * colliding route is refused rather than answered.
 */
export interface ServerPluginRouteContribution {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  handle(request: ServerPluginRequest, reply: ServerPluginReply, context: ServerPluginRouteContext): Promise<void>;
}

/** The three input faces a route handler may read: params, query, headers. */
export interface ServerPluginRequest {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

/**
 * A bounded answer: status, headers, and a body. The body may be an async
 * iterable for streaming answers (a Node Readable satisfies it), which is how
 * a range-streaming file preview stays expressible over the JSON-only
 * operation channel.
 */
export interface ServerPluginReply {
  code(status: number): ServerPluginReply;
  header(name: string, value: string): ServerPluginReply;
  send(body: string | Uint8Array | AsyncIterable<Uint8Array>): Promise<void>;
}

/** The cancellation signal of one route invocation: aborted on client disconnect. */
export interface ServerPluginRouteContext {
  readonly signal: AbortSignal;
}

/** Host ports, named fields so plugins consume them without narrowing. */
export interface ServerPluginHostPorts {
  /** Resolve one workspace of the identity tuple to its project and workspace paths. */
  workspaceCatalog?: WorkspaceCatalogPort;
  /** Read the effective per-project config values plugins may act on. */
  piWebConfig?: PiWebConfigPort;
}

export interface WorkspacePathResolution {
  readonly projectPath: string;
  readonly workspacePath: string;
}

export interface WorkspaceCatalogPort {
  resolveWorkspace(projectId: string, workspaceId: string): Promise<WorkspacePathResolution | undefined>;
}

/** The path-access slice of the per-project config, as plugins may consume it. */
export interface PluginPathAccessConfig {
  readonly allowedPaths?: readonly string[];
}

export interface PiWebConfigPort {
  readPathAccess(projectPath: string): Promise<PluginPathAccessConfig | undefined>;
}

/**
 * Every signal supplied to a provider is scoped to that single callback
 * invocation. The host aborts it when the operation times out or settles; it
 * must not be retained as a plugin-lifetime shutdown signal.
 */
export interface WorkspaceProvider {
  /** Fallback providers are considered only after all primary providers pass. */
  fallback?: boolean;
  probe(project: ProjectInput, signal: AbortSignal): Promise<ProviderClaim>;
  list(project: ProjectInput, signal: AbortSignal): Promise<ProviderWorkspace[]>;
  request?(context: ProviderRequestContext): Promise<ProviderResponse>;
  prepareRemove?(context: ProviderRemoveContext): Promise<WorkspaceRemovePlan>;
}

export type ProviderClaim = "claim" | "pass";

export interface ProjectInput {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

export interface ProviderWorkspace {
  /** Provider-local stable key; the host derives the public workspace id. */
  key: string;
  /** Absolute workspace path. The host validates ownership and path invariants. */
  path: string;
  label: string;
  isMain: boolean;
  /** Opaque provider-private data returned to this provider during the resolution. */
  data?: JsonValue;
  /**
   * Serializable data included in browser workspace responses. It is visible
   * to all browser code and API consumers, so it must never contain secrets.
   */
  publicMetadata?: JsonObject;
  removal?: WorkspaceRemovalPresentation;
}

export interface ProviderRequestContext {
  readonly project: ProjectInput;
  /** Host-validated, frozen projection of one listed provider workspace. */
  readonly workspace: Readonly<ProviderWorkspace>;
  readonly operation: string;
  readonly input: JsonValue;
  readonly signal: AbortSignal;
}

/** Provider-private JSON result returned through the host's scoped bridge. */
export type ProviderResponse = JsonValue;

export interface ProviderRemoveContext {
  readonly project: ProjectInput;
  /** Host-validated, frozen projection of one listed provider workspace. */
  readonly workspace: Readonly<ProviderWorkspace>;
  readonly signal: AbortSignal;
}

/**
 * Plugin-authored plan for a visible host terminal run. Returning this plan
 * approves the operation; it does not mean removal has completed.
 */
export interface WorkspaceRemovePlan {
  /** Human-readable title for the host-owned terminal run. */
  title: string;
  /**
   * Shell source interpreted by the host's login shell. The host chooses a safe
   * current non-target workspace as the working directory, so any workspace
   * path used here must be the absolute `workspace.path` supplied in the
   * request and must be shell-quoted by the provider. Keep the removal in the
   * foreground: the host records completion when the shell exits, with exit 0
   * meaning the removal succeeded.
   */
  command: string;
}
