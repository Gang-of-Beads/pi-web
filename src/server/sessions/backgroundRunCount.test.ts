import { describe, expect, it, vi } from "vitest";
import type { SessionSubagentRunInfo } from "../../shared/apiTypes.js";
import { countBackgroundRuns, type BackgroundRunCountDeps } from "./backgroundRunCount.js";

function run(over: Partial<SessionSubagentRunInfo>): SessionSubagentRunInfo {
  return { runId: "r", agent: "reviewer", status: "running", elapsedMs: 0, startedAt: "", hasOutput: false, ...over };
}

function deps(over: Partial<BackgroundRunCountDeps> = {}): BackgroundRunCountDeps {
  return {
    runningTaskIds: () => Promise.resolve(new Set<string>()),
    taskIdsForSession: () => Promise.resolve(new Set<string>()),
    listSubagentRuns: () => Promise.resolve([]),
    ...over,
  };
}

const session = { cwd: "/w", sessionFile: "/w/.pi/sessions/2026-08-25_abc.jsonl", parentActive: false, workingSubsessionCount: 0 };

describe("counting the work that outlives a turn", () => {
  it("adds up subsessions, tool runs and shell tasks", async () => {
    const count = await countBackgroundRuns({ ...session, workingSubsessionCount: 2 }, deps({
      runningTaskIds: () => Promise.resolve(new Set(["t1", "t2"])),
      taskIdsForSession: () => Promise.resolve(new Set(["t1", "t2", "t3"])),
      listSubagentRuns: () => Promise.resolve([run({ runId: "a" }), run({ runId: "b", status: "done" })]),
    }));

    expect(count).toBe(5);
  });

  it("ignores a live task another session in the same workspace started", async () => {
    // Every session in a server shares one task directory, so the workspace's
    // running set means nothing until the transcript says who owns it.
    const count = await countBackgroundRuns(session, deps({
      runningTaskIds: () => Promise.resolve(new Set(["theirs"])),
      taskIdsForSession: () => Promise.resolve(new Set(["mine"])),
    }));

    expect(count).toBe(0);
  });

  it("does not read a transcript when nothing in the workspace is running", async () => {
    const taskIdsForSession = vi.fn(() => Promise.resolve(new Set<string>()));
    const count = await countBackgroundRuns(session, deps({ taskIdsForSession }));

    // This is what makes the count affordable on a two-second timer: the
    // common answer is zero and costs one small directory read.
    expect(count).toBe(0);
    expect(taskIdsForSession).not.toHaveBeenCalled();
  });

  it("counts only subsessions for a session with no transcript yet", async () => {
    const listSubagentRuns = vi.fn(() => Promise.resolve([]));
    const count = await countBackgroundRuns(
      { ...session, sessionFile: undefined, workingSubsessionCount: 1 },
      deps({ listSubagentRuns }),
    );

    expect(count).toBe(1);
    expect(listSubagentRuns).not.toHaveBeenCalled();
  });

  it("asks for runs beside the transcript, keyed by its file name", async () => {
    const listSubagentRuns = vi.fn(() => Promise.resolve([]));
    await countBackgroundRuns({ ...session, parentActive: true }, deps({ listSubagentRuns }));

    // The tool names its run directory after the transcript file, not the
    // session id; looking it up by the bare id finds nothing on a real session.
    expect(listSubagentRuns).toHaveBeenCalledWith(
      "/w/.pi/sessions",
      "2026-08-25_abc",
      expect.any(Number),
      { parentActive: true },
    );
  });
});
