// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { runDuration } from "./ChatView";

describe("runDuration", () => {
  it("formats durations at every scale", () => {
    expect(runDuration(900)).toBe("1s");
    expect(runDuration(65_000)).toBe("1m 5s");
    expect(runDuration(3_900_000)).toBe("1h 5m");
  });
});
