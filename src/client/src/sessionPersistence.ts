import type { SessionInfo, SessionStatus } from "./api";
import { isCachedNewSessionInfo } from "./cachedNewSessions";

export type SessionPersistenceState = "persisted" | "transient" | "unknown";

/**
 * All supported runtimes report persisted/transient session state
 * authoritatively, so a missing `persisted` signal is `unknown`, never an
 * implicit "persisted".
 */
export function sessionPersistenceState(session: SessionInfo | undefined, status?: SessionStatus): SessionPersistenceState {
  if (session === undefined) return "unknown";
  const statusPersisted = status?.sessionId === session.id ? status.persisted : undefined;
  const persisted = statusPersisted ?? session.persisted;
  if (persisted === true) return "persisted";
  if (persisted === false || isCachedNewSessionInfo(session)) return "transient";
  return "unknown";
}

/** A session the machine has written to disk: it can be reloaded from its file. */
export function isPersistedSessionInfo(session: SessionInfo | undefined, status?: SessionStatus): boolean {
  return session !== undefined && session.archived !== true && sessionPersistenceState(session, status) === "persisted";
}

/**
 * A session the machine holds, written or not: archived like any other (owner, 2026-10-14: "就把它当成正常的session").
 * One still being created exists only in this browser, and is deleted instead.
 */
export function isArchivableSessionInfo(session: SessionInfo | undefined, status?: SessionStatus): boolean {
  if (session === undefined || session.archived === true || "clientPendingStart" in session) return false;
  return sessionPersistenceState(session, status) !== "unknown";
}

export function isTransientNewSessionInfo(session: SessionInfo | undefined, status?: SessionStatus): boolean {
  return session !== undefined && session.archived !== true && sessionPersistenceState(session, status) === "transient";
}
