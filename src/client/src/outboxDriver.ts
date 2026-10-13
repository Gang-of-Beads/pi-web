/**
 * One outbox's driver, as a state machine (docs/design/message-states.md, "Operations").
 *
 * The outbox is this browser's unanswered operations on one session. The driver sends them as a
 * batch, and the next batch only once the machine has answered the last. A batch nobody answered
 * is sent again after a wait that grows from 1 s to 15 s, and at once whenever something says the
 * link may be back (a new operation, `online`, the page coming into view).
 *
 *   idle     nothing in flight and nothing waiting: the outbox is empty
 *   sending  a batch is in flight
 *   waiting  the batch went unanswered; it is sent again when the wait ends or on a kick
 *
 * Every state answers every event, so an event the driver does not expect in a state is a row of
 * the table, not a fall-through. Pure: the engine performs the effect each move names.
 */
export type DriverState = "idle" | "sending" | "waiting";

/**
 * `kick`: something was written, or the link may be back. `answered`, `unanswered`: what the
 * batch came to. `elapsed`: the wait ended. `drained`: the outbox is empty.
 */
export type DriverEvent = "kick" | "answered" | "unanswered" | "elapsed" | "drained";

/** What the engine does on a move: send a batch now, wait and then resend it, or nothing. */
export type DriverEffect = "sendHead" | "wait" | "none";

/** How the resend wait changes: back to the start, one step longer, or as it is. */
export type DelayChange = "reset" | "grow" | "keep";

export interface DriverMove {
  readonly to: DriverState;
  readonly effect: DriverEffect;
  readonly delay: DelayChange;
}

const SEND_NOW: DriverMove = { to: "sending", effect: "sendHead", delay: "reset" };
const RESEND: DriverMove = { to: "sending", effect: "sendHead", delay: "keep" };
const BACK_OFF: DriverMove = { to: "waiting", effect: "wait", delay: "grow" };
const STOP: DriverMove = { to: "idle", effect: "none", delay: "reset" };
const stay = (state: DriverState): DriverMove => ({ to: state, effect: "none", delay: "keep" });

const TABLE: Readonly<Record<DriverState, Readonly<Record<DriverEvent, DriverMove>>>> = {
  idle: {
    kick: SEND_NOW,
    answered: stay("idle"),
    unanswered: stay("idle"),
    elapsed: stay("idle"),
    drained: STOP,
  },
  sending: {
    kick: stay("sending"),
    answered: SEND_NOW,
    unanswered: BACK_OFF,
    elapsed: stay("sending"),
    drained: STOP,
  },
  waiting: {
    kick: SEND_NOW,
    answered: stay("waiting"),
    unanswered: stay("waiting"),
    elapsed: RESEND,
    drained: STOP,
  },
};

export function driverMove(state: DriverState, event: DriverEvent): DriverMove {
  return TABLE[state][event];
}

const FIRST_WAIT_MS = 1_000;
/** The same longest wait as every read that went unanswered (QUIET_WINDOW_MS): a link that came back is used within it. */
const LONGEST_WAIT_MS = 15_000;

const DELAY_AFTER: Readonly<Record<DelayChange, (previous: number) => number>> = {
  reset: () => 0,
  grow: (previous) => Math.min(Math.max(previous * 2, FIRST_WAIT_MS), LONGEST_WAIT_MS),
  keep: (previous) => previous,
};

/** The resend wait after a move: 1 s, doubling to 15 s, from nothing after an answer or a kick. */
export function delayAfter(change: DelayChange, previous: number): number {
  return DELAY_AFTER[change](previous);
}
