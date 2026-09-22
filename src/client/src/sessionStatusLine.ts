/**
 * What the status bar says when it has no numbers.
 *
 * "No session status yet" was shown for both of the states that produce an
 * empty bar: a read that has not happened, and a read that failed. The owner
 * met the second one - a session whose transcript rendered from cache while
 * the status never arrived - and the bar sat there forever with no way to ask
 * again, which is the "no permanent error without a retry" rule broken in the
 * quietest possible place.
 */

export type SessionStatusLine =
  | { kind: "numbers" }
  | { kind: "unread"; text: string }
  | { kind: "unavailable"; text: string; retry: true };

export function sessionStatusLine(input: {
  hasStatus: boolean;
  failure?: string | undefined;
}): SessionStatusLine {
  if (input.hasStatus) return { kind: "numbers" };
  if (input.failure === undefined || input.failure === "") {
    return { kind: "unread", text: "No session status yet" };
  }
  return { kind: "unavailable", text: "Session status could not be read", retry: true };
}
