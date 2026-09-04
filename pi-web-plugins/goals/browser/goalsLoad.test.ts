import { describe, expect, it } from "vitest";
import { failedGoals, goalsForKey, loadedGoals, loadingGoals, unloadedGoals } from "./goalsLoad.js";

describe("what the goals plugin knows about one workspace", () => {
  it("starts unloaded, which is not the same as empty", () => {
    const slot = unloadedGoals<string>();

    expect(slot.state).toBe("unloaded");
    expect(slot.key).toBeUndefined();
  });

  it("tells a finished empty read apart from a failed one", () => {
    const loaded = loadedGoals("/repo", []);
    const failed = failedGoals("/repo", "daemon unreachable", unloadedGoals<string>());

    expect(loaded.state).toBe("loaded");
    expect(failed.state).toBe("failed");
    expect(failed.error).toBe("daemon unreachable");
  });

  it("keeps the rows it already had while re-reading the same workspace", () => {
    const loaded = loadedGoals("/repo", ["g1"]);

    expect(loadingGoals("/repo", loaded).data).toEqual(["g1"]);
  });

  it("drops them when the read is for a different workspace", () => {
    const loaded = loadedGoals("/repo", ["g1"]);

    expect(loadingGoals("/other", loaded).data).toEqual([]);
    expect(failedGoals("/other", "refused", loaded).data).toEqual([]);
  });

  it("refuses to lend one workspace's goals to another", () => {
    const loaded = loadedGoals("/repo", ["g1"]);

    expect(goalsForKey(loaded, "/repo").data).toEqual(["g1"]);
    expect(goalsForKey(loaded, "/other").state).toBe("unloaded");
    expect(goalsForKey(loaded, undefined).data).toEqual([]);
  });
});
