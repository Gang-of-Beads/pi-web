import { describe, expect, it } from "vitest";
import { SETTLE_GRACE_MS, handoffEnters, idleBatchSize, isSettling, leadingCommandCount, nextHandoff, refusalKind, runStateOf, type RunState } from "./promptHandoff.js";

const RUN_STATES: RunState[] = ["compacting", "handing", "stopping", "running", "settling", "idle"];

describe("nextHandoff", () => {
  it("waits on an empty inbox in every state", () => {
    expect(RUN_STATES.map((run) => nextHandoff({ waiting: 0, leadingCommands: 0, run }).kind)).toEqual(["wait", "wait", "wait", "wait", "wait", "wait"]);
  });

  it("answers every run state with a waiting inbox, hands a running agent everything at once (B33), and a stopping one only the commands at the head", () => {
    expect(Object.fromEntries(RUN_STATES.map((run) => [run, nextHandoff({ waiting: 3, leadingCommands: 0, run })]))).toEqual({
      compacting: { kind: "wait" },
      handing: { kind: "wait" },
      stopping: { kind: "wait" },
      running: { kind: "steer", count: 3 },
      settling: { kind: "wait" },
      idle: { kind: "direct" },
    });
    expect(Object.fromEntries(RUN_STATES.map((run) => [run, nextHandoff({ waiting: 3, leadingCommands: 2, run })]))).toEqual({
      compacting: { kind: "wait" },
      handing: { kind: "wait" },
      stopping: { kind: "steer", count: 2 },
      running: { kind: "steer", count: 3 },
      settling: { kind: "wait" },
      idle: { kind: "direct" },
    });
    expect(Object.fromEntries(RUN_STATES.map((run) => [run, [handoffEnters(run, "steer", false), handoffEnters(run, "steer", true), handoffEnters(run, "direct", false), handoffEnters(run, "direct", true)]]))).toEqual({
      compacting: [false, false, false, false],
      handing: [false, false, false, false],
      stopping: [false, true, false, false],
      running: [true, true, false, false],
      settling: [false, false, false, false],
      idle: [false, false, true, true],
    });
  });
});

describe("idleBatchSize", () => {
  it("takes everything up to the first extension command, and a command at the head alone", () => {
    const shapes = [[], [false], [false, false, false], [false, false, true, false], [false, true], [true, false, false], [true], [true, true, false]];
    expect(shapes.map((isCommand) => idleBatchSize(isCommand))).toEqual([0, 1, 3, 2, 1, 1, 1, 1]);
    expect(shapes.map((isCommand) => leadingCommandCount(isCommand))).toEqual([0, 0, 0, 0, 0, 1, 1, 2]);
  });
});

describe("runStateOf", () => {
  it("ranks compaction over a handoff over streaming (stopping once the reader cut it) over settling", () => {
    expect(runStateOf({ isCompacting: true, isStreaming: true, handing: true, cutByReader: true, settling: true })).toBe("compacting");
    expect(runStateOf({ isCompacting: false, isStreaming: true, handing: true, cutByReader: true, settling: true })).toBe("handing");
    expect(runStateOf({ isCompacting: false, isStreaming: true, handing: false, cutByReader: true, settling: true })).toBe("stopping");
    expect(runStateOf({ isCompacting: false, isStreaming: true, handing: false, cutByReader: false, settling: true })).toBe("running");
    expect(runStateOf({ isCompacting: false, isStreaming: false, handing: false, cutByReader: true, settling: true })).toBe("settling");
    expect(runStateOf({ isCompacting: false, isStreaming: false, handing: false, cutByReader: false, settling: false })).toBe("idle");
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
