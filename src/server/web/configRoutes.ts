import type { FastifyInstance } from "fastify";
import { PiWebConfigError, loadPiWebConfig, parsePiWebConfig, parseSharedThemeConfig, resolveEffectivePiWebConfig, savePiWebConfig, saveSharedThemeConfig, type AgentPathHost, type LoadOptions, type PiWebConfig } from "../../config.js";
import type { PiWebConfigEnvOverrides, PiWebConfigResponse, PiWebConfigValues, PiWebPluginConfigMap, PiWebServerSettingsUpdates, PiWebSharedThemeConfig } from "../../shared/apiTypes.js";
import { errorMessage, isRecord } from "../../shared/unknownValues.js";
import { hasServerSettings, parseServerSettingsStatus, parseServerSettingsUpdates, PLUGIN_SERVER_SETTINGS_PROTOCOL, PluginServerSettingsError, publicPiWebConfig, serverSettingsConfigured } from "../../shared/pluginConfigPrivacy.js";

export interface PiWebConfigService {
  read: () => PiWebConfigResponse | Promise<PiWebConfigResponse>;
  /** `serverSettingsUpdates` is required, even when undefined, so a wrapper cannot drop it unnoticed. */
  write: (config: PiWebConfigValues, serverSettingsUpdates: PiWebServerSettingsUpdates | undefined) => PiWebConfigResponse | Promise<PiWebConfigResponse>;
  /** Sets or clears the shared theme alone; a service without it serves no theme route. */
  writeTheme?: (theme: PiWebSharedThemeConfig | undefined) => PiWebConfigResponse | Promise<PiWebConfigResponse>;
  /**
   * Server-only: the stored plugin map with each plugin's private `serverSettings`, which this
   * process's plugin catalogs fingerprint and hand to server plugins. Never part of an answer. A
   * service without it supplies no private settings to this process's plugins.
   */
  readRawPlugins?: () => PiWebPluginConfigMap | Promise<PiWebPluginConfigMap>;
}

export const SELECTED_MACHINE_CONFIG_KEYS = [
  "plugins",
  "pathAccess",
  "uploads",
  "maxUploadBytes",
  "logging",
  "agent",
  "updateCommand",
] as const satisfies readonly (keyof PiWebConfigValues)[];

const SELECTED_MACHINE_CONFIG_KEY_SET = new Set<string>(SELECTED_MACHINE_CONFIG_KEYS);

export function createFilePiWebConfigService(options: LoadOptions = {}): PiWebConfigService {
  return {
    read: () => currentPiWebConfigResponse(options),
    write: (config, updates) => {
      savePiWebConfig(config, options, updates);
      return currentPiWebConfigResponse(options);
    },
    writeTheme: (theme) => {
      saveSharedThemeConfig(theme, options);
      return currentPiWebConfigResponse(options);
    },
    readRawPlugins: () => loadPiWebConfig(options).config.plugins ?? {},
  };
}

/** `{ theme: { themeId, auto } }` shares a theme across this PI WEB's browsers; `{ theme: null }` stops sharing. */
export function registerSharedThemeRoute(app: FastifyInstance, writeTheme: NonNullable<PiWebConfigService["writeTheme"]>): void {
  app.put<{ Body: { theme?: unknown } | undefined }>("/api/config/theme", async (request, reply) => {
    try {
      const theme = request.body?.theme;
      if (theme === undefined) throw new PiWebConfigError("PI WEB theme update must carry theme: an object, or null to stop sharing");
      return publicPiWebConfigResponse(await writeTheme(theme === null ? undefined : parseSharedThemeConfig(theme, "request")));
    } catch (error) {
      const status = isConfigValidationError(error) ? 400 : 500;
      return reply.code(status).send({ error: errorMessage(error) });
    }
  });
}

/** The public answer for this host's config: private blocks left out, their presence reported apart. */
export function currentPiWebConfigResponse(options: LoadOptions = {}): PiWebConfigResponse {
  const loaded = loadPiWebConfig(options);
  const effective = resolveEffectivePiWebConfig(loaded, options);
  const env = options.env ?? process.env;
  return {
    path: loaded.path,
    exists: loaded.exists,
    config: publicPiWebConfig(loaded.config),
    effectiveConfig: publicPiWebConfig(effective.config),
    envOverrides: piWebConfigEnvOverrides(env),
    serverSettingsProtocol: PLUGIN_SERVER_SETTINGS_PROTOCOL,
    serverSettingsConfigured: serverSettingsConfigured(loaded.config),
  };
}

export function registerConfigRoutes(app: FastifyInstance, service: PiWebConfigService = createFilePiWebConfigService()): void {
  app.get("/api/config", async (_request, reply) => {
    try {
      return publicPiWebConfigResponse(await service.read());
    } catch (error) {
      return reply.code(500).send({ error: errorMessage(error) });
    }
  });

  app.put<{ Body: { config?: unknown; serverSettingsUpdates?: unknown } | undefined }>("/api/config", async (request, reply) => {
    try {
      const config = parseConfigRequest(request.body?.config);
      const updates = parseServerSettingsUpdates(request.body?.serverSettingsUpdates);
      return publicPiWebConfigResponse(await service.write(config, updates));
    } catch (error) {
      const status = isConfigValidationError(error) ? 400 : 500;
      return reply.code(status).send({ error: errorMessage(error) });
    }
  });
}

