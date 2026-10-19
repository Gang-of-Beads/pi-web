import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import type { PiWebConfigValues, PiWebDeprecatedAgentInput, PiWebListTilesConfig, PiWebLoggingConfig, PiWebServerSettingsUpdates, PiWebSharedThemeConfig } from "./shared/apiTypes.js";
import { isPiWebPluginId, piWebPluginIdPattern } from "./shared/pluginIds.js";
import { isRecord } from "./shared/unknownValues.js";
import { isPluginModelGrant } from "./shared/pluginModelGrant.js";
import { hasServerSettings, isPluginServerSettings, parseServerSettingsUpdates, preservePluginServerSettings } from "./shared/pluginConfigPrivacy.js";

/**
 * A config file or request that does not say what PI WEB accepts. The type is what answers a
 * request with 400 rather than 500; its message was the only mark before (B16).
 */
export class PiWebConfigError extends Error {
  override name = "PiWebConfigError";
}

/** The certificate chain and private key, as PEM files, that the web/API serves HTTPS with. */
export interface PiWebTlsConfig {
  certFile: string;
  keyFile: string;
}

export type PiWebConfig = PiWebConfigValues;

export interface LoadedPiWebConfig {
  path: string;
  exists: boolean;
  config: PiWebConfig;
  /** Deprecated agent-configuration inputs detected in `env` and the loaded file. */
  deprecatedAgentInputs: readonly DeprecatedAgentInput[];
}

export interface EffectivePiWebConfig extends Omit<PiWebConfig, "uploads" | "dockerEnvironmentFacts" | "agent" | "extensionDialogsTimeoutMs" | "logging" | "piBuiltInExtensions"> {
  uploads: NonNullable<PiWebConfig["uploads"]>;
  logging: Required<PiWebLoggingConfig>;
  environmentFacts: boolean;
  piBuiltInExtensions: boolean;
  extensionDialogsTimeoutMs: number;
  agent: EffectivePiWebAgentConfig;
}

export interface LoadedEffectivePiWebConfig extends Omit<LoadedPiWebConfig, "config"> {
  config: EffectivePiWebConfig;
}

export interface LoadOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export function defaultPiWebConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdgConfigHome = env["XDG_CONFIG_HOME"];
  return join(xdgConfigHome !== undefined && xdgConfigHome !== "" ? xdgConfigHome : join(homedir(), ".config"), "pi-web", "config.json");
}

export function defaultPiWebDataDir(): string {
  return join(homedir(), ".pi-web");
}

/**
 * Default maximum HTTP body size (bytes) for the web/API and session daemon.
 * Generous headroom for base64 image attachments (well above pi's 4.5MB
 * per-image inline limit so several images fit in one request).
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

export const DEFAULT_UPLOADS_FOLDER = ".pi-web/uploads";

/**
 * Default auto-cancel delay for extension dialogs whose extension set no
 * `timeout` of its own: none. Set `extensionDialogsTimeoutMs` to a positive
 * number of milliseconds to restore an unattended-dialog safety valve.
 *
 * A dialog asks the user a question, and a question that expires unanswered is
 * answered anyway - with the kind's cancel value, which an extension cannot
 * tell apart from a deliberate dismissal. A five-minute default meant reading
 * a long proposal on a phone silently discarded it and reported it as the
 * user's own choice. Waiting is the safer failure: a dialog opened during a
 * run is still settled when the run ends or is stopped, and every dialog is
 * settled when the session ends, so nothing parks forever unattended.
 */
export const DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS = 0;

export const PI_WEB_AGENT_COMMAND_ENV = "PI_WEB_AGENT_COMMAND";
export const PI_WEB_AGENT_DIR_ENV = "PI_WEB_AGENT_DIR";
export const PI_WEB_AGENT_SESSION_DIR_ENV = "PI_WEB_AGENT_SESSION_DIR";
export const PI_CODING_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
export const PI_CODING_AGENT_SESSION_DIR_ENV = "PI_CODING_AGENT_SESSION_DIR";

/**
 * Session storage override env keys in precedence order: the deprecated
 * `PI_WEB_` alias first so it keeps winning when both are set (today's
 * precedence, preserved for the deprecation window), then the canonical pi
 * SDK name.
 */
export const AGENT_SESSION_DIR_ENV_KEYS = [PI_WEB_AGENT_SESSION_DIR_ENV, PI_CODING_AGENT_SESSION_DIR_ENV] as const;

export interface EffectivePiWebAgentConfig {
  dir: string;
}

/**
 * Resolve the pi agent state directory. PI WEB runs sessions on the bundled pi
 * SDK only, so there is no command abstraction: the directory comes from the
 * deprecated `PI_WEB_AGENT_DIR` alias, then the canonical `PI_CODING_AGENT_DIR`,
 * then the deprecated `agent.dir` config alias, then the pi SDK default
 * (`~/.pi/agent`, mirrored from the SDK's `getAgentDir()`). The session daemon
 * exports the resolved value as `PI_CODING_AGENT_DIR` at startup, so the
 * embedded SDK's own `getAgentDir()` observes the same directory and pi-web
 * cannot drift from pi.
 */
