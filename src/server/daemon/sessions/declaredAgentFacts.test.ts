import { afterEach, describe, expect, it } from "vitest";
import { declaredAgentFacts, declaredSurfaceTools, recordDeclaredAgentFacts, resetDeclaredAgentFacts } from "./declaredAgentFacts";
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
    expect(declaredAgentFacts()).toEqual({ surfaces: [], injectedTurns: [] });
    expect(declaredSurfaceTools("goals")).toEqual([]);
  });

  it("answers with the tools the declaring plugin named", () => {
    recordDeclaredAgentFacts({ surfaces: [{ surface: "goals", tools: ["get_goal"] }], injectedTurns: [] });

    expect(declaredSurfaceTools("goals")).toEqual(["get_goal"]);
  });

  it("calls a surface nobody declared unbacked rather than guessing at its tools", () => {
    recordDeclaredAgentFacts({ surfaces: [{ surface: "goals", tools: ["get_goal"] }], injectedTurns: [] });

    expect(declaredSurfaceTools("relays")).toEqual([]);
  });

  /**
   * A machine without the goals plugin declares no goals tools, and an
   * extension registering goal tools there must still not make the surface
   * look backed by something the host cannot name.
   */
  it("reports the goals surface as absent when no plugin declares it", () => {
    expect(pluginSurfacePresence(loader(["create_goal"]))?.goals).toBe("absent");
  });

  it("reports it as present once the plugin declares the tool that is loaded", () => {
    recordDeclaredAgentFacts({ surfaces: [{ surface: "goals", tools: ["create_goal"] }], injectedTurns: [] });

    expect(pluginSurfacePresence(loader(["create_goal"]))?.goals).toBe("present");
  });
});