export function registerLocalMachineConfigRoutes(app: FastifyInstance, service: PiWebConfigService = createFilePiWebConfigService()): void {
  app.get("/api/machines/local/config", async (_request, reply) => {
    try {
      return selectedMachineConfigResponse(await service.read());
    } catch (error) {
      return reply.code(500).send({ error: errorMessage(error) });
    }
  });

  app.put<{ Body: { config?: unknown; serverSettingsUpdates?: unknown } | undefined }>("/api/machines/local/config", async (request, reply) => {
    try {
      const current = await service.read();
      const patch = parseSelectedMachineConfigRequest(request.body?.config);
      const updates = parseServerSettingsUpdates(request.body?.serverSettingsUpdates);
      return selectedMachineConfigResponse(await service.write(mergeSelectedMachineConfig(current.config, patch), updates));
    } catch (error) {
      const status = isConfigValidationError(error) ? 400 : 500;
      return reply.code(status).send({ error: errorMessage(error) });
    }
  });
}

export class SelectedMachineConfigRequestError extends PiWebConfigError {}

export function parseSelectedMachineConfigRequest(value: unknown, agentPathHost: AgentPathHost = "current"): PiWebConfig {
  if (!isRecord(value)) throw new SelectedMachineConfigRequestError("PI WEB selected-machine config update must include a config object");
  for (const key of Object.keys(value)) {
    if (!SELECTED_MACHINE_CONFIG_KEY_SET.has(key)) throw new SelectedMachineConfigRequestError(`PI WEB selected-machine config key is not allowed: ${key}`);
  }
  try {
    return pickSelectedMachineConfig(parseConfigRequest(value, agentPathHost));
  } catch (error) {
    throw new SelectedMachineConfigRequestError(selectedMachineConfigErrorMessage(error), { cause: error });
  }
}

export function mergeSelectedMachineConfig(current: PiWebConfigValues, patch: PiWebConfigValues): PiWebConfig {
  return { ...current, ...pickSelectedMachineConfig(patch) };
}

export function selectedMachineConfigResponse(response: PiWebConfigResponse): PiWebConfigResponse {
  return publicPiWebConfigResponse({
    ...response,
    config: pickSelectedMachineConfig(response.config),
    effectiveConfig: pickSelectedMachineConfig(response.effectiveConfig),
  });
}

export function parsePiWebConfigResponseBody(value: unknown, source = "PI WEB config response"): PiWebConfigResponse {
  const record = requireResponseRecord(value, source);
  return {
    path: requireResponseString(record, "path", source),
    exists: requireResponseBoolean(record, "exists", source),
    config: publicPiWebConfig(parseResponseConfig(record["config"])),
    effectiveConfig: publicPiWebConfig(parseResponseConfig(record["effectiveConfig"])),
    envOverrides: parsePiWebConfigEnvOverridesResponse(record["envOverrides"], source),
    ...parseServerSettingsStatus(record),
  };
}

/** A config update's body, parsed as the file is; messages name it "request". */
function parseConfigRequest(value: unknown, agentPathHost: AgentPathHost = "current"): PiWebConfig {
  if (!isRecord(value)) throw new PiWebConfigError("PI WEB config update must include a config object");
  const config = parsePiWebConfig(value, "request", agentPathHost);
  if (hasServerSettings(config)) throw new PiWebConfigError("PI WEB config plugin serverSettings change only through serverSettingsUpdates operations");
  return config;
}

function parseResponseConfig(value: unknown): PiWebConfig {
  return parsePiWebConfig(requireResponseRecord(value, "PI WEB config response config"), "response", "portable");
}

/** Every route answers through this projection, because an injected service may hand back raw config. */
function publicPiWebConfigResponse(response: PiWebConfigResponse): PiWebConfigResponse {
  return { ...response, config: publicPiWebConfig(response.config), effectiveConfig: publicPiWebConfig(response.effectiveConfig) };
}

function pickSelectedMachineConfig(config: PiWebConfigValues): PiWebConfig {
  return {
    ...(config.plugins !== undefined ? { plugins: config.plugins } : {}),
    ...(config.pathAccess !== undefined ? { pathAccess: config.pathAccess } : {}),
    ...(config.uploads !== undefined ? { uploads: config.uploads } : {}),
    ...(config.maxUploadBytes !== undefined ? { maxUploadBytes: config.maxUploadBytes } : {}),
    ...(config.logging !== undefined ? { logging: config.logging } : {}),
    ...(config.agent !== undefined ? { agent: config.agent } : {}),
    ...(config.updateCommand !== undefined ? { updateCommand: config.updateCommand } : {}),
  };
}

function selectedMachineConfigErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (message.startsWith("PI WEB config ")) return `PI WEB selected-machine config ${message.slice("PI WEB config ".length)}`;
  return `PI WEB selected-machine config ${message}`;
}

function parsePiWebConfigEnvOverridesResponse(value: unknown, source: string): PiWebConfigEnvOverrides {
  const record = requireResponseRecord(value, `${source} envOverrides`);
  return {
    host: requireResponseBoolean(record, "host", source),
    port: requireResponseBoolean(record, "port", source),
    allowedHosts: requireResponseBoolean(record, "allowedHosts", source),
  };
}

function requireResponseRecord(value: unknown, source: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${source} must be an object`);
  return value;
}

function requireResponseString(record: Record<string, unknown>, key: string, source: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${source} field must be a string: ${key}`);
  return value;
}

function requireResponseBoolean(record: Record<string, unknown>, key: string, source: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`${source} field must be a boolean: ${key}`);
  return value;
}

function piWebConfigEnvOverrides(env: NodeJS.ProcessEnv): PiWebConfigEnvOverrides {
  return {
    host: isEnvSet(env["PI_WEB_HOST"]),
    port: isEnvSet(env["PI_WEB_PORT"]) || isEnvSet(env["PORT"]),
    allowedHosts: isEnvSet(env["PI_WEB_ALLOWED_HOSTS"]),
  };
}

function isEnvSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

function isConfigValidationError(error: unknown): boolean {
  return error instanceof PiWebConfigError || error instanceof PluginServerSettingsError;
}
