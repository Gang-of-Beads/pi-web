import { describe, expect, it } from "vitest";
import { BANNER_MIN_VISIBLE_MS, TRANSIENT_GRACE_MS } from "../components/bannerHold";
import { rowDecision } from "./connectionSummary";

const now = 100_000;

describe("rowDecision", () => {
  it("answers every combination of notice, unanswered time and a showing row", () => {
    const cases = {
      "quiet": rowDecision({ notice: false, unansweredSince: undefined, reconnectingShownAt: undefined, now }),
      "notice wins over reconnecting": rowDecision({ notice: true, unansweredSince: now - 60_000, reconnectingShownAt: now - 10_000, now }),
      "missed inside the grace": rowDecision({ notice: false, unansweredSince: now - 1000, reconnectingShownAt: undefined, now }),
      "missed past the grace": rowDecision({ notice: false, unansweredSince: now - TRANSIENT_GRACE_MS, reconnectingShownAt: undefined, now }),
      "still missing while shown": rowDecision({ notice: false, unansweredSince: now - 100, reconnectingShownAt: now - 20_000, now }),
      "answered inside the hold": rowDecision({ notice: false, unansweredSince: undefined, reconnectingShownAt: now - 500, now }),
      "answered past the hold": rowDecision({ notice: false, unansweredSince: undefined, reconnectingShownAt: now - BANNER_MIN_VISIBLE_MS, now }),
    };
    expect(cases).toEqual({
      "quiet": { claim: "none" },
      "notice wins over reconnecting": { claim: "notice" },
      "missed inside the grace": { claim: "none", recheckInMs: TRANSIENT_GRACE_MS - 1000 },
      "missed past the grace": { claim: "reconnecting" },
      "still missing while shown": { claim: "reconnecting" },
      "answered inside the hold": { claim: "reconnecting", recheckInMs: BANNER_MIN_VISIBLE_MS - 500 },
      "answered past the hold": { claim: "none" },
    });
  });
});
