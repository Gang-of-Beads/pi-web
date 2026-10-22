/** Fields of `launchctl print <domain>/<label>`, which prints one `name = value` line per field. */
function parseLaunchdField(output: string, field: string): string | undefined {
  const match = new RegExp(`^\\s*${field}\\s=\\s(.+)$`, "m").exec(output);
  return match?.[1]?.trim();
}

/** A job's run state, the words a status line shows for it, and the pid launchd started it as, while it runs. */
export function launchdRuntimeDetails(output: string): { state: string; detail: string; pid: string | undefined } {
  const state = parseLaunchdField(output, "state") ?? "unknown";
  const pid = parseLaunchdField(output, "pid");
  const lastExitCode = parseLaunchdField(output, "last exit code");
  const detail = state === "running"
    ? "running"
    : lastExitCode === undefined ? state : `${state} (last exit code ${lastExitCode})`;
  return { state, detail, pid };
}
