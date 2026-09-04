import type { JsonValue, PiWebServerPlugin } from "@gang-of-beads/pi-web/server-plugin-api";
import { readWorkspaceGoals } from "./server/goalStore.js";
import { archiveWorkspaceGoal, GoalArchiveError } from "./server/goalArchive.js";

/**
 * Goals as a plugin.
 *
 * Goal records live in a workspace's own `.pi/goals/` directory, outlive any
 * one session, and are shared by every session of that workspace, so reading
 * them is a workspace operation rather than a session one. Archiving is the
 * single write: a paused goal has no other way out of the panel, because the
 * extension's own clear command refuses without a confirmable UI that a web
 * session has not got.
 *
 * A refusal keeps its own shape - a locked archive is not the same answer as
 * an invalid request - so the caller can say which happened instead of
 * reporting one failure for both.
 */

function requireString(input: unknown, field: string): string {
  if (typeof input !== "object" || input === null) throw new Error("This operation needs an object");
  const value: unknown = Reflect.get(input, field);
  if (typeof value !== "string" || value === "") throw new Error(`This operation needs ${field}`);
  return value;
}

function optionalString(input: unknown, field: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value: unknown = Reflect.get(input, field);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The answer crosses a JSON boundary, so it is round-tripped rather than
 * asserted to already be JSON: a value the plugin can build and the boundary
 * cannot carry is a failure here, not a surprise at the far end.
 */
function asJson(value: unknown): JsonValue {
  const encoded: unknown = JSON.parse(JSON.stringify(value));
  if (!isJsonValue(encoded)) throw new Error("This operation produced a value the JSON boundary cannot carry");
  return encoded;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Goals",
  activate: () => ({
    operations: {
      "goals.read": async (input): Promise<JsonValue> => {
        const workspacePath = requireString(input, "workspacePath");
        const sessionCwd = optionalString(input, "sessionCwd");
        const goals = await readWorkspaceGoals(workspacePath, sessionCwd === undefined ? {} : { sessionCwd });
        return asJson(goals);
      },
      "goals.archive": async (input): Promise<JsonValue> => {
        const workspacePath = requireString(input, "workspacePath");
        const goalId = requireString(input, "goalId");
        try {
          return asJson(await archiveWorkspaceGoal(workspacePath, goalId));
        } catch (error) {
          if (error instanceof GoalArchiveError) return { refused: true, code: error.code, message: error.message };
          throw error;
        }
      },
    },
  }),
};

export default plugin;
