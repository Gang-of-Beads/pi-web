/**
 * Pinned projects, remembered on this device.
 *
 * The same rule as session pins, for the other thing the navigation board
 * lists: a personal "keep this close" mark, stored per machine because a
 * project id belongs to the machine that holds it, and kept locally because a
 * pin that needed a round trip would be slower than the scroll it replaces.
 */

import { type PinStorage } from "./sessionPins";

export const PROJECT_PINS_STORAGE_KEY = "pi-web.pinnedProjects";

export function readPinnedProjectIds(machineId: string, storage: PinStorage | undefined = browserStorage()): Set<string> {
  if (storage === undefined) return new Set();
  try {
    const raw = storage.getItem(PROJECT_PINS_STORAGE_KEY);
    if (raw === null || raw === "") return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return new Set();
    const scoped: unknown = Reflect.get(parsed, machineId);
    return Array.isArray(scoped) ? new Set(scoped.filter((id): id is string => typeof id === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function writePinnedProjectIds(machineId: string, ids: ReadonlySet<string>, storage: PinStorage | undefined = browserStorage()): void {
  if (storage === undefined) return;
  try {
    const raw = storage.getItem(PROJECT_PINS_STORAGE_KEY);
    const parsed: unknown = raw === null || raw === "" ? {} : JSON.parse(raw);
    const scopes: Record<string, string[]> = {};
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      for (const [scope, value] of Object.entries(parsed)) {
        if (Array.isArray(value)) scopes[scope] = value.filter((id): id is string => typeof id === "string");
      }
    }
    scopes[machineId] = [...ids];
    storage.setItem(PROJECT_PINS_STORAGE_KEY, JSON.stringify(scopes));
  } catch {
    // Storage being unavailable costs the pin its memory, nothing else.
  }
}

export function togglePinnedProjectId(ids: ReadonlySet<string>, projectId: string): Set<string> {
  const next = new Set(ids);
  if (!next.delete(projectId)) next.add(projectId);
  return next;
}

function browserStorage(): PinStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}
