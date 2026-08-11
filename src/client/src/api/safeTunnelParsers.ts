import type {
  SafeTunnelConfigState,
  SafeTunnelConfigStatus,
  SafeTunnelDisableResponse,
  SafeTunnelEnableResponse,
  SafeTunnelOperationPhase,
  SafeTunnelOperationResponse,
  SafeTunnelOperationStatus,
  SafeTunnelRuntimeDiagnosticCode,
  SafeTunnelRuntimeState,
  SafeTunnelRuntimeStatus,
  SafeTunnelStatusResponse,
} from "../../../shared/apiTypes";
import type { SafeTunnelDesiredState } from "../../../shared/safeTunnelTypes";

export function parseSafeTunnelStatusResponse(value: unknown): SafeTunnelStatusResponse {
  const record = requireRecord(value);
  const activeOperation = record["activeOperation"] === undefined
    ? undefined
    : parseSafeTunnelOperationResponse(record["activeOperation"]);
  return {
    config: parseSafeTunnelConfigStatus(record["config"]),
    desiredState: requireSafeTunnelDesiredState(record, "desiredState"),
    runtime: parseSafeTunnelRuntimeStatus(record["runtime"]),
    ...(activeOperation === undefined ? {} : { activeOperation }),
  };
}

export function parseSafeTunnelEnableResponse(value: unknown): SafeTunnelEnableResponse {
  const record = requireRecord(value);
  if (record["accepted"] !== true) throw new Error("Expected Safe Tunnel enable accepted response");
  return {
    accepted: true,
    operation: parseSafeTunnelOperationResponse(record["operation"]),
    status: parseSafeTunnelStatusResponse(record["status"]),
  };
}

export function parseSafeTunnelOperationResponse(value: unknown): SafeTunnelOperationResponse {
  const record = requireRecord(value);
  const exitCode = optionalNumberOrNull(record, "exitCode");
  const finishedAt = optionalString(record, "finishedAt");
  const logPath = optionalString(record, "logPath");
  const logTail = optionalString(record, "logTail");
  const logTailMaxCharacters = optionalNumber(record, "logTailMaxCharacters");
  const publicUrl = optionalHttpUrl(record, "publicUrl");
  const signal = optionalString(record, "signal");
  const userCode = optionalString(record, "userCode");
  const verificationUriComplete = optionalHttpUrl(record, "verificationUriComplete");
  const error = optionalString(record, "error");
  return {
    id: requireString(record, "id"),
    kind: requireSafeTunnelOperationKind(record, "kind"),
    phase: requireSafeTunnelOperationPhase(record, "phase"),
    status: requireSafeTunnelOperationStatus(record, "status"),
    startedAt: requireString(record, "startedAt"),
    stdout: requireString(record, "stdout"),
    stderr: requireString(record, "stderr"),
    ...(error === undefined ? {} : { error }),
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(logPath === undefined ? {} : { logPath }),
    ...(logTail === undefined ? {} : { logTail }),
    ...(logTailMaxCharacters === undefined ? {} : { logTailMaxCharacters }),
    ...(publicUrl === undefined ? {} : { publicUrl }),
    ...(signal === undefined ? {} : { signal }),
    ...(userCode === undefined ? {} : { userCode }),
    ...(verificationUriComplete === undefined ? {} : { verificationUriComplete }),
  };
}

export function parseSafeTunnelDisableResponse(value: unknown): SafeTunnelDisableResponse {
  const record = requireRecord(value);
  return { status: parseSafeTunnelStatusResponse(record["status"]) };
}

function parseSafeTunnelConfigStatus(value: unknown): SafeTunnelConfigStatus {
  const record = requireRecord(value);
  const localPiWebUrl = optionalHttpUrl(record, "localPiWebUrl");
  const frpcPathConfigured = optionalBoolean(record, "frpcPathConfigured");
  const machine = record["machine"] === undefined
    ? undefined
    : parseSafeTunnelConfigMachine(record["machine"]);
  const error = optionalString(record, "error");
  return {
    path: requireString(record, "path"),
    exists: requireBoolean(record, "exists"),
    state: requireSafeTunnelConfigState(record, "state"),
    ...(localPiWebUrl === undefined ? {} : { localPiWebUrl }),
    ...(frpcPathConfigured === undefined ? {} : { frpcPathConfigured }),
    ...(machine === undefined ? {} : { machine }),
    ...(error === undefined ? {} : { error }),
  };
}

function parseSafeTunnelConfigMachine(value: unknown): NonNullable<SafeTunnelConfigStatus["machine"]> {
  const record = requireRecord(value);
  const machineSlug = optionalString(record, "machineSlug");
  const publicHostname = optionalString(record, "publicHostname");
  const publicUrl = optionalHttpUrl(record, "publicUrl");
  return {
    controlApiBaseUrl: requireHttpUrl(record, "controlApiBaseUrl"),
    machineId: requireString(record, "machineId"),
    ...(machineSlug === undefined ? {} : { machineSlug }),
    ...(publicHostname === undefined ? {} : { publicHostname }),
    ...(publicUrl === undefined ? {} : { publicUrl }),
  };
}

