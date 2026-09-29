import type { MessageDeliveryState } from "./components/shared";

/**
 * One outgoing message, one owner scope, one state.
 *
 * The cross-session leak had a simple shape: the send captured the right key, then wrote
 * the answer into whatever the editor happened to be showing. A record that carries its
 * own scope cannot do that, and a transition table makes every event's effect explicit
 * instead of leaving it to a chain of booleans in a renderer.
 *
 * The record's states are the bubble's states (phase 5): the outbox used to say `stored`,
 * `accepted` and `unverified` for facts the bubble called `sending`, `received`/`queued` and
 * `unverifiable`, and nothing forced the two together.
 *
 * Pure. The store, the transport and the clock are outside.
 */

export type OutgoingState = MessageDeliveryState;

/**
 * Every event that can reach a record.
 *
 * `send-*` come from the transport answer, `daemon-*` from the session status (proof the
 * daemon owns it), `seen-in-transcript` from the transcript itself (the strongest proof),
 * `retry`/`discard` from the reader, `scope-gone` from the session list. A refusal by the
 * runtime after the inbox took the message arrives as `send-refused-permanent`.
 */
export type OutgoingEvent =
  | "send-started"
  | "send-accepted"
  | "send-refused-network"
  | "send-refused-permanent"
  | "send-timeout"
  | "daemon-queued"
  | "daemon-delivered"
  | "seen-in-transcript"
  | "retry"
  | "discard"
  | "scope-gone";

export type OutgoingVerdict =
  | { kind: "stay" }
  | { kind: "move"; to: OutgoingState }
  | { kind: "drop" }
  | { kind: "ignore" };

const move = (to: OutgoingState): OutgoingVerdict => ({ kind: "move", to });
const STAY: OutgoingVerdict = { kind: "stay" };
const DROP: OutgoingVerdict = { kind: "drop" };
const IGNORE: OutgoingVerdict = { kind: "ignore" };

/**
 * The whole table, state by state, so a new state or event is a compile error until it is
 * answered rather than a silent fallthrough.
 */
const TABLE: Record<OutgoingState, Record<OutgoingEvent, OutgoingVerdict>> = {
  sending: {
    "send-started": STAY,
    "send-accepted": move("received"),
    "send-refused-network": move("failed"),
    "send-refused-permanent": move("failed"),
    "send-timeout": move("unverifiable"),
    "daemon-queued": move("queued"),
    "daemon-delivered": move("delivered"),
    "seen-in-transcript": move("delivered"),
    retry: IGNORE,
    discard: DROP,
    "scope-gone": DROP,
  },
  received: {
    "send-started": IGNORE,
    "send-accepted": IGNORE,
    "send-refused-network": IGNORE,
    "send-refused-permanent": move("failed"),
    "send-timeout": IGNORE,
    "daemon-queued": move("queued"),
    "daemon-delivered": move("delivered"),
    "seen-in-transcript": move("delivered"),
    retry: IGNORE,
    discard: DROP,
    "scope-gone": DROP,
  },
  queued: {
    "send-started": IGNORE,
    "send-accepted": IGNORE,
    "send-refused-network": IGNORE,
    "send-refused-permanent": move("failed"),
    "send-timeout": IGNORE,
    "daemon-queued": STAY,
    "daemon-delivered": move("delivered"),
    "seen-in-transcript": move("delivered"),
    retry: IGNORE,
    discard: DROP,
    "scope-gone": DROP,
  },
  delivered: {
    "send-started": IGNORE,
    "send-accepted": IGNORE,
    "send-refused-network": IGNORE,
    "send-refused-permanent": IGNORE,
    "send-timeout": IGNORE,
    "daemon-queued": STAY,
    "daemon-delivered": STAY,
    "seen-in-transcript": STAY,
    retry: IGNORE,
    discard: DROP,
    "scope-gone": DROP,
  },
  unverifiable: {
    "send-started": IGNORE,
    "send-accepted": move("received"),
    "send-refused-network": IGNORE,
    "send-refused-permanent": IGNORE,
    "send-timeout": IGNORE,
    "daemon-queued": move("queued"),
    "daemon-delivered": move("delivered"),
    "seen-in-transcript": move("delivered"),
    retry: move("sending"),
    discard: DROP,
    "scope-gone": DROP,
  },
  failed: {
    "send-started": IGNORE,
    "send-accepted": move("received"),
    "send-refused-network": STAY,
    "send-refused-permanent": STAY,
    "send-timeout": IGNORE,
    "daemon-queued": move("queued"),
    "daemon-delivered": move("delivered"),
    "seen-in-transcript": move("delivered"),
    retry: move("sending"),
    discard: DROP,
    "scope-gone": DROP,
  },
};

export function outgoingVerdict(state: OutgoingState, event: OutgoingEvent): OutgoingVerdict {
  return TABLE[state][event];
}

/** Whether a value read back from storage is a state this table answers for. */
export function isOutgoingState(value: unknown): value is OutgoingState {
  return typeof value === "string" && Object.hasOwn(TABLE, value);
}

/**
 * The names earlier builds wrote to storage, read as the state each one meant. A record written
 * before phase 5 must keep its meaning: an `unverified` record read as freshly stored lost the
 * session list's mark and offered its message as if it had never been sent.
 */
const EARLIER_NAMES: Readonly<Record<string, OutgoingState>> = {
  stored: "sending",
  accepted: "received",
  unverified: "unverifiable",
};

/** The state a stored value names, in this build's words; undefined when it names none. */
export function outgoingStateFromStorage(value: unknown): OutgoingState | undefined {
  if (isOutgoingState(value)) return value;
  return typeof value === "string" && Object.hasOwn(EARLIER_NAMES, value) ? EARLIER_NAMES[value] : undefined;
}

export const OUTGOING_STATES: OutgoingState[] = ["sending", "received", "queued", "delivered", "failed", "unverifiable"];

export const OUTGOING_EVENTS: OutgoingEvent[] = [
  "send-started",
  "send-accepted",
  "send-refused-network",
  "send-refused-permanent",
  "send-timeout",
  "daemon-queued",
  "daemon-delivered",
  "seen-in-transcript",
  "retry",
  "discard",
  "scope-gone",
];
