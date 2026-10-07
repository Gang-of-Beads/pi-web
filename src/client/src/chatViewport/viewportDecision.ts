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
import { distanceFromScrollBottom, isNearScrollBottom } from "../chatScrollPosition.js";
import { BOTTOM_SLACK_PX } from "../streamingBottomHold.js";

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
  | { kind: "anchorMissing" }
  | { kind: "restoreSettled"; landed: "spot" | "bottom" }
  | { kind: "readerTookOver" };

export interface ViewportWindow {
  hasOlder: boolean;
  hasNewer: boolean;
  loading: boolean;
  /** A failed read is waiting out its retry (`pageRetry`): only the reader's jump asks before it ends. */
  held: boolean;
}

export type ViewportState =
  | { kind: "restoring" }
  | { kind: "following" }
  | { kind: "holding" }
  | { kind: "awaitingPage"; want: PageWant; resume: ViewportState };

/**
 * What the executor does. A page that lands under the reader and a spot being restored move
 * nothing here: the reading anchor in ChatView's update() and the restore frame do that work, so
 * those decisions are `idle` with their state (review ca45d6ed row 17 folded a no-op
 * `restore-anchor` away).
 */
export type ViewportAction =
  | "idle"
  | "snap-bottom"
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

const hasPage = (input: ViewportInput, want: PageWant): boolean => (want === "older" ? input.window.hasOlder : input.window.hasNewer);

/** The reader's own jump asks through a failed read's hold; nothing else does (D4, review ca45d6ed). */
const canLoadOnIntent = (input: ViewportInput, want: PageWant): boolean => !input.window.loading && hasPage(input, want);

const canLoad = (input: ViewportInput, want: PageWant): boolean => !input.window.held && canLoadOnIntent(input, want);

const load = (input: ViewportInput, want: PageWant, resume: ViewportState): ViewportDecision =>
  decide(want === "older" ? "load-older" : want === "newer" ? "load-newer-page" : "load-newest-page", {
    kind: "awaitingPage",
    want,
    resume,
  });

type Handler = (input: ViewportInput, event: ViewportEvent) => ViewportDecision;

/** Where a session opens: the stored mode decides, absence is not a stored bottom. */
const OPENING: Record<SavedOpen, ViewportDecision> = {
  anchor: idle({ kind: "restoring" }),
  bottom: decide("snap-bottom", { kind: "following" }),
  absent: decide("snap-bottom", { kind: "following" }),
};

const onOpened: Handler = (input, event) => (event.kind === "opened" ? OPENING[event.saved] : idle(input.state));

/**
 * The spot is above the loaded window: fetch the page it lives in and stay put. A page that waits
 * out a failed read's hold, or is on its way, is unknown, not a spot that is gone: the restore
 * waits for it, and only an older end that is not there lands at the newest (review 754821b2:
 * one failed read threw the remembered place away within a frame).
 */
const onAnchorMissing: Handler = (input, event) => {
  if (event.kind !== "anchorMissing" || input.state.kind !== "restoring") return idle(input.state);
  if (canLoad(input, "older")) return load(input, "older", { kind: "restoring" });
  if (input.window.hasOlder) return idle(input.state);
  return decide("snap-bottom", { kind: "following" });
};

/** The control loads the newest page directly rather than nudging to the boundary. */
const onJumpNewest: Handler = (input, event) => {
  if (event.kind !== "jumpNewest") return idle(input.state);
  if (input.state.kind === "awaitingPage") return idle({ kind: "awaitingPage", want: input.state.want, resume: { kind: "following" } });
  if (canLoadOnIntent(input, "newest")) return load(input, "newest", { kind: "following" });
  return decide("snap-bottom", { kind: "following" });
};

/** A newest page the reader did not wait for lands like any newer page. */
const LANDS_AS: Record<PageWant, PageWant> = { older: "older", newer: "newer", newest: "newer" };

/** A page the reader followed into lands at the newest, unless it was history above them. */
const FOLLOWED_LANDS_AS: Record<PageWant, PageWant> = { older: "older", newer: "newest", newest: "newest" };

/**
 * Where a page leaves the reader. Only the jump to the newest moves them; a page they scrolled into,
 * older or newer, keeps them reading where they were (D4, B13). The end of an older window is not
 * the bottom: a newer page snapped the reader there and set them following, so the follow carried
 * them through everything that loaded.
 */
const AFTER_PAGE: Record<PageWant, ViewportDecision> = {
  older: idle({ kind: "holding" }),
  newer: idle({ kind: "holding" }),
  newest: decide("snap-bottom", { kind: "following" }),
};

/**
 * A page that lands after the reader asked to follow (the jump pressed while a newer page was on
 * its way) lands them at the newest like the jump does (review ca45d6ed); while the newest is still
 * not loaded, the jump asks for it again. The walk lived in ChatView behind the follow flag, which an
 * older window's end clears, so a newest page that landed short left the reader "following" a window
 * that loads nothing newer (review 754821b2). A page whose jump the reader took over lands as theirs.
 */
const onPageArrived: Handler = (input, event) => {
  if (event.kind !== "pageArrived" || input.state.kind !== "awaitingPage") return idle(input.state);
  const { resume, want } = input.state;
  if (resume.kind === "restoring") return idle({ kind: "restoring" });
  if (resume.kind !== "following") return AFTER_PAGE[LANDS_AS[want]];
  if (input.window.hasNewer && canLoadOnIntent(input, "newest")) return load(input, "newest", { kind: "following" });
  return AFTER_PAGE[FOLLOWED_LANDS_AS[want]];
};

