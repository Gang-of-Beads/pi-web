import { browserLocalStorage } from "./browserLocalStorage";
import type { PinStorage } from "./sessionPins";

/**
 * Which machines this browser has already handed its old pins to.
 *
 * Pins moved from the browser to the machine; a browser hands its old list over once. Remembering
 * that only for the page's lifetime handed the list over on every load, so a pin removed on another
 * device while this browser was closed came back the next time it opened, from the browser's stale
 * copy. The mark is kept per kind of pin and per machine, beside the pins themselves.
 */
export type PinKind = "sessions" | "projects";

const PINS_HANDED_OVER_KEY = "pi-web.pinsHandedOver";

export function pinsHandedOver(kind: PinKind, machineId: string, storage: PinStorage | undefined = browserLocalStorage()): boolean {
  return readHandedOver(storage)[kind].includes(machineId);
}

export function markPinsHandedOver(kind: PinKind, machineId: string, storage: PinStorage | undefined = browserLocalStorage()): void {
  if (storage === undefined) return;
  const marks = readHandedOver(storage);
  if (marks[kind].includes(machineId)) return;
  try {
    storage.setItem(PINS_HANDED_OVER_KEY, JSON.stringify({ ...marks, [kind]: [...marks[kind], machineId] }));
  } catch {
    // Without storage the page's own memory of the handover stands in until it reloads.
  }
}

function readHandedOver(storage: PinStorage | undefined): Record<PinKind, string[]> {
  const empty: Record<PinKind, string[]> = { sessions: [], projects: [] };
  if (storage === undefined) return empty;
  try {
    const raw = storage.getItem(PINS_HANDED_OVER_KEY);
    const parsed: unknown = raw === null || raw === "" ? {} : JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty;
    return { sessions: machineIds(Reflect.get(parsed, "sessions")), projects: machineIds(Reflect.get(parsed, "projects")) };
  } catch {
    return empty;
  }
}

function machineIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}
