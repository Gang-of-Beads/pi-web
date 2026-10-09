/**
 * Line-level parsing shared by the two readers of Pi session files: the
 * summary scanner and the header reader. Both follow the SDK's rule that a
 * session file is a stream of JSON object entries, one per line, where an
 * unparseable line is skipped rather than fatal.
 */

/**
 * The entry a session-file line carries, or undefined when the line is blank,
 * not JSON, or a JSON scalar. Arrays count as entries, matching the SDK: its
 * readers index into any parsed non-null object.
 */
export function tryParseEntry(line: string): Record<string, unknown> | undefined {
  if (line.trim() === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether `value` can be indexed by key, i.e. a non-null object, arrays included. Deliberately
 * not the shared strict `isRecord`: pi's SDK takes any parseable JSON line, an array too, as an
 * entry, so a file whose first entry is an array is not a session file here either.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
