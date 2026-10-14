import { isRecord } from "../../shared/unknownValues";

/**
 * What to do when an essential browser record (a draft, an outbox record, a device id) does not fit.
 * Only caches the machine can rebuild (transcript pages, remembered session boards) give way; another
 * draft or outbox record never does, so making room can never lose something the reader wrote.
 */
export const StorageFailure = {
  quota: "quota",
  unavailable: "unavailable",
} as const;

export type StorageFailure = (typeof StorageFailure)[keyof typeof StorageFailure];

const QUOTA_ERROR_NAMES: ReadonlySet<string> = new Set(["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"]);
const REBUILDABLE_PREFIXES = ["pi-web:chat-history:v2:", "pi-web:session-board:v1:"];

export class BrowserStorageWriteError extends Error {
  constructor(message = "This browser could not persist the operation metadata.") {
    super(message);
    this.name = "BrowserStorageWriteError";
  }
}

/** Whether a refused write may retry after room is made: only a full store can be helped by evicting. */
const RETRIES_AFTER_EVICTION: Readonly<Record<StorageFailure, boolean>> = {
  [StorageFailure.quota]: true,
  [StorageFailure.unavailable]: false,
};

/** Durable input takes precedence over server-backed caches, never over another draft or outbox. */
export function writeEssentialBrowserRecord(storage: Storage | undefined, key: string, value: string): boolean {
  if (storage === undefined) return false;
  for (;;) {
    try {
      storage.setItem(key, value);
      return true;
    } catch (error) {
      const failure = storageFailureOf(error);
      if (!RETRIES_AFTER_EVICTION[failure] || !evictOldestRebuildableRecord(storage)) {
        console.warn("PI WEB browser storage write refused", { failure, characters: value.length });
        return false;
      }
    }
  }
}

export function storageFailureOf(error: unknown): StorageFailure {
  const name: unknown = isRecord(error) ? error["name"] : undefined;
  return typeof name === "string" && QUOTA_ERROR_NAMES.has(name) ? StorageFailure.quota : StorageFailure.unavailable;
}

function evictOldestRebuildableRecord(storage: Storage): boolean {
  let oldest: { key: string; savedAt: number } | undefined;
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key === null || !REBUILDABLE_PREFIXES.some(prefix => key.startsWith(prefix))) continue;
      const savedAt = recordSavedAt(storage.getItem(key));
      if (oldest === undefined || savedAt < oldest.savedAt) oldest = { key, savedAt };
    }
    if (oldest === undefined) return false;
    storage.removeItem(oldest.key);
    return storage.getItem(oldest.key) === null;
  } catch {
    return false;
  }
}

function recordSavedAt(raw: string | null): number {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    return isRecord(value) && typeof value["savedAt"] === "number" ? value["savedAt"] : 0;
  } catch {
    return 0;
  }
}
