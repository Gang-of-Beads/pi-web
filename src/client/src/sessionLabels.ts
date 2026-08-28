import type { SessionInfo } from "./api";

/**
 * What a session with nothing to say for itself is called.
 *
 * A session exists before anyone speaks to it, so it has no name and no first
 * message. The last fallback used to be the tail of its id, which put the
 * literal string "7c4dc82f" in front of the reader as the name of the thing
 * they were looking at. An identifier is not a name.
 */
export const NEW_SESSION_LABEL = "New session";

export function shortSessionId(id: string): string {
  return id.slice(-8);
}

function firstWordsOf(session: Pick<SessionInfo, "name" | "firstMessage">): string | undefined {
  const name = session.name?.trim();
  if (name !== undefined && name !== "") return name;
  const firstMessage = session.firstMessage.trim();
  return firstMessage === "" ? undefined : firstMessage;
}

/**
 * Display label for a session row. Shared so every surface that lists sessions
 * (navigation list, quick switcher) names the same session identically.
 */
export function sessionLabel(session: SessionInfo): string {
  return firstWordsOf(session) ?? NEW_SESSION_LABEL;
}

/**
 * The secondary detail that separates two sessions sharing a label.
 *
 * Every session waiting for its first message is called the same thing, so the
 * id is still what tells them apart - it is demoted to a detail beside the
 * name rather than standing in for it, and is absent once the session has
 * words of its own.
 */
export function sessionLabelDetail(session: SessionInfo): string | undefined {
  return firstWordsOf(session) === undefined ? shortSessionId(session.id) : undefined;
}