export function effectiveAgentConfig(env: NodeJS.ProcessEnv = process.env, config: Pick<PiWebConfig, "agent"> = {}): EffectivePiWebAgentConfig {
  const sources: readonly (readonly [string, string | undefined])[] = [
    [PI_WEB_AGENT_DIR_ENV, envValue(env, PI_WEB_AGENT_DIR_ENV)],
    [PI_CODING_AGENT_DIR_ENV, envValue(env, PI_CODING_AGENT_DIR_ENV)],
    ["agent.dir", config.agent?.dir],
  ];
  const configured = sources.find((source): source is readonly [string, string] => source[1] !== undefined);
  const [sourceName, configuredDir] = configured ?? ["the agent directory default", defaultAgentDir(env)];
  return { dir: resolveAgentDirPath(configuredDir, env, sourceName, "environment") };
}

/** The session storage override from the environment, in `AGENT_SESSION_DIR_ENV_KEYS` precedence order. */
export function agentSessionDirEnvOverride(env: Readonly<NodeJS.ProcessEnv>): string | undefined {
  for (const key of AGENT_SESSION_DIR_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

/**
 * A deprecated agent-configuration input detected in a process environment or
 * config file; the canonical wire shape lives in `shared/apiTypes.ts` so the
 * runtime/status pipeline reports exactly what the loader detects.
 */
export type DeprecatedAgentInput = PiWebDeprecatedAgentInput;

export function detectDeprecatedAgentInputs(env: Readonly<NodeJS.ProcessEnv>, config: Pick<PiWebConfig, "agent"> = {}): DeprecatedAgentInput[] {
  const inputs: DeprecatedAgentInput[] = [];
  if (isEnvSet(env[PI_WEB_AGENT_COMMAND_ENV])) inputs.push({ source: "environment", name: PI_WEB_AGENT_COMMAND_ENV });
  if (isEnvSet(env[PI_WEB_AGENT_DIR_ENV])) inputs.push({ source: "environment", name: PI_WEB_AGENT_DIR_ENV, replacement: PI_CODING_AGENT_DIR_ENV });
  if (isEnvSet(env[PI_WEB_AGENT_SESSION_DIR_ENV])) inputs.push({ source: "environment", name: PI_WEB_AGENT_SESSION_DIR_ENV, replacement: PI_CODING_AGENT_SESSION_DIR_ENV });
  if (config.agent?.command !== undefined) inputs.push({ source: "config", name: "agent.command" });
  if (config.agent?.dir !== undefined) inputs.push({ source: "config", name: "agent.dir", replacement: PI_CODING_AGENT_DIR_ENV });
  return inputs;
}

/** The log settings with their defaults: failures and slow requests, 50 MB files, three copies kept. */
export const DEFAULT_LOGGING: Required<PiWebLoggingConfig> = { level: "errors", maxFileMb: 50, keepFiles: 3 };

export function effectiveLoggingConfig(config: Pick<PiWebConfig, "logging"> = {}): Required<PiWebLoggingConfig> {
  return { ...DEFAULT_LOGGING, ...config.logging };
}

export function effectiveUploadsConfig(config: Pick<PiWebConfig, "uploads"> = {}): NonNullable<PiWebConfig["uploads"]> {
  return { defaultFolder: config.uploads?.defaultFolder ?? DEFAULT_UPLOADS_FOLDER };
}

export function maxUploadBytes(env: NodeJS.ProcessEnv = process.env, config: PiWebConfig = {}): number {
  const fromEnv = env["PI_WEB_MAX_UPLOAD_BYTES"];
  if (fromEnv !== undefined && fromEnv !== "") {
    const parsed = Number(fromEnv);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  if (config.maxUploadBytes !== undefined) return config.maxUploadBytes;
  return DEFAULT_MAX_UPLOAD_BYTES;
}

export function piWebDataDir(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configured = env["PI_WEB_DATA_DIR"];
  if (configured === undefined || configured === "") return defaultPiWebDataDir();
  return resolve(cwd, configured);
}

export function piWebConfigPath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configured = env["PI_WEB_CONFIG"];
  if (configured === undefined || configured === "") return defaultPiWebConfigPath(env);
  return resolve(cwd, configured);
}

export function loadPiWebConfig(options: LoadOptions = {}): LoadedPiWebConfig {
  const env = options.env ?? process.env;
  const path = piWebConfigPath(env, options.cwd ?? process.cwd());
  if (!existsSync(path)) return { path, exists: false, config: {}, deprecatedAgentInputs: detectDeprecatedAgentInputs(env) };

  const config = parsePiWebConfig(readExistingConfigObject(path), path);
  return { path, exists: true, config, deprecatedAgentInputs: detectDeprecatedAgentInputs(env, config) };
}

export function effectivePiWebConfig(options: LoadOptions = {}): LoadedEffectivePiWebConfig {
  return resolveEffectivePiWebConfig(loadPiWebConfig(options), options);
}

export function resolveEffectivePiWebConfig(loaded: LoadedPiWebConfig, options: LoadOptions = {}): LoadedEffectivePiWebConfig {
  const env = options.env ?? process.env;
  const host = env["PI_WEB_HOST"];
  const port = env["PI_WEB_PORT"] ?? env["PORT"];
  const allowedHosts = env["PI_WEB_ALLOWED_HOSTS"];
  const maxUpload = env["PI_WEB_MAX_UPLOAD_BYTES"];
  const agent = effectiveAgentConfig(env, loaded.config);
  return {
    ...loaded,
    config: {
      ...loaded.config,
      ...(host !== undefined && host !== "" ? { host } : {}),
      ...(port !== undefined && port !== "" ? { port: parsePort(port, "PI_WEB_PORT") } : {}),
      ...(allowedHosts !== undefined && allowedHosts !== "" ? { allowedHosts: parseAllowedHostsEnv(allowedHosts) } : {}),
      ...(maxUpload !== undefined && maxUpload !== "" ? { maxUploadBytes: parseMaxUploadBytes(maxUpload, "PI_WEB_MAX_UPLOAD_BYTES") } : {}),
      uploads: effectiveUploadsConfig(loaded.config),
      logging: effectiveLoggingConfig(loaded.config),
      // Always resolved (on by default); inert outside Docker deployments.
      environmentFacts: environmentFactsEnabled(env, loaded.config),
      piBuiltInExtensions: loaded.config.piBuiltInExtensions ?? true,
      // Always resolved; the unattended-dialog safety valve, not a gate.
      extensionDialogsTimeoutMs: loaded.config.extensionDialogsTimeoutMs ?? DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS,
      agent,
    },
  };
}

/**
 * The keys a save rewrites from the parsed config; every other key in the file is kept as it was.
 * `respectProjectTrust` and `askUser` (PI WEB no longer has a built-in question tool) are retired: a load
 * ignores them and a save drops them. `extensionDialogsTimeoutMs` is not here: it has no editor,
 * so a save keeps the value the file holds, and one a request carries is not written. `theme` is not
 * here either: Settings writes it alone through `saveSharedThemeConfig`, so a general save made from
 * an older read cannot replace it. `tls` is not a parsed key at all (see `piWebTlsConfig`), so a save
 * keeps it as the file holds it.
 */
const SAVED_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "host", "port", "allowedHosts", "shortcuts", "plugins", "pathAccess", "uploads", "maxUploadBytes",
  "logging", "listTiles", "askUser", "respectProjectTrust", "environmentFacts", "piBuiltInExtensions", "agent", "updateCommand",
]);

