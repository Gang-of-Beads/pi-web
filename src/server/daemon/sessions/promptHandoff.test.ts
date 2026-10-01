import { describe, expect, it } from "vitest";
import { SETTLE_GRACE_MS, idleBatchSize, isSettling, nextHandoff, refusalKind, runStateOf, type RunState } from "./promptHandoff.js";

const RUN_STATES: RunState[] = ["compacting", "handing", "running", "settling", "idle"];

describe("nextHandoff", () => {
  it("waits on an empty inbox in every state", () => {
    expect(RUN_STATES.map((run) => nextHandoff({ waiting: 0, run }).kind)).toEqual(["wait", "wait", "wait", "wait", "wait"]);
  });

  it("answers every run state with a waiting inbox, and hands a running agent everything at once (B33)", () => {
    expect(Object.fromEntries(RUN_STATES.map((run) => [run, nextHandoff({ waiting: 3, run })]))).toEqual({
      compacting: { kind: "wait" },
      handing: { kind: "wait" },
      running: { kind: "steer", count: 3 },
      settling: { kind: "wait" },
      idle: { kind: "direct" },
    });
  });
});

describe("idleBatchSize", () => {
  it("takes everything up to the first extension command, and a command at the head alone", () => {
    const table = [[], [false], [false, false, false], [false, false, true, false], [false, true], [true, false, false], [true]].map((isCommand) => idleBatchSize(isCommand));
    expect(table).toEqual([0, 1, 3, 2, 1, 1, 1]);
  });
});

describe("runStateOf", () => {
  it("ranks compaction over a handoff over streaming over settling", () => {
    expect(runStateOf({ isCompacting: true, isStreaming: true, handing: true, settling: true })).toBe("compacting");
    expect(runStateOf({ isCompacting: false, isStreaming: true, handing: true, settling: true })).toBe("handing");
    expect(runStateOf({ isCompacting: false, isStreaming: true, handing: false, settling: true })).toBe("running");
    expect(runStateOf({ isCompacting: false, isStreaming: false, handing: false, settling: true })).toBe("settling");
    expect(runStateOf({ isCompacting: false, isStreaming: false, handing: false, settling: false })).toBe("idle");
  });
});

describe("isSettling", () => {
  it("is not settling with no open run", () => {
    expect(isSettling(undefined, 0)).toBe(false);
  });

  it("settles a quiet open run until the grace runs out, so a lost agent_settled cannot stall the inbox", () => {
    expect(isSettling({}, 1_000)).toBe(true);
    expect(isSettling({ quietSince: 1_000 }, 1_000 + SETTLE_GRACE_MS - 1)).toBe(true);
    expect(isSettling({ quietSince: 1_000 }, 1_000 + SETTLE_GRACE_MS)).toBe(false);
  });
});

describe("refusalKind", () => {
  it("keeps a message whose refusal is the runtime being busy", () => {
    expect(refusalKind("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.")).toBe("transient");
    expect(refusalKind("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.")).toBe("transient");
    expect(refusalKind("Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.")).toBe("transient");
    expect(refusalKind("Cannot send a prompt while session tree navigation is active")).toBe("transient");
  });

  it("releases a message the runtime will never take", () => {
    expect(refusalKind("No model selected.")).toBe("terminal");
    expect(refusalKind("Authentication failed for \"anthropic\".")).toBe("terminal");
  });
});
