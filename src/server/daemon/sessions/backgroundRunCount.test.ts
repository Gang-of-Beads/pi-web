import { describe, expect, it, vi } from "vitest";
import { countBackgroundRuns, createBackgroundRunCountCycle, type BackgroundRunCountDeps } from "./backgroundRunCount.js";

function deps(over: Partial<BackgroundRunCountDeps> = {}): BackgroundRunCountDeps {
  return {
    runningTaskIds: () => Promise.resolve(new Set<string>()),
    taskIdsForSession: () => Promise.resolve(new Set<string>()),
    pluginBackgroundWork: () => Promise.resolve(0),
    ...over,
  };
}

const session = { sessionId: "abc", cwd: "/w", sessionFile: "/w/.pi/sessions/2026-08-25_abc.jsonl", parentActive: false, workingSubsessionCount: 0 };

describe("counting the work that outlives a turn", () => {
  it("adds up subsessions, plugin runs and shell tasks", async () => {
    const count = await countBackgroundRuns({ ...session, workingSubsessionCount: 2 }, deps({
      runningTaskIds: () => Promise.resolve(new Set(["t1", "t2"])),
      taskIdsForSession: () => Promise.resolve(new Set(["t1", "t2", "t3"])),
      pluginBackgroundWork: () => Promise.resolve(1),
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

  it("shares one workspace task probe across a heartbeat cycle", async () => {
    const runningTaskIds = vi.fn(() => Promise.resolve(new Set(["t1"])));
    const taskIdsForSession = vi.fn(() => Promise.resolve(new Set(["t1"])));
    const cycle = createBackgroundRunCountCycle(deps({ runningTaskIds, taskIdsForSession }));

    await Promise.all([
      cycle.count({ ...session, sessionFile: "/w/.pi/sessions/a.jsonl" }),
      cycle.count({ ...session, sessionFile: "/w/.pi/sessions/b.jsonl" }),
    ]);

    expect(runningTaskIds).toHaveBeenCalledTimes(1);
    // Ownership remains session-scoped even though the broad workspace probe is shared.
    expect(taskIdsForSession).toHaveBeenCalledTimes(2);
  });

  it("does not share task probes across heartbeat cycles", async () => {
    const runningTaskIds = vi.fn(() => Promise.resolve(new Set<string>()));
    const dependencies = deps({ runningTaskIds });

    await createBackgroundRunCountCycle(dependencies).count(session);
    await createBackgroundRunCountCycle(dependencies).count(session);

    expect(runningTaskIds).toHaveBeenCalledTimes(2);
  });

  it("counts only subsessions for a session with no transcript yet", async () => {
    const pluginBackgroundWork = vi.fn(() => Promise.resolve(0));
    const count = await countBackgroundRuns(
      { ...session, sessionFile: undefined, workingSubsessionCount: 1 },
      deps({ pluginBackgroundWork }),
    );

    expect(count).toBe(1);
    expect(pluginBackgroundWork).not.toHaveBeenCalled();
  });

  it("asks the plugins about the session by its transcript and whether its turn runs", async () => {
    const pluginBackgroundWork = vi.fn(() => Promise.resolve(0));
    await countBackgroundRuns({ ...session, parentActive: true }, deps({ pluginBackgroundWork }));

    expect(pluginBackgroundWork).toHaveBeenCalledWith({ sessionId: "abc", cwd: "/w", sessionFile: "/w/.pi/sessions/2026-08-25_abc.jsonl", parentActive: true });
  });
});
