import type { JsonValue, ServerPluginStorage } from "../../../server-plugin-api.js";

/**
 * In-memory plugin storage for tests that only need the activation context to
 * be complete. It keeps the same "missing is undefined" answer as the real
 * store so a test cannot accidentally rely on absence throwing.
 */
export function memoryPluginStorage(directory = "/tmp/plugin-storage/test"): ServerPluginStorage {
  const documents = new Map<string, JsonValue>();
  return {
    directory,
    read: (key) => Promise.resolve(documents.get(key)),
    write: (key, value) => { documents.set(key, value); return Promise.resolve(); },
    remove: (key) => { documents.delete(key); return Promise.resolve(); },
  };
}
