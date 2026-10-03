import { describe, expect, it } from "vitest";
import {
  followsAfterScroll,
  readerCanTakeOver,
  scrollDirection,
  viewportDecision,
  type PageWant,
  type ViewportEvent,
  type ViewportInput,
  type ViewportState,
  type ViewportWindow,
} from "./viewportDecision.js";

const metrics = { scrollTop: 0, scrollHeight: 4000, clientHeight: 800 };
const atTop = { scrollTop: 0, scrollHeight: 40_000, clientHeight: 800 };
const atBottom = { scrollTop: 39_200, scrollHeight: 40_000, clientHeight: 800 };

const window: ViewportWindow = { hasOlder: true, hasNewer: true, loading: false, held: false };
const fullWindow: ViewportWindow = { hasOlder: false, hasNewer: false, loading: false, held: false };

const decide = (state: ViewportState, event: ViewportEvent, rest: Partial<ViewportInput> = {}) =>
  viewportDecision({ state, event, window, measured: true, fillsViewport: true, ...rest });

describe("where a session opens", () => {
  it("opens at the newest when it was closed at the bottom", () => {
    expect(decide({ kind: "holding" }, { kind: "opened", saved: "bottom" })).toEqual({ action: "snap-bottom", next: { kind: "following" } });
  });

  it("opens at the stored spot when it was closed elsewhere, one page", () => {
    expect(decide({ kind: "holding" }, { kind: "opened", saved: "anchor" })).toEqual({ action: "restore-anchor", next: { kind: "restoring" } });
  });

  it("opens at the newest when nothing was stored - absence is not a spot", () => {
    expect(decide({ kind: "holding" }, { kind: "opened", saved: "absent" }).action).toBe("snap-bottom");
  });

  it("has nothing to say without a scroller", () => {
    expect(decide({ kind: "holding" }, { kind: "opened", saved: "bottom" }, { measured: false }).action).toBe("idle");
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "up", metrics }, { measured: false }).action).toBe("idle");
  });
});

describe("a stored spot whose row is not loaded", () => {
  it("fetches the page it lives in instead of jumping", () => {
    const decision = decide({ kind: "restoring" }, { kind: "anchorMissing" });
    expect(decision.action).toBe("load-older");
    expect(decision.next).toEqual({ kind: "awaitingPage", want: "older", resume: { kind: "restoring" } });
  });

  it("lands at the newest when there is no older page to fetch", () => {
    expect(decide({ kind: "restoring" }, { kind: "anchorMissing" }, { window: fullWindow })).toEqual({
      action: "snap-bottom",
      next: { kind: "following" },
    });
  });

  it("ignores the miss when it was not restoring", () => {
    expect(decide({ kind: "following" }, { kind: "anchorMissing" }).action).toBe("idle");
  });

  it("owes history while the viewport cannot fill, whatever the direction", () => {
    const decision = decide({ kind: "following" }, { kind: "scrolled", direction: "none", metrics }, { fillsViewport: false });
    expect(decision.action).toBe("load-older");
    expect(decide({ kind: "following" }, { kind: "scrolled", direction: "none", metrics }).action).toBe("idle");
  });
});


