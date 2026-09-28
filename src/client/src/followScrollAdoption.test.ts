import { describe, expect, it } from "vitest";
import { FOLLOW_SCROLL_GRACE_MS, followScrollVerdict } from "./followScrollAdoption.js";

describe("whose scroll was it", () => {
  it("calls our own follow scroll our own", () => {
    expect(followScrollVerdict({ target: 4200, scrollTop: 4201, ageMs: 16 })).toBe("our-scroll");
  });

  it("calls a stale target the reader, even when the position happens to match", () => {
    // The bounce: a target written when the view followed, met again by hand long
    // after. Adopting it re-pinned the view and dragged the reader down.
    expect(followScrollVerdict({ target: 4200, scrollTop: 4200, ageMs: FOLLOW_SCROLL_GRACE_MS + 100 })).toBe("reader-scroll");
  });

  it("calls a fresh target we did not reach the reader", () => {
    expect(followScrollVerdict({ target: 900, scrollTop: 200, ageMs: 30 })).toBe("reader-scroll");
  });

  it("has nothing to say without a target", () => {
    expect(followScrollVerdict({ target: undefined, scrollTop: 10, ageMs: 5000 })).toBe("unaimed");
  });

  it("tolerates a sub-pixel landing", () => {
    expect(followScrollVerdict({ target: 1000, scrollTop: 1002, ageMs: 10 })).toBe("our-scroll");
    expect(followScrollVerdict({ target: 1000, scrollTop: 1003, ageMs: 10 })).toBe("reader-scroll");
  });
});