export function savePiWebConfig(config: PiWebConfig, options: LoadOptions = {}, serverSettingsUpdates?: PiWebServerSettingsUpdates): LoadedPiWebConfig {
  const env = options.env ?? process.env;
  const path = piWebConfigPath(env, options.cwd ?? process.cwd());
  const normalized = parsePiWebConfig(piWebConfigRecord(config), path);
  if (hasServerSettings(normalized)) throw new PiWebConfigError("PI WEB config plugin serverSettings change only through serverSettingsUpdates operations");
  effectiveAgentConfig(env, normalized);
  const existing = readExistingConfigObject(path);
  const storedPlugins = existing["plugins"] === undefined ? {} : parsePlugins(existing["plugins"], path);
  const updates = parseServerSettingsUpdates(serverSettingsUpdates);
  const plugins = preservePluginServerSettings(storedPlugins, normalized.plugins, updates);
  if (normalized.plugins !== undefined || Object.keys(plugins).length > 0) normalized.plugins = plugins;
  if (existing["agent"] !== undefined) parseAgentConfig(existing["agent"], path);
  const kept = Object.fromEntries(Object.entries(existing).filter(([key]) => !SAVED_CONFIG_KEYS.has(key)));
  writeConfigObject(path, { ...kept, ...piWebConfigRecord(normalized) });
  return { path, exists: true, config: normalized, deprecatedAgentInputs: detectDeprecatedAgentInputs(env, normalized) };
}

/** Sets or clears the shared theme alone; every other key stays exactly as the file holds it. */
export function saveSharedThemeConfig(theme: PiWebSharedThemeConfig | undefined, options: LoadOptions = {}): LoadedPiWebConfig {
  const env = options.env ?? process.env;
  const path = piWebConfigPath(env, options.cwd ?? process.cwd());
  const others = Object.fromEntries(Object.entries(readExistingConfigObject(path)).filter(([key]) => key !== "theme"));
  const next = theme === undefined ? others : { ...others, theme: parseSharedThemeConfig(theme, path) };
  const config = parsePiWebConfig(next, path);
  writeConfigObject(path, next);
  return { path, exists: true, config, deprecatedAgentInputs: detectDeprecatedAgentInputs(env, config) };
}