describe("only an upward scroll asks for history", () => {
  it("stops following on the first upward scroll", () => {
    const justAbove = { ...atBottom, scrollTop: atBottom.scrollTop - 200 };
    expect(decide({ kind: "following" }, { kind: "scrolled", direction: "up", metrics: justAbove })).toEqual({
      action: "stop-following",
      next: { kind: "holding" },
    });
  });

  /** D4, B12: a view that grew lowers scrollTop to keep the bottom; that is not the reader leaving it. */
  it("keeps following through an upward scroll that ends at the bottom", () => {
    const grown = { scrollTop: 1819, scrollHeight: 2465, clientHeight: 646 };
    const leftIt = { scrollTop: 1719, scrollHeight: 2465, clientHeight: 646 };
    expect({
      grown: decide({ kind: "following" }, { kind: "scrolled", direction: "up", metrics: grown }),
      leftIt: decide({ kind: "following" }, { kind: "scrolled", direction: "up", metrics: leftIt }),
    }).toEqual({
      grown: { action: "idle", next: { kind: "following" } },
      leftIt: { action: "stop-following", next: { kind: "holding" } },
    });
  });

  it("does not fetch on the scroll that stops the follow", () => {
    expect(decide({ kind: "following" }, { kind: "scrolled", direction: "up", metrics: atTop }).action).toBe("stop-following");
  });

  it("fetches an older page when the reader reaches the top", () => {
    const decision = decide({ kind: "holding" }, { kind: "scrolled", direction: "up", metrics: atTop });
    expect(decision.action).toBe("load-older");
    expect(decision.next).toEqual({ kind: "awaitingPage", want: "older", resume: { kind: "holding" } });
  });

  it("does not fetch an older page while the reader is far from the top", () => {
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "up", metrics: { scrollTop: 20_000, scrollHeight: 40_000, clientHeight: 800 } }).action).toBe("idle");
  });

  it("fetches a newer page when the reader is at the boundary, however they got there", () => {
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "none", metrics: atBottom }).action).toBe("load-newer-page");
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "down", metrics: atBottom }).action).toBe("load-newer-page");
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "down", metrics: { scrollTop: 1000, scrollHeight: 40_000, clientHeight: 800 } }).action).toBe("idle");
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "up", metrics: atBottom }).action).toBe("idle");
  });

  it("fetches from an end before anything opened, holding being the same as unknown", () => {
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "down", metrics: atBottom }).action).toBe("load-newer-page");
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "up", metrics: atTop }).action).toBe("load-older");
  });

  /** D4: reading -> following when the reader scrolls down to the bottom of the newest (review ca45d6ed). */
  it("follows again once the reader scrolls down to the bottom of the newest, and not to the end of an older window", () => {
    const bottom = { scrollTop: 39_200, scrollHeight: 40_000, clientHeight: 800 };
    expect({
      newest: decide({ kind: "holding" }, { kind: "scrolled", direction: "down", metrics: bottom }, { window: { hasOlder: true, hasNewer: false, loading: false, held: false } }),
      olderWindow: decide({ kind: "holding" }, { kind: "scrolled", direction: "down", metrics: bottom }, { window: { hasOlder: true, hasNewer: true, loading: true, held: false } }),
    }).toEqual({
      newest: { action: "idle", next: { kind: "following" } },
      olderWindow: { action: "idle", next: { kind: "holding" } },
    });
  });

  /** D4: a downward scroll that lands within 48 px of the newest bottom reaches it (review 754821b2: the edge read 2 px). */
  it("follows again from a downward scroll that lands within 48 px of the newest bottom, not further", () => {
    const newest: ViewportWindow = { hasOlder: true, hasNewer: false, loading: false, held: false };
    const near = { scrollTop: 39_170, scrollHeight: 40_000, clientHeight: 800 };
    const far = { scrollTop: 39_100, scrollHeight: 40_000, clientHeight: 800 };
    expect({
      near: decide({ kind: "holding" }, { kind: "scrolled", direction: "down", metrics: near }, { window: newest }).next,
      far: decide({ kind: "holding" }, { kind: "scrolled", direction: "down", metrics: far }, { window: newest }).next,
    }).toEqual({ near: { kind: "following" }, far: { kind: "holding" } });
  });

  it("ignores a downward scroll while still following", () => {
    expect(decide({ kind: "following" }, { kind: "scrolled", direction: "down", metrics: atBottom }).action).toBe("idle");
  });
});

describe("a reader who scrolls during a restore (D4, review 754821b2)", () => {
  it("takes over: a restore stops, a page on its way for it or for a jump lands as the reader's, and nothing else changes", () => {
    const forTheRestore: ViewportState = { kind: "awaitingPage", want: "older", resume: { kind: "restoring" } };
    const forTheReader: ViewportState = { kind: "awaitingPage", want: "older", resume: { kind: "holding" } };
    const forTheJump: ViewportState = { kind: "awaitingPage", want: "newest", resume: { kind: "following" } };
    expect({
      restoring: decide({ kind: "restoring" }, { kind: "readerTookOver" }),
      inFlight: decide(forTheRestore, { kind: "readerTookOver" }),
      jump: decide(forTheJump, { kind: "readerTookOver" }),
      reading: decide(forTheReader, { kind: "readerTookOver" }),
      following: decide({ kind: "following" }, { kind: "readerTookOver" }),
    }).toEqual({
      restoring: { action: "idle", next: { kind: "holding" } },
      inFlight: { action: "idle", next: forTheReader },
      jump: { action: "idle", next: { kind: "awaitingPage", want: "newest", resume: { kind: "holding" } } },
      reading: { action: "idle", next: forTheReader },
      following: { action: "idle", next: { kind: "following" } },
    });
  });
});

