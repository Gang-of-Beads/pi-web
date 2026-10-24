import type { ChatLine, MessageDeliveryState } from "./components/shared";
import type { UserMessageRow } from "./userMessageRegister";

/**
 * Where each user row is drawn: placement is a function of the message's
 * state (B2, state-diagram D1 "Row placement is a function of state").
 *
 * A message the daemon still listed as queued left its transcript slot for the
 * pending block below every settled row, while a later message whose send
 * could not be verified kept its slot above it, so an earlier message was drawn
 * below a later one. Now every message the agent has not taken is in the
 * pending block, in the order the agent will take them (owner, 2026-10-23,
 * "Order"): what the daemon lists, in the daemon's order, and every other one
 * by its send time after them. Only a message the agent took stays where the
 * transcript has it.
 *
 * One device's messages keep their send order everywhere: the machine accepts
 * them in that order and hands its queue first in, first out. So a message of
 * this browser the queue does not list, sent before one it does list, is not
 * behind it: the agent has taken it, so it heads the block, or it is being
 * taken back, so it keeps its place just before that message. Drawn after
 * every listed message, a confirmed message and an unconfirmed one sent before
 * it swapped places.
 */
export function placeUserRows(rows: readonly UserMessageRow[]): { settled: ChatLine[]; pending: ChatLine[] } {
  const settled: ChatLine[] = [];
  const pending: { line: ChatLine; queuePosition: number | undefined; sentAt: number; own: boolean }[] = [];
  for (const row of rows) {
    if (row.queuePosition === undefined && !waiting(row.line)) {
      settled.push(row.line);
      continue;
    }
    const sentAt = Date.parse(row.line.meta?.timestamp ?? "");
    pending.push({ line: row.line, queuePosition: row.queuePosition, sentAt: Number.isFinite(sentAt) ? sentAt : Infinity, own: row.line.meta?.delivery !== undefined && Number.isFinite(sentAt) });
  }
  const listedOwn = pending.filter((entry) => entry.own && entry.queuePosition !== undefined);
  const keyed = pending.map((entry): { line: ChatLine; key: OrderKey } => {
    if (entry.queuePosition !== undefined) return { line: entry.line, key: [entry.queuePosition, entry.sentAt] };
    const sentLater = listedOwn.filter((listed) => listed.sentAt > entry.sentAt).map((listed) => listed.queuePosition ?? Infinity);
    if (sentLater.length === 0) return { line: entry.line, key: [Infinity, entry.sentAt] };
    const state = entry.line.meta?.delivery?.state;
    return { line: entry.line, key: [state !== undefined && KEEPS_PLACE_UNLISTED[state] ? Math.min(...sentLater) - 0.5 : -Infinity, entry.sentAt] };
  });
  return { settled, pending: keyed.sort((left, right) => compareKeys(left.key, right.key)).map(({ line }) => line) };
}

type OrderKey = readonly [queuePosition: number, sentAt: number];

/**
 * Which of this browser's messages the queue stopped listing keep their place before the next one
 * it lists: one being taken back. Any other was taken by the agent ahead of everything listed. A row
 * of this browser is one it drew, with the time it was written; a row drawn for another device's
 * queued message has none.
 */
const KEEPS_PLACE_UNLISTED: Readonly<Record<MessageDeliveryState, boolean>> = { queued: false, received: false, sending: false, takingBack: true, delivered: false };

/** Whether a message in this state is still waiting for the agent: only a message it took is not. */
const WAITING: Readonly<Record<MessageDeliveryState, boolean>> = { queued: true, received: true, sending: true, takingBack: true, delivered: false };

function waiting(line: ChatLine): boolean {
  const state = line.meta?.delivery?.state;
  return state !== undefined && WAITING[state];
}

function compareKeys(left: OrderKey, right: OrderKey): number {
  return compareNumbers(left[0], right[0]) || compareNumbers(left[1], right[1]);
}

function compareNumbers(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
