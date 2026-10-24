import type { MessageDeliveryState } from "./components/shared";

/**
 * The words for a sent message's state, in one table every surface reads
 * (docs/design/message-states.md, "Words"). A message on its way reads "Sending…" once the machine
 * has not answered within the grace; nothing reads "Not sent" or "Not received" and nothing offers
 * Retry or Discard. The one thing a reader does to a message that has not reached the agent is take
 * it back.
 */
export type DeliveryWordKey = "sending" | "takingBack" | "queued";

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
  queued: { glyph: "single", text: "Queued", label: "Queued - the machine holds this message and the agent takes it after the current reply", tone: "received", takeBack: true },
};

export function deliveryWords(key: DeliveryWordKey): DeliveryWords {
  return WORDS[key];
}

/**
 * How long a message the machine has not answered yet is drawn as if it had (owner, 2026-10-23,
 * Q1): long enough for a phone's round trip, short enough that a message stuck on a slow or broken
 * link says so. Every surface that holds back "Sending…" waits this long, counted from when this
 * device wrote the message, so a reload does not restart it.
 */
export const DELIVERY_GRACE_MS = 1_500;

/** What one sent message's mark is decided from (docs/design/message-states.md, "The sync overlay"). */
export interface DeliveryMarkFacts {
  readonly state: MessageDeliveryState;
  /** When this device wrote the message, in epoch milliseconds; NaN when unknown. */
  readonly writtenAt: number;
  readonly now: number;
  /** The session streams, stops or compacts, so a message that reaches it now waits after the reply. */
  readonly working: boolean;
}

/** Whether the machine's answer is still inside the grace: an unknown write time is past it. */
function withinGrace(facts: DeliveryMarkFacts): boolean {
  return facts.now - facts.writtenAt < DELIVERY_GRACE_MS;
}

/**
 * The mark each state wears. A message the machine has not answered is drawn as what the reader
 * expects it to become - said, or waiting behind a working session - until the grace runs out. One
 * the machine holds while the session is idle is said: it starts the next run, so it wears nothing.
 */
const MARK_FOR_STATE: Readonly<Record<MessageDeliveryState, (facts: DeliveryMarkFacts) => DeliveryWordKey | undefined>> = {
  sending: (facts) => {
    if (!withinGrace(facts)) return "sending";
    return facts.working ? "queued" : undefined;
  },
  takingBack: () => "takingBack",
  received: () => undefined,
  queued: (facts) => (facts.working ? "queued" : undefined),
  delivered: () => undefined,
};

/** The words a sent message wears now; none when it reads as an ordinary message. */
export function deliveryMark(facts: DeliveryMarkFacts): DeliveryWordKey | undefined {
  return MARK_FOR_STATE[facts.state](facts);
}

/** When a message on its way stops being drawn as answered, or undefined when no grace runs for it. */
export function deliveryGraceEndsAt(state: MessageDeliveryState, writtenAt: number, now: number): number | undefined {
  const endsAt = writtenAt + DELIVERY_GRACE_MS;
  return state === "sending" && endsAt > now ? endsAt : undefined;
}

/** Which states the reader may take back: every one the agent has not got and no take-back already asks about, drawn with a mark or not. */
const TAKES_BACK: Readonly<Record<MessageDeliveryState, boolean>> = { sending: true, takingBack: false, received: true, queued: true, delivered: false };

export function deliveryTakesBack(state: MessageDeliveryState): boolean {
  return TAKES_BACK[state];
}
