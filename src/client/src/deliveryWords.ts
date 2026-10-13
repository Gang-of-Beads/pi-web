import type { MessageDeliveryState } from "./components/shared";

/**
 * The words for a sent message's state, in one table every surface reads
 * (docs/design/message-states.md, "Words"). A message on its way reads "Sending…" for as long as
 * it takes; nothing reads "Not sent" or "Not received" and nothing offers Retry or Discard. The
 * one thing a reader does to a message that has not reached the agent is take it back.
 */
export type DeliveryWordKey = "sending" | "takingBack" | "received" | "queued";

export interface DeliveryWords {
  readonly glyph: "pending" | "single";
  readonly text: string;
  readonly label: string;
  readonly tone: "pending" | "received";
  /** Whether the reader may take it back from here. */
  readonly takeBack: boolean;
}

const WORDS: Readonly<Record<DeliveryWordKey, DeliveryWords>> = {
  sending: { glyph: "pending", text: "Sending…", label: "Sending… - on its way to the machine; it keeps trying until the machine has it", tone: "pending", takeBack: true },
  takingBack: { glyph: "pending", text: "Taking back…", label: "Taking back… - waiting for the machine to confirm", tone: "pending", takeBack: false },
  received: { glyph: "single", text: "Received", label: "Received - the machine has this message", tone: "received", takeBack: false },
  queued: { glyph: "single", text: "Queued", label: "Queued - the machine holds this message and the agent takes it next", tone: "received", takeBack: true },
};

const KEY_FOR_STATE: Readonly<Record<MessageDeliveryState, DeliveryWordKey | undefined>> = {
  sending: "sending",
  takingBack: "takingBack",
  received: "received",
  queued: "queued",
  delivered: undefined,
};

/** The key for one state; a delivered message has no words. */
export function deliveryWordKey(state: MessageDeliveryState): DeliveryWordKey | undefined {
  return KEY_FOR_STATE[state];
}

export function deliveryWords(key: DeliveryWordKey): DeliveryWords {
  return WORDS[key];
}
