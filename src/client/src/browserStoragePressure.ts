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

/**
 * Durable input takes precedence over server-backed caches, never over another draft or outbox.
 * The caches are read and ordered once, oldest first, and given up one at a time until the write
 * fits; a value larger than all of them together is refused without emptying them, since evicting
 * could not make that room (it may still have fitted in room already free: rare, and the caller
 * says the write was refused).
 */
export function writeEssentialBrowserRecord(storage: Storage | undefined, key: string, value: string): boolean {
  if (storage === undefined) return false;
  let failure = tryWrite(storage, key, value);
  if (failure === undefined) return true;
  const evictable = RETRIES_AFTER_EVICTION[failure] ? rebuildableOldestFirst(storage) : [];
  if (evictable.reduce((total, entry) => total + entry.characters, 0) >= value.length) {
    for (const entry of evictable) {
      if (!removed(storage, entry.key)) break;
      failure = tryWrite(storage, key, value);
      if (failure === undefined) return true;
      if (!RETRIES_AFTER_EVICTION[failure]) break;
    }
  }
  console.warn("PI WEB browser storage write refused", { failure, characters: value.length });
  return false;
}

export function storageFailureOf(error: unknown): StorageFailure {
  const name: unknown = isRecord(error) ? error["name"] : undefined;
  return typeof name === "string" && QUOTA_ERROR_NAMES.has(name) ? StorageFailure.quota : StorageFailure.unavailable;
}

function tryWrite(storage: Storage, key: string, value: string): StorageFailure | undefined {
  try {
    storage.setItem(key, value);
    return undefined;
  } catch (error) {
    return storageFailureOf(error);
  }
}

function removed(storage: Storage, key: string): boolean {
  try {
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}

function rebuildableOldestFirst(storage: Storage): { key: string; savedAt: number; characters: number }[] {
  const entries: { key: string; savedAt: number; characters: number }[] = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key === null || !REBUILDABLE_PREFIXES.some(prefix => key.startsWith(prefix))) continue;
      const raw = storage.getItem(key);
      entries.push({ key, savedAt: recordSavedAt(raw), characters: key.length + (raw?.length ?? 0) });
    }
  } catch {
    return [];
  }
  return entries.sort((left, right) => left.savedAt - right.savedAt);
}

function recordSavedAt(raw: string | null): number {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    return isRecord(value) && typeof value["savedAt"] === "number" ? value["savedAt"] : 0;
  } catch {
    return 0;
  }
}
