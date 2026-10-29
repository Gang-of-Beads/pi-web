import type { JsonObject, JsonPrimitive, JsonValue, PiWebComponentStatus, PiWebStatusResponse, WorkspaceRemovalPresentation } from "./shared/pluginApiTypes.js";
import type { Machine, MachineHealth, MachineRuntime, PiWebDeprecatedAgentInput, PiWebRuntimeComponent, PiWebRuntimeResponse } from "./shared/pluginApiTypes.js";
import { parsePiWebRuntimeResponse } from "./shared/piWebStatusParsing.js";
import { REQUEST_TIMEOUT_MS } from "./shared/requestTiming.js";
import type { WebSocket } from "ws";

export type { JsonObject, JsonPrimitive, JsonValue, WorkspaceRemovalPresentation };
export type { Machine, MachineHealth, MachineRuntime, PiWebComponentStatus, PiWebDeprecatedAgentInput, PiWebRuntimeComponent, PiWebRuntimeResponse, PiWebStatusResponse };
export { parsePiWebRuntimeResponse };
export type { WorkspaceFileRefusal } from "./shared/pluginApiTypes.js";

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
   * A JSON copy of this plugin's own private `plugins.<id>.serverSettings` block, taken at
   * activation; `{}` when none is configured. No browser receives it, and no other plugin's block
   * is ever here. Undefined means the host is older and does not supply private settings at all,
   * which is not the same as none configured: a plugin that needs a key should report that host
   * as unable to provide it rather than as unconfigured.
   */
  readonly serverSettings?: JsonObject;
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
   * Read-only facts about this machine's sessions, announced after the daemon decided them.
   * Undefined means this host cannot deliver facts at all (an older host, or a process built
   * without a daemon connection), which is not the same as nothing happening.
   */
  readonly events?: ServerPluginEvents;
  /**
   * Signal for this activation invocation. It is aborted when activation times
   * out or settles; it is not a plugin-lifetime shutdown signal.
   */
  readonly signal: AbortSignal;
}

/**
 * Where a session fact happened: always this machine (`"local"`), the session and its working
 * directory, and the project and workspace the directory belongs to when the daemon knows them.
 * A missing `projectId` or `workspaceId` means unattributed, not "no project".
 */
export interface SessionScope {
  readonly machineId: "local";
  readonly sessionId: string;
  readonly cwd: string;
  readonly projectId?: string;
  readonly workspaceId?: string;
}

/**
 * Every server fact by kind. `session.created` says why the session exists: `start` for a new
 * session started from a working directory, `new`, `fork` and `clone` for one that replaced
 * another in its runtime. `run.ended` is `stopped` when the reader's Stop or `/new` cut the run,
 * `interrupted` for any other abort such as its session closing under it, and `failed` when its
 * last reply ended on an error pi did not retry. `facts.resumed` reaches only a plugin in the web
 * process: the relay from the daemon was down, facts may have been lost, and delivery goes on from
 * here; it stays owed until a `facts.resumed` listener hears it. Enumerated values (kinds,
 * `reason`, `outcome`) may gain members in later releases: treat an unknown value as unknown.
 */
export interface ServerFactMap {
  "session.created": { readonly session: SessionScope; readonly reason: "new" | "fork" | "clone" | "start" };
  "session.archived": { readonly session: SessionScope };
  "session.restored": { readonly session: SessionScope };
  "session.deleted": { readonly session: SessionScope };
  "run.started": { readonly session: SessionScope };
  "run.ended": { readonly session: SessionScope; readonly outcome: "completed" | "stopped" | "interrupted" | "failed"; readonly error?: string };
  "message.accepted": { readonly session: SessionScope; readonly clientMessageId: string };
  "message.withdrawn": { readonly session: SessionScope; readonly clientMessageId: string };
  "facts.resumed": { readonly gap: true };
}

export type ServerFactKind = keyof ServerFactMap;

export type ServerFact<K extends ServerFactKind = ServerFactKind> = K extends ServerFactKind ? { readonly kind: K } & ServerFactMap[K] : never;

export type ServerFactListener<K extends ServerFactKind> = (fact: ServerFact<K>, signal: AbortSignal) => void | Promise<void>;

/**
 * Facts, never hooks: a listener cannot change or delay what the daemon does. Listeners run in
 * parallel and are not awaited by the session; each gets a signal aborted when the listener
 * settles, at the lifecycle timeout, or when the plugin stops, so a listener awaits the work that
 * uses it. A listener that throws is logged and contained. A fact may repeat (an archive of an
 * archived session, a Stop racing an idle handoff): treat facts as idempotent. Facts are not
 * persisted or replayed: a plugin that needs history reads `ports.sessionTranscripts`.
 */
