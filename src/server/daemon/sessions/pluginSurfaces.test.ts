import { describe, expect, it } from "vitest";
import { pluginSurfacePresence } from "./pluginSurfaces.js";

/**
 * A panel for a plugin nobody installed used to look exactly like an installed
 * plugin with nothing in it yet: both empty, neither saying which. This reports
 * what the runtime actually knows, so the interface can stop guessing from
 * whatever data the plugin happened to write.
 */

function loader(extensions: { path: string; tools: string[] }[], errors: { path: string; error: string }[] = []) {
  return {
    getExtensions: () => ({
      extensions: extensions.map((extension) => ({ path: extension.path, tools: new Map(extension.tools.map((tool) => [tool, {}])) })),
      errors,
    }),
  };
}

describe("what a plugin-backed surface can say about itself", () => {
  it("reports a surface as present when something registers its tools", () => {
    expect(pluginSurfacePresence(loader([{ path: "/x/goal.ts", tools: ["create_goal"] }]))).toEqual({ goals: "present" });
  });

  /**
   * Presence is asked of the tools, not of a package name: this repository runs
   * a fork of the goal plugin, and asking for the published name would call its
   * own goals absent.
   */
  it("does not care which file or package provides them", () => {
    expect(pluginSurfacePresence(loader([{ path: "/somebody/else/fork.ts", tools: ["get_goal"] }]))?.goals).toBe("present");
  });

  it("reports absent when nothing registers them and nothing failed", () => {
    expect(pluginSurfacePresence(loader([{ path: "/x/other.ts", tools: ["unrelated"] }]))).toEqual({ goals: "absent" });
  });

  /** A broken install must not hide behind a tidy empty panel. */
  it("keeps a load failure apart from absence", () => {
    expect(pluginSurfacePresence(loader([], [{ path: "/x/goal.ts", error: "boom" }]))?.goals).toBe("failed");
  });

  /**
   * The value that matters most: a runtime that cannot answer yields nothing at
   * all, so a browser reads it as unknown and keeps the surface. Hiding a panel
   * on no evidence is the fault this replaces.
   */
  it("answers nothing when the runtime cannot say", () => {
    expect(pluginSurfacePresence({})).toBeUndefined();
  });

  /** A tool that belongs to some other surface does not stand in for this one. */
  it("only answers for the surface it was asked about", () => {
    expect(pluginSurfacePresence(loader([{ path: "/x/sub.ts", tools: ["subagent"] }]))).toEqual({ goals: "absent" });
  });
});
