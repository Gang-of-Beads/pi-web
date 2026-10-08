import type { FastifyInstance } from "fastify";
import { PiWebConfigError, loadPiWebConfig, parsePiWebConfig, resolveEffectivePiWebConfig, savePiWebConfig, type AgentPathHost, type LoadOptions, type PiWebConfig } from "../../config.js";
import type { PiWebConfigEnvOverrides, PiWebConfigResponse, PiWebConfigValues } from "../../shared/apiTypes.js";
import { errorMessage, isRecord } from "../../shared/unknownValues.js";

export interface PiWebConfigService {
  read: () => PiWebConfigResponse | Promise<PiWebConfigResponse>;
  write: (config: PiWebConfigValues) => PiWebConfigResponse | Promise<PiWebConfigResponse>;
}

export const SELECTED_MACHINE_CONFIG_KEYS = [
  "plugins",
  "pathAccess",
  "uploads",
  "maxUploadBytes",
  "logging",
  "askUser",
  "agent",
  "updateCommand",
] as const satisfies readonly (keyof PiWebConfigValues)[];

const SELECTED_MACHINE_CONFIG_KEY_SET = new Set<string>(SELECTED_MACHINE_CONFIG_KEYS);

export function createFilePiWebConfigService(options: LoadOptions = {}): PiWebConfigService {
  return {
    read: () => currentPiWebConfigResponse(options),
    write: (config) => {
      savePiWebConfig(config, options);
      return currentPiWebConfigResponse(options);
    },
  };
}

export function currentPiWebConfigResponse(options: LoadOptions = {}): PiWebConfigResponse {
  const loaded = loadPiWebConfig(options);
  const effective = resolveEffectivePiWebConfig(loaded, options);
  const env = options.env ?? process.env;
  return {
    path: loaded.path,
    exists: loaded.exists,
    config: loaded.config,
    effectiveConfig: effective.config,
    envOverrides: piWebConfigEnvOverrides(env),
  };
}

export function registerConfigRoutes(app: FastifyInstance, service: PiWebConfigService = createFilePiWebConfigService()): void {
  app.get("/api/config", async (_request, reply) => {
    try {
      return await service.read();
    } catch (error) {
      return reply.code(500).send({ error: errorMessage(error) });
    }
  });

  app.put<{ Body: { config?: unknown } | undefined }>("/api/config", async (request, reply) => {
    try {
      return await service.write(parseConfigRequest(request.body?.config));
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

  app.put<{ Body: { config?: unknown } | undefined }>("/api/machines/local/config", async (request, reply) => {
    try {
      const current = await service.read();
      const patch = parseSelectedMachineConfigRequest(request.body?.config);
      return selectedMachineConfigResponse(await service.write(mergeSelectedMachineConfig(current.config, patch)));
    } catch (error) {
      const status = isConfigValidationError(error) ? 400 : 500;
      return reply.code(status).send({ error: errorMessage(error) });
    }
  });
}

export function parseSelectedMachineConfigRequest(value: unknown, agentPathHost: AgentPathHost = "current"): PiWebConfig {
  if (!isRecord(value)) throw new PiWebConfigError("PI WEB selected-machine config update must include a config object");
  for (const key of Object.keys(value)) {
    if (!SELECTED_MACHINE_CONFIG_KEY_SET.has(key)) throw new PiWebConfigError(`PI WEB selected-machine config key is not allowed: ${key}`);
  }
  try {
    return pickSelectedMachineConfig(parseConfigRequest(value, agentPathHost));
  } catch (error) {
    throw new PiWebConfigError(selectedMachineConfigErrorMessage(error), { cause: error });
  }
}

export function mergeSelectedMachineConfig(current: PiWebConfigValues, patch: PiWebConfigValues): PiWebConfig {
  return { ...current, ...pickSelectedMachineConfig(patch) };
}

export function selectedMachineConfigResponse(response: PiWebConfigResponse): PiWebConfigResponse {
  return {
    ...response,
    config: pickSelectedMachineConfig(response.config),
    effectiveConfig: pickSelectedMachineConfig(response.effectiveConfig),
  };
}

export function parsePiWebConfigResponseBody(value: unknown, source = "PI WEB config response"): PiWebConfigResponse {
  const record = requireResponseRecord(value, source);
  return {
    path: requireResponseString(record, "path", source),
    exists: requireResponseBoolean(record, "exists", source),
    config: parseConfigRequest(record["config"], "portable"),
    effectiveConfig: parseConfigRequest(record["effectiveConfig"], "portable"),
    envOverrides: parsePiWebConfigEnvOverridesResponse(record["envOverrides"], source),
  };
}

/** A config update's body, parsed as the file is; messages name it "request". */
function parseConfigRequest(value: unknown, agentPathHost: AgentPathHost = "current"): PiWebConfig {
  if (!isRecord(value)) throw new PiWebConfigError("PI WEB config update must include a config object");
  return parsePiWebConfig(value, "request", agentPathHost);
}

function pickSelectedMachineConfig(config: PiWebConfigValues): PiWebConfig {
  return {
    ...(config.plugins !== undefined ? { plugins: config.plugins } : {}),
    ...(config.pathAccess !== undefined ? { pathAccess: config.pathAccess } : {}),
    ...(config.uploads !== undefined ? { uploads: config.uploads } : {}),
    ...(config.maxUploadBytes !== undefined ? { maxUploadBytes: config.maxUploadBytes } : {}),
    ...(config.logging !== undefined ? { logging: config.logging } : {}),
    ...(config.askUser !== undefined ? { askUser: config.askUser } : {}),
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
    askUser: requireResponseBoolean(record, "askUser", source),
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
    askUser: isEnvSet(env["PI_WEB_ASK_USER"]),
  };
}

function isEnvSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

function isConfigValidationError(error: unknown): boolean {
  return error instanceof PiWebConfigError;
}
