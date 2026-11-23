import type { SessionInfo } from "../api";
import { sessionRowKind } from "../sessionOrder";
import { browserSessionStorage, parseStoredString, PersistentValueMap, type KeyValueStorage } from "./sessionStorageMemory";

export interface SessionSelectionMemory {
  latestSessionId(cwd: string): string | undefined;
  rememberSession(session: SessionInfo): void;
  forgetWorkspace(cwd: string): void;
}

export class InMemorySessionSelectionMemory implements SessionSelectionMemory {
  private readonly sessionIdsByCwd = new Map<string, string>();

  latestSessionId(cwd: string): string | undefined {
    return this.sessionIdsByCwd.get(cwd);
  }

  rememberSession(session: SessionInfo): void {
    this.sessionIdsByCwd.set(session.cwd, session.id);
  }

  forgetWorkspace(cwd: string): void {
    this.sessionIdsByCwd.delete(cwd);
  }
}

const sessionSelectionStorageKey = "pi-web:session-selection:v1";

export class SessionStorageSessionSelectionMemory implements SessionSelectionMemory {
  private readonly sessionIdsByCwd: PersistentValueMap<string>;

  constructor(storage: KeyValueStorage | undefined = browserSessionStorage()) {
    this.sessionIdsByCwd = new PersistentValueMap(sessionSelectionStorageKey, parseStoredString, storage);
  }

  latestSessionId(cwd: string): string | undefined {
    return this.sessionIdsByCwd.get(cwd);
  }

  rememberSession(session: SessionInfo): void {
    this.sessionIdsByCwd.set(session.cwd, session.id);
  }

  forgetWorkspace(cwd: string): void {
    this.sessionIdsByCwd.delete(cwd);
  }
}

/**
 * Whether a session can open: any but a row whose folder is gone (`sessionRowKind`). An archived
 * session opens read-only from the archive, which needs no folder; deciding on the folder alone, while
 * the lists put archived first, refused an archived row the lists had just opened (review of the
 * folder-gone lists, round 3, P2). No auto-pick may land on one that cannot open, or the selection guard
 * turns the pick into a notice while a live sibling exists. Every producer of a "next session" pick and
 * the selection guard read this one answer.
 */
export function isOpenableSession(session: SessionInfo): boolean {
  return sessionRowKind(session) !== "folder-gone";
}

export function selectPreferredSession(sessions: SessionInfo[], options?: { latestSessionId?: string | undefined }): SessionInfo | undefined {
  // A row whose folder is gone cannot open unless it is archived (`isOpenableSession`), so it is never the
  // preferred pick on any branch: restoring it would only select a dead row
  // and raise the same "folder no longer exists" notice on every boot. The
  // row stays listed (its badge says so); a later branch takes a live one.
  const alive = sessions.filter(isOpenableSession);
  const latestSessionId = options?.latestSessionId;
  if (latestSessionId !== undefined && latestSessionId !== "") {
    const latest = alive.find((session) => session.id === latestSessionId) ?? alive.find((session) => session.archived !== true);
    if (latest !== undefined) return latest;
  }

  return alive.find((session) => session.archived !== true);
}

export function markSessionsArchived(sessions: SessionInfo[], sessionIds: readonly string[], archivedAt: string): SessionInfo[] {
  const archivedIds = new Set(sessionIds);
  return sessions.map((session) => archivedIds.has(session.id) ? { ...session, archived: true, archivedAt } : session);
}