describe("what a reader's scroll takes over (review 9f8186d0)", () => {
  it("is a restore, or a page waited for on someone else's behalf, and nothing else", () => {
    const states: ViewportState[] = [
      { kind: "restoring" },
      { kind: "awaitingPage", want: "older", resume: { kind: "restoring" } },
      { kind: "awaitingPage", want: "newest", resume: { kind: "following" } },
      { kind: "awaitingPage", want: "older", resume: { kind: "holding" } },
      { kind: "holding" },
      { kind: "following" },
    ];
    expect(states.map(readerCanTakeOver)).toEqual([true, true, true, false, false, false]);
  });
});

describe("a restore that reads older pages (review 754821b2)", () => {
  it("goes on restoring after each page, so the next miss asks through the decision", () => {
    const reading: ViewportState = { kind: "awaitingPage", want: "older", resume: { kind: "restoring" } };
    expect(decide(reading, { kind: "pageArrived", want: "older" })).toEqual({ action: "restore-anchor", next: { kind: "restoring" } });
  });
});

describe("a restore that finished (D4, review ca45d6ed)", () => {
  it("leaves restoring for reading at a restored spot and for following at the bottom, and changes nothing else", () => {
    const awaiting: ViewportState = { kind: "awaitingPage", want: "older", resume: { kind: "restoring" } };
    expect({
      spot: decide({ kind: "restoring" }, { kind: "restoreSettled", landed: "spot" }),
      bottom: decide({ kind: "restoring" }, { kind: "restoreSettled", landed: "bottom" }),
      holding: decide({ kind: "holding" }, { kind: "restoreSettled", landed: "bottom" }),
      awaiting: decide(awaiting, { kind: "restoreSettled", landed: "spot" }),
    }).toEqual({
      spot: { action: "idle", next: { kind: "holding" } },
      bottom: { action: "idle", next: { kind: "following" } },
      holding: { action: "idle", next: { kind: "holding" } },
      awaiting: { action: "idle", next: awaiting },
    });
  });

  it("loads older history once a reader the restore left reading reaches the top", () => {
    const settled = decide({ kind: "restoring" }, { kind: "restoreSettled", landed: "spot" }).next;
    expect({ settled: decide(settled, { kind: "scrolled", direction: "up", metrics: atTop }).action, stillRestoring: decide({ kind: "restoring" }, { kind: "scrolled", direction: "up", metrics: atTop }).action }).toEqual({ settled: "load-older", stillRestoring: "idle" });
  });
});

describe("a failed read's hold (D4, review ca45d6ed)", () => {
  const held: ViewportWindow = { ...window, held: true };

  it("asks for no page while held, from either end, an unfilled view or a restore's missing spot", () => {
    expect({
      older: decide({ kind: "holding" }, { kind: "scrolled", direction: "up", metrics: atTop }, { window: held }).action,
      newer: decide({ kind: "holding" }, { kind: "scrolled", direction: "down", metrics: atBottom }, { window: held }).action,
      unfilled: decide({ kind: "holding" }, { kind: "scrolled", direction: "none", metrics }, { window: held, fillsViewport: false }).action,
      missingSpot: decide({ kind: "restoring" }, { kind: "anchorMissing" }, { window: held }).action,
    }).toEqual({ older: "idle", newer: "idle", unfilled: "idle", missingSpot: "idle" });
  });

  /** Review 754821b2: a failed read is unknown, not "the spot is gone"; only an older end that is not there lands at the newest. */
  it("keeps restoring while the spot's page waits out a hold or is on its way, and lands at the newest only when there is no older page", () => {
    expect({
      held: decide({ kind: "restoring" }, { kind: "anchorMissing" }, { window: held }),
      inFlight: decide({ kind: "restoring" }, { kind: "anchorMissing" }, { window: { ...window, loading: true } }),
      noOlder: decide({ kind: "restoring" }, { kind: "anchorMissing" }, { window: { ...fullWindow, held: true } }),
    }).toEqual({
      held: { action: "idle", next: { kind: "restoring" } },
      inFlight: { action: "idle", next: { kind: "restoring" } },
      noOlder: { action: "snap-bottom", next: { kind: "following" } },
    });
  });

  /** Review 754821b2: a jump whose read failed left the reader "following" an older window's end, where nothing loads. */
  it("leaves a failed jump reading at an older window's end, so the hold's end asks again", () => {
    const jumped: ViewportState = { kind: "awaitingPage", want: "newest", resume: { kind: "following" } };
    expect({
      olderWindow: decide(jumped, { kind: "pageFailed" }),
      newest: decide(jumped, { kind: "pageFailed" }, { window: { hasOlder: true, hasNewer: false, loading: false, held: true } }),
    }).toEqual({
      olderWindow: { action: "idle", next: { kind: "holding" } },
      newest: { action: "idle", next: { kind: "following" } },
    });
  });

  it("lets the reader's jump ask through the hold", () => {
    expect(decide({ kind: "holding" }, { kind: "jumpNewest" }, { window: held }).action).toBe("load-newest-page");
  });
});