/**
 * The file can hold private plugin settings in plaintext, so a file PI WEB creates is readable by its
 * owner alone on POSIX. The mode applies only when the file is created: an existing file keeps the
 * mode and ACLs its administrator gave it.
 */
const NEW_CONFIG_FILE_MODE = 0o600;

function writeConfigObject(path: string, value: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: NEW_CONFIG_FILE_MODE });
  } catch (error) {
    throw configWriteError(error, path);
  }
}

/** Why the config file could not be written, by the system's error code, in words a reader can act on. */
const CONFIG_WRITE_REFUSALS: Readonly<Record<string, string>> = {
  EACCES: "permission denied",
  EPERM: "not permitted",
  EROFS: "the file system is read-only",
};

/**
 * A config write the system refused, as a sentence that names the file and the fix (B38: a plugin
 * toggle on a read-only config.json reported a bare EACCES). Other errors pass through unchanged.
 */
function configWriteError(error: unknown, path: string): unknown {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
  const reason = code === undefined ? undefined : CONFIG_WRITE_REFUSALS[code];
  if (reason === undefined) return error;
  return new Error(`PI WEB could not save its config file ${path} (${reason}). Make the file writable, or set PI_WEB_CONFIG to a writable file, then try again.`, { cause: error });
}

/**
 * Where a JSON syntax error is, by line and column only. The parser's own message can quote the source
 * around the error, and that source can be a private setting, so the message itself is never repeated.
 */
export function jsonErrorLocation(error: SyntaxError): string {
  const location = /\(line (\d+) column (\d+)\)/u.exec(error.message);
  return location === null ? "" : ` (line ${location[1] ?? ""} column ${location[2] ?? ""})`;
}

/**
 * Parse a user-edited config file's text. A leading byte order mark is dropped first: Windows PowerShell 5.1's
 * `Set-Content -Encoding utf8` and Notepad's "UTF-8 with BOM" write one, and JSON.parse rejects it.
 */
export function parseConfigFileText(text: string): unknown {
  return JSON.parse(text.replace(/^\uFEFF/u, ""));
}

/** The config file's JSON object, or `{}` when there is no file; a syntax error names only its place (jsonErrorLocation). */
export function readExistingConfigObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = parseConfigFileText(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new PiWebConfigError(`PI WEB config must contain valid JSON: ${path}${jsonErrorLocation(error)}`);
    throw error;
  }
  if (!isRecord(parsed)) throw new PiWebConfigError(`PI WEB config must be a JSON object: ${path}`);
  return parsed;
}

function piWebConfigRecord(config: PiWebConfig): Record<string, unknown> {
  return {
    ...(config.host !== undefined ? { host: config.host } : {}),
    ...(config.port !== undefined ? { port: config.port } : {}),
    ...(config.allowedHosts !== undefined ? { allowedHosts: config.allowedHosts } : {}),
    ...(config.shortcuts !== undefined ? { shortcuts: config.shortcuts } : {}),
    ...(config.plugins !== undefined ? { plugins: config.plugins } : {}),
    ...(config.pathAccess !== undefined ? { pathAccess: config.pathAccess } : {}),
    ...(config.uploads !== undefined ? { uploads: config.uploads } : {}),
    ...(config.maxUploadBytes !== undefined ? { maxUploadBytes: config.maxUploadBytes } : {}),
    ...(config.logging !== undefined ? { logging: config.logging } : {}),
    ...(config.environmentFacts !== undefined ? { environmentFacts: config.environmentFacts } : {}),
    ...(config.piBuiltInExtensions !== undefined ? { piBuiltInExtensions: config.piBuiltInExtensions } : {}),
    ...(config.agent !== undefined ? { agent: config.agent } : {}),
    ...(config.listTiles !== undefined ? { listTiles: config.listTiles } : {}),
    ...(config.updateCommand !== undefined ? { updateCommand: config.updateCommand } : {}),
  };
}

/**
 * A config object, from the file or from a request: `path` names where it came from in the
 * messages, and `agentPathHost` which host the agent's paths are judged on.
 */
