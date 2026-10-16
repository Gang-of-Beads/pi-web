import type { PiWebConfigResponse, PiWebConfigValues, PiWebPluginConfig, PiWebPluginConfigMap, PiWebPluginSettings, PiWebServerSettingsUpdates } from "./apiTypes.js";
import { isPiWebPluginId } from "./pluginIds.js";
import { isRecord } from "./unknownValues.js";

/**
 * Private plugin settings (`plugins.<id>.serverSettings`) are a browser read boundary: the raw file
 * and the server keep them, every public config response leaves them out, and a public save can
 * neither carry nor drop them. They change only through explicit `serverSettingsUpdates` operations.
 * This is not encryption: the file stays plaintext to whoever administers the host.
 */
export const PLUGIN_SERVER_SETTINGS_PROTOCOL = 1;

/** A selected-machine write refused because the target does not speak the private-settings protocol. */
export const PRIVATE_SETTINGS_PROTOCOL_INCOMPATIBLE_CODE = "private-settings-protocol-incompatible";

/** A target accepted a write carrying private operations but its answer no longer confirms the protocol. */
export const PRIVATE_SETTINGS_OUTCOME_UNCONFIRMED_CODE = "private-settings-outcome-unconfirmed";

export class PluginServerSettingsError extends Error {}

export function isPluginServerSettings(value: unknown): value is PiWebPluginSettings {
  return isRecord(value) && isJsonValue(value, new Set());
}

function isJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  ancestors.add(value);
  const valid = Object.values(value).every((item: unknown) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

export function parseServerSettingsUpdates(value: unknown): PiWebServerSettingsUpdates | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new PluginServerSettingsError("PI WEB serverSettingsUpdates must be an object");
  return Object.fromEntries(Object.entries(value).map(([id, update]): [string, PiWebServerSettingsUpdates[string]] => {
    if (!isPiWebPluginId(id) || !isRecord(update)) throw new PluginServerSettingsError("PI WEB serverSettingsUpdates entries must name a plugin and an operation");
    if (update["operation"] === "clear" && Object.keys(update).length === 1) return [id, { operation: "clear" }];
    if (update["operation"] === "replace" && Object.keys(update).length === 2 && isPluginServerSettings(update["value"])) {
      return [id, { operation: "replace", value: update["value"] }];
    }
    throw new PluginServerSettingsError('PI WEB serverSettingsUpdates entries must be exactly { operation: "clear" } or { operation: "replace", value: <JSON object> }');
  }));
}

/** The operations a request carries, or undefined when it carries none: an empty map asks for nothing. */
export function requestedServerSettingsUpdates(updates: PiWebServerSettingsUpdates | undefined): PiWebServerSettingsUpdates | undefined {
  return updates === undefined || Object.keys(updates).length === 0 ? undefined : updates;
}

/** Fails closed on a protocol this build does not know rather than treating it as protocol 1 or none. */
export function parseServerSettingsStatus(record: Record<string, unknown>): Pick<PiWebConfigResponse, "serverSettingsProtocol" | "serverSettingsConfigured"> {
  const protocol = record["serverSettingsProtocol"];
  if (protocol !== undefined && protocol !== PLUGIN_SERVER_SETTINGS_PROTOCOL) throw new Error("PI WEB serverSettingsProtocol is unsupported");
  const configured = record["serverSettingsConfigured"];
  if (configured === undefined) return protocol === undefined ? {} : { serverSettingsProtocol: protocol };
  if (!isRecord(configured)) throw new Error("PI WEB serverSettingsConfigured must contain booleans");
  const presence = Object.fromEntries(Object.entries(configured).map(([id, value]) => {
    if (typeof value !== "boolean") throw new Error("PI WEB serverSettingsConfigured must contain booleans");
    return [id, value];
  }));
  return { ...(protocol === undefined ? {} : { serverSettingsProtocol: protocol }), serverSettingsConfigured: presence };
}

