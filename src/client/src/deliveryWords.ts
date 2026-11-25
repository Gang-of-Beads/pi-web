import type { MessageDelivery, MessageDeliveryState } from "./components/shared";

/**
 * The words for a sent message's state, in one table every surface reads
 * (docs/design/message-states.md, "Words"). A message the machine has not answered within the grace
 * reads "Not confirmed yet": it is still being tried, and only a machine that says no makes it
 * "Not sent". Nothing reads "Not received" and nothing offers Retry or Discard. The one thing a reader does to a message that has not reached the agent is take
 * it back.
 */
export type DeliveryWordKey = "sending" | "unconfirmed" | "takingBack" | "queued";

export interface DeliveryWords {
  readonly glyph: "pending" | "single";
  readonly text: string;
  readonly label: string;
  readonly tone: "pending" | "received";
}

const WORDS: Readonly<Record<DeliveryWordKey, DeliveryWords>> = {
  sending: { glyph: "pending", text: "Sending…", label: "Sending… - on its way to the machine", tone: "pending" },
  unconfirmed: { glyph: "pending", text: "Not confirmed yet", label: "Not confirmed yet - the machine has not answered; still trying until it has the message", tone: "pending" },
  takingBack: { glyph: "pending", text: "Taking back…", label: "Taking back… - waiting for the machine to confirm", tone: "pending" },
  queued: { glyph: "single", text: "Queued", label: "Queued - the machine holds this message and the agent takes it after the current reply", tone: "received" },
};

export function deliveryWords(key: DeliveryWordKey): DeliveryWords {
  return WORDS[key];
}

/**
 * How long a message the machine has not answered yet is drawn as if it had (owner, 2026-11-24:
 * ten seconds, up from 1.5): long enough for a slow phone link's round trip and a reconnect, so the
 * mark does not flicker on every send, and short enough that a message stuck on a broken link says so. Every surface that holds back "Sending…" waits this long, counted from when this
 * device wrote the message, so a reload does not restart it.
 */
export const DELIVERY_GRACE_MS = 10_000;

/** What one sent message's mark is decided from (docs/design/message-states.md, "The sync overlay"). */
export interface DeliveryMarkFacts {
  readonly state: MessageDeliveryState;
  /** When this device wrote the message, in epoch milliseconds; NaN when unknown. */
  readonly writtenAt: number;
  readonly now: number;
  /** The session streams, stops or compacts, so a message that reaches it now waits after the reply. */
  readonly working: boolean;
  /** A `!` command's line: it runs at once and never waits behind a reply (owner, 2026-10-23, Q5). */
  readonly shell: boolean;
}

/** Whether the machine's answer is still inside the grace: an unknown write time is past it. */
function withinGrace(facts: DeliveryMarkFacts): boolean {
  return facts.now - facts.writtenAt < DELIVERY_GRACE_MS;
}

/**
 * The mark each state wears. A message the machine has not answered is drawn as what the reader
 * expects it to become - said, or waiting behind a working session - until the grace runs out. One
 * the machine holds while the session is idle is said: it starts the next run, so it wears nothing.
 * A `!` command keeps its own row: "Sending…" from the first frame, never waiting behind a reply.
 */
const MARK_FOR_STATE: Readonly<Record<MessageDeliveryState, (facts: DeliveryMarkFacts) => DeliveryWordKey | undefined>> = {
  sending: (facts) => {
    if (facts.shell) return facts.now - facts.writtenAt >= DELIVERY_GRACE_MS ? "unconfirmed" : "sending";
    if (!withinGrace(facts)) return "unconfirmed";
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
export function deliveryGraceEndsAt(delivery: Pick<MessageDelivery, "state">, writtenAt: number, now: number): number | undefined {
  const endsAt = writtenAt + DELIVERY_GRACE_MS;
  return delivery.state === "sending" && endsAt > now ? endsAt : undefined;
}

/** Which states the reader may take back: every one the agent has not got and no take-back already asks about, drawn with a mark or not. */
const TAKES_BACK: Readonly<Record<MessageDeliveryState, boolean>> = { sending: true, takingBack: false, received: true, queued: true, delivered: false };

export function deliveryTakesBack(state: MessageDeliveryState): boolean {
  return TAKES_BACK[state];
}
