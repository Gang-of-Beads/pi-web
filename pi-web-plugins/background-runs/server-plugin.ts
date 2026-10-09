import type { JsonValue, PiWebServerPlugin, ServerPluginActivationContext } from "@gang-of-beads/pi-web/server-plugin-api";
import { isAbsolute } from "node:path";
import { listBackgroundTasks, processStartProbe, runningTasksForSession, type BackgroundTaskInfo } from "./server/tasks.js";

/**
 * Background runs' server half: everything PI WEB knows about pi-background-tasks (`bg_run`)
 * lives here, not in core (design plugin-lifecycle-and-subagents section 3).
 *
 * The extension keeps a registry and each task's output under the project folder
 * (`.pi/tasks`, `.pi/delegate`). The plugin declares those directories, so while it runs the
 * daemon watches them to recount and the Files and Git panels ignore their churn; it counts a
 * session's running tasks into "N background runs"; and it lists a session's tasks for its
 * panel. Turned off, none of that happens (owner, 2026-10-09: this is the plugin's behaviour).
 *
 * The session is named by its working directory and transcript path, which the browser holds.
 */

function sessionFrom(input: unknown): { cwd: string; sessionFile: string } | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const cwd: unknown = Reflect.get(input, "cwd");
  const sessionFile: unknown = Reflect.get(input, "sessionFile");
  if (typeof cwd !== "string" || !isAbsolute(cwd)) return undefined;
  if (typeof sessionFile !== "string" || !isAbsolute(sessionFile) || !sessionFile.endsWith(".jsonl")) return undefined;
  return { cwd, sessionFile };
}

/** What the panel draws of each task, and nothing more: a command line can be long. */
function tasksAsJson(tasks: readonly BackgroundTaskInfo[]): JsonValue {
  return tasks.map((task) => ({
    id: task.id,
    name: task.name,
    status: task.status,
    ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
    ...(task.durationMs === undefined ? {} : { durationMs: task.durationMs }),
    ...(task.exitCode === undefined ? {} : { exitCode: task.exitCode }),
  }));
}

/** When a pid's process was born, read with `ps` through the host's bounded command helper; undefined when it is gone. */
function probeWith(context: ServerPluginActivationContext, signal: AbortSignal): (pid: number) => Promise<number | undefined> {
  return processStartProbe((args) => context.execFile({ file: "ps", args, signal }));
}

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Background Runs",
  activate: (context) => ({
    agentFacts: {
      workPaths: [{ root: "cwd", path: ".pi/tasks" }, { root: "cwd", path: ".pi/delegate" }],
    },
    backgroundWork: async (session, signal) => ({ running: await runningTasksForSession(session.cwd, session.sessionFile, probeWith(context, signal)) }),
    operations: {
      "tasks.list": async (input, { signal }): Promise<JsonValue> => {
        const session = sessionFrom(input);
        if (session === undefined) return { known: false, reason: "no-session" };
        return { known: true, tasks: tasksAsJson(await listBackgroundTasks(session.cwd, session.sessionFile, Date.now(), probeWith(context, signal))) };
      },
    },
  }),
};

export default plugin;
