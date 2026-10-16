import type { FastifyInstance, FastifyReply } from "fastify";
import type { WebSocket } from "ws";
import type { MachineClient, MachineJsonResponse, MachineRequestOptions } from "../../../server-plugin-api.js";
import { DEFAULT_REMOTE_REQUEST_TIMEOUT_MS, RemoteMachineRequestError } from "../../../server-plugin-api.js";
import { FEDERATED_HTTP_ROUTES, FEDERATED_WEBSOCKET_ROUTES, WORKSPACE_FILE_PREVIEW_ROUTE_PATH, WORKSPACE_LISTING_ROUTE_PATH, type FederatedHttpRouteSpec } from "../../../shared/federatedRoutes.js";
import { ROUTE_MISSING_CODE, TRANSPORT_FAILURES, type TransportFailure } from "../../../shared/apiTypes.js";
import { SelectedMachineConfigRequestError, mergeSelectedMachineConfig, parsePiWebConfigResponseBody, parseSelectedMachineConfigRequest, selectedMachineConfigResponse } from "../configRoutes.js";
import { requestCancellation } from "../../shared/requestCancellation.js";
import { gatewayTransport } from "../../shared/transportFailure.js";
import { bridgeSockets } from "../webSocketBridge.js";
import { applyWorkspaceFilePreviewErrorResponsePolicy, applyWorkspaceFilePreviewResponsePolicy } from "../../shared/workspaces/filePreviewResponseHeaders.js";
import { workspaceFilePreviewErrorResponsePolicy, workspaceFilePreviewResponsePolicy, type WorkspaceFilePreviewResponsePolicy } from "../../shared/workspaces/filePreviewResponsePolicy.js";
import { errorMessage, isRecord } from "../../../shared/unknownValues.js";
import {
  configResponseHasServerSettings,
  parseServerSettingsUpdates,
  PluginServerSettingsError,
  PRIVATE_SETTINGS_OUTCOME_UNCONFIRMED_CODE,
  PRIVATE_SETTINGS_PROTOCOL_INCOMPATIBLE_CODE,
  publicWorkspaceConfigPayload,
  requestedServerSettingsUpdates,
  targetSupportsServerSettings,
} from "../../../shared/pluginConfigPrivacy.js";

/** The proxy's slice of the machine registry: it only ever needs the remote client. */
interface ProxyMachines {
  remoteClient(id: string): Promise<MachineClient | undefined>;
}

export const REMOTE_HTTP_ROUTES = FEDERATED_HTTP_ROUTES;
export const REMOTE_WEBSOCKET_ROUTES = FEDERATED_WEBSOCKET_ROUTES;

const SAFE_RESPONSE_HEADERS = new Set([
  "content-type",
  "content-length",
  "content-disposition",
  "cache-control",
  "last-modified",
  "etag",
  "content-security-policy",
  "x-content-type-options",
]);

/**
 * How the gateway answers for a proxied route. A route whose answer can carry plugin config is rebuilt
 * from parsed fields and never relayed, so neither a target's private settings nor its raw error text
 * reaches the browser; every other route is relayed as it was.
 */
type ProxyRouteKind = "selected-machine-config" | "workspace-listing" | "relay";
type ConfigBearingRouteKind = Exclude<ProxyRouteKind, "relay">;

const CONFIG_BEARING_ROUTE_KINDS: ReadonlyMap<string, ConfigBearingRouteKind> = new Map([
  ["/config", "selected-machine-config"],
  [WORKSPACE_LISTING_ROUTE_PATH, "workspace-listing"],
]);

function proxyRouteKind(spec: FederatedHttpRouteSpec): ProxyRouteKind {
  return CONFIG_BEARING_ROUTE_KINDS.get(spec.path) ?? "relay";
}

/** The gateway's own words for a config-bearing answer it does not relay. */
const CONFIG_BEARING_ROUTE_WORDS: Record<ConfigBearingRouteKind, { readonly refused: string; readonly invalid: string }> = {
  "selected-machine-config": {
    refused: "Remote machine refused the configuration request",
    invalid: "Remote machine sent a configuration answer PI WEB cannot use",
  },
  "workspace-listing": {
    refused: "Remote machine could not list workspaces",
    invalid: "Remote machine sent a workspace listing PI WEB cannot use",
  },
};

