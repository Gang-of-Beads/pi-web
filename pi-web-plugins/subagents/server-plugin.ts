import { basename, dirname } from "node:path";
import type { JsonValue, PiWebServerPlugin } from "@gang-of-beads/pi-web/server-plugin-api";
import { listSubagentRuns, readSubagentRunOutput, type SubagentRunInfo } from "./server/runs.js";

/**
 * Subagents' server half.
 *
 * The runs a session started are read here, from the layout the subagent tool
 * leaves on disk, so the whole feature - the reader, the operations and the
 * panel - ships in one plugin. The shell learns nothing about runs; it only
 * mounts what this plugin declares.
 *
 * The parent session is named by its transcript path, which the browser
 * already holds: a run belongs to the session whose directory contains it,
 * and attribution is by that recorded fact rather than by timing.
 */

function sessionFileFrom(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const path: unknown = Reflect.get(input, "sessionFile");
  return typeof path === "string" && path.endsWith(".jsonl") ? path : undefined;
}

function runsAsJson(runs: readonly SubagentRunInfo[]): JsonValue {
  return runs.map((run) => ({
    runId: run.runId,
    agent: run.agent,
    status: run.status,
    elapsedMs: run.elapsedMs,
    startedAt: run.startedAt,
    ...(run.lastActivity === undefined ? {} : { lastActivity: run.lastActivity }),
    ...(run.task === undefined ? {} : { task: run.task }),
    ...(run.model === undefined ? {} : { model: run.model }),
    ...(run.toolCount === undefined ? {} : { toolCount: run.toolCount }),
    hasOutput: run.hasOutput,
  }));
}

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Subagents",
  activate: () => ({
    operations: {
      "runs.list": async (input): Promise<JsonValue> => {
        const sessionFile = sessionFileFrom(input);
        // Absence is a state: without a session path there is nothing to read,
        // and saying so is not the same as reporting no runs.
        if (sessionFile === undefined) return { known: false, reason: "no-session" };
        const runs = await listSubagentRuns(dirname(sessionFile), basename(sessionFile, ".jsonl"), Date.now());
        return { known: true, runs: runsAsJson(runs) };
      },
      "runs.output": async (input): Promise<JsonValue> => {
        const sessionFile = sessionFileFrom(input);
        const runId: unknown = typeof input === "object" && input !== null ? Reflect.get(input, "runId") : undefined;
        if (sessionFile === undefined || typeof runId !== "string" || runId === "") return { known: false, reason: "no-run" };
        const output = await readSubagentRunOutput(dirname(sessionFile), runId, { parentSessionId: basename(sessionFile, ".jsonl") });
        return output === undefined ? { known: false, reason: "not-written" } : { known: true, output };
      },
    },
  }),
};

export default plugin;
