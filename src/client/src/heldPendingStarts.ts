import { isRecord } from "../../shared/unknownValues";
import { browserLocalStorage } from "./browserLocalStorage";

/**
 * The new-session starts this browser is waiting on, kept so a reload still knows it asked (r44
 * round 2). A start with no words and no queued message left nothing else behind, so after a
 * reload its pending-session link read as gone while the machine still held the creation parked on
 * a startup question nobody could answer. A record names its machine, directory and startup token:
 * it rebuilds only that start, on that machine, in that directory. It goes when the start settles
 * (named, refused, discarded, or unknown to the machine), and a day after it was
 * asked for, about as long as the machine remembers a settled creation; the newest `MAX_HELD` are kept.
 */
export interface HeldPendingStart {
  readonly machineId: string;
  readonly cwd: string;
  readonly token: string;
  readonly startedAt: number;
}

const STORAGE_KEY = "pi-web:held-pending-starts:v1";
const HELD_FOR_MS = 24 * 60 * 60 * 1000;
const MAX_HELD = 20;
/**
 * Every tab of a browser shares the records, and a record is written before its create reaches the
 * machine. A join another tab sends in that window is told the machine holds no such creation, so a
 * record that young stays for the tab still creating it (r44 round 3).
 */
const JOIN_GRACE_MS = 60 * 1000;

/** Keep a start as held; a start already held keeps the time it was first asked for. */
export function holdPendingStart(start: Omit<HeldPendingStart, "startedAt">, now = Date.now(), storage = browserLocalStorage()): void {
  const held = loadHeld(now, storage);
  if (held.some((record) => sameStart(record, start))) return;
  saveHeld([{ ...start, startedAt: now }, ...held].slice(0, MAX_HELD), storage);
}

export function releasePendingStart(machineId: string, token: string, storage = browserLocalStorage()): void {
  const held = loadHeld(Date.now(), storage);
  const kept = held.filter((record) => record.machineId !== machineId || record.token !== token);
  if (kept.length !== held.length) saveHeld(kept, storage);
}

/** Release a record a join was told the machine does not hold, unless it is young enough that its create may still be on its way. */
export function releaseUnjoinedPendingStart(machineId: string, token: string, now = Date.now(), storage = browserLocalStorage()): void {
  const held = loadHeld(now, storage);
  const kept = held.filter((record) => record.machineId !== machineId || record.token !== token || now - record.startedAt < JOIN_GRACE_MS);
  if (kept.length !== held.length) saveHeld(kept, storage);
}

/** Whether this browser holds the start for `token` on this machine in this directory. */
export function holdsPendingStart(machineId: string, cwd: string, token: string, now = Date.now(), storage = browserLocalStorage()): boolean {
  return loadHeld(now, storage).some((record) => sameStart(record, { machineId, cwd, token }));
}

export function heldPendingStartsOn(machineId: string, now = Date.now(), storage = browserLocalStorage()): HeldPendingStart[] {
  return loadHeld(now, storage).filter((record) => record.machineId === machineId);
}

function sameStart(record: HeldPendingStart, start: Omit<HeldPendingStart, "startedAt">): boolean {
  return record.machineId === start.machineId && record.cwd === start.cwd && record.token === start.token;
}

function loadHeld(now: number, storage: Storage | undefined): HeldPendingStart[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw === undefined || raw === null || raw === "") return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap(parseHeld).filter((record) => now - record.startedAt < HELD_FOR_MS);
  } catch {
    return [];
  }
}

function saveHeld(held: readonly HeldPendingStart[], storage: Storage | undefined): void {
  try {
    if (held.length === 0) storage?.removeItem(STORAGE_KEY);
    else storage?.setItem(STORAGE_KEY, JSON.stringify(held));
  } catch {
    return;
  }
}

function parseHeld(value: unknown): HeldPendingStart[] {
  if (!isRecord(value)) return [];
  const { machineId, cwd, token, startedAt } = value;
  if (typeof machineId !== "string" || typeof cwd !== "string" || typeof token !== "string" || typeof startedAt !== "number") return [];
  return [{ machineId, cwd, token, startedAt }];
}
