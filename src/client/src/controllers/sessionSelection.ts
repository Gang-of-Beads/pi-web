import type { SessionInfo } from "../api";
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

/** A session whose folder is gone can never open: no auto-pick may land on it,
 * or the selection guard turns the pick into a notice while a live sibling
 * exists. Every producer of a "next session" pick must filter through this. */
export function isOpenableSession(session: SessionInfo): boolean {
  return session.cwdMissing !== true;
}

export function selectPreferredSession(sessions: SessionInfo[], options?: { targetSessionId?: string | undefined; latestSessionId?: string | undefined }): SessionInfo | undefined {
  // A session whose folder is gone can never open, so it is never the
  // preferred pick on any branch: restoring it would only select a dead row
  // and raise the same "folder no longer exists" notice on every boot. The
  // row stays listed (its badge says so); a later branch takes a live one.
  const alive = sessions.filter((session) => session.cwdMissing !== true);
  const targetSessionId = options?.targetSessionId;
  if (targetSessionId !== undefined && targetSessionId !== "") {
    const targeted = sessionByIdOrPrefix(alive, targetSessionId);
    if (targeted !== undefined) return targeted;
  }

  const latestSessionId = options?.latestSessionId;
  if (latestSessionId !== undefined && latestSessionId !== "") {
    const latest = alive.find((session) => session.id === latestSessionId) ?? alive.find((session) => session.archived !== true);
    if (latest !== undefined) return latest;
  }

  return alive.find((session) => session.archived !== true);
}

export function shouldDeselectAfterArchivedCollapse(sessions: SessionInfo[], selectedSession: SessionInfo | undefined): boolean {
  if (selectedSession?.archived !== true) return false;
  return !sessions.some((session) => session.archived !== true);
}

function sessionByIdOrPrefix(sessions: SessionInfo[], sessionId: string): SessionInfo | undefined {
  return sessions.find((session) => session.id === sessionId || session.id.startsWith(sessionId));
}

export type ArchiveSelectionChange =
  | { type: "unchanged" }
  | { type: "select"; session: SessionInfo }
  | { type: "clear" };

export function markSessionArchived(sessions: SessionInfo[], sessionId: string, archivedAt: string): SessionInfo[] {
  return markSessionsArchived(sessions, [sessionId], archivedAt);
}

export function markSessionsArchived(sessions: SessionInfo[], sessionIds: readonly string[], archivedAt: string): SessionInfo[] {
  const archivedIds = new Set(sessionIds);
  return sessions.map((session) => archivedIds.has(session.id) ? { ...session, archived: true, archivedAt } : session);
}

export function selectionAfterArchivingSession(sessions: SessionInfo[], selectedSessionId: string | undefined, archivedSessionId: string): ArchiveSelectionChange {
  return selectionAfterArchivingSessions(sessions, selectedSessionId, [archivedSessionId]);
}

export function selectionAfterArchivingSessions(sessions: SessionInfo[], selectedSessionId: string | undefined, archivedSessionIds: readonly string[]): ArchiveSelectionChange {
  if (selectedSessionId === undefined || !archivedSessionIds.includes(selectedSessionId)) return { type: "unchanged" };

  const archivedIds = new Set(archivedSessionIds);
  const nextSession = sessions.find((session) => !archivedIds.has(session.id) && session.archived !== true && isOpenableSession(session));
  return nextSession === undefined ? { type: "clear" } : { type: "select", session: nextSession };
}