/**
 * Why a config-bearing request failed without an answer to rebuild: the target was out of reach (the
 * machine client's own failure), or it answered with something the gateway could not parse.
 */
type ConfigBearingFailure = "unreachable" | "answered-invalid";

function configBearingFailure(error: unknown): ConfigBearingFailure {
  return error instanceof RemoteMachineRequestError ? "unreachable" : "answered-invalid";
}

const SEND_CONFIG_BEARING_FAILURE: Record<ConfigBearingFailure, (reply: FastifyReply, kind: ConfigBearingRouteKind, machineId: string, error: unknown) => FastifyReply> = {
  unreachable: (reply, _kind, machineId, error) => {
    clearRelayedHeaders(reply);
    return sendGatewayError(reply, machineId, error);
  },
  "answered-invalid": (reply, kind, machineId) => sendRebuiltJson(reply, 502, { error: CONFIG_BEARING_ROUTE_WORDS[kind].invalid, machineId, statusCode: 502 }),
};

/**
 * Whether a selected-machine write may reach its target. Private operations need a target that speaks
 * the private-settings protocol. An older target still takes an ordinary write, unless its own answer
 * shows private blocks its saver would not preserve.
 */
type RemoteConfigWriteGate = "forward" | "refuse-private-protocol";

function remoteConfigWriteGate(target: unknown, carriesPrivateOperations: boolean): RemoteConfigWriteGate {
  if (targetSupportsServerSettings(target)) return "forward";
  return carriesPrivateOperations || configResponseHasServerSettings(target) ? "refuse-private-protocol" : "forward";
}

export function registerMachineProxyRoutes(app: FastifyInstance, machines: ProxyMachines): void {
  for (const spec of REMOTE_HTTP_ROUTES) {
    app.route<{ Params: { machineId: string }; Body: unknown }>({
      method: spec.method,
      url: `/api/machines/:machineId${spec.path}`,
      ...("bodyLimit" in spec ? { bodyLimit: spec.bodyLimit } : {}),
      handler: async (request, reply) => {
        const cancellation = "propagateCancellation" in spec
          ? requestCancellation(request, reply)
          : undefined;
        try {
          return await proxyHttpRequest(
            machines,
            spec,
            request.params.machineId,
            request.method,
            request.url,
            request.body,
            request.headers["content-type"],
            reply,
            cancellation?.signal,
          );
        } finally {
          cancellation?.dispose();
        }
      },
    });
  }

  for (const path of REMOTE_WEBSOCKET_ROUTES) {
    app.get<{ Params: { machineId: string } }>(`/api/machines/:machineId${path}`, { websocket: true }, async (socket, request) => {
      await proxyWebSocket(machines, request.params.machineId, request.url, socket);
    });
  }
}

async function proxyHttpRequest(
  machines: ProxyMachines,
  spec: FederatedHttpRouteSpec,
  machineId: string,
  method: string,
  requestUrl: string,
  body: unknown,
  contentType: string | string[] | undefined,
  reply: FastifyReply,
  signal?: AbortSignal,
): Promise<FastifyReply> {
  if (machineId === "local") {
    return reply.code(501).send({ error: "Local machine route is not registered for this endpoint" });
  }

  const client = await machines.remoteClient(machineId);
  if (client === undefined) {
    return reply.code(404).send({ error: "Machine not found" });
  }

  const kind = proxyRouteKind(spec);
  try {
    const remotePath = remoteApiPath(machineId, requestUrl);
    if (kind === "selected-machine-config") return await proxySelectedMachineConfigRequest(client, machineId, method, remotePath, body, reply);

    let preview: RemoteFilePreviewRequest | undefined;
    try {
      preview = remoteFilePreviewRequest(spec, remotePath);
    } catch (error) {
      applyWorkspaceFilePreviewErrorResponsePolicy(reply);
      return await reply.code(400).send({ error: errorMessage(error) });
    }
    const previewPolicy = preview?.policy;
    const responseBodyLimit = preview === undefined ? spec.responseBodyLimit : preview.responseBodyLimit;

    const startedAt = Date.now();
    const requestOptions = proxyRequestOptions(spec, body, contentType, signal);
    const upstream = requestOptions === undefined
      ? await client.request(method, remotePath, body)
      : await client.request(method, remotePath, body, requestOptions);
    const responseBody = upstream.body === undefined || responseBodyLimit === undefined
      ? upstream.body
      : await readBoundedRemoteBody(
          upstream.body,
          responseBodyLimit,
          remainingResponseTimeout(startedAt, spec.timeoutMs),
          signal,
        );
    if (kind === "workspace-listing") return await sendWorkspaceListing(reply, upstream.statusCode, responseBody);
    if (isUnknownRemotePluginBackendRoute(spec, method, remotePath, upstream.statusCode, responseBody)) {
      return await reply.code(409).send({
        error: "Remote machine plugin lifecycle is incompatible",
        code: "plugin-lifecycle-incompatible",
        machineId,
        detail: "The remote machine does not support workspace provider backend requests. Update and restart PI WEB on the remote machine.",
      });
    }
    reply.code(upstream.statusCode);
    applySafeHeaders(reply, upstream.headers);
    if (previewPolicy !== undefined) {
      const enforcedPolicy = isSuccessfulStatus(upstream.statusCode) ? previewPolicy : workspaceFilePreviewErrorResponsePolicy();
      applyWorkspaceFilePreviewResponsePolicy(reply, enforcedPolicy);
    }
    if (responseBody === undefined) return await reply.send();
    // A bounded body is authoritative over whatever length the remote claimed.
    if (Buffer.isBuffer(responseBody)) reply.header("Content-Length", String(responseBody.byteLength));
    return await reply.send(responseBody);
  } catch (error) {
    if (isSelectedMachineConfigRequestError(error)) return reply.code(400).send({ error: errorMessage(error) });
    if (kind !== "relay") return SEND_CONFIG_BEARING_FAILURE[configBearingFailure(error)](reply, kind, machineId, error);
    return sendGatewayError(reply, machineId, error);
  }
}