describe("the jump-to-newest control", () => {
  it("jumps to the newest page rather than walking there", () => {
    const decision = decide({ kind: "holding" }, { kind: "jumpNewest" });
    expect(decision.action).toBe("load-newest-page");
    expect(decision.next).toEqual({ kind: "awaitingPage", want: "newest", resume: { kind: "following" } });
  });

  it("just lands at the bottom when the newest is already loaded", () => {
    expect(decide({ kind: "holding" }, { kind: "jumpNewest" }, { window: { hasOlder: true, hasNewer: false, loading: false, held: false } })).toEqual({
      action: "snap-bottom",
      next: { kind: "following" },
    });
  });
});

describe("one page in flight at a time", () => {
  const awaiting: ViewportState = { kind: "awaitingPage", want: "older", resume: { kind: "holding" } };

  it("is idle while a page is loading", () => {
    expect(decide(awaiting, { kind: "scrolled", direction: "up", metrics: atTop }).action).toBe("idle");
  });

  it("takes the newest landing from a jump pressed while a page is in flight, without a second fetch", () => {
    const decision = decide(awaiting, { kind: "jumpNewest" });
    expect(decision.action).toBe("idle");
    expect(decision.next).toEqual({ kind: "awaitingPage", want: "older", resume: { kind: "following" } });
  });

  it("does not start a second fetch while one is in flight", () => {
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "up", metrics: atTop }, { window: { ...window, loading: true, held: false } }).action).toBe("idle");
  });

  it("resumes where it was after a page arrives", () => {
    expect(decide(awaiting, { kind: "pageArrived", want: "older" })).toEqual({ action: "restore-anchor", next: { kind: "holding" } });
  });

  /** D4, B13: the end of an older window is not the bottom; the newer page the reader scrolled into leaves them reading. */
  it("keeps the reader reading after a newer page they scrolled into", () => {
    const scrolledInto: ViewportState = { kind: "awaitingPage", want: "newer", resume: { kind: "holding" } };
    expect(decide(scrolledInto, { kind: "pageArrived", want: "newer" })).toEqual({ action: "restore-anchor", next: { kind: "holding" } });
  });

  /** Review ca45d6ed: the jump pressed while a newer page was on its way asked to follow. */
  it("lands at the newest when a newer page lands after the reader jumped", () => {
    const jumpedMidFlight: ViewportState = { kind: "awaitingPage", want: "newer", resume: { kind: "following" } };
    expect(decide(jumpedMidFlight, { kind: "pageArrived", want: "newer" }, { window: { hasOlder: true, hasNewer: false, loading: false, held: false } })).toEqual({ action: "snap-bottom", next: { kind: "following" } });
  });

  it("lands at the newest after a page that was asked for by a jump", () => {
    const jumped: ViewportState = { kind: "awaitingPage", want: "newest", resume: { kind: "following" } };
    expect(decide(jumped, { kind: "pageArrived", want: "newest" }, { window: { hasOlder: true, hasNewer: false, loading: false, held: false } })).toEqual({ action: "snap-bottom", next: { kind: "following" } });
  });

  /** Review 9f8186d0: a jump pressed while an older page was on its way was lost when that page landed. */
  it("goes on to the newest when an older page lands after the reader jumped", () => {
    const jumpedDuringOlder: ViewportState = { kind: "awaitingPage", want: "older", resume: { kind: "following" } };
    expect({
      jumped: decide(jumpedDuringOlder, { kind: "pageArrived", want: "older" }),
      newestLoaded: decide(jumpedDuringOlder, { kind: "pageArrived", want: "older" }, { window: { hasOlder: true, hasNewer: false, loading: false, held: false } }),
    }).toEqual({
      jumped: { action: "load-newest-page", next: { kind: "awaitingPage", want: "newest", resume: { kind: "following" } } },
      newestLoaded: { action: "restore-anchor", next: { kind: "holding" } },
    });
  });

  /** Review 754821b2: a newest page that landed short of the newest left the reader "following" a window that loads nothing newer. */
  it("asks for the newest again when a jump's page lands short of it, and keeps a taken-over page the reader's", () => {
    const jumped: ViewportState = { kind: "awaitingPage", want: "newest", resume: { kind: "following" } };
    const takenOver: ViewportState = { kind: "awaitingPage", want: "newest", resume: { kind: "holding" } };
    expect({
      short: decide(jumped, { kind: "pageArrived", want: "newest" }),
      takenOver: decide(takenOver, { kind: "pageArrived", want: "newest" }),
    }).toEqual({
      short: { action: "load-newest-page", next: jumped },
      takenOver: { action: "restore-anchor", next: { kind: "holding" } },
    });
  });

  it("returns to the previous state when the page fails", () => {
    expect(decide(awaiting, { kind: "pageFailed" }).next).toEqual({ kind: "holding" });
  });
});

