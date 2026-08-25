/** Each word is looked for separately so "opus-5 merchant" finds "claude-opus-5 anthropic-merchant". */
export function matchesAllQueryWords(haystack: string, normalizedQuery: string): boolean {
  const text = haystack.toLowerCase();
  return normalizedQuery.split(/\s+/).every((word) => text.includes(word));
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}
