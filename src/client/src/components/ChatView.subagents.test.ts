// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { subagentRunDuration, topDrawerStartsOpen } from "./ChatView";

describe("topDrawerStartsOpen", () => {
  // The complaint this answers: two finished background tasks covered a third
  // of a phone screen and could not be closed.
  it("never opens itself, whatever is happening", () => {
    expect(topDrawerStartsOpen()).toBe(false);
  });
});

describe("subagentRunDuration", () => {
  it("formats durations at every scale", () => {
    expect(subagentRunDuration(900)).toBe("1s");
    expect(subagentRunDuration(65_000)).toBe("1m 5s");
    expect(subagentRunDuration(3_900_000)).toBe("1h 5m");
  });
});
