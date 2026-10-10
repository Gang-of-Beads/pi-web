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
 * lives beside the walk that renders them (branchMessages) so the two surfaces
 * cannot drift apart again.
 */

import { isReadableBranchEntry, retriedAttemptIds, stopOutcomes } from "../../../shared/branchMessages.js";

export { isReadableBranchEntry as isReadableMessageEntry };

/** `retrying`: the attempts the daemon is about to retry, hidden as the transcript hides them (D11). */
export function readableMessageCount(branch: readonly unknown[], retrying?: ReadonlySet<string>): number {
  const retried = retriedAttemptIds(branch, retrying);
  let count = stopOutcomes(branch).alone.size;
  for (const entry of branch) {
    if (isReadableBranchEntry(entry) && !retried.has(entryId(entry))) count += 1;
  }
  return count;
}

function entryId(entry: unknown): string {
  const id: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "id") : undefined;
  return typeof id === "string" ? id : "";
}
