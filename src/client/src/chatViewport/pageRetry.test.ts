import { describe, expect, it } from "vitest";
import { holdAfterFailure, isHeld, owedAfter, PAGE_RETRY_OPEN, readerMoved, releaseHold, type PageRetry } from "./pageRetry.js";

describe("a failed page read's hold (D4, review ca45d6ed)", () => {
  it("waits on the read ladder, doubling up to the quiet window, while the failures go on", () => {
    let retry: PageRetry = PAGE_RETRY_OPEN;
    const waits: number[] = [];
    for (let failure = 0; failure < 6; failure += 1) {
      const held = holdAfterFailure(retry, "reevaluate");
      waits.push(held.waitMs);
      retry = releaseHold(held);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000]);
  });

  /** Review 754821b2: a hold that ended by the wall clock could outlive its timer when the clock stepped back. */
  it("holds until its timer releases it, whatever the clock says, and a released hold remembers its failures", () => {
    const held = holdAfterFailure(PAGE_RETRY_OPEN, "reevaluate");
    const released = releaseHold(held);
    expect({
      open: isHeld(PAGE_RETRY_OPEN),
      held: isHeld(held),
      released: isHeld(released),
      next: holdAfterFailure(released, "reevaluate").waitMs,
      openStaysOpen: releaseHold(PAGE_RETRY_OPEN),
    }).toEqual({ open: false, held: true, released: false, next: 2000, openStaysOpen: PAGE_RETRY_OPEN });
  });

  /** Review 9f8186d0: a failed jump re-applied the scroll rules at the hold's end, so a reader far from the end got nothing. */
  it("owes a jump's newest page at its end, until the reader moves", () => {
    const jump = holdAfterFailure(PAGE_RETRY_OPEN, "newest");
    expect({
      jump: jump.owes,
      scroll: holdAfterFailure(PAGE_RETRY_OPEN, "reevaluate").owes,
      moved: readerMoved(jump),
      openMoved: readerMoved(PAGE_RETRY_OPEN),
    }).toEqual({ jump: "newest", scroll: "reevaluate", moved: { ...jump, owes: "reevaluate" }, openMoved: PAGE_RETRY_OPEN });
  });

  it("owes the newest after a failed read only while a jump the reader still owns was waiting", () => {
    expect({
      jump: owedAfter({ kind: "awaitingPage", want: "newest", resume: { kind: "following" } }),
      jumpDuringOlder: owedAfter({ kind: "awaitingPage", want: "older", resume: { kind: "following" } }),
      takenOver: owedAfter({ kind: "awaitingPage", want: "newest", resume: { kind: "holding" } }),
      older: owedAfter({ kind: "awaitingPage", want: "older", resume: { kind: "holding" } }),
      notWaiting: owedAfter({ kind: "holding" }),
    }).toEqual({ jump: "newest", jumpDuringOlder: "newest", takenOver: "reevaluate", older: "reevaluate", notWaiting: "reevaluate" });
  });
});
