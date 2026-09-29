import type { ChatLine } from "./components/shared";
import { carryDeliveryForward, deliveryWaiting, markDeliveryFailed, withdrawDeliveryLine } from "./messageDelivery";

/** Terminal outcomes a replay carried for messages it did not commit: taken back, or refused. */
export interface ReplayedOutcomes {
  withdrawn: readonly string[];
  refused: readonly string[];
}

/**
 * Apply a replay's withdrawals and refusals to a transcript. They are not transcript events, so
 * a rebuild from the cache plus a replay applied the replayed echo of a message but not its
 * withdrawal: a recalled message stood again as a plain line, and a reload kept it.
 */
export function applyReplayedOutcomes(lines: ChatLine[], outcomes: ReplayedOutcomes): ChatLine[] {
  const kept = outcomes.withdrawn.reduce((next, clientMessageId) => withdrawDeliveryLine(next, clientMessageId), lines);
  return outcomes.refused.reduce((next, clientMessageId) => markDeliveryFailed(next, clientMessageId, "not-sent"), kept);
}

/** A row a rebuild must not lose: one still waiting, and one that failed and still offers Retry. */
function carriedAcrossRebuild(state: Parameters<typeof deliveryWaiting>[0]): boolean {
  return state === "failed" || deliveryWaiting(state);
}

/**
 * What a rebuilt transcript holds of one waiting message, found by its identity in every form
 * a rebuild can carry it: the row itself, the daemon's echo of its acceptance, or the committed
 * copy stamped with its id. A committed page line carries the id as `meta.clientMessageId` and
 * no delivery, so matching on the delivery alone missed it and the waiting row was added a
 * second time beside its own committed copy.
 */
type RebuiltCopy =
  | { kind: "absent" }
  | { kind: "tracked" }
  | { kind: "echo"; at: number }
  | { kind: "committed"; at: number };

function rebuiltCopyOf(rebuilt: readonly ChatLine[], clientMessageId: string): RebuiltCopy {
  let echo: number | undefined;
  for (const [at, line] of rebuilt.entries()) {
    if (line.meta?.delivery?.clientMessageId === clientMessageId) return { kind: "tracked" };
    if (line.role === "user" && line.meta?.clientMessageId === clientMessageId && line.meta.echo !== true) return { kind: "committed", at };
    if (echo === undefined && line.meta?.echo === true && line.meta.echoClientMessageId === clientMessageId) echo = at;
  }
  return echo === undefined ? { kind: "absent" } : { kind: "echo", at: echo };
}

/**
 * A transcript rebuilt from disk, or from the cache plus a replay, contains only what reached
 * them. A send still waiting for its confirmation is not there yet, and dropping it showed the
 * sender their message vanishing with no failure anywhere. Waiting cards ride across the
 * rebuild; everything settled answers to the rebuild alone.
 *
 * - The daemon's echo of the message is acceptance, not reading: the waiting row takes its
 *   place and keeps its state. Applied on its own, the replayed echo stood beside the row, or
 *   was merged into it and read "delivered" while the daemon still held it queued (the live
 *   realtime probe, 2026-09-29).
 * - A committed copy stamped with its id is the fact of delivery: it becomes the row, marked
 *   delivered.
 * - Nothing of it: the row is carried to the end, as before.
 *
 * A failed row rides along too: rebuilt away, the sender's "Not received" bubble and its
 * Retry vanished while the outbox still held the message.
 */
export function carryUnsettledForward(previous: readonly ChatLine[], rebuilt: ChatLine[]): ChatLine[] {
  let next = rebuilt;
  const carried: ChatLine[] = [];
  for (const line of previous) {
    const delivery = line.meta?.delivery;
    if (delivery === undefined || !carriedAcrossRebuild(delivery.state)) continue;
    const copy = rebuiltCopyOf(next, delivery.clientMessageId);
    if (copy.kind === "tracked") continue;
    if (copy.kind === "absent") {
      carried.push(line);
      continue;
    }
    const replacement = copy.kind === "echo" ? line : carryDeliveryForward(line, next[copy.at] ?? line);
    next = [...next.slice(0, copy.at), replacement, ...next.slice(copy.at + 1)];
  }
  return carried.length === 0 ? next : [...next, ...carried];
}

/** Whether any line is still waiting on a confirmation the pushes may have dropped. */
export function hasWaitingDelivery(messages: readonly ChatLine[]): boolean {
  return messages.some((line) => {
    const state = line.meta?.delivery?.state;
    return state !== undefined && deliveryWaiting(state);
  });
}
