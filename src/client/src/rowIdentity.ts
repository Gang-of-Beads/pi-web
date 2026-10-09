import type { ChatLine } from "./components/shared";

/**
 * A transcript row's key: what the row is, not where it sits (state-diagram.md D4, "A row is keyed by
 * what it is").
 *
 * Every per-row thing hangs off this key: Lit's repeat key, the scroll anchor and marker, the copy
 * highlight, the open metadata and a group's disclosure. They used to be the row's position, so a
 * message leaving the pending block for its committed place, a retried attempt hidden mid-list or a
 * withdrawn row shifted every later key. Lit rebuilt those rows, a saved anchor named another row, and
 * the reading anchor lost the row it was holding (CHECKLIST #227).
 *
 * The identity is the same live and after a reload, read from the first source a line carries.
 * A line with none of them, such as a reply still streaming before its response id or a live custom
 * message, keeps its position, `p:<index>`. A save prefers any other key, because a position does not
 * survive a reload.
 */
type IdentitySource = "user" | "tool" | "response" | "entry";

const IDENTITY_PREFIX: Readonly<Record<IdentitySource, string>> = { user: "u:", tool: "t:", response: "r:", entry: "e:" };

const IDENTITY_ORDER: readonly IdentitySource[] = ["user", "tool", "response", "entry"];

const IDENTITY_READERS: Readonly<Record<IdentitySource, (line: ChatLine) => string | undefined>> = {
  user: (line) => line.meta?.delivery?.clientMessageId ?? line.meta?.clientMessageId ?? line.meta?.echoClientMessageId,
  tool: (line) => line.parts.map(partToolCallId).find((id) => id !== undefined),
  response: (line) => line.meta?.responseId,
  entry: (line) => line.meta?.entryId,
};

const POSITION_PREFIX = "p:";

const WRAPPER_PREFIXES: readonly string[] = ["g:", "ev:"];

/** A run of transcript lines and the absolute index of its first line, for its positional keys. */
export interface RowKeySegment {
  readonly lines: readonly ChatLine[];
  readonly firstIndex: number;
}

/**
 * The key of every line, segment by segment, counted in transcript order.
 *
 * Two lines share an identity only when they come from one message: the lines a reply is split into
 * carry its response id and entry id. The second and later get `#<n>`, so keys stay unique. A page
 * never splits a message, so older history loaded above does not renumber them; only a provider that
 * reuses one response id across replies would (the 8505 probe model does).
 */
export function rowKeys(segments: readonly RowKeySegment[]): string[][] {
  const seen = new Map<string, number>();
  return segments.map(({ lines, firstIndex }) => lines.map((line, offset) => {
    const identity = rowIdentity(line);
    if (identity === undefined) return positionalRowKey(firstIndex + offset);
    const count = (seen.get(identity) ?? 0) + 1;
    seen.set(identity, count);
    return count === 1 ? identity : `${identity}#${String(count)}`;
  }));
}

/** The key of a row known only by its place in the transcript. */
export function positionalRowKey(index: number): string {
  return `${POSITION_PREFIX}${String(index)}`;
}

/** Whether a key names a row only by its place, which a reload does not keep. */
export function isPositionalRowKey(key: string): boolean {
  const wrapper = WRAPPER_PREFIXES.find((prefix) => key.startsWith(prefix));
  return wrapper === undefined ? key.startsWith(POSITION_PREFIX) : isPositionalRowKey(key.slice(wrapper.length));
}

/** A collapsed event group, keyed by its first member: events join a group at its end. */
export function groupRowKey(firstMemberKey: string): string {
  return `g:${firstMemberKey}`;
}

/** The scroll marker before a group, named by its last member: older events join a group at its start. */
export function groupMarkerKey(lastMemberKey: string): string {
  return `g:${lastMemberKey}`;
}

/** An event inside a group. Its line can also draw a readable row, which owns the line's own key. */
export function groupEventKey(memberKey: string): string {
  return `ev:${memberKey}`;
}

function rowIdentity(line: ChatLine): string | undefined {
  for (const source of IDENTITY_ORDER) {
    const id = IDENTITY_READERS[source](line);
    if (id !== undefined && id !== "") return `${IDENTITY_PREFIX[source]}${id}`;
  }
  return undefined;
}

function partToolCallId(part: ChatLine["parts"][number]): string | undefined {
  return "toolCallId" in part ? part.toolCallId : undefined;
}