export interface ServerPluginEvents {
  /** Listen for one kind of fact; the returned function stops listening. */
  on<K extends ServerFactKind>(kind: K, listener: ServerFactListener<K>): () => void;
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
 * shutdown signals; the host invokes `stop()` explicitly, when the plugin is
 * turned off in Settings and during shutdown. An operation or route handler's
 * signal also fires when the plugin is turned off (docs/plugins.md, "Turning a
 * plugin on or off").
 */
/**
 * A named JSON operation the host exposes as
 * `api/plugins/<pluginId>/<operation>`. The plugin declares the name; it never
 * picks a path, and an undeclared name is refused rather than answered.
 */
export type ServerPluginOperation = (input: unknown, context: { signal: AbortSignal }) => JsonValue | Promise<JsonValue>;

/**
 * Facts about the agent-side feature this plugin fronts: the tools that prove
 * its surface is backed, the markers its injected turns carry, and where its
 * extension does background work. The host used to hold these as constants
 * and had to be edited whenever the feature changed.
 */
export interface ServerPluginAgentFacts {
  surfaces?: readonly { surface: string; tools: readonly string[] }[];
  injectedTurns?: readonly { id: string; marker: string; producer: string }[];
  /**
   * Directories the extension writes background work into (B20). While the plugin runs, the
   * daemon watches each one and its parent and recounts the session's background runs when they
   * change, and the Files and Git panels ignore the ones under `cwd` as churn. `cwd` is the session's working directory, `session-dir` the directory holding its
   * transcript, `session-stem` the directory named after the transcript file; `path` is relative
   * and stays inside its root, and may be empty only under `session-stem`.
   */
  workPaths?: readonly { root: "cwd" | "session-dir" | "session-stem"; path: string }[];
}

/** One open session a plugin is asked about: where it lives and whether its own turn is still running. */
export interface BackgroundWorkSession {
  readonly sessionId: string;
  readonly cwd: string;
  /** The session's transcript; a session with no transcript yet is not asked about. */
  readonly sessionFile: string;
  /** Whether the session's own turn is still streaming; decides what a silent run means. */
  readonly parentActive: boolean;
}

export interface ServerPluginActivation {
  workspaceProvider?: WorkspaceProvider;
  operations?: Readonly<Record<string, ServerPluginOperation>>;
  /**
   * The machine registry this plugin owns. The host consumes it for the
   * proxy families and the fleet fan-out — dependency points from core to
   * the plugin, not copies — and never learns what a machine store is.
   */
  machineRegistry?: MachineRegistryContribution;
  /**
   * Routes the plugin answers at core-shaped paths. The host owns path
   * resolution and mounts each route under both `/api` and
   * `/api/machines/local`; a route whose path is named by the federated route
   * table inherits that entry's transport bounds. A route handler is not
   * bounded by the lifecycle timeout — its signal is request cancellation.
   */
  routes?: readonly ServerPluginRouteContribution[];
  agentFacts?: ServerPluginAgentFacts;
  /**
   * How many runs this plugin knows the session still has going after its own turn (B20). The
   * daemon adds every running plugin's answer into the session's "N background runs", which the
   * status line shows and an extension's continuation can wait on; a plugin turned off stops counting. Asked on
   * the daemon's heartbeat while background work is known or being watched for, so keep it cheap
   * when the answer is zero. Bounded by the lifecycle timeout.
   */
  backgroundWork?(session: BackgroundWorkSession, signal: AbortSignal): MaybePromise<{ running: number }>;
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

export type { FileSuggestion } from "./shared/pluginApiTypes.js";

/**
 * A declared route the host mounts. The plugin never picks a URL prefix: the
 * path is a core-shaped template the host mounts, and an undeclared or
 * colliding route is refused rather than answered.
 */
export interface ServerPluginRouteContribution {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  handle(request: ServerPluginRequest, reply: ServerPluginReply, context: ServerPluginRouteContext): Promise<void>;
}

/** The input faces a route handler may read: params, query, headers, body. */
export interface ServerPluginRequest {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
  /**
   * The request body: raw bytes for text and binary payloads (the host
   * buffers and hands them over untouched), a parsed JSON object for
   * JSON payloads — the machines management family is a route family with
   * JSON bodies, the same shape core's own management routes take — and
   * undefined for bodyless methods.
   */
  readonly body: ServerPluginRouteBody | undefined;
}

export type ServerPluginRouteBody = Uint8Array | Record<string, JsonValue>;

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
  /** The data directory the machines store file lives in; the plugin resolves the file name. */
  machinesStorePath?: () => string;
  /** The local runtime the machines plugin reads for local health and runtime. */
  localRuntime?: () => Promise<PiWebRuntimeResponse>;
  /**
   * A machine registry the host already owns. When present the plugin
   * contributes its management routes over this registry instead of building
   * its own, so a host-side registry and the HTTP surface stay one source.
   */
  machineRegistry?: MachineRegistryContribution;
  /**
   * Read-only access to this machine's session transcripts, scoped by the
   * session's own identity (id + cwd). Only the session daemon offers it; a
   * plugin running in the web process sees no port. There is no write path:
   * the daemon stays the single producer of session files.
   */
  sessionTranscripts?: SessionTranscriptPort;
  /**
   * Model calls (text and tool calls) through this machine's model registry and logins, limited to the models
   * the owner granted this plugin (`plugins.<id>.models`). Absent when the plugin has no grant,
   * in a web-process plugin, and on hosts older than the port. The plugin never sees a key.
   */
  models?: PluginModelPort;
}

/** The models the owner granted one plugin, and calls to them. */
export interface PluginModelPort {
  /** Every granted model, in the grant's order, with whether this machine can call it now. */
  list(): Promise<readonly PluginGrantedModel[]>;
  /**
   * One call, bounded by the host: at most 4096 output tokens, a 60-second deadline and two
   * calls in flight per plugin. The model may call the tools the request offers (at most 8, each
   * description at most 1024 characters and `parameters` at most 8192 bytes as JSON); the host
   * never runs a tool and never calls the model again. Every host with this port takes `tools`.
   * No images. Never rejects: a refusal or a failure is an answer.
   */
  complete(request: PluginModelRequest, signal: AbortSignal): Promise<PluginModelReply>;
}

/**
 * Whether a granted model can be called now: `ready`, `no-auth` (its provider has no login or
 * key on this machine), `unknown-model` (this machine's registry has no such model), or
 * `not-ready` (the daemon is still starting). May gain members: treat an unknown value as not ready.
 */
export type PluginGrantedModelState = "ready" | "no-auth" | "unknown-model" | "not-ready";

export interface PluginGrantedModel {
  /** `provider/model-id`, exactly as granted. */
  readonly model: string;
  readonly name: string | undefined;
  /** Whether the model can think; undefined when the model is not known here. */
  readonly reasoning: boolean | undefined;
  readonly state: PluginGrantedModelState;
}

export type PluginModelReasoning = "off" | "minimal" | "low" | "medium" | "high";

export interface PluginModelRequest {
  /** `provider/model-id`; must be one of the granted models. */
  readonly model: string;
  readonly system?: string;
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly text: string }[];
  /** Default "off". */
  readonly reasoning?: PluginModelReasoning;
  /** Default 1024; the host caps it at 4096. */
  readonly maxTokens?: number;
  /**
   * Tools the model may call: at most 8, with distinct names. A request outside the bounds is
   * refused `tools-out-of-bounds`.
   */
  readonly tools?: readonly PluginModelTool[];
}

/** A tool the model may call. The host only hands the call back; the plugin acts on it. */
export interface PluginModelTool {
  /** Matches `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`. */
  readonly name: string;
  /** What the tool does and when to call it, for the model; at most 1024 characters. */
  readonly description: string;
  /**
   * A JSON Schema of the arguments, as plain JSON with `type: "object"`; at most 8192 bytes
   * written as JSON.
   */
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** A tool call the model made, with the arguments as the provider parsed them: validate them before acting. */
export interface PluginModelToolCall {
  /** Always the name of a tool the request offered. */
  readonly name: string;
  readonly arguments: unknown;
}

/**
 * A tool call the host left out of `toolCalls`: `not-offered` (a name the request did not offer)
 * or `unreadable-arguments` (the arguments were not a JSON object). May gain members.
 */
export interface PluginModelDroppedToolCall {
  readonly name: string;
  readonly reason: "not-offered" | "unreadable-arguments";
}

/** Tokens a call used; `costUsd` only when the provider reported a cost. */
export interface PluginModelUsage {
  readonly input: number;
  readonly output: number;
  readonly reasoning?: number;
  readonly costUsd?: number;
}

/**
 * What became of a call. `answered`: the model's text and, when the request offered tools, the
 * tool calls it made, in order (`toolCalls`, empty when it made none); text and tool calls may both
 * be present, and `stopReason` is `toolUse` when the model stopped to have its tools run (only
 * when the request offered tools; an empty `tools` list offers none).
 * `droppedToolCalls` is present when the host left calls out. `refused`: nothing was sent
 * (`not-granted`, `unknown-model`, `no-auth`, `not-ready`, `busy` when the plugin already has the
 * most calls in flight, or `tools-out-of-bounds`); may gain members, and an unknown reason still
 * means nothing was sent. `failed`: the request was not valid, the provider answered with an error,
 * the call was aborted, or it ran past the deadline.
 */
export type PluginModelReply =
  | {
    readonly kind: "answered";
    readonly text: string;
    readonly stopReason: "stop" | "length" | "toolUse";
    readonly usage: PluginModelUsage;
    readonly toolCalls?: readonly PluginModelToolCall[];
    readonly droppedToolCalls?: readonly PluginModelDroppedToolCall[];
  }
  | { readonly kind: "refused"; readonly reason: "not-granted" | "unknown-model" | "no-auth" | "not-ready" | "busy" | "tools-out-of-bounds" }
  | { readonly kind: "failed"; readonly message: string };

export interface SessionTranscriptRef {
  readonly id: string;
  readonly cwd: string;
}

export interface SessionTranscriptSummary extends SessionTranscriptRef {
  readonly name?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archived?: boolean;
}

/** One page of a transcript, in the browser projection (bounded, images by reference). */
export interface SessionTranscriptPage {
  readonly messages: readonly unknown[];
  readonly start: number;
  readonly total: number;
}

/**
 * Thrown (as `Error.message`) by every port method while the daemon's session
 * service is still starting. A plugin that sees it must retry later, never
 * record "no sessions".
 */
export const SESSION_TRANSCRIPTS_NOT_READY = "session-transcripts-not-ready";

export interface SessionTranscriptPort {
  /**
   * The sessions recorded for a working directory (its tree included), archived
   * ones last, read passively: no session is opened and nothing is reconciled.
   * `cwd` is normalized like a browser request (absolute, `~` expanded).
   */
  listSessions(cwd: string): Promise<readonly SessionTranscriptSummary[]>;
  /**
   * One page of a transcript, read from the session file without opening the
   * session (an open session answers from its live entries). Paging mirrors the
   * browser: `before` is the exclusive end index (default: the end), `limit`
   * defaults to 100 and caps at 500, and `start` may land before the request:
   * a page opens on the user message that opens its turn. A page read with
   * `before` reaches back at most 100 messages for it, and past that opens on
   * the nearest message that is not a tool result. Undefined means the session
   * file is gone or unreadable - not an empty session.
   */
  readMessages(ref: SessionTranscriptRef, page?: { before?: number; limit?: number }): Promise<SessionTranscriptPage | undefined>;
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

/**
 * The machine registry face core consumes. The proxy families and the fleet
 * fan-out read machines through this interface; the machines plugin
 * implements it over its own store and remote client. Every method is the
 * whole authority the caller holds — no plugin-internal type leaks through.
 */
export interface MachineRegistryContribution {
  list(): Promise<Machine[]>;
  get(id: string): Promise<Machine | undefined>;
  /** The local machine with the user's alias applied, if one was set. */
  localMachine(): Promise<Machine>;
  add(input: PluginMachineCreateInput): Promise<Machine>;
  update(id: string, input: PluginMachineUpdateInput): Promise<Machine | undefined>;
  remove(id: string): Promise<boolean>;
  health(id: string): Promise<MachineHealth | undefined>;
  runtime(id: string, refresh?: boolean): Promise<MachineRuntime | undefined>;
  remoteClient(id: string): Promise<MachineClient | undefined>;
}

export interface PluginMachineCreateInput {
  name?: string;
  baseUrl?: string;
  token?: string;
  headers?: Record<string, string>;
}

export type PluginMachineUpdateInput = Partial<PluginMachineCreateInput>;

/**
 * One remote machine connection as the proxy consumes it. The response
 * bodies stream: the outer HTTP edge frames them, so the client hands back
 * the decoded stream and the wire headers untouched.
 */
export interface MachineClient {
  request(method: string, path: string, body?: unknown, options?: MachineRequestOptions): Promise<MachineHttpResponse>;
  requestJson(method: string, path: string, body?: unknown, options?: MachineRequestOptions): Promise<MachineJsonResponse>;
  connectWebSocket(path: string): WebSocket;
}

export interface MachineHttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body?: NodeJS.ReadableStream;
}

export interface MachineJsonResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface MachineRequestOptions {
  timeoutMs?: number;
  contentType?: string;
  signal?: AbortSignal;
}

export const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
export const DEFAULT_REMOTE_HEALTH_TIMEOUT_MS = 3_000;

/** The failure shape a proxied machine request reports upstream. */
export class RemoteMachineRequestError extends Error {
  constructor(message: string, readonly statusCode: 502 | 504) {
    super(message);
    this.name = "RemoteMachineRequestError";
  }
}
