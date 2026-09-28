/**
 * One owner for "where is the reader, and which page do we owe them".
 *
 * `chat.scrollTop` had ten writers and each decided for itself, so they overwrote one
 * another: a page prepend's settle raced the bottom hold, an older page was fetched while
 * the reader was pinned at the bottom with nothing above them changed, and a newer page
 * was fetched from a render rather than from a scroll.
 *
 * The policy is the owner's, verbatim: where the session was closed decides where it
 * opens; only an upward scroll asks for history; the jump-to-bottom control jumps to the
 * newest instead of walking there.
 *
 * Pure: one input, one decision. The DOM, the fetching and the persistence stay outside,
 * and callers are dumb executors of the action they are handed.
 */
import { isNearTop } from "../chatHistoryLoading.js";

export interface ViewportMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export type SavedOpen = "bottom" | "anchor" | "absent";

export type PageWant = "older" | "newer" | "newest";

export type ViewportEvent =
  | { kind: "opened"; saved: SavedOpen }
  | { kind: "scrolled"; direction: "up" | "down" | "none"; metrics: ViewportMetrics }
  | { kind: "grew"; aboveChanged: boolean; gesture: boolean }
  | { kind: "jumpNewest" }
  | { kind: "pageArrived"; want: PageWant }
  | { kind: "pageFailed" }
  | { kind: "anchorMissing"; following: boolean };

export interface ViewportWindow {
  hasOlder: boolean;
  hasNewer: boolean;
  loading: boolean;
}

export type ViewportState =
  | { kind: "unknown" }
  | { kind: "restoring" }
  | { kind: "following" }
  | { kind: "holding" }
  | { kind: "awaitingPage"; want: PageWant; resume: ViewportState };

export type ViewportAction =
  | "idle"
  | "snap-bottom"
  | "hold-bottom"
  | "hold-reading-anchor"
  | "restore-anchor"
  | "load-older"
  | "load-newest-page"
  | "load-newer-page"
  | "stop-following";

export interface ViewportDecision {
  action: ViewportAction;
  next: ViewportState;
}

export interface ViewportInput {
  state: ViewportState;
  event: ViewportEvent;
  window: ViewportWindow;
  measured: boolean;
  fillsViewport: boolean;
}

export const FOLLOW_START: ViewportState = { kind: "following" };

const NEAR_TOP = 600;

const idle = (state: ViewportState): ViewportDecision => ({ action: "idle", next: state });
const decide = (action: ViewportAction, next: ViewportState): ViewportDecision => ({ action, next });

const canLoad = (input: ViewportInput, want: PageWant): boolean =>
  !input.window.loading && (want === "older" ? input.window.hasOlder : input.window.hasNewer);

const load = (input: ViewportInput, want: PageWant, resume: ViewportState): ViewportDecision =>
  decide(want === "older" ? "load-older" : want === "newer" ? "load-newer-page" : "load-newest-page", {
    kind: "awaitingPage",
    want,
    resume,
  });

const wantOf = (state: ViewportState): PageWant => (state.kind === "awaitingPage" ? state.want : "older");

type Handler = (input: ViewportInput, event: ViewportEvent) => ViewportDecision;

/** Where a session opens: the stored mode decides, absence is not a stored bottom. */
const onOpened: Handler = (input, event) => {
  if (event.kind !== "opened") return idle(input.state);
  return event.saved === "anchor" ? decide("restore-anchor", { kind: "restoring" }) : decide("snap-bottom", FOLLOW_START);
};

/** The spot is above the loaded window: fetch its page and stay put, or land at the newest. */
const onAnchorMissing: Handler = (input, event) => {
  if (event.kind !== "anchorMissing" || input.state.kind !== "restoring") return idle(input.state);
  if (event.following) return decide("snap-bottom", FOLLOW_START);
  if (canLoad(input, "older")) return load(input, "older", { kind: "restoring" });
  return decide("snap-bottom", FOLLOW_START);
};

