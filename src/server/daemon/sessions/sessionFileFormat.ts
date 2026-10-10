/**
 * Line-level parsing shared by the readers of Pi session files: the summary
 * scanner, the count it folds (`ReadableCountFold`) and the header reader.
 * All follow the SDK's rule that a session file is a stream of JSON object
 * entries, one per line, where an unparseable line is skipped rather than fatal.
 */

const CARRIAGE_RETURN = 0x0d;
const CLOSING_BRACE = 0x7d;
const SPACE = 0x20;
const TAB = 0x09;

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

/**
 * Whether the line `data[start, end)` can be complete JSON: its last significant byte is `}`,
 * skipping trailing spaces, tabs and carriage returns, which JSON.parse (and therefore the SDK)
 * tolerates. A line still being written usually is not, and is read again once the file grows.
 */
export function endsWithClosingBrace(data: Buffer, start: number, end: number): boolean {
  let last = end;
  while (last > start) {
    const byte = data[last - 1];
    if (byte !== SPACE && byte !== TAB && byte !== CARRIAGE_RETURN) break;
    last -= 1;
  }
  return last > start && data[last - 1] === CLOSING_BRACE;
}
