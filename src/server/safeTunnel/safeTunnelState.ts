import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { piWebDataDir } from "../../config.js";
import type { SafeTunnelDesiredState } from "../../shared/apiTypes.js";

export const safeTunnelStateVersion = 1;
// The temporary connector runtime can read this compatible projection while PI WEB
// remains the sole writer/owner. The connector ignores PI WEB's additional fields.
export const safeTunnelConnectorConfigSchemaVersion = 2;
export const safeTunnelStateDirectoryMode = 0o700;
export const safeTunnelStateFileMode = 0o600;
export const defaultSafeTunnelLocalPiWebUrl = "http://127.0.0.1:8504";
export const safeTunnelConnectorConfigPathEnvVar = "PI_WEB_SAFE_TUNNEL_CONFIG_PATH";

interface PathApi {
  dirname(path: string): string;
  join(...paths: string[]): string;
}

export interface SafeTunnelMachineCredentials {
  readonly controlApiBaseUrl: string;
  readonly machineId: string;
  readonly machineToken: string;
  readonly machineSlug?: string;
  readonly publicUrl?: string;
}

/**
 * PI WEB-owned durable Safe Tunnel state. Desired state is deliberately separate
 * from runtime observations; no PID, process status, generated frp config, or log
 * state belongs in this file.
 */
export interface SafeTunnelPersistedState {
  readonly stateVersion: typeof safeTunnelStateVersion;
  readonly schemaVersion: typeof safeTunnelConnectorConfigSchemaVersion;
  readonly desiredState: SafeTunnelDesiredState;
  readonly localPiWebUrl: string;
  readonly frpcPath?: string;
  readonly machine?: SafeTunnelMachineCredentials;
}

export interface LoadedSafeTunnelState {
  readonly exists: boolean;
  readonly state: SafeTunnelPersistedState;
}

export interface SafeTunnelStateStorage {
  readonly filePath: string;
  load(): Promise<LoadedSafeTunnelState>;
  save(state: SafeTunnelPersistedState): Promise<void>;
}

export interface FileSafeTunnelStateStorageOptions {
  readonly filePath?: string;
  readonly legacyConnectorConfigPath?: string;
  readonly platform?: NodeJS.Platform;
}

export class FileSafeTunnelStateStorage implements SafeTunnelStateStorage {
  readonly filePath: string;
  private readonly legacyConnectorConfigPath: string;
  private readonly platform: NodeJS.Platform;

  constructor(options: FileSafeTunnelStateStorageOptions = {}) {
    this.filePath = options.filePath ?? defaultSafeTunnelStatePath();
    this.legacyConnectorConfigPath = options.legacyConnectorConfigPath ?? discoverLegacyConnectorConfigPath();
    this.platform = options.platform ?? process.platform;
  }

  async load(): Promise<LoadedSafeTunnelState> {
    const persisted = await readJsonFile(this.filePath);
    if (persisted !== undefined) {
      await this.restrictExistingStatePermissions();
      const state = parseSafeTunnelState(persisted);
      if (!isCurrentSafeTunnelStateRecord(persisted)) await this.save(state);
      return { exists: true, state };
    }

    const legacy = this.legacyConnectorConfigPath === this.filePath
      ? undefined
      : await readJsonFile(this.legacyConnectorConfigPath);
    if (legacy === undefined) return { exists: false, state: createDefaultSafeTunnelState() };

    const state = parseSafeTunnelState(legacy);
    await this.save(state);
    return { exists: true, state };
  }

