/**
 * The composer's outbox driver, as a state machine (docs/design/message-states.md, "Order").
 *
 * The outbox is this device's log of unanswered operations on one session. The driver sends its
 * head, and only its head: until the machine answers it, nothing behind it goes. A head nobody
 * answered is sent again after a wait that grows from 1 s to 30 s, and at once whenever something
 * says the link may be back (a new message, `online`, the session opening).
 *
 *   idle     nothing in flight and nothing waiting: the outbox is empty or off the page
 *   sending  the head is in flight
 *   waiting  the head went unanswered; it is sent again when the wait ends or on a kick
 *
 * Every state answers every event, so an event the driver does not expect in a state is a row of
 * the table, not a fall-through. Pure: the composer performs the effect each move names.
 */
export type DriverState = "idle" | "sending" | "waiting";

/**
 * `kick`: something was written, or the link may be back. `answered`, `unanswered`: what the
 * attempt at the head came to. `moved`: the head belongs to a session the composer no longer
 * shows, and the composer now shows another, whose head goes next. `stalled`: the head belongs to
 * a session that is not the selected one, and the composer still shows it. `elapsed`: the wait
 * ended. `drained`: there is no head - the outbox is empty, or the composer left the page.
 */
export type DriverEvent = "kick" | "answered" | "unanswered" | "moved" | "stalled" | "elapsed" | "drained";

/** What the composer does on a move: send the head now, wait and then resend it, or nothing. */
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
    moved: stay("idle"),
    stalled: stay("idle"),
    elapsed: stay("idle"),
    drained: STOP,
  },
  sending: {
    kick: stay("sending"),
    answered: SEND_NOW,
    unanswered: BACK_OFF,
    moved: SEND_NOW,
    stalled: BACK_OFF,
    elapsed: stay("sending"),
    drained: STOP,
  },
  waiting: {
    kick: SEND_NOW,
    answered: stay("waiting"),
    unanswered: stay("waiting"),
    moved: SEND_NOW,
    stalled: stay("waiting"),
    elapsed: RESEND,
    drained: STOP,
  },
};

export function driverMove(state: DriverState, event: DriverEvent): DriverMove {
  return TABLE[state][event];
}

const FIRST_WAIT_MS = 1_000;
const LONGEST_WAIT_MS = 30_000;

const DELAY_AFTER: Readonly<Record<DelayChange, (previous: number) => number>> = {
  reset: () => 0,
  grow: (previous) => Math.min(Math.max(previous * 2, FIRST_WAIT_MS), LONGEST_WAIT_MS),
  keep: (previous) => previous,
};

/** The resend wait after a move: 1 s, doubling to 30 s, from nothing after an answer or a kick. */
export function delayAfter(change: DelayChange, previous: number): number {
  return DELAY_AFTER[change](previous);
}

/** What one attempt at the head came to, as the driver event it raises. */
export type AttemptOutcome = "answered" | "unanswered" | "elsewhere";

/** Where the composer is after an attempt for another session: still on that session, or moved on. */
export type ComposerPlace = "same" | "moved";

const ATTEMPT_EVENT: Readonly<Record<AttemptOutcome, Readonly<Record<ComposerPlace, DriverEvent>>>> = {
  answered: { same: "answered", moved: "answered" },
  unanswered: { same: "unanswered", moved: "unanswered" },
  elsewhere: { same: "stalled", moved: "moved" },
};

export function attemptEvent(outcome: AttemptOutcome, place: ComposerPlace): DriverEvent {
  return ATTEMPT_EVENT[outcome][place];
}