/**
 * A restore that finished leaves `restoring`: a restored (or skipped) spot is reading, a landing at
 * the bottom is following. A viewport left restoring asks for no page, so a session reopened where
 * the reader left it loaded nothing however far they scrolled (D4, review ca45d6ed). A spot found
 * while its page is still on its way ends the restore too; the page lands as the reader's (review
 * 7b1987f0: it left the restore standing once the page landed).
 */
const onRestoreSettled: Handler = (input, event) => {
  if (event.kind !== "restoreSettled" || !isRestoring(input.state)) return idle(input.state);
  const landed: ViewportState = event.landed === "bottom" ? { kind: "following" } : { kind: "holding" };
  return idle(input.state.kind === "awaitingPage" ? { ...input.state, resume: landed } : landed);
};

/**
 * D4: only the reader's intent moves the reader. A reader who scrolls during a restore, or while a
 * jump's page is on its way, takes over: the restore stops, and a page on its way lands as theirs,
 * so it cannot move a reader who already went elsewhere (review 754821b2: a restore that waits out a
 * failed read would otherwise move them seconds later).
 */
const onReaderTookOver: Handler = (input, event) => {
  if (event.kind !== "readerTookOver" || !readerCanTakeOver(input.state)) return idle(input.state);
  return idle(input.state.kind === "awaitingPage" ? { ...input.state, resume: { kind: "holding" } } : { kind: "holding" });
};

const onPageFailed: Handler = (input, event) => {
  if (event.kind !== "pageFailed" || input.state.kind !== "awaitingPage") return idle(input.state);
  const resume = input.state.resume;
  return idle(resume.kind === "following" && input.window.hasNewer ? { kind: "holding" } : resume);
};

const nearTop = (metrics: ViewportMetrics): boolean =>
  isNearTop({ scrollTop: metrics.scrollTop, clientHeight: metrics.clientHeight });

/**
 * Still at the bottom after the scroll. When the view grows (the dock or the composer gets shorter),
 * the browser lowers `scrollTop` to keep the bottom, and that scroll reads as upward though the
 * reader went nowhere (D4, B12; seen on 8505 with a card docked: following -> holding with the
 * reader still at the bottom, no input).
 */
const atBottom = (metrics: ViewportMetrics): boolean => distanceFromScrollBottom(metrics) < BOTTOM_SLACK_PX;

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
    return event.direction === "up" && !atBottom(event.metrics) ? decide("stop-following", { kind: "holding" }) : idle(input.state);
  }
  if (input.state.kind !== "holding") return idle(input.state);
  if (event.direction !== "up" && nearBottom(event.metrics) && canLoad(input, "newer")) {
    return load(input, "newer", { kind: "holding" });
  }
  if (event.direction === "up" && nearTop(event.metrics) && canLoad(input, "older")) {
    return load(input, "older", { kind: "holding" });
  }
  if (event.direction === "down" && isNearScrollBottom(event.metrics) && !input.window.hasNewer) return idle({ kind: "following" });
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
  restoreSettled: onRestoreSettled,
  readerTookOver: onReaderTookOver,
};

/** What a reader's scroll takes over: a restore, or a page waited for on a restore's or a jump's behalf. */
export function readerCanTakeOver(state: ViewportState): boolean {
  return state.kind === "restoring" || (state.kind === "awaitingPage" && state.resume.kind !== "holding");
}

/** A restore is under way: restoring, or a page on its way for it. */
export function isRestoring(state: ViewportState): boolean {
  return state.kind === "restoring" || (state.kind === "awaitingPage" && state.resume.kind === "restoring");
}

/**
 * Nothing is decided against a scroller that has no height, except where a session opens: that is a
 * fact about the new session, and answering idle left the previous session's state standing, an
 * `awaitingPage` that asked for no page in the new one (review bbe5adc9 row 7).
 */
export function viewportDecision(input: ViewportInput): ViewportDecision {
  if (input.measured) return EVENT_HANDLERS[input.event.kind](input, input.event);
  return idle(input.event.kind === "opened" ? OPENING[input.event.saved].next : input.state);
}

/**
 * Whether the reader follows the newest after a scroll (D4). The end of an older window is not the
 * bottom: reaching it pinned the reader there, so the newer page landing under them carried them
 * through everything that loaded, a page at a time (review ca45d6ed, B13). An upward scroll
 * releases; a downward one that ends near the bottom follows; a scroll that did not move keeps what
 * was.
 */
export function followsAfterScroll(facts: { readonly hasNewer: boolean; readonly atBottom: boolean; readonly moved: boolean; readonly scrollingUp: boolean; readonly nearBottom: boolean; readonly wasFollowing: boolean }): boolean {
  if (facts.hasNewer) return false;
  if (facts.atBottom) return true;
  if (!facts.moved) return facts.wasFollowing;
  return !facts.scrollingUp && facts.nearBottom;
}

/** The direction of a scroll event, so callers do not compare positions themselves. */
export function scrollDirection(previousTop: number | undefined, scrollTop: number): "up" | "down" | "none" {
  if (previousTop === undefined || scrollTop === previousTop) return "none";
  return scrollTop < previousTop ? "up" : "down";
}
