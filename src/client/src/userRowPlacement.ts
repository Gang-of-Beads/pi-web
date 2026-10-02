import type { QueuedSessionMessage } from "./api";
import type { ChatLine, MessageDeliveryState } from "./components/shared";
import { queuedIdentity, type UserMessageRow } from "./userMessageRegister";

/**
 * Where each user row is drawn: placement is a function of the message's
 * state (B2, state-diagram D1 "Row placement is a function of state").
 *
 * A message the daemon still listed as queued left its transcript slot for the
 * pending block below every settled row, while a later message whose send
 * could not be verified kept its slot above it, so an earlier message was drawn
 * below a later one. Now every message the agent has not taken is in the
 * pending block: what the daemon lists first, in the daemon's order, then what
 * it accepted but does not list, then what is being sent, could not be verified
 * or was not sent, each by its send time. Only a message the agent took stays
 * where the transcript has it.
 */
export function placeUserRows(rows: readonly UserMessageRow[], queued: readonly QueuedSessionMessage[]): { settled: ChatLine[]; pending: ChatLine[] } {
  const queuePositions = new Map(queued.map((message, position) => [queuedIdentity(message, position), position]));
  const settled: ChatLine[] = [];
  const pending: { line: ChatLine; key: readonly number[] }[] = [];
  for (const row of rows) {
    const position = queuePositions.get(row.identity);
    const rank = position === undefined ? waitingRank(row.line) : WAITING_RANK.queued;
    if (rank === undefined) {
      settled.push(row.line);
      continue;
    }
    const sentAt = Date.parse(row.line.meta?.timestamp ?? "");
    pending.push({ line: row.line, key: [rank, position ?? Infinity, Number.isFinite(sentAt) ? sentAt : Infinity] });
  }
  return { settled, pending: pending.sort((left, right) => compareKeys(left.key, right.key)).map(({ line }) => line) };
}

/** The pending block's order between states: what the daemon holds, then what it accepted, then the rest. */
const WAITING_RANK: Readonly<Record<Exclude<MessageDeliveryState, "delivered">, number>> = { queued: 0, received: 1, sending: 2, unverifiable: 2, failed: 2 };

function waitingRank(line: ChatLine): number | undefined {
  const state = line.meta?.delivery?.state;
  return state === undefined || state === "delivered" ? undefined : WAITING_RANK[state];
}

function compareKeys(left: readonly number[], right: readonly number[]): number {
  for (const [index, value] of left.entries()) {
    const other = right[index] ?? 0;
    if (value !== other) return value < other ? -1 : 1;
  }
  return 0;
}
