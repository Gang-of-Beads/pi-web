import type { ChatLine } from "./components/shared";
import { carryDeliveryForward, deliveryWaiting } from "./messageDelivery";

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
 */
export function carryUnsettledForward(previous: readonly ChatLine[], rebuilt: ChatLine[]): ChatLine[] {
  let next = rebuilt;
  const carried: ChatLine[] = [];
  for (const line of previous) {
    const delivery = line.meta?.delivery;
    if (delivery === undefined || !deliveryWaiting(delivery.state)) continue;
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