export function parsePiWebConfig(value: Record<string, unknown>, path: string, agentPathHost: AgentPathHost = "current"): PiWebConfig {
  return {
    ...(value["host"] !== undefined ? { host: parseString(value["host"], "host", path) } : {}),
    ...(value["port"] !== undefined ? { port: parsePort(value["port"], "port", path) } : {}),
    ...(value["allowedHosts"] !== undefined ? { allowedHosts: parseAllowedHosts(value["allowedHosts"], path) } : {}),
    ...(value["shortcuts"] !== undefined ? { shortcuts: parseShortcuts(value["shortcuts"], path) } : {}),
    ...(value["plugins"] !== undefined ? { plugins: parsePlugins(value["plugins"], path) } : {}),
    ...(value["pathAccess"] !== undefined ? { pathAccess: parsePathAccessConfig(value["pathAccess"], path) } : {}),
    ...(value["uploads"] !== undefined ? { uploads: parseUploadsConfig(value["uploads"], path) } : {}),
    ...(value["maxUploadBytes"] !== undefined ? { maxUploadBytes: parseMaxUploadBytes(value["maxUploadBytes"], "maxUploadBytes", path) } : {}),
    ...(value["logging"] !== undefined ? { logging: parseLoggingConfig(value["logging"], path) } : {}),
    ...(value["listTiles"] !== undefined ? { listTiles: parseListTilesConfig(value["listTiles"], path) } : {}),
    ...(value["theme"] !== undefined ? { theme: parseSharedThemeConfig(value["theme"], path) } : {}),
    ...(value["environmentFacts"] !== undefined ? { environmentFacts: parseBooleanKey(value["environmentFacts"], "environmentFacts", path) } : {}),
    ...(value["piBuiltInExtensions"] !== undefined ? { piBuiltInExtensions: parseBooleanKey(value["piBuiltInExtensions"], "piBuiltInExtensions", path) } : {}),
    ...(value["extensionDialogsTimeoutMs"] !== undefined ? { extensionDialogsTimeoutMs: parseExtensionDialogsTimeoutMs(value["extensionDialogsTimeoutMs"], path) } : {}),
    ...(value["agent"] !== undefined ? { agent: parseAgentConfig(value["agent"], path, agentPathHost) } : {}),
    ...(value["updateCommand"] !== undefined ? { updateCommand: parseUpdateCommand(value["updateCommand"], path) } : {}),
  };
}

/**
 * The certificate and key the web/API serves HTTPS with, or none for plain HTTP.
 *
 * Only the web/API and the commands that reach it read this; it is not part of `PiWebConfig`, so
 * a mistake in it cannot stop the session daemon, and the browser never receives it. It has no
 * Settings editor (owner, 2026-10-14). `PI_WEB_TLS_CERT` and `PI_WEB_TLS_KEY` each win over the
 * file's value. A pair with one half missing is refused rather than served as plain HTTP: whoever
 * configured HTTPS must not get a plaintext listener in its place.
 */
export function piWebTlsConfig(options: LoadOptions = {}): PiWebTlsConfig | undefined {
  const env = options.env ?? process.env;
  const path = piWebConfigPath(env, options.cwd ?? process.cwd());
  const fromFile = readExistingConfigObject(path)["tls"];
  return effectiveTlsConfig(env, fromFile === undefined ? undefined : parseTlsConfig(fromFile, path));
}

function effectiveTlsConfig(env: NodeJS.ProcessEnv, fromFile: PiWebTlsConfig | undefined): PiWebTlsConfig | undefined {
  const certFile = envTlsPath(env, "PI_WEB_TLS_CERT") ?? fromFile?.certFile;
  const keyFile = envTlsPath(env, "PI_WEB_TLS_KEY") ?? fromFile?.keyFile;
  if (certFile === undefined && keyFile === undefined) return undefined;
  if (certFile === undefined || keyFile === undefined) {
    throw new PiWebConfigError("PI WEB HTTPS needs both a certificate and a key: set tls.certFile and tls.keyFile in the config file, or PI_WEB_TLS_CERT and PI_WEB_TLS_KEY.");
  }
  return { certFile: expandHomePath(certFile, env), keyFile: expandHomePath(keyFile, env) };
}

function envTlsPath(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === "" ? undefined : parseTlsPath(value, key, "environment");
}

function parseTlsConfig(value: unknown, path: string): PiWebTlsConfig {
  if (!isRecord(value)) throw new PiWebConfigError(`PI WEB config tls must be an object with certFile and keyFile: ${path}`);
  return { certFile: parseTlsPath(value["certFile"], "tls.certFile", path), keyFile: parseTlsPath(value["keyFile"], "tls.keyFile", path) };
}

/** A service's working directory is not the reader's, so a relative certificate path would name a file nobody chose. */
function parseTlsPath(value: unknown, key: string, path: string): string {
  if (typeof value !== "string" || value === "") throw new PiWebConfigError(`PI WEB config ${key} must be a non-empty file path: ${path}`);
  if (!isAbsolute(value) && !isHomePath(value, "current")) throw new PiWebConfigError(`PI WEB config ${key} must be an absolute or ~/ path: ${path}`);
  return value;
}

function parseUpdateCommand(value: unknown, path: string): string {
  if (typeof value !== "string") throw new PiWebConfigError(`PI WEB config updateCommand must be a string: ${path}`);
  return value.trim();
}

