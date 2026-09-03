/**
 * Sending in order, over a link that comes and goes.
 *
 * Identity alone stops a message being drawn twice. It does not stop the second
 * message overtaking the first when the first is retried, and it does not stop
 * the daemon acting on them in an order the sender never intended. Two messages
 * sent a second apart, the first one's request stalling, and the reader gets
 * their instructions applied backwards.
 *
 * So each message carries a sequence, assigned by the sender when it enters the
 * outbox, and the outbox drains strictly in that order: one attempt in flight
 * at a time, and an entry that has not been answered blocks the ones behind it.
 * That is what makes recovery after a dropped link resume rather than reshuffle.
 *
 * The sequence is per session and per browser. Two browsers on one session have
 * independent sequences and their messages interleave by arrival - which is the
 * honest answer, because nothing about their two hands is ordered either.
 */

export interface OrderedEntry {
  id: string;
  /** Monotonic within one session and one browser. Assigned before the first attempt. */
  seq: number;
  state: "outbox" | "inFlight" | "accepted" | "refused";
}

export type DrainDecision =
  | { action: "send"; id: string; seq: number }
  | { action: "wait"; reason: "in-flight" | "nothing-to-send" };

/**
 * What the outbox may do right now.
 *
 * Only the lowest unsent sequence is ever offered, and only when nothing else
 * is in flight. Draining in parallel is what lets a retried message land after
 * one sent later; draining out of order is the same fault with a different
 * cause.
 */
export function nextToSend(entries: readonly OrderedEntry[]): DrainDecision {
  if (entries.some((entry) => entry.state === "inFlight")) return { action: "wait", reason: "in-flight" };
  const pending = entries.filter((entry) => entry.state === "outbox").sort((a, b) => a.seq - b.seq);
  const head = pending[0];
  if (head === undefined) return { action: "wait", reason: "nothing-to-send" };
  return { action: "send", id: head.id, seq: head.seq };
}

/**
 * The next sequence to assign.
 *
 * Taken from the highest the outbox has ever held rather than from its length:
 * entries leave as they settle, and numbering from the count would re-issue a
 * sequence that a still-unanswered message is using.
 */
export function nextSequence(entries: readonly OrderedEntry[], highWater: number): number {
  const highest = entries.reduce((max, entry) => Math.max(max, entry.seq), highWater);
  return highest + 1;
}

/**
 * Whether the daemon should act on a submission, given what it has already
 * accepted from this sender.
 *
 * A repeat of something already accepted is answered with the original outcome
 * instead of being run again - this is what makes the sender's automatic retry
 * safe. A sequence beyond the next expected one means something earlier is
 * still missing, and acting on it would apply instructions out of order.
 */
export type AcceptDecision =
  | { action: "accept"; seq: number }
  | { action: "replay-outcome"; seq: number }
  | { action: "hold"; expected: number; received: number };

export function acceptSubmission(highestAccepted: number, received: number): AcceptDecision {
  if (received <= highestAccepted) return { action: "replay-outcome", seq: received };
  if (received > highestAccepted + 1) return { action: "hold", expected: highestAccepted + 1, received };
  return { action: "accept", seq: received };
}
