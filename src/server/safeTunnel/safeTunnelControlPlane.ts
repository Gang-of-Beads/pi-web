import {
  normalizeSafeTunnelControlApiBaseUrl,
  normalizeSafeTunnelPublicUrl,
  type SafeTunnelMachineCredentials,
} from "./safeTunnelState.js";

export const safeTunnelClientVersion = "pi-web-safe-tunnel/1";

export type SafeTunnelControlPlaneErrorCode =
  | "authentication_failed"
  | "authorization_denied"
  | "authorization_expired"
  | "conflict"
  | "invalid_response"
  | "rate_limited"
  | "request_rejected"
  | "service_unavailable"
  | "transport_failed";

export type SafeTunnelControlPlaneOperation =
  | "complete_device_authorization"
  | "get_tunnel_config"
  | "record_heartbeat"
  | "register_machine"
  | "start_device_authorization";

export class SafeTunnelControlPlaneError extends Error {
  constructor(
    readonly code: SafeTunnelControlPlaneErrorCode,
    readonly operation: SafeTunnelControlPlaneOperation,
  ) {
    super(controlPlaneErrorMessage(code, operation));
  }
}

export interface SafeTunnelDeviceAuthorization {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string;
  readonly expiresAt: string;
  readonly intervalSeconds: number;
}

export interface SafeTunnelApprovedDeviceAuthorization {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly account: {
    readonly id: string;
    readonly publicNamespace: string;
  };
}

export type SafeTunnelDeviceAuthorizationCompletion =
  | { readonly kind: "approved"; readonly authorization: SafeTunnelApprovedDeviceAuthorization }
  | { readonly kind: "pending" };

export interface SafeTunnelRegisteredMachine {
  readonly machine: {
    readonly id: string;
    readonly accountId: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly publicHostname: string;
  readonly publicUrl: string;
  readonly machineToken: string;
}

export interface SafeTunnelMachineTunnelConfig {
  readonly machineId: string;
  readonly publicHostname: string;
  readonly publicUrl: string;
  readonly localPiWebUrl: string;
  readonly proxyName: string;
  readonly frpcConfigToml: string;
}

export type SafeTunnelHeartbeatTunnelStatus =
  | "error"
  | "running"
  | "starting"
  | "stopping";

export interface SafeTunnelMachineHeartbeat {
  readonly machineId: string;
  readonly lastSeenAt: string;
  readonly nextHeartbeatSeconds: number;
}

export interface SafeTunnelControlPlane {
  startDeviceAuthorization(input: {
    readonly controlApiBaseUrl: string;
    readonly clientVersion: string;
  }): Promise<SafeTunnelDeviceAuthorization>;
  completeDeviceAuthorization(input: {
    readonly controlApiBaseUrl: string;
    readonly deviceCode: string;
  }): Promise<SafeTunnelDeviceAuthorizationCompletion>;
  registerMachine(input: {
    readonly controlApiBaseUrl: string;
    readonly connectorAccessToken: string;
    readonly machineName: string;
    readonly machineSlug: string;
    readonly localPiWebUrl: string;
    readonly clientVersion: string;
  }): Promise<SafeTunnelRegisteredMachine>;
  getMachineTunnelConfig(
    credentials: SafeTunnelMachineCredentials,
    options?: { readonly signal?: AbortSignal },
  ): Promise<SafeTunnelMachineTunnelConfig>;
  recordMachineHeartbeat(
    credentials: SafeTunnelMachineCredentials,
    input: {
      readonly clientVersion: string;
      readonly tunnelStatus: SafeTunnelHeartbeatTunnelStatus;
      readonly errorMessage?: string;
    },
    options?: { readonly signal?: AbortSignal },
  ): Promise<SafeTunnelMachineHeartbeat>;
}

export type SafeTunnelFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpSafeTunnelControlPlaneOptions {
  readonly fetch?: SafeTunnelFetch;
}

/**
 * Concrete Control API adapter. HTTP paths, headers, status handling, and DTO
 * parsing terminate here; callers receive only PI WEB-owned results/errors.
 */
export class HttpSafeTunnelControlPlane implements SafeTunnelControlPlane {
  private readonly fetch: SafeTunnelFetch;