async function proxySelectedMachineConfigRequest(client: MachineClient, machineId: string, method: string, remotePath: string, body: unknown, reply: FastifyReply): Promise<FastifyReply> {
  if (method === "GET") return sendSelectedMachineConfigResponse(reply, await client.requestJson("GET", remotePath));
  if (method !== "PUT") return reply.code(405).send({ error: "Method not allowed" });

  const patch = parseSelectedMachineConfigRequest(configPayload(body), "portable");
  const updates = requestedServerSettingsUpdates(parseServerSettingsUpdates(isRecord(body) ? body["serverSettingsUpdates"] : undefined));
  const currentResponse = await client.requestJson("GET", remotePath);
  if (!isSuccessfulStatus(currentResponse.statusCode)) return sendConfigBearingRefusal(reply, "selected-machine-config", currentResponse.statusCode, currentResponse.body);
  if (remoteConfigWriteGate(currentResponse.body, updates !== undefined) === "refuse-private-protocol") {
    return sendRebuiltJson(reply, 409, {
      error: "Remote machine private settings protocol is incompatible. Update and restart PI WEB on the remote machine before changing this configuration.",
      code: PRIVATE_SETTINGS_PROTOCOL_INCOMPATIBLE_CODE,
      machineId,
    });
  }
  const current = parsePiWebConfigResponseBody(currentResponse.body, "Remote machine config response");
  const merged = mergeSelectedMachineConfig(current.config, patch);
  const written = await client.requestJson("PUT", remotePath, { config: merged, ...(updates === undefined ? {} : { serverSettingsUpdates: updates }) });
  if (updates !== undefined && isSuccessfulStatus(written.statusCode) && !targetSupportsServerSettings(written.body)) {
    return sendRebuiltJson(reply, 502, {
      error: "Remote machine answered without confirming its private settings. The change may or may not have been saved; read the configuration again before retrying.",
      code: PRIVATE_SETTINGS_OUTCOME_UNCONFIRMED_CODE,
      machineId,
      statusCode: 502,
    });
  }
  return sendSelectedMachineConfigResponse(reply, written);
}

function configPayload(body: unknown): unknown {
  return isRecord(body) ? body["config"] : undefined;
}

function sendSelectedMachineConfigResponse(reply: FastifyReply, upstream: MachineJsonResponse): FastifyReply {
  if (!isSuccessfulStatus(upstream.statusCode)) return sendConfigBearingRefusal(reply, "selected-machine-config", upstream.statusCode, upstream.body);
  const response = parsePiWebConfigResponseBody(upstream.body, "Remote machine config response");
  return sendRebuiltJson(reply, upstream.statusCode, selectedMachineConfigResponse(response));
}

