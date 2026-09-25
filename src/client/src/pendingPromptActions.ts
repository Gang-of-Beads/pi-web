/**
 * What a prompt that has not landed offers the reader.
 *
 * The state used to come from the composer's own `sending` flag, which is
 * global: with one send in flight and another that had failed, the flag decided
 * for both, so an unsent row could read "Sending" and a message still on its
 * way could offer "Retry" - two states that cannot coexist. It is per message
 * now, and the actions follow from the state alone.
 *
 * The states are exhaustive and exclusive: a row is either still on its way or
 * it stopped. A message the daemon has confirmed leaves the outbox entirely, so
 * "confirmed" is never a row - which is what the reader meant by "已经确认开始
 * 处理的消息，还怎么还可能有 retry/discard".
 */
export type PendingPromptState = "in-flight" | "unsent";

export interface PendingPromptActions {
  state: PendingPromptState;
  label: string;
  /** Retry belongs to a send that stopped; one on its way cannot be re-sent. */
  retry: boolean;
  /** Discard is always available: it drops the local record, retried or not. */
  discard: true;
}

export function pendingPromptActions(state: PendingPromptState): PendingPromptActions {
  if (state === "in-flight") return { state, label: "Sending", retry: false, discard: true };
  return { state, label: "Unsent", retry: true, discard: true };
}
