import { describe, expect, it, vi } from "vitest";
import { countBackgroundRuns, type BackgroundRunCountDeps } from "./backgroundRunCount.js";

function deps(over: Partial<BackgroundRunCountDeps> = {}): BackgroundRunCountDeps {
  return {
    pluginBackgroundWork: () => Promise.resolve(0),
    ...over,
  };
}

const session = { sessionId: "abc", cwd: "/w", sessionFile: "/w/.pi/sessions/2026-08-25_abc.jsonl", parentActive: false, workingSubsessionCount: 0 };

describe("counting the work that outlives a turn", () => {
  it("adds up subsessions and plugin runs", async () => {
    const count = await countBackgroundRuns({ ...session, workingSubsessionCount: 2 }, deps({
      pluginBackgroundWork: () => Promise.resolve(1),
    }));

    expect(count).toBe(3);
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
