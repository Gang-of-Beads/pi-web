/**
 * How a session list arranges pinned rows.
 *
 * Pins exist so a session is reachable without hunting; a mark left in place
 * in a long list does not deliver that, so pinned roots are lifted into their
 * own group at the top, exactly as the quick-access menu groups them. A row
 * with a parent keeps its place in its subtree: lifting it would orphan the
 * tree that explains it. While a search is running the query owns the order,
 * so nothing is lifted and the list stays a plain ranking of matches.
 */

interface PinnableRow {
  session: { id: string };
  depth: number;
}

export interface PinnedRowSplit<T> {
  pinned: T[];
  rest: T[];
}

export function splitPinnedSessionRows<T extends PinnableRow>(
  rows: readonly T[],
  pinnedSessionIds: ReadonlySet<string>,
  options: { searching: boolean },
): PinnedRowSplit<T> {
  if (options.searching || pinnedSessionIds.size === 0) return { pinned: [], rest: [...rows] };
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const row of rows) {
    if (row.depth === 0 && pinnedSessionIds.has(row.session.id)) pinned.push(row);
    else rest.push(row);
  }
  return { pinned, rest };
}