  async save(state: SafeTunnelPersistedState): Promise<void> {
    const normalized = parseSafeTunnelState(state);
    const stateDirectory = dirname(this.filePath);
    await mkdir(stateDirectory, { mode: safeTunnelStateDirectoryMode, recursive: true });
    await restrictMode(stateDirectory, safeTunnelStateDirectoryMode, this.platform);

    const tempPath = `${this.filePath}.${process.pid.toString()}-${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: safeTunnelStateFileMode,
      });
      await restrictMode(tempPath, safeTunnelStateFileMode, this.platform);
      await rename(tempPath, this.filePath);
      await restrictMode(this.filePath, safeTunnelStateFileMode, this.platform);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private async restrictExistingStatePermissions(): Promise<void> {
    await restrictMode(dirname(this.filePath), safeTunnelStateDirectoryMode, this.platform);
    await restrictMode(this.filePath, safeTunnelStateFileMode, this.platform);
  }
}

export function createDefaultSafeTunnelState(): SafeTunnelPersistedState {
  return {
    stateVersion: safeTunnelStateVersion,
    schemaVersion: safeTunnelConnectorConfigSchemaVersion,
    desiredState: "disabled",
    localPiWebUrl: defaultSafeTunnelLocalPiWebUrl,
  };
}

export function defaultSafeTunnelStatePath(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  return join(piWebDataDir(env, cwd), "safe-tunnel", "config.json");
}

export function discoverLegacyConnectorConfigPath(options: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory?: string;
  readonly platform?: NodeJS.Platform;
} = {}): string {
  const env = options.env ?? process.env;
  const homeDirectory = requireNonEmptyString(options.homeDirectory ?? homedir(), "home directory");
  const platform = options.platform ?? process.platform;
  const pathApi = pathApiForPlatform(platform);

  if (platform === "win32") {
    const configRoot = optionalNonEmptyString(env["APPDATA"])
      ?? pathApi.join(homeDirectory, "AppData", "Roaming");
    return pathApi.join(configRoot, "pi-web-tunnel", "config.json");
  }

  const configRoot = optionalNonEmptyString(env["XDG_CONFIG_HOME"])
    ?? pathApi.join(homeDirectory, ".config");
  return pathApi.join(configRoot, "pi-web-tunnel", "config.json");
}

export function parseSafeTunnelState(value: unknown): SafeTunnelPersistedState {
  const record = requireRecord(value, "Safe Tunnel state must be a JSON object.");
  const stateVersion = record["stateVersion"];
  const connectorSchemaVersion = record["schemaVersion"];

  if (stateVersion !== undefined && stateVersion !== safeTunnelStateVersion) {
    throw new Error("Unsupported Safe Tunnel state version.");
  }
  if (connectorSchemaVersion !== 1 && connectorSchemaVersion !== safeTunnelConnectorConfigSchemaVersion) {
    throw new Error("Unsupported Safe Tunnel connector config schema version.");
  }

  const desiredState = stateVersion === undefined
    ? "disabled"
    : requireDesiredState(record["desiredState"]);
  const localPiWebUrl = normalizeSafeTunnelLocalPiWebUrl(record["localPiWebUrl"]);
  const frpcPath = optionalNonEmptyStateString(record["frpcPath"], "frpcPath");
  const machine = parseOptionalMachineCredentials(record["machine"]);

  return {
    stateVersion: safeTunnelStateVersion,
    schemaVersion: safeTunnelConnectorConfigSchemaVersion,
    desiredState,
    localPiWebUrl,
    ...(frpcPath === undefined ? {} : { frpcPath }),
    ...(machine === undefined ? {} : { machine }),
  };
}

export function normalizeSafeTunnelControlApiBaseUrl(value: unknown): string {
  const source = requireNonEmptyString(value, "controlApiBaseUrl");
  const parsed = parseUrl(source, "controlApiBaseUrl");
  requireHttpProtocol(parsed, "controlApiBaseUrl");
  requireUrlWithoutCredentials(parsed, "controlApiBaseUrl");
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Safe Tunnel controlApiBaseUrl must not include a query or fragment.");
  }
  const path = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.origin}${path === "" ? "" : path}`;
}

export function normalizeSafeTunnelLocalPiWebUrl(value: unknown): string {
  const source = requireNonEmptyString(value, "localPiWebUrl");
  const parsed = parseUrl(source, "localPiWebUrl");
  if (parsed.protocol !== "http:") {
    throw new Error("Safe Tunnel localPiWebUrl must use http.");
  }
  requireUrlWithoutCredentials(parsed, "localPiWebUrl");
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Safe Tunnel localPiWebUrl must not include a path, query, or fragment.");
  }
  if (parsed.port === "") {
    throw new Error("Safe Tunnel localPiWebUrl must include an explicit port.");
  }
  return parsed.origin;
}