  constructor(options: HttpSafeTunnelControlPlaneOptions = {}) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async startDeviceAuthorization(input: {
    readonly controlApiBaseUrl: string;
    readonly clientVersion: string;
  }): Promise<SafeTunnelDeviceAuthorization> {
    const operation = "start_device_authorization";
    const response = await this.request(
      endpoint(input.controlApiBaseUrl, "/v1/device/start"),
      jsonPostRequest({ connectorVersion: input.clientVersion }),
      operation,
    );
    requireExpectedResponse(response, 202, operation);
    return parseControlPlaneResponse(
      await readSuccessJson(response, operation),
      operation,
      parseDeviceAuthorization,
    );
  }

  async completeDeviceAuthorization(input: {
    readonly controlApiBaseUrl: string;
    readonly deviceCode: string;
  }): Promise<SafeTunnelDeviceAuthorizationCompletion> {
    const operation = "complete_device_authorization";
    const response = await this.request(
      endpoint(input.controlApiBaseUrl, "/v1/device/complete"),
      jsonPostRequest({ deviceCode: input.deviceCode }),
      operation,
    );

    if (response.status === 409 || response.status === 403 || response.status === 410) {
      const applicationCode = await readApplicationErrorCode(response);
      if (response.status === 409 && applicationCode === "authorization_pending") {
        return { kind: "pending" };
      }
      if (applicationCode === "authorization_denied") {
        throw new SafeTunnelControlPlaneError("authorization_denied", operation);
      }
      if (applicationCode === "authorization_expired") {
        throw new SafeTunnelControlPlaneError("authorization_expired", operation);
      }
      throw mappedHttpError(response.status, operation);
    }

    requireExpectedResponse(response, 200, operation);
    return {
      kind: "approved",
      authorization: parseControlPlaneResponse(
        await readSuccessJson(response, operation),
        operation,
        parseApprovedDeviceAuthorization,
      ),
    };
  }

  async registerMachine(input: {
    readonly controlApiBaseUrl: string;
    readonly connectorAccessToken: string;
    readonly machineName: string;
    readonly machineSlug: string;
    readonly localPiWebUrl: string;
    readonly clientVersion: string;
  }): Promise<SafeTunnelRegisteredMachine> {
    const operation = "register_machine";
    const response = await this.request(
      endpoint(input.controlApiBaseUrl, "/v1/machines"),
      jsonPostRequest({
        name: input.machineName,
        slug: input.machineSlug,
        localPiWebUrl: input.localPiWebUrl,
        connectorVersion: input.clientVersion,
      }, input.connectorAccessToken),
      operation,
    );
    requireExpectedResponse(response, 201, operation);
    return parseControlPlaneResponse(
      await readSuccessJson(response, operation),
      operation,
      parseRegisteredMachine,
    );
  }

