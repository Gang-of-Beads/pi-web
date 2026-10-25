import type { JsonValue, PiWebServerPlugin } from "@gang-of-beads/pi-web/server-plugin-api";
import { isAbsolute } from "node:path";
import { GOAL_SURFACE } from "./goalRecords.js";
import { agentDirectory, nodeGoalFiles, readAllGoals, readWorkspaceGoals } from "./goalStore.js";

/**
 * Goal's server half: reads pi-goal's goal files on this machine for the pages, and declares the
 * pi-goal surface so the pages stand for the extension in Go to.
 *
 * The surface is backed by pi-goal's tools: a session where neither is loaded reports pi-goal
 * absent and Go to leaves the pages out. Nothing here writes; the pages change goals only by
 * running pi-goal's own `/goal` command in the session on screen.
 */
function workspaceInput(input: unknown): string | undefined {
  const path: unknown = typeof input === "object" && input !== null ? Reflect.get(input, "path") : undefined;
  return typeof path === "string" && isAbsolute(path) ? path : undefined;
}

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Goal",
  activate: () => {
    const agentDir = agentDirectory(process.env);
    return {
      agentFacts: { surfaces: [{ surface: GOAL_SURFACE, tools: ["goal_todo", "goal_plan"] }] },
      operations: {
        "goals.workspace": async (input): Promise<JsonValue> => {
          const path = workspaceInput(input);
          if (path === undefined) return { state: "failed", directory: "unknown", error: "No absolute workspace path was given." };
          return readWorkspaceGoals(nodeGoalFiles, agentDir, path);
        },
        "goals.all": async (): Promise<JsonValue> => readAllGoals(nodeGoalFiles, agentDir),
      },
    };
  },
};

export default plugin;
