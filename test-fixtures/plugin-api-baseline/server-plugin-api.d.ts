import type { JsonObject, JsonPrimitive, JsonValue, PiWebComponentStatus, PiWebStatusResponse, WorkspaceRemovalPresentation } from "./shared/pluginApiTypes.js";
import type { Machine, MachineHealth, MachineRuntime, PiWebDeprecatedAgentInput, PiWebRuntimeComponent, PiWebRuntimeResponse } from "./shared/pluginApiTypes.js";
import { parsePiWebRuntimeResponse } from "./shared/piWebStatusParsing.js";
import type { WebSocket } from "ws";
export type { JsonObject, JsonPrimitive, JsonValue, WorkspaceRemovalPresentation };
export type { Machine, MachineHealth, MachineRuntime, PiWebComponentStatus, PiWebDeprecatedAgentInput, PiWebRuntimeComponent, PiWebRuntimeResponse, PiWebStatusResponse };
export { parsePiWebRuntimeResponse };
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
export type ServerPluginOperation = (input: unknown, context: {
    signal: AbortSignal;
}) => JsonValue | Promise<JsonValue>;
/**
 * Facts about the agent-side feature this plugin fronts: the tools that prove
 * its surface is backed, and the markers its injected turns carry. The host
 * used to hold these as constants and had to be edited whenever the feature
 * changed.
 */
export interface ServerPluginAgentFacts {
    surfaces?: readonly {
        surface: string;
        tools: readonly string[];
    }[];
    injectedTurns?: readonly {
        id: string;
        marker: string;
        producer: string;
    }[];
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
export declare const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 30000;
export declare const DEFAULT_REMOTE_HEALTH_TIMEOUT_MS = 3000;
/** The failure shape a proxied machine request reports upstream. */
export declare class RemoteMachineRequestError extends Error {
    readonly statusCode: 502 | 504;
    constructor(message: string, statusCode: 502 | 504);
}