export function normalizeSafeTunnelPublicUrl(value: unknown): string {
  const source = requireNonEmptyString(value, "publicUrl");
  const parsed = parseUrl(source, "publicUrl");
  requireHttpProtocol(parsed, "publicUrl");
  requireUrlWithoutCredentials(parsed, "publicUrl");
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Safe Tunnel publicUrl must not include a path, query, or fragment.");
  }
  return parsed.origin;
}

function parseOptionalMachineCredentials(value: unknown): SafeTunnelMachineCredentials | undefined {
  if (value === undefined) return undefined;
  const record = requireRecord(value, "Safe Tunnel machine credentials must be a JSON object.");
  const machineSlug = optionalNonEmptyStateString(record["machineSlug"], "machine.machineSlug");
  const publicUrl = record["publicUrl"] === undefined
    ? undefined
    : normalizeSafeTunnelPublicUrl(record["publicUrl"]);

  if (machineSlug !== undefined && !isMachineSlug(machineSlug)) {
    throw new Error("Safe Tunnel machine.machineSlug must be a lowercase DNS label.");
  }

  return {
    controlApiBaseUrl: normalizeSafeTunnelControlApiBaseUrl(record["controlApiBaseUrl"]),
    machineId: requireNonEmptyString(record["machineId"], "machine.machineId"),
    machineToken: requireNonEmptyString(record["machineToken"], "machine.machineToken"),
    ...(machineSlug === undefined ? {} : { machineSlug }),
    ...(publicUrl === undefined ? {} : { publicUrl }),
  };
}

function isCurrentSafeTunnelStateRecord(value: unknown): boolean {
  return isRecord(value)
    && value["stateVersion"] === safeTunnelStateVersion
    && value["schemaVersion"] === safeTunnelConnectorConfigSchemaVersion
    && (value["desiredState"] === "enabled" || value["desiredState"] === "disabled");
}

async function readJsonFile(path: string): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ENOENT")) return undefined;
    throw error;
  }

  try {
    const value: unknown = JSON.parse(source);
    return value;
  } catch {
    throw new Error("Safe Tunnel state contains invalid JSON.");
  }
}

async function restrictMode(path: string, mode: number, platform: NodeJS.Platform): Promise<void> {
  if (platform === "win32") return;
  await chmod(path, mode);
}

function requireDesiredState(value: unknown): SafeTunnelDesiredState {
  if (value !== "enabled" && value !== "disabled") {
    throw new Error("Safe Tunnel desiredState must be enabled or disabled.");
  }
  return value;
}

function optionalNonEmptyStateString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  return requireNonEmptyString(value, fieldName);
}

function optionalNonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized === "" ? undefined : normalized;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Safe Tunnel ${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function parseUrl(value: string, fieldName: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Safe Tunnel ${fieldName} must be a valid URL.`);
  }
}

function requireHttpProtocol(url: URL, fieldName: string): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Safe Tunnel ${fieldName} must use http or https.`);
  }
}

function requireUrlWithoutCredentials(url: URL, fieldName: string): void {
  if (url.username !== "" || url.password !== "") {
    throw new Error(`Safe Tunnel ${fieldName} must not include credentials.`);
  }
}

function isMachineSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value);
}

function requireRecord(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function pathApiForPlatform(platform: NodeJS.Platform): PathApi {
  return platform === "win32" ? win32 : posix;
}
