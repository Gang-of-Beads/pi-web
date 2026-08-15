import type { SessionInfo } from "./api";

export function shortSessionId(id: string): string {
  return id.slice(-8);
}

/**
 * Display label for a session row. Shared so every surface that lists sessions
 * (navigation list, quick switcher) names the same session identically.
 */
export function sessionLabel(session: SessionInfo): string {
  if (session.name !== undefined && session.name !== "") return session.name;
  return session.firstMessage !== "" ? session.firstMessage : shortSessionId(session.id);
}
