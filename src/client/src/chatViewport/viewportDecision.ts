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
  | { kind: "jumpNewest" }
  | { kind: "pageArrived"; want: PageWant }
  | { kind: "pageFailed" }
  | { kind: "anchorMissing" };

export interface ViewportWindow {
  hasOlder: boolean;
  hasNewer: boolean;
  loading: boolean;
}

export type ViewportState =
  | { kind: "restoring" }
  | { kind: "following" }
  | { kind: "holding" }
  | { kind: "awaitingPage"; want: PageWant; resume: ViewportState };

export type ViewportAction =
  | "idle"
  | "snap-bottom"
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

type Handler = (input: ViewportInput, event: ViewportEvent) => ViewportDecision;

/** Where a session opens: the stored mode decides, absence is not a stored bottom. */
const onOpened: Handler = (input, event) => {
  if (event.kind !== "opened") return idle(input.state);
  return event.saved === "anchor" ? decide("restore-anchor", { kind: "restoring" }) : decide("snap-bottom", { kind: "following" });
};

/** The spot is above the loaded window: fetch the page it lives in and stay put. */
const onAnchorMissing: Handler = (input, event) => {
  if (event.kind !== "anchorMissing" || input.state.kind !== "restoring") return idle(input.state);
  if (canLoad(input, "older")) return load(input, "older", { kind: "restoring" });
  return decide("snap-bottom", { kind: "following" });
};

/** The control loads the newest page directly rather than nudging to the boundary. */
const onJumpNewest: Handler = (input, event) => {
  if (event.kind !== "jumpNewest") return idle(input.state);
  if (input.state.kind === "awaitingPage") return idle({ kind: "awaitingPage", want: input.state.want, resume: { kind: "following" } });
  if (canLoad(input, "newest")) return load(input, "newest", { kind: "following" });
  return decide("snap-bottom", { kind: "following" });
};

/**
 * Where a page leaves the reader. Only the jump to the newest moves them; a page they scrolled into,
 * older or newer, keeps them reading where they were (D4, B13). The end of an older window is not
 * the bottom: a newer page snapped the reader there and set them following, so the follow carried
 * them through everything that loaded.
 */
const AFTER_PAGE: Record<PageWant, ViewportDecision> = {
  older: decide("restore-anchor", { kind: "holding" }),
  newer: decide("restore-anchor", { kind: "holding" }),
  newest: decide("snap-bottom", { kind: "following" }),
};

const onPageArrived: Handler = (input, event) => {
  if (event.kind !== "pageArrived" || input.state.kind !== "awaitingPage") return idle(input.state);
  return AFTER_PAGE[input.state.want];
};

const onPageFailed: Handler = (input, event) => {
  if (event.kind !== "pageFailed") return idle(input.state);
  return idle(input.state.kind === "awaitingPage" ? input.state.resume : input.state);
};

const nearTop = (metrics: ViewportMetrics): boolean =>
  isNearTop({ scrollTop: metrics.scrollTop, clientHeight: metrics.clientHeight });

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
  if (input.state.kind !== "holding") return idle(input.state);
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
  jumpNewest: onJumpNewest,
  pageArrived: onPageArrived,
  pageFailed: onPageFailed,
  scrolled: onScrolled,
};

export function viewportDecision(input: ViewportInput): ViewportDecision {
  if (!input.measured) return idle(input.state);
  return EVENT_HANDLERS[input.event.kind](input, input.event);
}

/** The direction of a scroll event, so callers do not compare positions themselves. */
export function scrollDirection(previousTop: number | undefined, scrollTop: number): "up" | "down" | "none" {
  if (previousTop === undefined || scrollTop === previousTop) return "none";
  return scrollTop < previousTop ? "up" : "down";
}
