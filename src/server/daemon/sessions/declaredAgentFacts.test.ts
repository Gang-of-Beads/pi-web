import { afterEach, describe, expect, it } from "vitest";
import { declaredAgentFacts, recordDeclaredAgentFacts, resetDeclaredAgentFacts } from "./declaredAgentFacts";
import { pluginSurfacePresence } from "./pluginSurfaces";

afterEach(() => { resetDeclaredAgentFacts(); });

function loader(tools: string[]) {
  return {
    getExtensions: () => ({
      extensions: [{ path: "/plugins/goal.ts", tools: new Map(tools.map((tool) => [tool, {}])) }],
      errors: [],
    }),
  };
}

describe("the agent facts this daemon's plugins declare", () => {
  it("reports nothing before any plugin has declared anything", () => {
    expect(declaredAgentFacts()).toEqual({ surfaces: [], injectedTurns: [], workPaths: [] });
  });

  it("keeps the tools the declaring plugin named", () => {
    recordDeclaredAgentFacts({ surfaces: [{ surface: "goals", tools: ["get_goal"] }], injectedTurns: [], workPaths: [] });

    expect(declaredAgentFacts().surfaces).toEqual([{ surface: "goals", tools: ["get_goal"] }]);
  });

  /**
   * A machine without the goals plugin declares no goals surface, so no page
   * fronts one and nothing is reported for it: an extension registering goal
   * tools there names no surface the host would have to know.
   */
  it("reports no surface no plugin declared", () => {
    expect(pluginSurfacePresence(loader(["create_goal"]))).toEqual({});
  });

  it("reports a declared surface present once the tool it names is loaded", () => {
    recordDeclaredAgentFacts({ surfaces: [{ surface: "goals", tools: ["create_goal"] }], injectedTurns: [], workPaths: [] });

    expect(pluginSurfacePresence(loader(["create_goal"]))?.["goals"]).toBe("present");
  });
});
