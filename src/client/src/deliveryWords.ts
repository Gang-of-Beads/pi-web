import type { MessageDeliveryState } from "./components/shared";

/**
 * The words for a sent message's state, in one table every surface reads.
 *
 * The bubble, the composer tray and the command bubble each kept their own wording, so one
 * message read "No answer yet" on its bubble and "Unsent" in the tray, and a confirmation
 * that was not a queue read "Queued". The owner fixed the words (2026-09-29 and 2026-09-30):
 * Sending… / Receiving… / Received / Queued / Not sent / Not received, and no "Read" - once
 * the agent takes a message it is an ordinary input message and carries no mark.
 */

/**
 * Why a message failed. `not-sent`: it never became part of the conversation - the bytes never
 * left, or the runtime refused it. `not-received`: the daemon has no record of it.
 */
export type DeliveryFailureCause = "not-sent" | "not-received";

export type DeliveryWordKey = "sending" | "unverifiable" | "received" | "queued" | DeliveryFailureCause;

export interface DeliveryWords {
  readonly glyph: "pending" | "failed" | "single" | "double";
  readonly text: string;
  readonly label: string;
  readonly tone: "pending" | "received" | "delivered" | "failed";
  /** Whether the reader may send it again under the same identity. */
  readonly retry: boolean;
  /** Whether the reader may take it back; only once nothing can still land it. */
  readonly discard: boolean;
}

const WORDS: Readonly<Record<DeliveryWordKey, DeliveryWords>> = {
  sending: { glyph: "pending", text: "Sending…", label: "Sending…", tone: "pending", retry: false, discard: false },
  unverifiable: {
    glyph: "pending",
    text: "Receiving…",
    label: "Receiving… - sent, and the server has not confirmed it yet; still checking",
    tone: "pending",
    retry: true,
    discard: true,
  },
  received: { glyph: "single", text: "Received", label: "Received - the server has this message", tone: "received", retry: false, discard: false },
  queued: { glyph: "single", text: "Queued", label: "Queued - the server holds this message and the agent takes it next", tone: "received", retry: false, discard: false },
  "not-sent": { glyph: "failed", text: "Not sent", label: "Not sent - this message did not reach the conversation", tone: "failed", retry: true, discard: true },
  "not-received": { glyph: "failed", text: "Not received", label: "Not received - the server has no record of this message", tone: "failed", retry: true, discard: true },
};

const KEY_FOR_STATE: Readonly<Record<Exclude<MessageDeliveryState, "failed">, DeliveryWordKey | undefined>> = {
  sending: "sending",
  unverifiable: "unverifiable",
  received: "received",
  queued: "queued",
  delivered: undefined,
};

/**
 * The key for one state. A failure without a recorded cause reads "Not received": that is what
 * the daemon's own verdicts said before causes were recorded. A delivered message has no words.
 */
export function deliveryWordKey(state: MessageDeliveryState, cause?: DeliveryFailureCause): DeliveryWordKey | undefined {
  if (state === "failed") return cause ?? "not-received";
  return KEY_FOR_STATE[state];
}

export function deliveryWords(key: DeliveryWordKey): DeliveryWords {
  return WORDS[key];
}
