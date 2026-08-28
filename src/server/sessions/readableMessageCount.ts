/**
 * How many messages a session has, counted the way the transcript counts them.
 *
 * A session file also records level changes, summaries and other bookkeeping.
 * Counting those made the sidebar disagree with the line above the
 * conversation while both said "messages".
 */
export function readableMessageCount(branch: readonly unknown[]): number {
  let count = 0;
  for (const entry of branch) {
    if (typeof entry !== "object" || entry === null) continue;
    const record: Record<string, unknown> = { ...entry };
    if (record["type"] === "message") count += 1;
  }
  return count;
}
