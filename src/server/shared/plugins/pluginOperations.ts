import type { JsonValue } from "../../../shared/pluginApiTypes.js";

/**
 * Named JSON operations a daemon plugin exposes.
 *
 * A plugin that owns server work - minting a short-lived speech token, reading
 * a store it alone understands - needed a way to be called that is not a
 * workspace-provider operation, because not every plugin capability belongs to
 * a workspace. Operations are declared by name rather than by URL: the plugin
 * never picks a path, the host maps `api/plugins/<pluginId>/<operation>` onto
 * the declared name, and a name nobody declared is an honest 404 rather than a
 * silent success.
 */

export type PluginOperationHandler = (input: unknown, context: { signal: AbortSignal }) => Promise<JsonValue> | JsonValue;

export type PluginOperationMap = ReadonlyMap<string, PluginOperationHandler>;

export const operationNamePattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u;

export class UnknownPluginOperationError extends Error {}
export class InvalidPluginOperationError extends Error {}

export function parsePluginOperations(value: unknown): PluginOperationMap | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidPluginOperationError("Server plugin operations must be an object of named handlers");
  }
  const parsed = new Map<string, PluginOperationHandler>();
  for (const [name, handler] of Object.entries(value)) {
    if (!operationNamePattern.test(name)) throw new InvalidPluginOperationError(`Invalid plugin operation name: ${name}`);
    if (!isOperationHandler(handler)) throw new InvalidPluginOperationError(`Plugin operation ${name} must be a function`);
    parsed.set(name, (input, context) => handler(input, context));
  }
  return parsed;
}

function isOperationHandler(value: unknown): value is PluginOperationHandler {
  return typeof value === "function";
}

export function requirePluginOperation(operations: PluginOperationMap | undefined, name: string): PluginOperationHandler {
  const handler = operations?.get(name);
  if (handler === undefined) throw new UnknownPluginOperationError(`No plugin operation named ${name}`);
  return handler;
}
