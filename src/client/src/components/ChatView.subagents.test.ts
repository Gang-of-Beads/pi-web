// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { SessionSubagentInfo, SessionSubagentRunInfo } from "../../../shared/apiTypes";
import { activityStripSummary, subagentStatusLabel, isActiveActivityStatus, subagentRows, subagentRunDuration, subagentRunRows, topDrawerStartsOpen } from "./ChatView";

const SUBAGENTS: SessionSubagentInfo[] = [
  { sessionId: "01a0child-0001-0000-000000000001", cwd: "/repo/.pi/sub", status: "working" },
  { sessionId: "01a0child-0002-0000-000000000002", cwd: "/repo/.pi/sub", status: "idle" },
];

describe("topDrawerStartsOpen", () => {
  // The complaint this answers: two finished background tasks covered a third
  // of a phone screen and could not be closed.
  it("stays folded when everything is finished", () => {
    expect(topDrawerStartsOpen()).toBe(false);
  });

});

describe("activityStripSummary", () => {
  it("reports that work is running and that some of it failed", () => {
    expect(activityStripSummary(["working", "running", "failed", "idle", "done"])).toEqual({ working: true, failed: true });
  });

  it("reports a quiet strip as neither working nor failed", () => {
    expect(activityStripSummary(["done", "done"])).toEqual({ working: false, failed: false });
    expect(activityStripSummary([])).toEqual({ working: false, failed: false });
  });
});

const RUNS: SessionSubagentRunInfo[] = [
  { runId: "run-live", agent: "scout", status: "running", elapsedMs: 42_000, startedAt: "2026-08-21T10:00:00.000Z", lastActivity: "bash", hasOutput: false },
  { runId: "run-done", agent: "reviewer", status: "done", elapsedMs: 125_000, startedAt: "2026-08-21T09:00:00.000Z", task: "review the diff", hasOutput: true },
];

describe("subagentRunRows", () => {
  it("shows the live step while running and the task once finished", () => {
    const [live, done] = subagentRunRows(RUNS);
    expect(live).toMatchObject({ statusLabel: "Running", duration: "42s", detail: "bash" });
    expect(done).toMatchObject({ statusLabel: "Done", duration: "2m 5s", detail: "review the diff" });
  });

  it("formats durations at every scale", () => {
    expect(subagentRunDuration(900)).toBe("1s");
    expect(subagentRunDuration(65_000)).toBe("1m 5s");
    expect(subagentRunDuration(3_900_000)).toBe("1h 5m");
  });
});

// The pure seam: rendered rows derive their fields once, so the strip stays a
// dumb map and this shape is what the template consumes.
describe("subagentRows", () => {
  it("shortens ids and labels status with a caption word", () => {
    expect(subagentRows(SUBAGENTS)).toEqual([
      { subagent: SUBAGENTS[0], shortId: "00000001", status: "working", statusLabel: "Working", cwd: "/repo/.pi/sub", ariaLabel: "Working subagent 00000001" },
      { subagent: SUBAGENTS[1], shortId: "00000002", status: "idle", statusLabel: "Idle", cwd: "/repo/.pi/sub", ariaLabel: "Idle subagent 00000002" },
    ]);
  });
});

describe("isActiveActivityStatus", () => {
  it("counts only work that is happening now", () => {
    expect((["working", "running"] as const).every(isActiveActivityStatus)).toBe(true);
    expect((["idle", "done", "failed", "unknown", "lost"] as const).some(isActiveActivityStatus)).toBe(false);
  });
});

describe("run status labels", () => {
  // Keyed by the union: adding a status without giving it a word stops
  // compiling here instead of quietly reading "Unknown" in the drawer.
  const EXPECTED: Record<SessionSubagentRunInfo["status"], string> = {
    // Stopped now means the reader stopped it. A run whose tracking was lost
    // is reported as lost: saying "Stopped" claimed an action nobody took.
    running: "Running", done: "Done", failed: "Failed", lost: "Lost", unknown: "Running",
  };
  const SUBAGENT_RUN_STATUSES: readonly SessionSubagentRunInfo["status"][] = ["running", "done", "failed", "lost", "unknown"];

  it("gives every status its own word", () => {
    for (const status of Object.keys(EXPECTED)) {
      const run = SUBAGENT_RUN_STATUSES.find((known) => known === status);
      if (run === undefined) throw new Error(`unknown status ${status}`);
      const [row] = subagentRunRows([{ runId: "r", agent: "worker", status: run, elapsedMs: 0, startedAt: "2026-08-25T10:00:00.000Z", hasOutput: false }]);
      expect(row?.statusLabel).toBe(EXPECTED[run]);
    }
  });
});

describe("a run whose tracking was lost", () => {
  it("is named rather than left a mystery, and is not counted as running", () => {
    const [row] = subagentRunRows([{ runId: "r", agent: "worker", status: "lost", elapsedMs: 1000, startedAt: "2026-08-25T10:00:00.000Z", hasOutput: false }]);

    expect(row?.statusLabel).toBe("Lost");
    // Losing track of a run is not the run failing, so it is not filed as one.
    expect(row?.status).toBe("lost");
    expect(isActiveActivityStatus(row?.status ?? "unknown")).toBe(false);
  });

});

describe("subagentStatusLabel", () => {
  it("speaks in the same voice as the other activity rows", () => {
    // Agent-run rows report Running / Done / Failed, so passing a subagent's
    // raw status through put "Working" directly above "idle" in one column.
    expect(subagentStatusLabel("working")).toBe("Working");
    expect(subagentStatusLabel("idle")).toBe("Idle");
    expect(subagentStatusLabel("error")).toBe("Error");
  });

  it("names an absent status rather than rendering a blank cell", () => {
    expect(subagentStatusLabel("")).toBe("Unknown");
  });
});

describe("a run says what it is running on", () => {
  /**
   * A fleet of agents on screen gave no way to tell which was on which model,
   * or at what thinking level - the two things that decide what a run costs
   * and how long it takes. The run records it as `provider/model:thinking`.
   */
  it("shows the model and thinking level, and keeps the full id in the title", () => {
    const [row] = subagentRunRows([{
      runId: "r1",
      agent: "opus-design-reviewer-a",
      status: "running",
      elapsedMs: 103_000,
      startedAt: "2026-08-26T10:00:00.000Z",
      model: "anthropic-merchant/claude-opus-5:medium",
      hasOutput: false,
    }]);

    expect(row?.modelLabel).toBe("claude-opus-5 · medium");
    expect(row?.modelTitle).toBe("anthropic-merchant/claude-opus-5:medium");
    expect(row?.ariaLabel).toContain("claude-opus-5 · medium");
  });

  it("says nothing when the run recorded no model", () => {
    const [row] = subagentRunRows([{
      runId: "r2",
      agent: "reviewer",
      status: "done",
      elapsedMs: 1000,
      startedAt: "2026-08-26T10:00:00.000Z",
      hasOutput: true,
    }]);

    expect(row?.modelLabel).toBeUndefined();
  });
});
