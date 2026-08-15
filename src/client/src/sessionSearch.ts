import type { SessionInfo } from "./api";

/**
 * Session list filtering.
 *
 * Sessions accumulate fast in a busy workspace, and on a phone the list is the
 * primary navigation surface: scrolling to find one session is the slowest
 * interaction in the app. Matching is deliberately forgiving (per-token
 * substring, then subsequence) because the searchable text is a mix of
 * generated names, first messages, and ids that nobody types exactly.
 */

/** Minimum session count before the search field is worth its vertical space. */
export const SESSION_SEARCH_MIN_SESSIONS = 5;

interface SessionRowLike {
  session: SessionInfo;
  depth: number;
}

export function sessionSearchHaystack(session: SessionInfo): string {
  return [session.name ?? "", session.firstMessage, session.id, session.path].join("\n").toLowerCase();
}

export function sessionMatchesSearch(session: SessionInfo, query: string): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const haystack = sessionSearchHaystack(session);
  return tokens.every((token) => haystack.includes(token) || isSubsequence(token, haystack));
}

/**
 * Filter rendered rows while keeping each match readable in its tree: an
 * ancestor row is retained purely as context, never as a match, so hiding it
 * cannot make a nested match look like a root session.
 */
export function filterSessionRows<T extends SessionRowLike>(rows: readonly T[], query: string): T[] {
  if (searchTokens(query).length === 0) return [...rows];

  const keptIndexes = new Set<number>();
  rows.forEach((row, index) => {
    if (!sessionMatchesSearch(row.session, query)) return;
    keptIndexes.add(index);
    // Rows are emitted depth-first, so the nearest preceding row with a
    // smaller depth is this row's parent, and so on up to the root.
    let requiredDepth = row.depth - 1;
    for (let ancestorIndex = index - 1; ancestorIndex >= 0 && requiredDepth >= 0; ancestorIndex -= 1) {
      if (rows[ancestorIndex]?.depth !== requiredDepth) continue;
      keptIndexes.add(ancestorIndex);
      requiredDepth -= 1;
    }
  });

  return rows.filter((_row, index) => keptIndexes.has(index));
}

export function shouldShowSessionSearch(sessionCount: number, query: string): boolean {
  return sessionCount >= SESSION_SEARCH_MIN_SESSIONS || query.trim() !== "";
}

function searchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of needle) {
    index = haystack.indexOf(character, index);
    if (index === -1) return false;
    index += character.length;
  }
  return true;
}
