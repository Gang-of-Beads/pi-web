import { describe, expect, it } from "vitest";
import {
  FOLLOW_START,
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

const window: ViewportWindow = { hasOlder: true, hasNewer: true, loading: false };
const fullWindow: ViewportWindow = { hasOlder: false, hasNewer: false, loading: false };

const decide = (state: ViewportState, event: ViewportEvent, rest: Partial<ViewportInput> = {}) =>
  viewportDecision({ state, event, window, measured: true, ...rest });

describe("where a session opens", () => {
  it("opens at the newest when it was closed at the bottom", () => {
    expect(decide({ kind: "unknown" }, { kind: "opened", saved: "bottom" })).toEqual({ action: "snap-bottom", next: FOLLOW_START });
  });

  it("opens at the stored spot when it was closed elsewhere, one page", () => {
    expect(decide({ kind: "unknown" }, { kind: "opened", saved: "anchor" })).toEqual({ action: "restore-anchor", next: { kind: "restoring" } });
  });

  it("opens at the newest when nothing was stored - absence is not a spot", () => {
    expect(decide({ kind: "unknown" }, { kind: "opened", saved: "absent" }).action).toBe("snap-bottom");
  });

  it("has nothing to say without a scroller", () => {
    expect(decide({ kind: "unknown" }, { kind: "opened", saved: "bottom" }, { measured: false }).action).toBe("idle");
    expect(decide({ kind: "unknown" }, { kind: "scrolled", direction: "up", metrics }, { measured: false }).action).toBe("idle");
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
      next: FOLLOW_START,
    });
  });

  it("ignores the miss when it was not restoring", () => {
    expect(decide(FOLLOW_START, { kind: "anchorMissing" }).action).toBe("idle");
  });
});

describe("content growing", () => {
  it("holds the bottom while the reader follows", () => {
    expect(decide(FOLLOW_START, { kind: "grew", aboveChanged: false, gesture: false })).toEqual({ action: "hold-bottom", next: FOLLOW_START });
  });

  it("lets a finger own the scroll", () => {
    expect(decide(FOLLOW_START, { kind: "grew", aboveChanged: false, gesture: true }).action).toBe("idle");
  });

  it("holds the reader's row when content above them moved", () => {
    expect(decide({ kind: "holding" }, { kind: "grew", aboveChanged: true, gesture: false }).action).toBe("hold-reading-anchor");
  });

  it("does nothing while holding and nothing above moved", () => {
    expect(decide({ kind: "holding" }, { kind: "grew", aboveChanged: false, gesture: false }).action).toBe("idle");
  });

  it("never fetches history just because content grew", () => {
    expect(decide(FOLLOW_START, { kind: "grew", aboveChanged: true, gesture: false }).next.kind).toBe("following");
  });
});

describe("only an upward scroll asks for history", () => {
  it("stops following on the first upward scroll", () => {
    expect(decide(FOLLOW_START, { kind: "scrolled", direction: "up", metrics: atBottom })).toEqual({
      action: "stop-following",
      next: { kind: "holding" },
    });
  });

  it("does not fetch on the scroll that stops the follow", () => {
    expect(decide(FOLLOW_START, { kind: "scrolled", direction: "up", metrics: atTop }).action).toBe("stop-following");
  });

  it("fetches an older page when the reader reaches the top", () => {
    const decision = decide({ kind: "holding" }, { kind: "scrolled", direction: "up", metrics: atTop });
    expect(decision.action).toBe("load-older");
    expect(decision.next).toEqual({ kind: "awaitingPage", want: "older", resume: { kind: "holding" } });
  });

  it("does not fetch an older page while the reader is far from the top", () => {
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "up", metrics: { scrollTop: 20_000, scrollHeight: 40_000, clientHeight: 800 } }).action).toBe("idle");
  });

  it("fetches a newer page only when the reader scrolls back down to the boundary", () => {
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "down", metrics: atBottom }).action).toBe("load-newer-page");
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "down", metrics: { scrollTop: 1000, scrollHeight: 40_000, clientHeight: 800 } }).action).toBe("idle");
  });

  it("ignores a downward scroll while still following", () => {
    expect(decide(FOLLOW_START, { kind: "scrolled", direction: "down", metrics: atBottom }).action).toBe("idle");
  });
});

describe("the jump-to-newest control", () => {
  it("jumps to the newest page rather than walking there", () => {
    const decision = decide({ kind: "holding" }, { kind: "jumpNewest" });
    expect(decision.action).toBe("load-newest-page");
    expect(decision.next).toEqual({ kind: "awaitingPage", want: "newest", resume: FOLLOW_START });
  });

  it("just lands at the bottom when the newest is already loaded", () => {
    expect(decide({ kind: "holding" }, { kind: "jumpNewest" }, { window: { hasOlder: true, hasNewer: false, loading: false } })).toEqual({
      action: "snap-bottom",
      next: FOLLOW_START,
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
    expect(decision.next).toEqual({ kind: "awaitingPage", want: "older", resume: FOLLOW_START });
  });

  it("does not start a second fetch while one is in flight", () => {
    expect(decide({ kind: "holding" }, { kind: "scrolled", direction: "up", metrics: atTop }, { window: { ...window, loading: true } }).action).toBe("idle");
  });

  it("resumes where it was after a page arrives", () => {
    expect(decide(awaiting, { kind: "pageArrived", want: "older" })).toEqual({ action: "restore-anchor", next: { kind: "holding" } });
  });

  it("lands at the newest after a page that was asked for by a jump", () => {
    const jumped: ViewportState = { kind: "awaitingPage", want: "newest", resume: FOLLOW_START };
    expect(decide(jumped, { kind: "pageArrived", want: "newest" })).toEqual({ action: "snap-bottom", next: FOLLOW_START });
  });

  it("returns to the previous state when the page fails", () => {
    expect(decide(awaiting, { kind: "pageFailed" }).next).toEqual({ kind: "holding" });
  });
});

describe("every state answers every event", () => {
  const states: ViewportState[] = [
    { kind: "unknown" },
    { kind: "restoring" },
    FOLLOW_START,
    { kind: "holding" },
    { kind: "awaitingPage", want: "older", resume: FOLLOW_START },
  ];
  const wants: PageWant[] = ["older", "newer", "newest"];
  const events: ViewportEvent[] = [
    { kind: "opened", saved: "bottom" },
    { kind: "opened", saved: "anchor" },
    { kind: "opened", saved: "absent" },
    { kind: "scrolled", direction: "up", metrics: atTop },
    { kind: "scrolled", direction: "down", metrics: atBottom },
    { kind: "scrolled", direction: "none", metrics },
    { kind: "grew", aboveChanged: true, gesture: false },
    { kind: "grew", aboveChanged: false, gesture: true },
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

describe("direction from two positions", () => {
  it("reads up, down and none", () => {
    expect(scrollDirection(100, 60)).toBe("up");
    expect(scrollDirection(60, 100)).toBe("down");
    expect(scrollDirection(60, 60)).toBe("none");
    expect(scrollDirection(undefined, 60)).toBe("none");
  });
});
