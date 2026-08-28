import type { SessionInfo } from "./api";

/**
 * The last known session list per workspace, held in memory for the life of
 * the page.
 *
 * Switching workspaces used to blank the list and redraw it only once the
 * fresh listing arrived; the unloaded state and the loaded-empty state were
 * both just `sessions: []`. This cache is what lets a revisited workspace show
 * its previous list immediately while a fresh listing loads, and what keeps a
 * row on screen when a refresh fails. It is a staleness reducer, not a store
 * of truth: the daemon's listing always replaces it.
 */
const cache = new Map<string, readonly SessionInfo[]>();

/** Cache key. Two machines can list the same path, so the machine is part of it. */
function cacheKey(machineId: string, workspacePath: string): string {
  return `${machineId}\u0000${workspacePath}`;
}

export function cachedSessionsFor(machineId: string, workspacePath: string): readonly SessionInfo[] | undefined {
  return cache.get(cacheKey(machineId, workspacePath));
}

export function rememberWorkspaceSessions(machineId: string, workspacePath: string, sessions: readonly SessionInfo[]): void {
  cache.set(cacheKey(machineId, workspacePath), sessions);
}

/** For tests: the cache is module state, so a file's tests start from empty. */
export function clearWorkspaceSessionsCache(): void {
  cache.clear();
}
