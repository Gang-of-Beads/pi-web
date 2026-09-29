import { deliveryWords, type DeliveryFailureCause, type DeliveryWordKey } from "./deliveryWords";

/**
 * What a message in the composer tray offers the reader.
 *
 * The state used to come from the composer's own `sending` flag, which is
 * global: with one send in flight and another that had failed, the flag decided
 * for both, so an unsent row could read "Sending" and a message still on its
 * way could offer "Retry" - two states that cannot coexist. It is per message
 * now, and the words and actions come from the one table the bubble reads, so
 * the tray and the bubble cannot name one message differently.
 *
 * A message the daemon has confirmed is never a tray row - which is what the
 * reader meant by "已经确认开始处理的消息，还怎么还可能有 retry/discard".
 */
export type PendingPromptState = Extract<DeliveryWordKey, "sending" | "unverifiable" | "not-sent" | "not-received">;

export interface PendingPromptActions {
  state: PendingPromptState;
  label: string;
  /** Retry belongs to a send that stopped; one on its way cannot be re-sent. */
  retry: boolean;
  /**
   * Discard only once the send has stopped: a local delete cannot stop a request in flight,
   * so offering it there would claim an outcome the request can overturn.
   */
  discard: boolean;
}

/**
 * Which words a tray record reads. A record whose send is on its way is sending; one that failed
 * reads its cause (a record failed without one never left: the outbox fails a record only on a
 * refusal or a link that was down); any other stopped record went and was never confirmed.
 */
export function trayState(record: { state?: string | undefined; failure?: DeliveryFailureCause | undefined }, inFlight: boolean): PendingPromptState {
  if (inFlight) return "sending";
  if (record.state === "failed") return record.failure ?? "not-sent";
  return "unverifiable";
}

export function pendingPromptActions(state: PendingPromptState): PendingPromptActions {
  const words = deliveryWords(state);
  return { state, label: words.text, retry: words.retry, discard: words.discard };
}
