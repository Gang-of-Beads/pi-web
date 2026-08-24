/**
 * When the open session should keep re-reading its activity (subagents,
 * subagent-tool runs and background tasks).
 *
 * The list used to be fetched only when a session was selected, but the normal
 * way to acquire a subagent is to ask for one in the session you are already
 * reading: nothing refetched afterwards, so the drawer stayed empty until the
 * reader switched sessions and came back. Polling is therefore tied to having
 * a session on screen, and stops with the tab so a backgrounded browser is not
 * charged for a conversation nobody is watching.
 */
export function shouldPollSessionActivity(input: { hasSelectedSession: boolean; documentVisible: boolean }): boolean {
  return input.hasSelectedSession && input.documentVisible;
}
