import { isRecord } from "../../shared/unknownValues";
import { browserLocalStorage } from "./browserLocalStorage";
import type { MachineReachability, MachineReachabilityView } from "./machineReachability";

/**
 * The last reachability this browser observed for each machine of one PI WEB server (owner,
 * 2026-10-21: a machine's state rarely changes, so the Machines lists show the last known state
 * instead of "Checking…" until this page's own check concludes).
 *
 * One record per server (origin and base path); inside it, one entry per machine id, holding the
 * target it was observed at (kind, connection and URL). An entry for another target is not
 * recalled, so a changed URL or connection, a removed and re-added machine, or another server
 * never shows a stale state, while a rename keeps it. Every write re-reads the record and decides
 * on what it holds then, so another tab's newer entries survive and are not overwritten by an
 * older decision. Entries are not pruned by this page's machine list, which can be older than
 * another tab's: removing a machine forgets its entry, and the rest expire. Trying is kept: no
 * answer for 10 seconds is an observation, and a later visit must not open on an older Online.
 * Entries follow the cached-first storage rules (docs/design/cached-first-and-motion.md): each
 * carries `savedAt` and lives at most 7 days, and a write the store refuses removes the record, so
 * an older state is never shown after a newer one was observed.
 */
export interface MachineReachabilityMemory {
  recall(machineId: string, target: string): MachineReachabilityView | undefined;
  /** `observe` gets what the record holds for the target after the re-read, and answers the state to keep, or undefined to keep nothing new. */
  remember(machineId: string, target: string, observe: (remembered: MachineReachabilityView | undefined) => MachineReachabilityView | undefined): void;
  forget(machineId: string): void;
}

type ReachabilityStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface RememberedReachability {
  readonly target: string;
  readonly view: MachineReachabilityView;
  readonly savedAt: number;
}

type Entries = Map<string, RememberedReachability>;

const KEY_PREFIX = "pi-web:machine-reachability:v1:";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** An unchanged state is rewritten at most hourly, so its age stays a bound on when it was last observed. */
const REFRESH_AFTER_MS = 60 * 60 * 1000;

const REMEMBERED_STATES: Readonly<Record<MachineReachability, boolean>> = {
  checking: false,
  trying: true,
  online: true,
  error: true,
  offline: true,
  unknown: true,
};

function isRememberedState(value: unknown): value is MachineReachability {
  return typeof value === "string" && Object.hasOwn(REMEMBERED_STATES, value) && Reflect.get(REMEMBERED_STATES, value) === true;
}

export interface MachineReachabilityMemoryDependencies {
  storage?: () => ReachabilityStorage | undefined;
  now?: () => number;
}

export function browserMachineReachabilityMemory(server: () => string, dependencies: MachineReachabilityMemoryDependencies = {}): MachineReachabilityMemory {
  const storage = dependencies.storage ?? browserLocalStorage;
  const now = dependencies.now ?? (() => Date.now());
  let entries: Entries | undefined;
  const storageKey = () => `${KEY_PREFIX}${server()}`;
  const read = (): Entries | undefined => {
    const fresh = readEntries(storage(), storageKey, now());
    if (fresh !== undefined) entries = fresh;
    return fresh;
  };
  const viewOf = (held: Entries | undefined, machineId: string, target: string): MachineReachabilityView | undefined => {
    const remembered = held?.get(machineId);
    return remembered?.target !== target || now() - remembered.savedAt > MAX_AGE_MS ? undefined : remembered.view;
  };
  const write = (change: (current: Entries) => boolean): void => {
    const current = read() ?? entries ?? new Map<string, RememberedReachability>();
    if (!change(current)) return;
    entries = current;
    writeEntries(storage(), storageKey, current);
  };
  return {
    recall: (machineId, target) => viewOf(entries ?? read(), machineId, target),
    remember: (machineId, target, observe) => {
      write((current) => {
        const view = observe(viewOf(current, machineId, target));
        if (view === undefined || !REMEMBERED_STATES[view.state]) return false;
        const previous = current.get(machineId);
        if (previous?.target === target && previous.view.state === view.state && previous.view.text === view.text && now() - previous.savedAt < REFRESH_AFTER_MS) return false;
        current.set(machineId, { target, view: { state: view.state, text: view.text }, savedAt: now() });
        return true;
      });
    },
    forget: (machineId) => {
      write((current) => current.delete(machineId));
    },
  };
}

/** The record as stored, without entries past their age; undefined when the store could not be read, so the next call tries again. A record that does not parse holds nothing. */
function readEntries(storage: ReachabilityStorage | undefined, storageKey: () => string, now: number): Entries | undefined {
  if (storage === undefined) return undefined;
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey());
  } catch {
    return undefined;
  }
  const entries: Entries = new Map();
  if (raw === null) return entries;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return entries;
    for (const [machineId, entry] of Object.entries(value)) {
      if (!isRecord(entry) || typeof entry["target"] !== "string" || !isRememberedState(entry["state"]) || typeof entry["text"] !== "string" || typeof entry["savedAt"] !== "number") continue;
      if (now - entry["savedAt"] > MAX_AGE_MS) continue;
      entries.set(machineId, { target: entry["target"], view: { state: entry["state"], text: entry["text"] }, savedAt: entry["savedAt"] });
    }
  } catch {
    return entries;
  }
  return entries;
}

function writeEntries(storage: ReachabilityStorage | undefined, storageKey: () => string, entries: Entries): void {
  if (storage === undefined) return;
  try {
    const record = Object.fromEntries([...entries].map(([machineId, { target, view, savedAt }]) => [machineId, { target, state: view.state, text: view.text, savedAt }]));
    storage.setItem(storageKey(), JSON.stringify(record));
  } catch {
    removeRecord(storage, storageKey);
  }
}

function removeRecord(storage: ReachabilityStorage, storageKey: () => string): void {
  try {
    storage.removeItem(storageKey());
  } catch {
    return;
  }
}
