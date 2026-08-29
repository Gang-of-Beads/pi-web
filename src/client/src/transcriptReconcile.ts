import type { ChatLine } from "./components/shared";
import { deliveryWaiting } from "./messageDelivery";
import { indexOfIdentity, messageIdentity } from "./messageIdentity";

/**
 * A transcript rebuilt from disk contains only what reached the disk. A send
 * still waiting for its confirmation is not there yet, and dropping it showed
 * the sender their message vanishing with no failure anywhere. Waiting cards
 * ride across the rebuild; everything settled answers to the disk alone.
 */
export function carryUnsettledForward(previous: readonly ChatLine[], rebuilt: ChatLine[]): ChatLine[] {
  const missing = previous.filter((line) => {
    const state = line.meta?.delivery?.state;
    if (state === undefined || !deliveryWaiting(state)) return false;
    const identity = messageIdentity(line);
    return identity === undefined || indexOfIdentity(rebuilt, identity) === -1;
  });
  return missing.length === 0 ? rebuilt : [...rebuilt, ...missing];
}

/** Whether any line is still waiting on a confirmation the pushes may have dropped. */
export function hasWaitingDelivery(messages: readonly ChatLine[]): boolean {
  return messages.some((line) => {
    const state = line.meta?.delivery?.state;
    return state !== undefined && deliveryWaiting(state);
  });
}
