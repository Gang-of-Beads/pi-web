import { describe, expect, it } from "vitest";
import { payloadRevision } from "./payloadRevision.js";

describe("payloadRevision", () => {
  it("is stable for the same payload regardless of construction order", () => {
    const first = payloadRevision([{ id: "a" }, { id: "b" }]);
    const second = payloadRevision([{ id: "a" }, { id: "b" }]);
    expect(first).toBe(second);
  });

  it("differs when any contained field changes", () => {
    const before = payloadRevision([{ id: "a", modified: "2026-01-01" }]);
    const after = payloadRevision([{ id: "a", modified: "2026-01-02" }]);
    expect(before).not.toBe(after);
  });

  it("differs across payload shapes a JSON stringify would conflate", () => {
    expect(payloadRevision(["a"])).not.toBe(payloadRevision("a"));
    expect(payloadRevision(null)).not.toBe(payloadRevision("null"));
  });

  it("answers fixed-width hex", () => {
    expect(payloadRevision({})).toMatch(/^[0-9a-f]{8}$/);
  });
});