function parseMaxUploadBytes(value: unknown, key: string, path = "environment"): number {
  const bytes = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  if (!Number.isInteger(bytes) || bytes < 1) throw new PiWebConfigError(`PI WEB config ${key} must be a positive integer: ${path}`);
  return bytes;
}

function parseExtensionDialogsTimeoutMs(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new PiWebConfigError(`PI WEB config extensionDialogsTimeoutMs must be a non-negative integer: ${path}`);
  }
  return value;
}

function parseBooleanKey(value: unknown, key: string, path: string): boolean {
  if (typeof value !== "boolean") throw new PiWebConfigError(`PI WEB config ${key} must be a boolean: ${path}`);
  return value;
}

/**
 * Whether PI WEB appends deployment environment facts to session system
 * prompts. On by default; set the env var `PI_WEB_ENVIRONMENT_FACTS` or the
 * `environmentFacts` config key to `false` to leave the system prompt
 * untouched. The env var takes precedence over the config file.
 *
 * The facts describe the pi-web session nesting every session runs in; Docker
 * deployments append container facts on top. The env var deliberately avoids
 * the `PI_WEB_DOCKER_` prefix, which agent processes inherit for
 * `pi-web-docker`.
 */
export function environmentFactsEnabled(env: NodeJS.ProcessEnv = process.env, config: PiWebConfig = {}): boolean {
  const fromEnv = env["PI_WEB_ENVIRONMENT_FACTS"];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv === "1" || fromEnv.toLowerCase() === "true";
  return config.environmentFacts ?? true;
}

const OFFLINE_ENV_KEYS = ["PI_WEB_OFFLINE", "PI_OFFLINE"] as const;

/**
 * Whether the operator asked PI WEB (or pi itself) to stay offline, meaning
 * background network access must be skipped. Matches the "set and non-empty"
 * semantics used for the other runtime-only env switches.
 *
 * Deliberately narrower than `piWebStatus`'s update-check suppression: the
 * `*_SKIP_VERSION_CHECK` keys only silence release lookups, while these keys ask
 * for no background network at all.
 */
export function offlineModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return OFFLINE_ENV_KEYS.some((key) => isEnvSet(env[key]));
}

function parseString(value: unknown, key: string, path: string): string {
  if (typeof value !== "string" || value === "") throw new PiWebConfigError(`PI WEB config ${key} must be a non-empty string: ${path}`);
  return value;
}

/**
 * Keys still accepted under `agent` during the deprecation window: `command`
 * is parsed only so the file round-trips and the deprecation detector can name
 * it (the concept is gone), and `dir` remains honored as a deprecated alias.
 * The section has no live schema — every accepted key is deprecated — so any
 * other key fails loudly, naming the deprecated survivors.
 */
const DEPRECATED_AGENT_CONFIG_KEYS = new Set(["command", "dir"]);

export type AgentPathHost = "current" | "portable";

export function parseAgentConfig(value: unknown, path: string, pathHost: AgentPathHost = "current"): NonNullable<PiWebConfig["agent"]> {
  if (!isRecord(value)) throw new PiWebConfigError(`PI WEB config agent must be an object: ${path}`);
  const unknownKey = Object.keys(value).find((key) => !DEPRECATED_AGENT_CONFIG_KEYS.has(key));
  if (unknownKey !== undefined) throw new PiWebConfigError(`PI WEB config agent accepts only the deprecated keys "command" and "dir"; unknown key ${JSON.stringify(unknownKey)}: ${path}`);
  const command = value["command"];
  const dir = value["dir"];
  return {
    // `agent.command` is deprecated and ignored (the multi-CLI abstraction is
    // gone): it is parsed only so the file round-trips faithfully and the
    // deprecation detector can name it. `agent.dir` is still honored as a
    // deprecated alias during the deprecation window, so it keeps validation.
    ...(command !== undefined ? { command: parseString(command, "agent.command", path) } : {}),
    ...(dir !== undefined ? { dir: parseAgentDir(dir, "agent.dir", path, pathHost) } : {}),
  };
}

function parseAgentDir(value: unknown, key: string, path: string, pathHost: AgentPathHost): string {
  const dir = parseString(value, key, path).trim();
  const isAbsoluteDir = pathHost === "current" ? isHostAbsoluteAgentDir(dir) : isPortableAbsoluteAgentPath(dir);
  if (!isAbsoluteDir && !isHomePath(dir, pathHost)) {
    const absoluteLabel = pathHost === "current" ? "a host-absolute" : "an absolute";
    throw new PiWebConfigError(`PI WEB config ${key} must be ${absoluteLabel} path or start with ~: ${path}`);
  }
  return dir;
}

function resolveAgentDirPath(value: string, env: NodeJS.ProcessEnv, key: string, path: string): string {
  const parsed = parseAgentDir(value, key, path, "current");
  const expanded = expandHomePath(parsed, env);
  if (!isHostAbsoluteAgentDir(expanded)) {
    throw new PiWebConfigError(`PI WEB config ${key} must resolve to a host-absolute path: ${path}`);
  }
  return normalize(expanded);
}

