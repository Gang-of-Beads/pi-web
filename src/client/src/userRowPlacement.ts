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
 * pending block: what the daemon lists first, in the daemon's order, then every
 * other one (accepted but no longer listed, being sent, unverifiable, not sent)
 * by its send time. Only a message the agent took stays where the transcript
 * has it.
 */
export function placeUserRows(rows: readonly UserMessageRow[]): { settled: ChatLine[]; pending: ChatLine[] } {
  const settled: ChatLine[] = [];
  const pending: { line: ChatLine; key: OrderKey }[] = [];
  for (const row of rows) {
    if (row.queuePosition === undefined && !waiting(row.line)) {
      settled.push(row.line);
      continue;
    }
    const sentAt = Date.parse(row.line.meta?.timestamp ?? "");
    pending.push({ line: row.line, key: [row.queuePosition ?? Infinity, Number.isFinite(sentAt) ? sentAt : Infinity] });
  }
  return { settled, pending: pending.sort((left, right) => compareKeys(left.key, right.key)).map(({ line }) => line) };
}

type OrderKey = readonly [queuePosition: number, sentAt: number];

/** Whether a message in this state is still waiting for the agent: only a message it took is not. */
const WAITING: Readonly<Record<MessageDeliveryState, boolean>> = { queued: true, received: true, sending: true, unverifiable: true, failed: true, delivered: false };

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
