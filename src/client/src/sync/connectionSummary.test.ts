import { describe, expect, it } from "vitest";
import { BANNER_MIN_VISIBLE_MS, TRANSIENT_GRACE_MS } from "../components/bannerHold";
import { rowDecision } from "./connectionSummary";

const now = 100_000;

const linkDown = { kind: "link-down" } as const;
const serverError = { kind: "server-error", machineId: "local", reason: "Project store is locked" } as const;

describe("rowDecision", () => {
  it("answers every combination of notice, unanswered time and a showing row, and carries why", () => {
    const cases = {
      "quiet": rowDecision({ notice: false, unanswered: undefined, shown: undefined, behind: undefined, lookingSince: 0, now }),
      "notice wins over an unanswered read": rowDecision({ notice: true, unanswered: { since: now - 60_000, miss: linkDown }, shown: { at: now - 10_000, miss: linkDown }, behind: undefined, lookingSince: 0, now }),
      "missed inside the grace": rowDecision({ notice: false, unanswered: { since: now - 1000, miss: linkDown }, shown: undefined, behind: undefined, lookingSince: 0, now }),
      "missed past the grace": rowDecision({ notice: false, unanswered: { since: now - TRANSIENT_GRACE_MS, miss: linkDown }, shown: undefined, behind: undefined, lookingSince: 0, now }),
      "a server error past the grace": rowDecision({ notice: false, unanswered: { since: now - TRANSIENT_GRACE_MS, miss: serverError }, shown: undefined, behind: undefined, lookingSince: 0, now }),
      "the reason changed while shown": rowDecision({ notice: false, unanswered: { since: now - 25_000, miss: serverError }, shown: { at: now - 20_000, miss: linkDown }, behind: undefined, lookingSince: 0, now }),
      "a request sent after the row appeared, past the hold": rowDecision({ notice: false, unanswered: { since: now - 100, miss: linkDown }, shown: { at: now - 20_000, miss: linkDown }, behind: undefined, lookingSince: 0, now }),
      "a request sent after the row appeared, inside the hold": rowDecision({ notice: false, unanswered: { since: now - 100, miss: linkDown }, shown: { at: now - 500, miss: serverError }, behind: undefined, lookingSince: 0, now }),
      "answered inside the hold": rowDecision({ notice: false, unanswered: undefined, shown: { at: now - 500, miss: serverError }, behind: undefined, lookingSince: 0, now }),
      "answered past the hold": rowDecision({ notice: false, unanswered: undefined, shown: { at: now - BANNER_MIN_VISIBLE_MS, miss: linkDown }, behind: undefined, lookingSince: 0, now }),
      "behind a machine": rowDecision({ notice: false, unanswered: undefined, shown: undefined, behind: { machineId: "local", since: now - 5000 }, lookingSince: 0, now }),
      "behind a machine, unanswered inside the grace": rowDecision({ notice: false, unanswered: { since: now - 1000, miss: linkDown }, shown: undefined, behind: { machineId: "local", since: now - 5000 }, lookingSince: 0, now }),
      "behind a machine, unanswered past the grace": rowDecision({ notice: false, unanswered: { since: now - TRANSIENT_GRACE_MS, miss: linkDown }, shown: undefined, behind: { machineId: "local", since: now - 5000 }, lookingSince: 0, now }),
      "a notice over being behind": rowDecision({ notice: true, unanswered: undefined, shown: undefined, behind: { machineId: "local", since: now - 5000 }, lookingSince: 0, now }),
    };
    expect(cases).toEqual({
      "quiet": { claim: { kind: "none" } },
      "notice wins over an unanswered read": { claim: { kind: "notice" } },
      "missed inside the grace": { claim: { kind: "none" }, recheckInMs: TRANSIENT_GRACE_MS - 1000 },
      "missed past the grace": { claim: { kind: "unanswered", miss: linkDown } },
      "a server error past the grace": { claim: { kind: "unanswered", miss: serverError } },
      "the reason changed while shown": { claim: { kind: "unanswered", miss: serverError } },
      "a request sent after the row appeared, past the hold": { claim: { kind: "none" }, recheckInMs: TRANSIENT_GRACE_MS - 100 },
      "a request sent after the row appeared, inside the hold": { claim: { kind: "unanswered", miss: serverError }, recheckInMs: Math.min(BANNER_MIN_VISIBLE_MS - 500, TRANSIENT_GRACE_MS - 100) },
      "answered inside the hold": { claim: { kind: "unanswered", miss: serverError }, recheckInMs: BANNER_MIN_VISIBLE_MS - 500 },
      "answered past the hold": { claim: { kind: "none" } },
      "behind a machine": { claim: { kind: "syncing", machineId: "local" } },
      "behind a machine, unanswered inside the grace": { claim: { kind: "syncing", machineId: "local" }, recheckInMs: TRANSIENT_GRACE_MS - 1000 },
      "behind a machine, unanswered past the grace": { claim: { kind: "unanswered", miss: linkDown } },
      "a notice over being behind": { claim: { kind: "notice" } },
    });
  });
});