describe("every state answers every event", () => {
  const states: ViewportState[] = [
    { kind: "restoring" },
    { kind: "following" },
    { kind: "holding" },
    { kind: "awaitingPage", want: "older", resume: { kind: "following" } },
  ];
  const wants: PageWant[] = ["older", "newer", "newest"];
  const events: ViewportEvent[] = [
    { kind: "opened", saved: "bottom" },
    { kind: "opened", saved: "anchor" },
    { kind: "opened", saved: "absent" },
    { kind: "scrolled", direction: "up", metrics: atTop },
    { kind: "scrolled", direction: "down", metrics: atBottom },
    { kind: "scrolled", direction: "none", metrics },
    { kind: "jumpNewest" },
    ...wants.map((want): ViewportEvent => ({ kind: "pageArrived", want })),
    { kind: "pageFailed" },
    { kind: "anchorMissing" },
  ];

  it("returns an action and a next state for the whole cross product", () => {
    for (const state of states) {
      for (const event of events) {
        const decision = decide(state, event);
        expect(decision.action).toBeTypeOf("string");
        expect(decision.next).toHaveProperty("kind");
      }
    }
  });

  it("never trusts a page that arrives unsolicited", () => {
    for (const state of states) {
      if (state.kind === "awaitingPage") continue;
      expect(decide(state, { kind: "pageArrived", want: "older" }).action).toBe("idle");
    }
  });
});

/** D4: whether the reader follows the newest after a scroll, every state (review ca45d6ed, B13). */
describe("following after a scroll", () => {
  const facts = { hasNewer: false, atBottom: false, moved: true, scrollingUp: false, nearBottom: false, wasFollowing: false };
  it.each<[string, Partial<typeof facts>, boolean]>([
    ["the end of an older window is not the bottom, even at its very end", { hasNewer: true, atBottom: true, nearBottom: true, wasFollowing: true }, false],
    ["at the bottom of the newest", { atBottom: true }, true],
    ["a scroll that did not move keeps following", { moved: false, wasFollowing: true }, true],
    ["a scroll that did not move keeps reading", { moved: false, wasFollowing: false }, false],
    ["an upward scroll releases, even near the bottom", { scrollingUp: true, nearBottom: true, wasFollowing: true }, false],
    ["a downward scroll that ends near the bottom follows", { nearBottom: true }, true],
    ["a downward scroll that ends far from it reads", { nearBottom: false, wasFollowing: true }, false],
  ])("%s", (_name, overrides, follows) => {
    expect(followsAfterScroll({ ...facts, ...overrides })).toBe(follows);
  });
});

describe("direction from two positions", () => {
  it("reads up, down and none", () => {
    expect(scrollDirection(100, 60)).toBe("up");
    expect(scrollDirection(60, 100)).toBe("down");
    expect(scrollDirection(60, 60)).toBe("none");
    expect(scrollDirection(undefined, 60)).toBe("none");
  });
});
