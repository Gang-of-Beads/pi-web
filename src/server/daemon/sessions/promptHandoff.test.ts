import { describe, expect, it } from "vitest";
import { nextHandoff, refusalKind, runStateOf, type HandoffTrigger, type RunState } from "./promptHandoff.js";

const RUN_STATES: RunState[] = ["compacting", "handing", "running", "idle"];
const TRIGGERS: HandoffTrigger[] = ["gap", "settled", "nudge"];

describe("nextHandoff", () => {
  it("waits on an empty inbox in every state", () => {
    for (const run of RUN_STATES) for (const trigger of TRIGGERS) {
      expect(nextHandoff({ waiting: 0, run, trigger })).toEqual({ kind: "wait" });
    }
  });

  it("answers every run state and trigger with a waiting inbox", () => {
    const table = Object.fromEntries(RUN_STATES.map((run) => [run, Object.fromEntries(TRIGGERS.map((trigger) => [trigger, nextHandoff({ waiting: 3, run, trigger }).kind]))]));
    expect(table).toEqual({
      compacting: { gap: "wait", settled: "wait", nudge: "wait" },
      handing: { gap: "wait", settled: "wait", nudge: "wait" },
      running: { gap: "steer", settled: "wait", nudge: "wait" },
      idle: { gap: "direct", settled: "direct", nudge: "direct" },
    });
  });

  it("hands everything waiting at a gap, not only the head", () => {
    expect(nextHandoff({ waiting: 3, run: "running", trigger: "gap" })).toEqual({ kind: "steer", count: 3 });
  });
});

describe("runStateOf", () => {
  it("ranks compaction over a handoff over streaming", () => {
    expect(runStateOf({ isCompacting: true, isStreaming: true, handing: true })).toBe("compacting");
    expect(runStateOf({ isCompacting: false, isStreaming: true, handing: true })).toBe("handing");
    expect(runStateOf({ isCompacting: false, isStreaming: true, handing: false })).toBe("running");
    expect(runStateOf({ isCompacting: false, isStreaming: false, handing: false })).toBe("idle");
  });
});

describe("refusalKind", () => {
  it("keeps a message whose refusal is the runtime being busy", () => {
    expect(refusalKind("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.")).toBe("transient");
    expect(refusalKind("Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.")).toBe("transient");
  });

  it("releases a message the runtime will never take", () => {
    expect(refusalKind("No model selected.")).toBe("terminal");
    expect(refusalKind("Authentication failed for \"anthropic\".")).toBe("terminal");
  });
});
