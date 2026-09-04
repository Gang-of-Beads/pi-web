import { describe, expect, it } from "vitest";
import { InvalidAgentFactDeclarationError, parseAgentFactDeclarations } from "./agentSurfaceDeclarations";

describe("what a plugin declares about its own agent-side facts", () => {
  it("reads the surfaces and injected turns a plugin claims", () => {
    const parsed = parseAgentFactDeclarations({
      surfaces: [{ surface: "goals", tools: ["create_goal", "get_goal"] }],
      injectedTurns: [{ id: "goal-continuation", marker: "<pi_goal_continuation", producer: "pi-goal extension" }],
    });

    expect(parsed?.surfaces).toEqual([{ surface: "goals", tools: ["create_goal", "get_goal"] }]);
    expect(parsed?.injectedTurns[0]?.marker).toBe("<pi_goal_continuation");
  });

  it("treats a plugin declaring nothing as declaring nothing, not as broken", () => {
    expect(parseAgentFactDeclarations(undefined)).toBeUndefined();
    expect(parseAgentFactDeclarations({})).toEqual({ surfaces: [], injectedTurns: [] });
  });

  it("refuses a surface with no tools behind it", () => {
    expect(() => parseAgentFactDeclarations({ surfaces: [{ surface: "goals", tools: [] }] })).toThrow(InvalidAgentFactDeclarationError);
    expect(() => parseAgentFactDeclarations({ surfaces: [{ tools: ["get_goal"] }] })).toThrow(InvalidAgentFactDeclarationError);
  });

  it("refuses an injected turn missing its marker or producer", () => {
    expect(() => parseAgentFactDeclarations({ injectedTurns: [{ id: "x", producer: "p" }] })).toThrow(InvalidAgentFactDeclarationError);
    expect(() => parseAgentFactDeclarations({ injectedTurns: [{ id: "x", marker: "<x" }] })).toThrow(InvalidAgentFactDeclarationError);
  });

  it("refuses a declaration that is not shaped like one", () => {
    expect(() => parseAgentFactDeclarations("goals")).toThrow(InvalidAgentFactDeclarationError);
    expect(() => parseAgentFactDeclarations({ surfaces: "goals" })).toThrow(InvalidAgentFactDeclarationError);
  });
});
