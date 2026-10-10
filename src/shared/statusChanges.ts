/**
 * A session's status sent as what changed (B28; the owner's budget: "status frames carry what
 * changed, not the whole status"). The daemon compares the top-level fields of the status it
 * sends with the one the same socket received before it; the page lays the changes over that
 * status. A field without a value counts as absent, so a field that goes away is named in
 * `unset` instead of vanishing from the JSON unseen. Pure and shared: the session daemon builds
 * the frames, the page applies them.
 */

/** The socket URL's query field and value a page asks for status deltas with. */
export const STATUS_DELTA_QUERY = { name: "status", value: "delta" } as const;

export interface StatusChangedFrame {
  readonly type: "status.changed";
  readonly sessionId: string;
  readonly set: Readonly<Record<string, unknown>>;
  readonly unset: readonly string[];
}

/** The fields of `next` that differ from `previous`. */
export function statusChanges(sessionId: string, previous: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>): StatusChangedFrame {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const before = previous[key];
    const after = next[key];
    if (after === undefined) {
      if (before !== undefined) unset.push(key);
      continue;
    }
    if (before === undefined || JSON.stringify(before) !== JSON.stringify(after)) set[key] = after;
  }
  return { type: "status.changed", sessionId, set, unset };
}

/** `base` with a frame's changes laid over it. */
export function withStatusChanges(base: Readonly<Record<string, unknown>>, frame: Pick<StatusChangedFrame, "set" | "unset">): Record<string, unknown> {
  const gone = new Set(frame.unset);
  return Object.fromEntries(Object.entries({ ...base, ...frame.set }).filter(([key]) => !gone.has(key)));
}
