/**
 * One outgoing message, one owner scope, one state.
 *
 * The cross-session leak had a simple shape: the send captured the right key, then wrote
 * the answer into whatever the editor happened to be showing. A record that carries its
 * own scope cannot do that, and a transition table makes every event's effect explicit
 * instead of leaving it to a chain of booleans in a renderer.
 *
 * Pure. The store, the transport and the clock are outside.
 */

export type OutgoingState = "stored" | "sending" | "accepted" | "delivered" | "unverified" | "failed";

/**
 * Every event that can reach a record.
 *
 * `send-*` come from the transport answer, `daemon-*` from the session status (proof the
 * daemon owns it), `seen-in-transcript` from the transcript itself (the strongest proof),
 * `retry`/`discard` from the reader, `scope-gone` from the session list.
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
  stored: {
    "send-started": move("sending"),
    "send-accepted": IGNORE,
    "send-refused-network": move("failed"),
    "send-refused-permanent": move("failed"),
    "send-timeout": IGNORE,
    "daemon-queued": move("accepted"),
    "daemon-delivered": move("delivered"),
    "seen-in-transcript": move("delivered"),
    retry: IGNORE,
    discard: DROP,
    "scope-gone": DROP,
  },
  sending: {
    "send-started": IGNORE,
    "send-accepted": move("accepted"),
    "send-refused-network": move("failed"),
    "send-refused-permanent": move("failed"),
    "send-timeout": move("unverified"),
    "daemon-queued": move("accepted"),
    "daemon-delivered": move("delivered"),
    "seen-in-transcript": move("delivered"),
    retry: IGNORE,
    discard: DROP,
    "scope-gone": DROP,
  },
  accepted: {
    "send-started": IGNORE,
    "send-accepted": IGNORE,
    "send-refused-network": IGNORE,
    "send-refused-permanent": IGNORE,
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
  unverified: {
    "send-started": IGNORE,
    "send-accepted": move("accepted"),
    "send-refused-network": IGNORE,
    "send-refused-permanent": IGNORE,
    "send-timeout": IGNORE,
    "daemon-queued": move("accepted"),
    "daemon-delivered": move("delivered"),
    "seen-in-transcript": move("delivered"),
    retry: move("sending"),
    discard: DROP,
    "scope-gone": DROP,
  },
  failed: {
    "send-started": IGNORE,
    "send-accepted": move("delivered"),
    "send-refused-network": STAY,
    "send-refused-permanent": STAY,
    "send-timeout": IGNORE,
    "daemon-queued": move("accepted"),
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

export const OUTGOING_STATES: OutgoingState[] = ["stored", "sending", "accepted", "delivered", "unverified", "failed"];

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
