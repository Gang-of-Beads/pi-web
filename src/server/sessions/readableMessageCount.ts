/**
 * How many messages a session has, counted the way the transcript counts them.
 *
 * A session file also records level changes, summaries and other bookkeeping.
 * Counting those made the sidebar disagree with the line above the
 * conversation while both said "messages".
 *
 * Dropping the bookkeeping was only half of it. The transcript is built by
 * `historyMessages` (piSessionService), which renders the ordinary messages
 * *and* the custom messages an extension asked to display - a goal banner, an
 * update notice - while this counted only the ordinary ones. So the two numbers
 * were still built from different sets and still disagreed, now by exactly the
 * number of displayed custom entries: measured on one live session, 14235 in
 * the sidebar against 14414 above the conversation, and 179 displayed custom
 * entries on that branch.
 *
 * The rule is therefore not "messages" but "entries a reader can see", and it
 * lives in one predicate so the two surfaces cannot drift apart again.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Whether the transcript renders this entry, and so whether it is counted. */
export function isReadableMessageEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  if (entry["type"] === "message") return true;
  return entry["type"] === "custom_message" && entry["display"] === true;
}

export function readableMessageCount(branch: readonly unknown[]): number {
  let count = 0;
  for (const entry of branch) {
    if (isReadableMessageEntry(entry)) count += 1;
  }
  return count;
}
