import { describe, expect, it } from "vitest";
import type { SessionStep } from "../../../shared/apiTypes";
import { parseSessionStep } from "./sessionStepParser";

describe("reading the step an activity frame carries (B25)", () => {
  const steps: SessionStep[] = [
    { kind: "idle" },
    { kind: "waiting" },
    { kind: "thinking" },
    { kind: "writing" },
    { kind: "compacting" },
    { kind: "preparing" },
    { kind: "preparing", tool: "edit" },
    { kind: "running", tools: [{ id: "c1", name: "bash", target: "sleep 25" }, { id: "c2", name: "read" }] },
    { kind: "retrying", attempt: 2, maxAttempts: 3, reason: "overloaded", resumesAt: "2026-10-02T10:00:04.000Z" },
    { kind: "bash", command: "ls" },
  ];

  it.each(steps)("reads $kind as sent", (step) => {
    expect(parseSessionStep(JSON.parse(JSON.stringify(step)))).toEqual(step);
  });

  it("reads a step it does not know, or a malformed one, as no step", () => {
    expect([
      parseSessionStep({ kind: "dreaming" }),
      parseSessionStep({ kind: "toString" }),
      parseSessionStep({ kind: "running", tools: [{ name: "bash" }] }),
      parseSessionStep({ kind: "retrying", attempt: "2" }),
      parseSessionStep(undefined),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
