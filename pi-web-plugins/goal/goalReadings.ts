import type { PluginListRead } from "@gang-of-beads/pi-web/plugin-api";

/**
 * Reads kept by the key they were made for (machine and folder, or machine alone).
 *
 * A reading is drawn only under its own key, so a page never shows one folder's goals for
 * another. A read that was invalidated while it ran is dropped and read again at the next `ensure`, so a
 * command's effect is never hidden behind a read that started before it. A failed refresh keeps the last value for the same key, marked failed, so the list says
 * it is stale instead of emptying; nothing is carried from one key to another.
 */
export interface Reading<T> {
  readonly read: PluginListRead;
  readonly value: T | undefined;
  readonly error: unknown;
}

interface Entry<T> {
  read: PluginListRead;
  value: T | undefined;
  error: unknown;
  readAt: number;
  inFlight: boolean;
  generation: number;
}

export interface Readings<T> {
  /** The reading for `key`, starting a read when there is none or it is older than `maxAgeMs`; `changed` runs when a read settles. */
  ensure(key: string, read: () => Promise<T>, maxAgeMs: number, changed: () => void): Reading<T>;
  /** The reading for `key` as held, without starting a read. */
  peek(key: string): Reading<T> | undefined;
  /** Make the next `ensure` read again. */
  invalidate(key: string): void;
  invalidateAll(): void;
}

export function createReadings<T>(now: () => number = Date.now): Readings<T> {
  const entries = new Map<string, Entry<T>>();
  return {
    ensure(key, read, maxAgeMs, changed) {
      const entry = entries.get(key) ?? { read: "reading", value: undefined, error: undefined, readAt: Number.NEGATIVE_INFINITY, inFlight: false, generation: 0 };
      entries.set(key, entry);
      if (!entry.inFlight && now() - entry.readAt >= maxAgeMs) {
        entry.inFlight = true;
        const generation = entry.generation;
        void read().then((value) => {
          if (entry.generation !== generation) return;
          entry.value = value;
          entry.error = undefined;
          entry.read = "ready";
        }, (error: unknown) => {
          if (entry.generation !== generation) return;
          entry.error = error;
          entry.read = "failed";
        }).finally(() => {
          entry.inFlight = false;
          if (entry.generation === generation) entry.readAt = now();
          changed();
        });
      }
      return entry;
    },
    peek: (key) => entries.get(key),
    invalidate(key) {
      const entry = entries.get(key);
      if (entry === undefined) return;
      entry.readAt = Number.NEGATIVE_INFINITY;
      entry.generation += 1;
    },
    invalidateAll() {
      for (const entry of entries.values()) {
        entry.readAt = Number.NEGATIVE_INFINITY;
        entry.generation += 1;
      }
    },
  };
}
