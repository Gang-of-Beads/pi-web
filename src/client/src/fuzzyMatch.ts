/**
 * Forgiving text matching for the app's search surfaces.
 *
 * Every searchable list here mixes machine identifiers with prose: model ids
 * (`claude-opus-5`), provider aliases (`anthropic-work`), generated session
 * names, first messages, and file paths. Nobody types those exactly, and the
 * useful query is usually a couple of remembered fragments in whatever order
 * they come to mind — `opus-5 work` for `anthropic-work/claude-opus-5`.
 *
 * So matching is token-based rather than one contiguous substring: each
 * whitespace-separated token must appear somewhere, as a substring or (failing
 * that) as an abbreviation. Tokens are independent, so order never matters.
 */

/** Split a query into lowercase tokens, discarding empty ones. */
export function searchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
}

/**
 * Whether `haystack` satisfies every token of `query`.
 *
 * An empty query matches everything: a search box that has not been typed into
 * is not a filter.
 */
export function fuzzyMatches(haystack: string, query: string): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const target = haystack.toLowerCase();
  return tokens.every((token) => tokenMatches(target, token));
}

/**
 * Relevance of `haystack` for `query`, higher being better, or `undefined`
 * when it does not match at all.
 *
 * Ranking exists because forgiving matching admits weak hits: once an
 * abbreviation counts, a query can match something the user did not mean. The
 * score keeps the obvious answer on top by rewarding, per token, matches that
 * are more literal (substring over abbreviation) and better anchored (at a word
 * boundary, or at the very start).
 *
 * Deliberately no preference for shorter haystacks: the searchable text here
 * concatenates a provider with a model id, so length would rank the same model
 * by how long its account happens to be named. Equal relevance instead keeps
 * the caller's order, which is the one the user can predict.
 */
export function fuzzyScore(haystack: string, query: string): number | undefined {
  const tokens = searchTokens(query);
  const target = haystack.toLowerCase();
  if (tokens.length === 0) return 0;

  let score = 0;
  for (const token of tokens) {
    const index = target.indexOf(token);
    if (index !== -1) {
      score += 100;
      if (index === 0) score += 30;
      else if (isBoundary(target.charAt(index - 1))) score += 20;
      continue;
    }
    if (!isAbbreviation(token, target)) return undefined;
    score += 25;
  }
  return score;
}

/**
 * Filter and rank `items` by `query`, keeping the input order for equal scores
 * so a caller's own ordering (recency, a curated list) survives a tie.
 */
export function fuzzyRank<T>(items: readonly T[], query: string, haystackOf: (item: T) => string): T[] {
  if (searchTokens(query).length === 0) return [...items];
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const score = fuzzyScore(haystackOf(item), query);
    if (score !== undefined) scored.push({ item, score, index });
  });
  scored.sort((left, right) => right.score - left.score || left.index - right.index);
  return scored.map((entry) => entry.item);
}

function tokenMatches(target: string, token: string): boolean {
  return target.includes(token) || isAbbreviation(token, target);
}

/**
 * Whether `needle` reads as an abbreviation of `haystack`.
 *
 * A plain subsequence is far too permissive on this data: `opus-4` can be
 * spelled out of the scattered letters of `anthropic/claude-sonnet-4-5`, which
 * makes a confident query return the wrong model. People abbreviate in only two
 * ways, so those are the two moves allowed — every character must either
 *
 *   - start a word (`ch45` for `claude-haiku-4-5`), or
 *   - directly continue the previous match (`opus5` for `claude-opus-5`).
 *
 * Explored breadth-first over match states rather than greedily: the leftmost
 * candidate for an early character can be a dead end that a later one avoids.
 */
export function isAbbreviation(needle: string, haystack: string): boolean {
  if (needle === "") return true;
  if (haystack === "") return false;

  // Each state is the position just past a matched character, so a state is
  // simultaneously "where to resume scanning" and "the one position that would
  // continue the previous match". Keeping that per state matters: a shared
  // high-water mark would let one candidate's contiguity license another's.
  let states = new Set<number>([0]);

  for (const character of needle) {
    const nextStates = new Set<number>();
    for (const start of states) {
      for (let index = start; index < haystack.length; index += 1) {
        if (haystack.charAt(index) !== character) continue;
        const continuesPrevious = index === start;
        if (!continuesPrevious && !isWordStart(haystack, index)) continue;
        nextStates.add(index + 1);
      }
    }
    if (nextStates.size === 0) return false;
    states = nextStates;
  }
  return true;
}

function isWordStart(haystack: string, index: number): boolean {
  return index === 0 || isBoundary(haystack.charAt(index - 1));
}

function isBoundary(character: string): boolean {
  return character === "" || /[\s\-_/.:@]/u.test(character);
}
