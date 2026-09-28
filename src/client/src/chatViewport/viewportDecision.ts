/**
 * One owner for "where is the reader, and which page do we owe them".
 *
 * `chat.scrollTop` had ten writers and each decided for itself, so they overwrote
 * one another: a page prepend's 30-frame settle raced the bottom hold, an older page
 * was fetched while the reader was pinned at the bottom (nothing above them had
 * changed), and a newer page was fetched from a render rather than from a scroll. The
 * owner sees that as jitter, and as losing his place.
 *
 * The policy is the owner's, verbatim: where the session was closed decides where it
 * opens (bottom opens at the newest page, a stored spot opens at that spot, each one
 * page); only an upward scroll asks for history; the jump-to-bottom control *jumps* to
 * the newest page instead of walking there page by page.
 *
 * This module is pure: it reads a state, an event and the loaded window, and answers
 * with one action plus the next state. The DOM, the fetching and the persistence stay
 * outside, and every caller becomes a dumb executor.
 */
import { isNearTop, type ChatHistoryLoadState } from "../chatHistoryLoading.js";

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
  /** No scroller (or no height yet): absence is not "at the bottom". */
  measured: boolean;
  /** The loaded window is shorter than the viewport, so history is owed either way. */
  fillsViewport: boolean;
}

export const FOLLOW_START: ViewportState = { kind: "following" };

/** How close to the bottom counts as "the reader is back at the newest". */
const NEAR_TOP = 600;

const idle = (state: ViewportState): ViewportDecision => ({ action: "idle", next: state });
const decide = (action: ViewportAction, next: ViewportState): ViewportDecision => ({ action, next });

/**
 * The whole policy, as one table over (state, event).
 *
 * Exhaustive by construction: every event arm returns from every state, so a state
 * nobody thought about surfaces in the tests instead of in a scroll handler.
 */
export function viewportDecision(input: ViewportInput): ViewportDecision {
  if (!input.measured) return idle({ kind: "unknown" });

  // The reader's newest intent survives a page already in flight: the fetch is not
  // restarted (one page at a time), but where it lands is now the bottom.
  if (input.event.kind === "jumpNewest" && input.state.kind === "awaitingPage") {
    return idle({ kind: "awaitingPage", want: input.state.want, resume: FOLLOW_START });
  }

  const loading = (want: PageWant, resume: ViewportState): ViewportDecision =>
    decide(want === "older" ? "load-older" : want === "newer" ? "load-newer-page" : "load-newest-page", {
      kind: "awaitingPage",
      want,
      resume,
    });

  const canLoad = (want: PageWant): boolean =>
    !input.window.loading && (want === "older" ? input.window.hasOlder : input.window.hasNewer);

  switch (input.event.kind) {
    case "opened":
      if (input.event.saved === "anchor") return decide("restore-anchor", { kind: "restoring" });
      // Absence is not a stored bottom, but it is not a stored place either: with
      // nothing to restore, the newest is the honest landing.
      return decide("snap-bottom", FOLLOW_START);

    case "anchorMissing":
      if (input.state.kind !== "restoring") return idle(input.state);
      // The spot is above the loaded window. Fetch the page it lives in and stay put -
      // the prepend anchor holds the reader's row, so the page arrives without a jump.
      // A reader who was following the bottom wants no history at all: walking up to
      // find their row is what put them in the middle of the session.
      if (input.event.following) return decide("snap-bottom", FOLLOW_START);
      if (canLoad("older")) return loading("older", { kind: "restoring" });
      return decide("snap-bottom", FOLLOW_START);

    case "grew":
      if (input.state.kind !== "following") {
        return input.event.aboveChanged ? decide("hold-reading-anchor", input.state) : idle(input.state);
      }
      if (input.event.gesture) return idle(input.state);
      return decide("hold-bottom", input.state);

    case "jumpNewest":
      // A jump loads the newest page directly instead of walking there one page at a
      // time, which is what made the control feel like it only nudged the view.
      if (canLoad("newest") && input.window.hasNewer) return loading("newest", FOLLOW_START);
      return decide("snap-bottom", FOLLOW_START);

    case "pageArrived":
      if (input.state.kind !== "awaitingPage") return idle(input.state);
      if (input.state.want === "older") return decide("restore-anchor", { kind: "holding" });
      return decide("snap-bottom", FOLLOW_START);

    case "pageFailed":
      return idle(input.state.kind === "awaitingPage" ? input.state.resume : input.state);

    case "scrolled": {
      // An unfilled viewport owes history whatever the reader is doing: there is not
      // enough on screen to read, so "only an upward scroll" would leave it empty.
      if (!input.fillsViewport && canLoad("older")) return loading("older", input.state);
      if (input.state.kind === "restoring") return idle(input.state);
      if (input.state.kind === "following") {
        if (input.event.direction !== "up") return idle(input.state);
        return decide("stop-following", { kind: "holding" });
      }
      // Before anything opened, a scroll is a reader scrolling: treat it as holding, so
      // reaching an end still fetches rather than doing nothing until a restore ran.
      if (input.state.kind !== "holding" && input.state.kind !== "unknown") return idle(input.state);
      // The forward end answers nearness, not only a downward scroll: `hasNewer` means
      // the newest is not loaded, so being near the end is reason enough. The older end
      // is the one that needs the direction gate - that is where the jitter came from.
      if (input.event.direction !== "up" && nearBottom(input.event.metrics) && canLoad("newer")) {
        return loading("newer", { kind: "holding" });
      }
      if (input.event.direction === "up" && nearTop(input.event.metrics) && canLoad("older")) {
        return loading("older", { kind: "holding" });
      }
      return idle(input.state);
    }
  }
}

function nearTop(metrics: ViewportMetrics): boolean {
  const state: Pick<ChatHistoryLoadState, "scrollTop" | "clientHeight"> = {
    scrollTop: metrics.scrollTop,
    clientHeight: metrics.clientHeight,
  };
  return isNearTop(state) || metrics.scrollTop < NEAR_TOP / 4;
}

function nearBottom(metrics: ViewportMetrics): boolean {
  const distance = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distance < Math.max(NEAR_TOP, metrics.clientHeight * 1.5);
}

/** The direction of a scroll event, so callers do not compare positions themselves. */
export function scrollDirection(previousTop: number | undefined, scrollTop: number): "up" | "down" | "none" {
  if (previousTop === undefined || scrollTop === previousTop) return "none";
  return scrollTop < previousTop ? "up" : "down";
}
