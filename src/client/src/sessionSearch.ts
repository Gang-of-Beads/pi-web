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

/**
 * Identifiers a person types verbatim rather than abbreviating: the session id
 * and its file path. Kept apart from the prose fields because they are long and
 * high-entropy, and folding them into one haystack let a loose match spell any
 * short query out of scattered characters.
 */
function sessionIdentifierHaystack(session: SessionInfo): string {
  return [session.id, session.path].join("\n").toLowerCase();
}

/** Human-written text, where abbreviated typing is worth supporting. */
function sessionProseHaystack(session: SessionInfo): string {
  return [session.name ?? "", session.firstMessage].join("\n").toLowerCase();
}

/**
 * Whether a query looks like an identifier a person copied rather than prose
 * they are abbreviating: several characters, all hex digits or dashes. Such a
 * query is matched literally so it cannot be spelled out of scattered
 * characters in a long message.
 */
function isIdentifierLikeToken(token: string): boolean {
  return token.length >= 6 && /^[0-9a-f-]+$/.test(token) && /[0-9]/.test(token);
}

export function sessionMatchesSearch(session: SessionInfo, query: string): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const prose = sessionProseHaystack(session);
  const identifiers = sessionIdentifierHaystack(session);
  return tokens.every((token) =>
    isIdentifierLikeToken(token)
      // Nobody abbreviates their way to a session id, and a long stack trace
      // contains almost any short hex string in order, so these must appear
      // literally. Searching an id prefix used to return 13 of 14 sessions.
      ? prose.includes(token) || identifiers.includes(token)
      :
    // Abbreviations are allowed against prose, so "prmted" still finds
    // "prompt editor", but an id or path must contain the text literally.
    // Searching a session id prefix previously returned 13 of 14 sessions,
    // because a UUID and a path together contain almost any short string as a
    // subsequence -- which is the same as not searching at all.
        prose.includes(token) || identifiers.includes(token) || isSubsequence(token, prose),
  );
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


/**
 * Loose ordered-character match, applied only to prose so abbreviated typing
 * such as "prmted" still finds "prompt editor". Deliberately not applied to
 * ids or paths: those are long and high-entropy, and matching them this way
 * makes a short query match nearly every session.
 */
function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

/**
 * Drop descendant rows whose subtree root is collapsed. Rows are depth-first,
 * so a depth>0 row belongs to the nearest preceding row with a smaller depth.
 * Rows with a missing recorded parent (orphan rows) are their own roots and
 * are never hidden.
 */
export function hideCollapsedSubtreeRows<Row extends { depth: number; hasMissingParent: boolean }>(
  rows: readonly Row[],
  collapsedRoots: ReadonlySet<string>,
  rootKey: (row: Row) => string,
): Row[] {
  if (collapsedRoots.size === 0) return [...rows];
  const visible: Row[] = [];
  let activeRoot: Row | undefined;
  for (const row of rows) {
    if (row.depth === 0) {
      activeRoot = row.hasMissingParent ? undefined : row;
      visible.push(row);
      continue;
    }
    if (activeRoot === undefined || !collapsedRoots.has(rootKey(activeRoot))) visible.push(row);
  }
  return visible;
}