  async getMachineTunnelConfig(
    credentials: SafeTunnelMachineCredentials,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<SafeTunnelMachineTunnelConfig> {
    const operation = "get_tunnel_config";
    const response = await this.request(
      endpoint(
        credentials.controlApiBaseUrl,
        `/v1/machines/${encodeURIComponent(credentials.machineId)}/tunnel-config`,
      ),
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${credentials.machineToken}`,
        },
        redirect: "error",
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
      operation,
    );
    requireExpectedResponse(response, 200, operation);
    return parseControlPlaneResponse(
      await readSuccessJson(response, operation),
      operation,
      parseMachineTunnelConfig,
    );
  }

  async recordMachineHeartbeat(
    credentials: SafeTunnelMachineCredentials,
    input: {
      readonly clientVersion: string;
      readonly tunnelStatus: SafeTunnelHeartbeatTunnelStatus;
      readonly errorMessage?: string;
    },
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<SafeTunnelMachineHeartbeat> {
    const operation = "record_heartbeat";
    const response = await this.request(
      endpoint(
        credentials.controlApiBaseUrl,
        `/v1/machines/${encodeURIComponent(credentials.machineId)}/heartbeat`,
      ),
      {
        ...jsonPostRequest({
          connectorVersion: input.clientVersion,
          tunnelStatus: input.tunnelStatus,
          ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
        }, credentials.machineToken),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
      operation,
    );
    requireExpectedResponse(response, 202, operation);
    return parseControlPlaneResponse(
      await readSuccessJson(response, operation),
      operation,
      parseMachineHeartbeat,
    );
  }

  private async request(
    url: string,
    init: RequestInit,
    operation: SafeTunnelControlPlaneOperation,
  ): Promise<Response> {
    try {
      return await this.fetch(url, init);
    } catch {
      throw new SafeTunnelControlPlaneError("transport_failed", operation);
    }
  }
}

function jsonPostRequest(
  body: Readonly<Record<string, string>>,
  bearerToken?: string,
): RequestInit {
  return {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(bearerToken === undefined ? {} : { authorization: `Bearer ${bearerToken}` }),
    },
    body: JSON.stringify(body),
    redirect: "error",
  };
}

function endpoint(baseUrl: string, path: string): string {
  return `${normalizeSafeTunnelControlApiBaseUrl(baseUrl)}${path}`;
}

function requireExpectedResponse(
  response: Response,
  expectedStatus: number,
  operation: SafeTunnelControlPlaneOperation,
): void {
  if (response.status === expectedStatus) return;
  if (response.ok) throw new SafeTunnelControlPlaneError("invalid_response", operation);
  throw mappedHttpError(response.status, operation);
}

function mappedHttpError(
  status: number,
  operation: SafeTunnelControlPlaneOperation,
): SafeTunnelControlPlaneError {
  if (status === 401 || status === 403) {
    return new SafeTunnelControlPlaneError("authentication_failed", operation);
  }
  if (status === 409) return new SafeTunnelControlPlaneError("conflict", operation);
  if (status === 429) return new SafeTunnelControlPlaneError("rate_limited", operation);
  if (status >= 500) return new SafeTunnelControlPlaneError("service_unavailable", operation);
  return new SafeTunnelControlPlaneError("request_rejected", operation);
}

async function readSuccessJson(
  response: Response,
  operation: SafeTunnelControlPlaneOperation,
): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    throw new SafeTunnelControlPlaneError("invalid_response", operation);
  }
}

async function readApplicationErrorCode(response: Response): Promise<string | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  if (!isRecord(body)) return undefined;
  const envelope = body["error"];
  const errorRecord = isRecord(envelope) ? envelope : body;
  const code = errorRecord["code"];
  return typeof code === "string" && code.trim() !== "" ? code : undefined;
}

class InvalidSafeTunnelControlPlaneResponseError extends Error {}

function parseControlPlaneResponse<T>(
  body: unknown,
  operation: SafeTunnelControlPlaneOperation,
  parse: (value: unknown) => T,
): T {
  try {
    return parse(body);
  } catch (error: unknown) {
    if (error instanceof InvalidSafeTunnelControlPlaneResponseError) {
      throw new SafeTunnelControlPlaneError("invalid_response", operation);
    }
    throw error;
  }
}

function parseDeviceAuthorization(body: unknown): SafeTunnelDeviceAuthorization {
  const record = requireResponseRecord(body);
  return {
    deviceCode: requireResponseString(record["deviceCode"]),
    userCode: requireResponseString(record["userCode"]),
    verificationUri: requireExternalHttpUrl(record["verificationUri"]),
    verificationUriComplete: requireExternalHttpUrl(record["verificationUriComplete"]),
    expiresAt: requireCanonicalIsoDateTime(record["expiresAt"]),
    intervalSeconds: requirePositiveInteger(record["intervalSeconds"]),
  };
}

function parseApprovedDeviceAuthorization(body: unknown): SafeTunnelApprovedDeviceAuthorization {
  const record = requireResponseRecord(body);
  const account = requireResponseRecord(record["account"]);
  if (record["tokenType"] !== "Bearer") throw invalidResponse();
  return {
    accessToken: requireResponseString(record["accessToken"]),
    expiresAt: requireCanonicalIsoDateTime(record["expiresAt"]),
    account: {
      id: requireResponseString(account["id"]),
      publicNamespace: requireResponseString(account["publicNamespace"]),
    },
  };
}

function parseRegisteredMachine(body: unknown): SafeTunnelRegisteredMachine {
  const record = requireResponseRecord(body);
  const machine = requireResponseRecord(record["machine"]);
  requireResponseString(record["tunnelConfigUrl"]);
  return {
    machine: {
      id: requireResponseString(machine["id"]),
      accountId: requireResponseString(machine["accountId"]),
      name: requireResponseString(machine["name"]),
      slug: requireResponseString(machine["slug"]),
    },
    publicHostname: requireResponseString(record["publicHostname"]),
    publicUrl: normalizeResponsePublicUrl(record["publicUrl"]),
    machineToken: requireResponseString(record["machineToken"]),
  };
}

function parseMachineTunnelConfig(body: unknown): SafeTunnelMachineTunnelConfig {
  const record = requireResponseRecord(body);
  const machine = requireResponseRecord(record["machine"]);
  const frp = requireResponseRecord(record["frp"]);
  if (frp["configFormat"] !== "toml") throw invalidResponse();
  return {
    machineId: requireResponseString(machine["id"]),
    publicHostname: requireResponseString(record["publicHostname"]),
    publicUrl: normalizeResponsePublicUrl(record["publicUrl"]),
    localPiWebUrl: requireResponseString(record["localPiWebUrl"]),
    proxyName: requireResponseString(frp["proxyName"]),
    frpcConfigToml: requireResponseString(frp["frpcConfigToml"]),
  };
}

function parseMachineHeartbeat(body: unknown): SafeTunnelMachineHeartbeat {
  const record = requireResponseRecord(body);
  const machine = requireResponseRecord(record["machine"]);
  if (record["accepted"] !== true) throw invalidResponse();
  return {
    machineId: requireResponseString(machine["id"]),
    lastSeenAt: requireCanonicalIsoDateTime(machine["lastSeenAt"]),
    nextHeartbeatSeconds: requirePositiveInteger(record["nextHeartbeatSeconds"]),
  };
}

function normalizeResponsePublicUrl(value: unknown): string {
  try {
    return normalizeSafeTunnelPublicUrl(value);
  } catch {
    throw invalidResponse();
  }
}

function requireExternalHttpUrl(value: unknown): string {
  const source = requireResponseString(value);
  try {
    const url = new URL(source);
    if ((url.protocol !== "http:" && url.protocol !== "https:")
      || url.username !== "" || url.password !== "") throw invalidResponse();
    return source;
  } catch (error: unknown) {
    if (error instanceof InvalidSafeTunnelControlPlaneResponseError) throw error;
    throw invalidResponse();
  }
}

function requireCanonicalIsoDateTime(value: unknown): string {
  const source = requireResponseString(value);
  const parsed = new Date(source);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== source) {
    throw invalidResponse();
  }
  return source;
}

function requirePositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw invalidResponse();
  }
  return value;
}

function requireResponseString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw invalidResponse();
  return value;
}

function requireResponseRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw invalidResponse();
  return value;
}

function invalidResponse(): InvalidSafeTunnelControlPlaneResponseError {
  return new InvalidSafeTunnelControlPlaneResponseError();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function controlPlaneErrorMessage(
  code: SafeTunnelControlPlaneErrorCode,
  operation: SafeTunnelControlPlaneOperation,
): string {
  const label = operationLabel(operation);
  switch (code) {
    case "authentication_failed":
      return `${label} was not authorized by the Safe Tunnel service.`;
    case "authorization_denied":
      return "Safe Tunnel device authorization was denied.";
    case "authorization_expired":
      return "Safe Tunnel device authorization expired.";
    case "conflict":
      return `${label} conflicted with current Safe Tunnel service state.`;
    case "invalid_response":
      return `The Safe Tunnel service returned an invalid response for ${label.toLowerCase()}.`;
    case "rate_limited":
      return `${label} was rate limited by the Safe Tunnel service.`;
    case "request_rejected":
      return `${label} was rejected by the Safe Tunnel service.`;
    case "service_unavailable":
      return `The Safe Tunnel service is unavailable during ${label.toLowerCase()}.`;
    case "transport_failed":
      return `Unable to reach the Safe Tunnel service for ${label.toLowerCase()}.`;
  }
}

function operationLabel(operation: SafeTunnelControlPlaneOperation): string {
  switch (operation) {
    case "complete_device_authorization":
      return "Device authorization completion";
    case "get_tunnel_config":
      return "Tunnel configuration";
    case "record_heartbeat":
      return "Machine heartbeat";
    case "register_machine":
      return "Machine registration";
    case "start_device_authorization":
      return "Device authorization start";
  }
}
