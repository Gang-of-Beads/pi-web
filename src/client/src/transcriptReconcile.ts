import type { ChatLine } from "./components/shared";
import { carryDeliveryForward, deliveryWaiting, findDeliveryLineIndex, markDelivery, optimisticUserLine } from "./messageDelivery";
import type { PendingPrompt } from "./pendingOutbox";

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

/**
 * The transcript with this browser's stored outbox drawn at its tail, in the order it was written:
 * a message or shell command not yet in the transcript reads "Sending…", or "Taking back…" while a
 * take-back for it waits, and one already withdrawn here is not drawn. A row is made when a record
 * is written; after a reload the records are read back from storage, and without this they had no
 * row until the composer's fallback drew them seconds later, while a new session read "Send a
 * message to start it" (QA, 2026-10-14).
 */
export function withOutboxRows(messages: ChatLine[], records: readonly PendingPrompt[]): ChatLine[] {
  const takeBacks = new Map(records.filter((record) => record.kind === "takeBack").map((record) => [record.takeBackOf ?? "", record]));
  const rows = records
    .filter((record) => (record.kind === "message" || record.kind === "shell") && takeBacks.get(record.clientMessageId)?.wordsReturned !== true)
    .filter((record) => findDeliveryLineIndex(messages, record.clientMessageId) === -1)
    .map((record) => {
      const line = optimisticUserLine(record.text, record.clientMessageId, record.attachments ?? [], record.at);
      return takeBacks.has(record.clientMessageId) ? markDelivery([line], record.clientMessageId, "takingBack")[0] ?? line : line;
    });
  return rows.length === 0 ? messages : carryUnsettledForward(rows, messages);
}