export function targetSupportsServerSettings(response: unknown): boolean {
  return isRecord(response) && response["serverSettingsProtocol"] === PLUGIN_SERVER_SETTINGS_PROTOCOL;
}

export function publicPluginConfig(plugins: PiWebPluginConfigMap): PiWebPluginConfigMap {
  return Object.fromEntries(Object.entries(plugins).map(([id, config]) => [id, withoutServerSettings(config)]));
}

export function publicPiWebConfig(config: PiWebConfigValues): PiWebConfigValues {
  return { ...config, ...(config.plugins === undefined ? {} : { plugins: publicPluginConfig(config.plugins) }) };
}

export function serverSettingsConfigured(config: PiWebConfigValues): Record<string, boolean> {
  return Object.fromEntries(Object.entries(config.plugins ?? {}).map(([id, plugin]) => [id, plugin.serverSettings !== undefined]));
}

/** Whether a target's raw, unparsed config answer carries any private block in either config view. */
export function configResponseHasServerSettings(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [value["config"], value["effectiveConfig"]].some((config) => isRecord(config) && isRecord(config["plugins"])
    && Object.values(config["plugins"]).some((plugin) => isRecord(plugin) && Object.hasOwn(plugin, "serverSettings")));
}

export function hasServerSettings(config: PiWebConfigValues): boolean {
  return Object.values(config.plugins ?? {}).some((plugin) => plugin.serverSettings !== undefined);
}

/**
 * The plugin map a save writes. The stored file is the only source of private blocks: each one is kept
 * unless an explicit operation replaces or clears it. An entry the incoming public map omits is kept
 * only for its private block, with its stored activation, so preserving a secret neither turns a
 * disabled plugin on nor a running one off; an entry the incoming map names keeps the ordinary
 * replacement semantics. Clear removes a block and nothing else, so it never creates an entry.
 */
export function preservePluginServerSettings(stored: PiWebPluginConfigMap, incoming: PiWebPluginConfigMap = {}, updates: PiWebServerSettingsUpdates = {}): PiWebPluginConfigMap {
  const plugins: PiWebPluginConfigMap = Object.fromEntries(Object.entries(incoming).map(([id, plugin]) => [id, { ...plugin }]));
  for (const [id, previous] of Object.entries(stored)) {
    if (previous.serverSettings === undefined) continue;
    plugins[id] = { ...(ownEntry(plugins, id) ?? storedActivation(previous)), serverSettings: previous.serverSettings };
  }
  for (const [id, update] of Object.entries(updates)) {
    const entry = ownEntry(plugins, id);
    if (update.operation === "replace") plugins[id] = { ...entry, serverSettings: update.value };
    else if (entry !== undefined) plugins[id] = withoutServerSettings(entry);
  }
  return plugins;
}

function ownEntry(plugins: PiWebPluginConfigMap, id: string): PiWebPluginConfig | undefined {
  return Object.hasOwn(plugins, id) ? plugins[id] : undefined;
}

function storedActivation(plugin: PiWebPluginConfig): PiWebPluginConfig {
  return plugin.enabled === undefined ? {} : { enabled: plugin.enabled };
}

function withoutServerSettings(plugin: PiWebPluginConfig): PiWebPluginConfig {
  return Object.fromEntries(Object.entries(plugin).filter(([key]) => key !== "serverSettings"));
}

/** Remote workspace payloads can carry effective config beyond the current upload-only DTO. */
export function publicWorkspaceConfigPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicWorkspaceConfigPayload);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if ((key === "config" || key === "effectiveConfig") && isRecord(entry) && isRecord(entry["plugins"])) {
      return [key, { ...entry, plugins: Object.fromEntries(Object.entries(entry["plugins"]).map(([id, plugin]) => [
        id, isRecord(plugin) ? Object.fromEntries(Object.entries(plugin).filter(([name]) => name !== "serverSettings")) : plugin,
      ])) }];
    }
    return [key, publicWorkspaceConfigPayload(entry)];
  }));
}
