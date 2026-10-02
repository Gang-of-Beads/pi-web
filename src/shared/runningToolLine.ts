import type { RunningTool } from "./apiTypes.js";

/** One running tool in words, "bash: sleep 25", for the daemon's activity detail and the browser's status line alike (B25). */
export function runningToolLine(tool: RunningTool): string {
  return tool.target === undefined || tool.target === "" ? tool.name : `${tool.name}: ${tool.target}`;
}