export function isHostAbsoluteAgentDir(value: string): boolean {
  return isSafeAgentDirPath(value) && isAbsolute(value);
}

function isPortableAbsoluteAgentPath(value: string): boolean {
  return isSafeAgentDirPath(value) && isAbsoluteLike(value);
}

function isSafeAgentDirPath(value: string): boolean {
  return value !== "" && value === value.trim() && !hasControlCharacter(value);
}

function parsePort(value: unknown, key: string, path = "environment"): number {
  const port = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new PiWebConfigError(`PI WEB config ${key} must be an integer from 1 to 65535: ${path}`);
  return port;
}

function parseAllowedHosts(value: unknown, path: string): string[] | true {
  if (value === true) return true;
  if (!isNonEmptyStringArray(value)) {
    throw new PiWebConfigError(`PI WEB config allowedHosts must be true or an array of non-empty strings: ${path}`);
  }
  return value;
}

function parseAllowedHostsEnv(value: string): string[] | true {
  if (value === "true") return true;
  return value.split(",").map((host) => host.trim()).filter((host) => host !== "");
}

export function parsePathAccessConfig(value: unknown, path: string): NonNullable<PiWebConfigValues["pathAccess"]> {
  if (!isRecord(value)) throw new PiWebConfigError(`PI WEB config pathAccess must be an object: ${path}`);
  const allowedPaths = value["allowedPaths"];
  return {
    ...(allowedPaths !== undefined ? { allowedPaths: parseAllowedPaths(allowedPaths, path) } : {}),
  };
}

function parseAllowedPaths(value: unknown, path: string): string[] {
  if (!isNonEmptyStringArray(value)) throw new PiWebConfigError(`PI WEB config pathAccess.allowedPaths must be an array of non-empty strings: ${path}`);
  return value;
}

const LOGGING_LEVELS: readonly string[] = ["errors", "requests", "debug"];

function isLoggingLevel(value: unknown): value is NonNullable<PiWebLoggingConfig["level"]> {
  return typeof value === "string" && LOGGING_LEVELS.includes(value);
}

/** `theme`: the shared theme, a qualified theme id and whether it follows the system's light/dark preference. */
export function parseSharedThemeConfig(value: unknown, path: string): PiWebSharedThemeConfig {
  if (!isRecord(value)) throw new PiWebConfigError(`PI WEB config theme must be an object: ${path}`);
  const themeId = value["themeId"];
  const auto = value["auto"];
  if (!isQualifiedThemeId(themeId)) throw new PiWebConfigError(`PI WEB config theme.themeId must be a qualified theme id such as core:material-dark: ${path}`);
  if (typeof auto !== "boolean") throw new PiWebConfigError(`PI WEB config theme.auto must be true or false: ${path}`);
  return { themeId, auto };
}

function isQualifiedThemeId(value: unknown): value is PiWebSharedThemeConfig["themeId"] {
  return typeof value === "string" && /^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$/u.test(value);
}

/** `listTiles`: 1 or 2 tiles per row for the `phone` and `desktop` layouts; an absent layout keeps the width rule. */
export function parseListTilesConfig(value: unknown, path: string): PiWebListTilesConfig {
  if (!isRecord(value)) throw new PiWebConfigError(`PI WEB config listTiles must be an object: ${path}`);
  const phone = value["phone"];
  const desktop = value["desktop"];
  if (phone !== undefined && phone !== 1 && phone !== 2) throw new PiWebConfigError(`PI WEB config listTiles.phone must be 1 or 2: ${path}`);
  if (desktop !== undefined && desktop !== 1 && desktop !== 2) throw new PiWebConfigError(`PI WEB config listTiles.desktop must be 1 or 2: ${path}`);
  return {
    ...(phone !== undefined ? { phone } : {}),
    ...(desktop !== undefined ? { desktop } : {}),
  };
}

export function parseLoggingConfig(value: unknown, path: string): PiWebLoggingConfig {
  if (!isRecord(value)) throw new PiWebConfigError(`PI WEB config logging must be an object: ${path}`);
  const level = value["level"];
  const maxFileMb = value["maxFileMb"];
  const keepFiles = value["keepFiles"];
  if (level !== undefined && !isLoggingLevel(level)) throw new PiWebConfigError(`PI WEB config logging.level must be "errors", "requests" or "debug": ${path}`);
  if (maxFileMb !== undefined && (typeof maxFileMb !== "number" || !Number.isInteger(maxFileMb) || maxFileMb < 1)) throw new PiWebConfigError(`PI WEB config logging.maxFileMb must be a whole number of megabytes, at least 1: ${path}`);
  if (keepFiles !== undefined && (typeof keepFiles !== "number" || !Number.isInteger(keepFiles) || keepFiles < 1 || keepFiles > 20)) throw new PiWebConfigError(`PI WEB config logging.keepFiles must be a whole number from 1 to 20: ${path}`);
  return {
    ...(level !== undefined ? { level } : {}),
    ...(typeof maxFileMb === "number" ? { maxFileMb } : {}),
    ...(typeof keepFiles === "number" ? { keepFiles } : {}),
  };
}

