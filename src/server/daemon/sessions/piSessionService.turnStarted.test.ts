import { describe, expect, it } from "vitest";
import { turnStartedAtFromBranch } from "./piSessionService.js";

describe("turnStartedAtFromBranch", () => {
  it("returns undefined for an empty branch", () => {
    expect(turnStartedAtFromBranch([])).toBeUndefined();
  });

  it("returns undefined when the tail entry is a user message without a timestamp", () => {
    expect(turnStartedAtFromBranch([{ type: "message", message: { role: "user" } }])).toBeUndefined();
  });

  it("skips assistant entries and reads the timestamp from the latest user message", () => {
    const branch = [
      { type: "message", message: { role: "user", timestamp: "2026-02-03T09:00:00.000Z" } },
      { type: "message", message: { role: "assistant" } },
      { type: "message", message: { role: "user", timestamp: "2026-02-03T10:00:00.000Z" } },
    ];
    expect(turnStartedAtFromBranch(branch)).toBe("2026-02-03T10:00:00.000Z");
  });

  it("prefers the entry timestamp over the message's own", () => {
    const branch = [
      { type: "message", timestamp: "2026-02-03T10:00:00.000Z", message: { role: "user", timestamp: "2026-02-03T09:00:00.000Z" } },
    ];
    expect(turnStartedAtFromBranch(branch)).toBe("2026-02-03T10:00:00.000Z");
  });

  /**
   * A turn can also be started by a custom entry - an extension's follow-up,
   * for example - which carries its own millisecond timestamp.
   */
  it("reads a custom_message details timestamp", () => {
    const branch = [
      { type: "message", message: { role: "user", timestamp: "2026-02-03T09:00:00.000Z" } },
      { type: "custom_message", details: { timestamp: Date.UTC(2026, 1, 3, 10, 0, 0) } },
    ];
    expect(turnStartedAtFromBranch(branch)).toBe("2026-02-03T10:00:00.000Z");
  });

  it("ignores tool and assistant activity after the input boundary", () => {
    const branch = [
      { type: "message", message: { role: "user", timestamp: "2026-02-03T10:00:00.000Z" } },
      { type: "message", message: { role: "assistant", timestamp: "2026-02-03T10:00:30.000Z" } },
      { type: "tool_call", timestamp: "2026-02-03T10:01:00.000Z" },
    ];
    expect(turnStartedAtFromBranch(branch)).toBe("2026-02-03T10:00:00.000Z");
  });
});
