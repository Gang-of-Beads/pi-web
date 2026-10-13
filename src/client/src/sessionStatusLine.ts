/**
 * What the status bar says when it has no numbers.
 *
 * "No session status yet" was shown for both of the states that produce an
 * empty bar: a read that has not happened, and a read that failed. They stay
 * apart; a failed read is read again by itself (sessionController
 * `readSelectionAgain`), so the bar offers nothing to press (B48).
 */

export type SessionStatusLine =
  | { kind: "numbers" }
  | { kind: "unread"; text: string }
  | { kind: "unavailable"; text: string };

export function sessionStatusLine(input: {
  hasStatus: boolean;
  failure?: string | undefined;
}): SessionStatusLine {
  if (input.hasStatus) return { kind: "numbers" };
  if (input.failure === undefined || input.failure === "") {
    return { kind: "unread", text: "No session status yet" };
  }
  return { kind: "unavailable", text: "Session status not available yet" };
}