function sendWorkspaceListing(reply: FastifyReply, statusCode: number, body: NodeJS.ReadableStream | Buffer | undefined): FastifyReply {
  const parsed = Buffer.isBuffer(body) ? parseJsonBody(body) : undefined;
  if (!isSuccessfulStatus(statusCode)) return sendConfigBearingRefusal(reply, "workspace-listing", statusCode, parsed);
  if (parsed === undefined) throw new Error("Remote machine workspace listing is not JSON");
  return sendRebuiltJson(reply, statusCode, publicWorkspaceConfigPayload(parsed));
}

function parseJsonBody(body: Buffer): unknown {
  try {
    const value: unknown = JSON.parse(body.toString("utf8"));
    return value;
  } catch {
    return undefined;
  }
}

/**
 * A target's error answer rebuilt from what can be trusted in it: its status, a known transport
 * failure and the route-missing code. Its own words stay behind, because an older target's error
 * text can quote the very config it failed to read.
 */
function sendConfigBearingRefusal(reply: FastifyReply, kind: ConfigBearingRouteKind, statusCode: number, body: unknown): FastifyReply {
  return sendRebuiltJson(reply, statusCode, { error: CONFIG_BEARING_ROUTE_WORDS[kind].refused, statusCode, ...trustedFailureFields(body) });
}

function trustedFailureFields(body: unknown): { transport?: TransportFailure; code?: typeof ROUTE_MISSING_CODE } {
  if (!isRecord(body)) return {};
  const transport = TRANSPORT_FAILURES.find((failure) => failure === body["transport"]);
  return {
    ...(transport === undefined ? {} : { transport }),
    ...(body["code"] === ROUTE_MISSING_CODE ? { code: ROUTE_MISSING_CODE } : {}),
  };
}

/** A rebuilt answer owns its framing: no header the target sent describes this body. */
function sendRebuiltJson(reply: FastifyReply, statusCode: number, body: unknown): FastifyReply {
  clearRelayedHeaders(reply);
  return reply.code(statusCode).type("application/json; charset=utf-8").send(body);
}

function clearRelayedHeaders(reply: FastifyReply): void {
  for (const name of SAFE_RESPONSE_HEADERS) reply.removeHeader(name);
}

function isSuccessfulStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

async function proxyWebSocket(machines: ProxyMachines, machineId: string, requestUrl: string, socket: WebSocket): Promise<void> {
  if (machineId === "local") {
    socket.close(1011, "Local machine route is not registered for this endpoint");
    return;
  }

  const client = await machines.remoteClient(machineId);
  if (client === undefined) {
    socket.close(1008, "Machine not found");
    return;
  }

  try {
    bridgeSockets(socket, client.connectWebSocket(remoteApiPath(machineId, requestUrl)));
  } catch {
    socket.close(1011, "Remote machine unavailable");
  }
}

function remoteApiPath(machineId: string, requestUrl: string): string {
  const machinePrefix = `/api/machines/${encodeURIComponent(machineId)}`;
  const stripped = requestUrl.startsWith(machinePrefix) ? requestUrl.slice(machinePrefix.length) : requestUrl;
  const compatPath = stripped.startsWith("/") ? stripped : `/${stripped}`;
  return `/api${compatPath}`;
}

interface RemoteFilePreviewRequest {
  policy: WorkspaceFilePreviewResponsePolicy;
  responseBodyLimit: number | undefined;
}

function remoteFilePreviewRequest(spec: FederatedHttpRouteSpec, remotePath: string): RemoteFilePreviewRequest | undefined {
  if (spec.path !== WORKSPACE_FILE_PREVIEW_ROUTE_PATH) return undefined;
  const url = new URL(remotePath, "http://pi-web.local");
  const path = url.searchParams.get("path");
  if (path === null || path === "") throw new Error("path query parameter is required");
  const downloadValue = url.searchParams.get("download");
  const download = downloadValue === "1" || downloadValue === "true";
  return {
    policy: workspaceFilePreviewResponsePolicy(path, { download }),
    // Inline previews keep the local inline contract even when the remote is
    // hostile or racy; attachment downloads stay deliberately uncapped.
    responseBodyLimit: download ? undefined : spec.responseBodyLimit,
  };
}

