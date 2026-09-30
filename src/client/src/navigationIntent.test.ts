import { describe, expect, it } from "vitest";
import { NavigationIntents, navigationPhase, OPENING_WORDS, SLOW_AFTER_MS, STALLED_AFTER_MS, type NavigationClock, type NavigationPhase } from "./navigationIntent";

function fakeClock(): NavigationClock & { advance(ms: number): void; armed(): number } {
  let now = 0;
  let timers: { at: number; run: () => void }[] = [];
  return {
    now: () => now,
    after: (ms, run) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => { timers = timers.filter((entry) => entry !== timer); };
    },
    advance(ms) {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now);
      timers = timers.filter((timer) => timer.at > now);
      for (const timer of due) timer.run();
    },
    armed: () => timers.length,
  };
}

describe("navigationPhase", () => {
  it.each<[number, boolean, NavigationPhase]>([
    [0, false, "going"],
    [SLOW_AFTER_MS - 1, false, "going"],
    [SLOW_AFTER_MS, false, "slow"],
    [STALLED_AFTER_MS - 1, false, "slow"],
    [STALLED_AFTER_MS, false, "stalled"],
    [0, true, "failed"],
    [STALLED_AFTER_MS, true, "failed"],
  ])("%i ms, failed %s: %s", (elapsed, failed, phase) => {
    expect(navigationPhase(elapsed, failed)).toBe(phase);
  });

  it("names every phase for the tapped item, and the first frame needs no words", () => {
    expect(OPENING_WORDS.going).toBe("");
    for (const phase of ["slow", "stalled", "failed"] as const) expect(OPENING_WORDS[phase]).not.toBe("");
  });
});

describe("NavigationIntents", () => {
  const target = { key: "local:s1", label: "Session one" };

  it("shows the tapped item as going at once, then slow, then stalled, redrawing at each step", () => {
    const clock = fakeClock();
    let draws = 0;
    const intents = new NavigationIntents(() => { draws += 1; }, clock);
    intents.begin(target);
    expect({ phase: intents.view()?.phase, draws }).toEqual({ phase: "going", draws: 1 });
    clock.advance(SLOW_AFTER_MS);
    expect({ phase: intents.view()?.phase, draws }).toEqual({ phase: "slow", draws: 2 });
    clock.advance(STALLED_AFTER_MS);
    expect({ phase: intents.view()?.phase, draws }).toEqual({ phase: "stalled", draws: 3 });
  });

  it("lets only the latest intent move the page", () => {
    const intents = new NavigationIntents(() => undefined, fakeClock());
    const first = intents.begin(target);
    const second = intents.begin();
    expect({ first: intents.isCurrent(first), second: intents.isCurrent(second), pending: intents.view() }).toEqual({ first: false, second: true, pending: undefined });
  });

  it("settles and fails only the intent it was given", () => {
    const clock = fakeClock();
    const intents = new NavigationIntents(() => undefined, clock);
    const stale = intents.begin(target);
    const current = intents.begin({ key: "local:s2", label: "Session two" });
    intents.settle(stale);
    intents.fail(stale);
    expect(intents.view()).toEqual({ key: "local:s2", label: "Session two", phase: "going" });
    intents.fail(current);
    expect(intents.view()?.phase).toBe("failed");
    expect(clock.armed()).toBe(0);
    intents.settle(current);
    expect(intents.view()).toBeUndefined();
  });

  it("ignores a second tap on the item already opening, and retries a failed one", () => {
    const intents = new NavigationIntents(() => undefined, fakeClock());
    const seq = intents.begin(target);
    expect(intents.isOpening(target.key)).toBe(true);
    intents.fail(seq);
    expect(intents.isOpening(target.key)).toBe(false);
  });

  it("cancels a pending open without moving, and supersedes it", () => {
    const clock = fakeClock();
    const intents = new NavigationIntents(() => undefined, clock);
    const seq = intents.begin(target);
    intents.cancel();
    expect({ current: intents.isCurrent(seq), pending: intents.view(), timers: clock.armed() }).toEqual({ current: false, pending: undefined, timers: 0 });
    const after = intents.latest();
    intents.cancel();
    expect(intents.latest()).toBe(after);
  });
});
