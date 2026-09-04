import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { JsonValue } from "../../../shared/pluginApiTypes.js";

/**
 * Per-plugin durable storage under the host's data directory.
 *
 * A daemon plugin that owns state - a goal store, a cache, a queue - needed
 * somewhere to put it, and the alternative was every plugin inventing its
 * own path inside the user's data directory with no containment. The store
 * hands each plugin one directory, refuses keys that escape it, and writes
 * through a temporary file so a crash mid-write cannot leave a half-written
 * document where a whole one used to be.
 *
 * Missing is not empty: `read` answers undefined for a key that was never
 * written, and callers must not read that as "the plugin has no state".
 */

const keyPattern = /^[a-z0-9][a-z0-9._-]*$/iu;

export interface PluginScopedStorage {
  readonly directory: string;
  read: (key: string) => Promise<JsonValue | undefined>;
  write: (key: string, value: JsonValue) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export class PluginStorageKeyError extends Error {}

export function pluginStorageDirectory(baseDir: string, pluginId: string): string {
  return join(baseDir, "plugin-storage", pluginId);
}

export function createPluginScopedStorage(baseDir: string, pluginId: string): PluginScopedStorage {
  const directory = pluginStorageDirectory(baseDir, pluginId);
  return {
    directory,
    read: (key) => readDocument(directory, key),
    write: (key, value) => writeDocument(directory, key, value),
    remove: (key) => removeDocument(directory, key),
  };
}

function documentPath(directory: string, key: string): string {
  if (!keyPattern.test(key)) throw new PluginStorageKeyError(`Invalid plugin storage key: ${key}`);
  const path = resolve(directory, `${key}.json`);
  const root = resolve(directory);
  if (path !== join(root, `${key}.json`) || !path.startsWith(`${root}${sep}`)) {
    throw new PluginStorageKeyError(`Plugin storage key escapes its directory: ${key}`);
  }
  return path;
}

async function readDocument(directory: string, key: string): Promise<JsonValue | undefined> {
  const path = documentPath(directory, key);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    return parseJsonValue(raw);
  } catch {
    return undefined;
  }
}

function parseJsonValue(raw: string): JsonValue {
  const parsed: unknown = JSON.parse(raw);
  if (!isJsonValue(parsed)) throw new Error("Stored document is not a JSON value");
  return parsed;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function writeDocument(directory: string, key: string, value: JsonValue): Promise<void> {
  const path = documentPath(directory, key);
  await mkdir(dirname(path), { recursive: true });
  const staged = `${path}.${String(process.pid)}.${randomUUID()}.staged`;
  try {
    await writeFile(staged, JSON.stringify(value), "utf8");
    await rename(staged, path);
  } catch (error) {
    await rm(staged, { force: true });
    throw error;
  }
}

async function removeDocument(directory: string, key: string): Promise<void> {
  await rm(documentPath(directory, key), { force: true });
}
