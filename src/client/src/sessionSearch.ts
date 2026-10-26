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
