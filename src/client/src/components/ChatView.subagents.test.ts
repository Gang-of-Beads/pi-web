// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { subagentRunDuration } from "./ChatView";

describe("subagentRunDuration", () => {
  it("formats durations at every scale", () => {
    expect(subagentRunDuration(900)).toBe("1s");
    expect(subagentRunDuration(65_000)).toBe("1m 5s");
    expect(subagentRunDuration(3_900_000)).toBe("1h 5m");
  });
});
