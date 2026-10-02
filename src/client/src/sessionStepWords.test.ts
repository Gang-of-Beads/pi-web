import { describe, expect, it } from "vitest";
import type { SessionStep } from "../../shared/apiTypes";
import { stepStatusText, stepWaitingText } from "./sessionStepWords";

const steps: { step: SessionStep; text: string }[] = [
  { step: { kind: "idle" }, text: "Idle" },
  { step: { kind: "waiting" }, text: "Waiting for the model · 4 s" },
  { step: { kind: "thinking" }, text: "Thinking · 4 s" },
  { step: { kind: "writing" }, text: "Writing the reply · 4 s" },
  { step: { kind: "preparing" }, text: "Preparing a tool call · 4 s" },
  { step: { kind: "preparing", tool: "edit" }, text: "Preparing edit · 4 s" },
  { step: { kind: "running", tools: [{ id: "b", name: "bash", target: "sleep 25" }, { id: "r", name: "read" }] }, text: "Running bash: sleep 25 · read · 4 s" },
  { step: { kind: "retrying", attempt: 2, maxAttempts: 3, reason: "overloaded", resumesAt: "t" }, text: "Retrying, attempt 2 of 3: overloaded · 4 s" },
  { step: { kind: "compacting" }, text: "Compacting the history · 4 s" },
  { step: { kind: "bash", command: "ls" }, text: "Running ls · 4 s" },
];

describe("what the status line says for each step (B25)", () => {
  it.each(steps)("$step.kind -> $text", ({ step, text }) => {
    expect(stepStatusText(step, 1_000, 5_000)).toBe(text);
  });

  it("counts minutes once a step runs past one", () => {
    expect(stepStatusText({ kind: "thinking" }, 0, 125_000)).toBe("Thinking · 2 min 5 s");
  });

  it("says when what waits is read, from the step it waits behind", () => {
    expect([
      stepWaitingText({ kind: "running", tools: [] }, { messages: 2, answers: 0 }),
      stepWaitingText({ kind: "writing" }, { messages: 0, answers: 1 }),
      stepWaitingText({ kind: "compacting" }, { messages: 1, answers: 1 }),
      stepWaitingText({ kind: "thinking" }, { messages: 0, answers: 0 }),
    ]).toEqual([
      "2 messages are read when these tools finish",
      "your answer is read when this reply ends",
      "your answer and 1 message are read next",
      undefined,
    ]);
  });
});