/** Growth: the bottom moves down, and the bottom hold is its single writer. */
const onGrew: Handler = (input, event) => {
  if (event.kind !== "grew") return idle(input.state);
  if (input.state.kind !== "following") return event.aboveChanged ? decide("hold-reading-anchor", input.state) : idle(input.state);
  return event.gesture ? idle(input.state) : decide("hold-bottom", input.state);
};

/** The control loads the newest page directly rather than nudging to the boundary. */
const onJumpNewest: Handler = (input, event) => {
  if (event.kind !== "jumpNewest") return idle(input.state);
  if (input.state.kind === "awaitingPage") return idle({ kind: "awaitingPage", want: input.state.want, resume: FOLLOW_START });
  if (input.window.hasNewer && canLoad(input, "newest")) return load(input, "newest", FOLLOW_START);
  return decide("snap-bottom", FOLLOW_START);
};

const onPageArrived: Handler = (input, event) => {
  if (event.kind !== "pageArrived" || input.state.kind !== "awaitingPage") return idle(input.state);
  return wantOf(input.state) === "older" ? decide("restore-anchor", { kind: "holding" }) : decide("snap-bottom", FOLLOW_START);
};

const onPageFailed: Handler = (input, event) => {
  if (event.kind !== "pageFailed") return idle(input.state);
  return idle(input.state.kind === "awaitingPage" ? input.state.resume : input.state);
};

const nearTop = (metrics: ViewportMetrics): boolean =>
  isNearTop({ scrollTop: metrics.scrollTop, clientHeight: metrics.clientHeight }) || metrics.scrollTop < NEAR_TOP / 4;

const nearBottom = (metrics: ViewportMetrics): boolean =>
  metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < Math.max(NEAR_TOP, metrics.clientHeight * 1.5);

/**
 * An unfilled viewport owes history whatever the reader is doing; otherwise the older end
 * answers an upward scroll (where the jitter came from) and the forward end answers
 * nearness, because `hasNewer` already says the newest is not loaded.
 */
const onScrolled: Handler = (input, event) => {
  if (event.kind !== "scrolled") return idle(input.state);
  if (!input.fillsViewport && canLoad(input, "older")) return load(input, "older", input.state);
  if (input.state.kind === "restoring") return idle(input.state);
  if (input.state.kind === "following") {
    return event.direction === "up" ? decide("stop-following", { kind: "holding" }) : idle(input.state);
  }
  if (input.state.kind !== "holding" && input.state.kind !== "unknown") return idle(input.state);
  if (event.direction !== "up" && nearBottom(event.metrics) && canLoad(input, "newer")) {
    return load(input, "newer", { kind: "holding" });
  }
  if (event.direction === "up" && nearTop(event.metrics) && canLoad(input, "older")) {
    return load(input, "older", { kind: "holding" });
  }
  return idle(input.state);
};

/**
 * One handler per event kind. The record is keyed by the event union, so a new event kind
 * fails the type check until it is answered instead of falling through a ladder.
 */
const EVENT_HANDLERS: Record<ViewportEvent["kind"], Handler> = {
  opened: onOpened,
  anchorMissing: onAnchorMissing,
  grew: onGrew,
  jumpNewest: onJumpNewest,
  pageArrived: onPageArrived,
  pageFailed: onPageFailed,
  scrolled: onScrolled,
};

export function viewportDecision(input: ViewportInput): ViewportDecision {
  if (!input.measured) return idle({ kind: "unknown" });
  return EVENT_HANDLERS[input.event.kind](input, input.event);
}

/** The direction of a scroll event, so callers do not compare positions themselves. */
export function scrollDirection(previousTop: number | undefined, scrollTop: number): "up" | "down" | "none" {
  if (previousTop === undefined || scrollTop === previousTop) return "none";
  return scrollTop < previousTop ? "up" : "down";
}
