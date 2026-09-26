/**
 * Retiring an outbox row the transcript already proves delivered.
 *
 * The send call and the daemon's acceptance frame are two independent reports of
 * the same fact, and on a phone over a tailnet both can go missing while the
 * message itself arrives: the POST times out, or the socket carrying
 * `prompt.accepted` drops. The outbox then kept an "Unsent / Retry" row for a
 * message sitting in the transcript under a running turn - two states that
 * cannot coexist, and the reader's own words: 既然是 running 怎么可能还有
 * retry/discard.
 *
 * The transcript is the proof that needs no frame: a delivered message carries
 * the id the browser minted, so a row whose id is already settled is not unsent
 * whatever the send call said.
 */
export interface OutboxSettlement {
  /** Ids still owed a decision: no proof of delivery, so the row stays. */
  keep: string[];
  /** Ids the transcript shows: their row leaves the outbox. */
  drop: string[];
}

export function settleOutbox(ids: readonly string[], wasDelivered: (id: string) => boolean): OutboxSettlement {
  const keep: string[] = [];
  const drop: string[] = [];
  for (const id of ids) (wasDelivered(id) ? drop : keep).push(id);
  return { keep, drop };
}
