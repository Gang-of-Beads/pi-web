import type { ToolExecutionPart } from "./components/shared";

/** pi's shell tools: their rows end with how long the command ran (pi 1.1.0, `core/tools/renderers/bash.ts`). */
const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "powershell"]);

/**
 * The line a finished shell row ends with, in pi's own words: `Took 3.2s`, `Took 4m 5s`,
 * `Took 1h 2m 5s`, from the duration pi recorded on the result, so it reads the same live and
 * after a reload (owner, Q26). None when pi recorded none (before 1.1.0, a call that never
 * finished), as pi's reloaded view shows none, and none when an extension draws the result itself,
 * which then decides what its rows say.
 */
export function shellTookLine(execution: ToolExecutionPart): string | undefined {
  if (!SHELL_TOOLS.has(execution.toolName) || execution.durationMs === undefined || execution.drawnResult !== undefined) return undefined;
  return `Took ${shellDuration(execution.durationMs)}`;
}

function shellDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) return `${String(minutes)}m ${String(remainder)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m ${String(remainder)}s`;
}
