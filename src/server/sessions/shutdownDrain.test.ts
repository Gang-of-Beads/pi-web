import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DRAIN_TIMEOUT_MS,
  drainActiveWork,
  drainDecision,
  resolveDrainTimeoutMs,
} from "./shutdownDrain";

describe("drainDecision", () => {
  it("exits immediately when nothing is working", () => {
    expect(drainDecision({ activeSessionIds: [], elapsedMs: 0, timeoutMs: 60_000 }))
      .toEqual({ wait: false, reason: "no-active-work", activeSessionIds: [] });
  });

  it("waits while a run is in flight", () => {
    const decision = drainDecision({ activeSessionIds: ["s1"], elapsedMs: 0, timeoutMs: 60_000 });
    expect(decision.wait).toBe(true);
    expect(decision.reason).toBe("waiting-for-active-work");
  });

  it("gives up at the deadline rather than holding a restart open forever", () => {
    const decision = drainDecision({ activeSessionIds: ["s1"], elapsedMs: 60_000, timeoutMs: 60_000 });
    expect(decision.wait).toBe(false);
    expect(decision.reason).toBe("deadline-reached");
    // Reported, not dropped: the operator should know what was cut off.
    expect(decision.activeSessionIds).toEqual(["s1"]);
  });

  it("can be switched off entirely, restoring immediate exit", () => {
    const decision = drainDecision({ activeSessionIds: ["s1"], elapsedMs: 0, timeoutMs: 0 });
    expect(decision).toEqual({ wait: false, reason: "drain-disabled", activeSessionIds: ["s1"] });
  });
});

describe("resolveDrainTimeoutMs", () => {
  it("defaults when unset", () => {
    expect(resolveDrainTimeoutMs({})).toBe(DEFAULT_DRAIN_TIMEOUT_MS);
  });

  it("honours an explicit value, including zero to disable", () => {
    expect(resolveDrainTimeoutMs({ PI_WEB_SHUTDOWN_DRAIN_MS: "5000" })).toBe(5000);
    expect(resolveDrainTimeoutMs({ PI_WEB_SHUTDOWN_DRAIN_MS: "0" })).toBe(0);
  });

  it("falls back on nonsense rather than failing a shutdown", () => {
    // Refusing to stop would be worse than a mistyped timeout.
    expect(resolveDrainTimeoutMs({ PI_WEB_SHUTDOWN_DRAIN_MS: "abc" })).toBe(DEFAULT_DRAIN_TIMEOUT_MS);
    expect(resolveDrainTimeoutMs({ PI_WEB_SHUTDOWN_DRAIN_MS: "-1" })).toBe(DEFAULT_DRAIN_TIMEOUT_MS);
  });
});

describe("drainActiveWork", () => {
  it("returns as soon as the work finishes", async () => {
    let active = ["s1", "s2"];
    let elapsed = 0;
    const decision = await drainActiveWork(60_000, {
      activeSessionIds: () => active,
      elapsedMs: () => elapsed,
      wait: (ms) => { elapsed += ms; if (elapsed >= 500) active = []; return Promise.resolve(); },
    });

    expect(decision.reason).toBe("no-active-work");
    expect(elapsed).toBeLessThan(60_000);
  });

  it("stops at the deadline when the work never finishes", async () => {
    let elapsed = 0;
    const decision = await drainActiveWork(1000, {
      activeSessionIds: () => ["stuck"],
      elapsedMs: () => elapsed,
      wait: (ms) => { elapsed += ms; return Promise.resolve(); },
    });

    expect(decision.reason).toBe("deadline-reached");
    expect(decision.activeSessionIds).toEqual(["stuck"]);
  });

  it("does not wait at all when draining is disabled", async () => {
    const wait = vi.fn(() => Promise.resolve());
    const decision = await drainActiveWork(0, {
      activeSessionIds: () => ["s1"],
      elapsedMs: () => 0,
      wait,
    });

    expect(decision.reason).toBe("drain-disabled");
    expect(wait).not.toHaveBeenCalled();
  });

  it("reports progress so the operator sees why the exit is delayed", async () => {
    const seen: string[] = [];
    let active = ["s1"];
    let elapsed = 0;
    await drainActiveWork(60_000, {
      activeSessionIds: () => active,
      elapsedMs: () => elapsed,
      wait: (ms) => { elapsed += ms; active = []; return Promise.resolve(); },
      onProgress: (decision) => { seen.push(decision.reason); },
    });

    expect(seen).toEqual(["waiting-for-active-work", "no-active-work"]);
  });
});