function parseSafeTunnelRuntimeStatus(value: unknown): SafeTunnelRuntimeStatus {
  const record = requireRecord(value);
  const diagnosticCode = optionalSafeTunnelRuntimeDiagnosticCode(record, "diagnosticCode");
  const frpcConfigExists = optionalBoolean(record, "frpcConfigExists");
  const frpcConfigPath = optionalString(record, "frpcConfigPath");
  const pid = optionalNumber(record, "pid");
  const error = optionalString(record, "error");
  const logError = optionalString(record, "logError");
  const logExists = optionalBoolean(record, "logExists");
  const logPath = optionalString(record, "logPath");
  const logTail = optionalString(record, "logTail");
  const logTailMaxCharacters = optionalNumber(record, "logTailMaxCharacters");
  return {
    state: requireSafeTunnelRuntimeState(record, "state"),
    ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
    ...(frpcConfigExists === undefined ? {} : { frpcConfigExists }),
    ...(frpcConfigPath === undefined ? {} : { frpcConfigPath }),
    ...(pid === undefined ? {} : { pid }),
    ...(error === undefined ? {} : { error }),
    ...(logError === undefined ? {} : { logError }),
    ...(logExists === undefined ? {} : { logExists }),
    ...(logPath === undefined ? {} : { logPath }),
    ...(logTail === undefined ? {} : { logTail }),
    ...(logTailMaxCharacters === undefined ? {} : { logTailMaxCharacters }),
  };
}

function requireSafeTunnelConfigState(record: Record<string, unknown>, key: string): SafeTunnelConfigState {
  const value = requireString(record, key);
  if (value !== "missing" && value !== "unregistered" && value !== "registered" && value !== "rejected" && value !== "invalid") {
    throw new Error(`Expected Safe Tunnel config state field: ${key}`);
  }
  return value;
}

function requireSafeTunnelDesiredState(record: Record<string, unknown>, key: string): SafeTunnelDesiredState {
  const value = requireString(record, key);
  if (value !== "enabled" && value !== "disabled") throw new Error(`Expected Safe Tunnel desired state field: ${key}`);
  return value;
}

function requireSafeTunnelRuntimeState(record: Record<string, unknown>, key: string): SafeTunnelRuntimeState {
  const value = requireString(record, key);
  if (value !== "stopped" && value !== "running" && value !== "unknown") throw new Error(`Expected Safe Tunnel runtime state field: ${key}`);
  return value;
}

function optionalSafeTunnelRuntimeDiagnosticCode(
  record: Record<string, unknown>,
  key: string,
): SafeTunnelRuntimeDiagnosticCode | undefined {
  const value = optionalString(record, key);
  if (value === undefined) return undefined;
  if (value !== "credentials_rejected"
    && value !== "heartbeat_retrying"
    && value !== "registration_required"
    && value !== "runtime_recovery_failed"
    && value !== "state_retrying") {
    throw new Error(`Expected Safe Tunnel runtime diagnostic field: ${key}`);
  }
  return value;
}

function requireSafeTunnelOperationKind(record: Record<string, unknown>, key: string): "enable" {
  const value = requireString(record, key);
  if (value !== "enable") throw new Error(`Expected Safe Tunnel operation kind field: ${key}`);
  return value;
}

function requireSafeTunnelOperationPhase(record: Record<string, unknown>, key: string): SafeTunnelOperationPhase {
  const value = requireString(record, key);
  if (value !== "preparing"
    && value !== "awaiting_approval"
    && value !== "registering"
    && value !== "starting"
    && value !== "enabled") {
    throw new Error(`Expected Safe Tunnel operation phase field: ${key}`);
  }
  return value;
}

function requireSafeTunnelOperationStatus(record: Record<string, unknown>, key: string): SafeTunnelOperationStatus {
  const value = requireString(record, key);
  if (value !== "running" && value !== "succeeded" && value !== "failed" && value !== "cancelled") {
    throw new Error(`Expected Safe Tunnel operation status field: ${key}`);
  }
  return value;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Expected object response");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`Expected string field: ${key}`);
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Expected optional string field: ${key}`);
  return value;
}

function requireHttpUrl(record: Record<string, unknown>, key: string): string {
  return requireSafeBrowserUrl(requireString(record, key), key);
}

function optionalHttpUrl(record: Record<string, unknown>, key: string): string | undefined {
  const value = optionalString(record, key);
  return value === undefined ? undefined : requireSafeBrowserUrl(value, key);
}

function requireSafeBrowserUrl(value: string, key: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Expected HTTP(S) URL field: ${key}`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:")
    || url.username !== ""
    || url.password !== "") {
    throw new Error(`Expected HTTP(S) URL field: ${key}`);
  }
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`Expected boolean field: ${key}`);
  return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`Expected optional boolean field: ${key}`);
  return value;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected optional number field: ${key}`);
  return value;
}

function optionalNumberOrNull(record: Record<string, unknown>, key: string): number | null | undefined {
  const value = record[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Expected optional number|null field: ${key}`);
  return value;
}