export function parseUploadsConfig(value: unknown, path: string): NonNullable<PiWebConfigValues["uploads"]> {
  if (!isRecord(value)) throw new PiWebConfigError(`PI WEB config uploads must be an object: ${path}`);
  const defaultFolder = value["defaultFolder"];
  return {
    ...(defaultFolder !== undefined ? { defaultFolder: parseWorkspaceRelativeFolder(defaultFolder, "uploads.defaultFolder", path) } : {}),
  };
}

function parseWorkspaceRelativeFolder(value: unknown, key: string, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new PiWebConfigError(`PI WEB config ${key} must be a non-empty project-relative path: ${path}`);
  if (isAbsoluteLike(value)) throw new PiWebConfigError(`PI WEB config ${key} must be project-relative: ${path}`);
  const parts = value.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) throw new PiWebConfigError(`PI WEB config ${key} must be a non-empty project-relative path: ${path}`);
  if (parts.some((part) => part === "..")) throw new PiWebConfigError(`PI WEB config ${key} must not contain path traversal: ${path}`);
  return parts.join("/");
}


function isHomePath(value: string, pathHost: AgentPathHost): boolean {
  return value === "~" || value.startsWith("~/") || ((pathHost === "portable" || process.platform === "win32") && value.startsWith("~\\"));
}

function expandHomePath(value: string, env: NodeJS.ProcessEnv): string {
  const home = env["HOME"] !== undefined && env["HOME"] !== "" ? env["HOME"] : homedir();
  if (value === "~") return home;
  if (value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\"))) return join(home, value.slice(2));
  return value;
}

// Exact mirror of the pi SDK default (`getAgentDir()`: `~/.pi/agent`) rather
// than a delegation, so the injected `env` stays authoritative; if the bundled
// SDK is ever swapped for a fork whose default moves, this mirror must move
// with it or the two resolutions drift.
function defaultAgentDir(env: NodeJS.ProcessEnv): string {
  return expandHomePath("~/.pi/agent", env);
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value !== undefined && value !== "" ? value : undefined;
}

function isEnvSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isAbsoluteLike(value: string): boolean {
  const withForwardSlashes = value.replace(/\\/g, "/");
  return isAbsolute(value) || withForwardSlashes.startsWith("/") || /^[A-Za-z]:\//.test(withForwardSlashes);
}

function parseShortcuts(value: unknown, path: string): Record<string, string | null> {
  if (!isRecord(value)) throw new PiWebConfigError(`PI WEB config shortcuts must be an object: ${path}`);
  return Object.fromEntries(Object.entries(value).map(([actionId, shortcut]) => {
    if (shortcut !== null && (typeof shortcut !== "string" || shortcut === "")) {
      throw new PiWebConfigError(`PI WEB config shortcut values must be non-empty strings or null: ${path}`);
    }
    return [actionId, shortcut];
  }));
}

function parsePlugins(value: unknown, path: string): NonNullable<PiWebConfigValues["plugins"]> {
  if (!isRecord(value)) throw new PiWebConfigError(`PI WEB config plugins must be an object: ${path}`);
  return Object.fromEntries(Object.entries(value).map(([pluginId, config]) => {
    if (!isPiWebPluginId(pluginId)) throw new PiWebConfigError(`PI WEB config plugin ids must match ${piWebPluginIdPattern.source}: ${path}`);
    if (!isRecord(config)) throw new PiWebConfigError(`PI WEB config plugin entries must be objects: ${path}`);
    const enabled = config["enabled"];
    if (enabled !== undefined && typeof enabled !== "boolean") throw new PiWebConfigError(`PI WEB config plugin enabled values must be booleans: ${path}`);
    const settings = config["settings"];
    if (settings !== undefined && !isRecord(settings)) throw new PiWebConfigError(`PI WEB config plugin settings must be objects: ${path}`);
    const serverSettings = config["serverSettings"];
    if (serverSettings !== undefined && !isPluginServerSettings(serverSettings)) throw new PiWebConfigError(`PI WEB config plugin serverSettings must be JSON objects: ${path}`);
    if (config["models"] !== undefined && !isPluginModelGrant(config["models"])) throw new PiWebConfigError(`PI WEB config plugin models must be a list of provider/model-id names: ${path}`);
    return [pluginId, config];
  }));
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
}

export function examplePiWebConfig(config: PiWebConfig = {}): string {
  return `${JSON.stringify({ host: config.host ?? "127.0.0.1", port: config.port ?? 8504, allowedHosts: config.allowedHosts ?? [] }, null, 2)}\n`;
}

