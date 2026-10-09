/** Lines an extension drew with its own pi renderer, as the daemon sends them; none when absent or empty. */
export function drawnLines(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines = value.filter((line): line is string => typeof line === "string");
  return lines.length === 0 ? undefined : lines;
}