function proxyRequestOptions(
  spec: Pick<FederatedHttpRouteSpec, "timeoutMs" | "propagateCancellation">,
  body: unknown,
  contentType: string | string[] | undefined,
  signal?: AbortSignal,
): MachineRequestOptions | undefined {
  const options: MachineRequestOptions = {};
  if (spec.timeoutMs !== undefined) options.timeoutMs = spec.timeoutMs;
  if (spec.propagateCancellation === true && signal !== undefined) options.signal = signal;
  if (isRawProxyBody(body)) {
    const value = firstHeaderValue(contentType);
    if (value !== undefined && value !== "") options.contentType = value;
  }
  return Object.keys(options).length === 0 ? undefined : options;
}

function isUnknownRemotePluginBackendRoute(
  spec: FederatedHttpRouteSpec,
  method: string,
  remotePath: string,
  statusCode: number,
  body: NodeJS.ReadableStream | Buffer | undefined,
): boolean {
  if (!spec.path.startsWith("/plugin-backends/") || statusCode !== 404 || !(body instanceof Buffer)) return false;
  try {
    const value: unknown = JSON.parse(body.toString("utf8"));
    if (!isRecord(value) || value["statusCode"] !== 404 || value["error"] !== "Not Found") return false;
    const message = value["message"];
    const queryIndex = remotePath.indexOf("?");
    const requestPath = queryIndex === -1 ? remotePath : remotePath.slice(0, queryIndex);
    if (typeof message !== "string") return false;
    const routePrefix = `Route ${method.toUpperCase()}:`;
    return message === `${routePrefix}${requestPath} not found` || message === `${routePrefix}${remotePath} not found`;
  } catch {
    return false;
  }
}

function isRawProxyBody(body: unknown): boolean {
  return typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function applySafeHeaders(reply: FastifyReply, headers: Record<string, string | string[] | undefined>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (!SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    reply.header(name, value);
  }
}

function remainingResponseTimeout(startedAt: number, timeoutMs: number | undefined): number {
  return Math.max(1, (timeoutMs ?? DEFAULT_REMOTE_REQUEST_TIMEOUT_MS) - (Date.now() - startedAt));
}

function readBoundedRemoteBody(body: NodeJS.ReadableStream, maxBytes: number, timeoutMs: number, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, rejectPromise) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      fail(new RemoteMachineRequestError("Remote machine response body timed out", 504));
    }, timeoutMs);
    timeout.unref();
    // An inbound disconnect must release the upstream connection instead of
    // draining a remote body nobody is waiting for any more.
    const onAbort = (): void => {
      fail(new RemoteMachineRequestError("Remote machine request cancelled", 502));
    };

    const cleanup = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      body.removeListener("data", onData);
      body.removeListener("end", onEnd);
      body.removeListener("error", onError);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        destroyReadable(body);
      } catch {
        // The bounded gateway error remains authoritative even if teardown fails.
      }
      rejectPromise(error);
    };
    const onData = (chunk: unknown): void => {
      const buffer = typeof chunk === "string"
        ? Buffer.from(chunk)
        : chunk instanceof Uint8Array ? Buffer.from(chunk) : undefined;
      if (buffer === undefined) {
        fail(new RemoteMachineRequestError("Remote machine returned an invalid response body", 502));
        return;
      }
      byteLength += buffer.byteLength;
      if (byteLength > maxBytes) {
        fail(new RemoteMachineRequestError(`Remote machine response exceeded the ${String(maxBytes)} byte limit`, 502));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = (error: unknown): void => {
      fail(new RemoteMachineRequestError(errorMessage(error), 502));
    };

    body.on("data", onData);
    body.once("end", onEnd);
    body.once("error", onError);
    if (signal?.aborted === true) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function destroyReadable(body: NodeJS.ReadableStream): void {
  const destroy: unknown = Reflect.get(body, "destroy");
  if (typeof destroy === "function") Reflect.apply(destroy, body, []);
}

function isSelectedMachineConfigRequestError(error: unknown): boolean {
  return error instanceof SelectedMachineConfigRequestError || error instanceof PluginServerSettingsError;
}

function sendGatewayError(reply: FastifyReply, machineId: string, error: unknown): FastifyReply {
  const statusCode = error instanceof RemoteMachineRequestError ? error.statusCode : 502;
  const label = statusCode === 504 ? "Remote machine timeout" : "Remote machine unavailable";
  return reply.code(statusCode).send({
    error: label,
    machineId,
    statusCode,
    ...gatewayTransport(error),
    detail: errorMessage(error),
  });
}
