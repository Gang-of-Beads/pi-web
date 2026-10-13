/** Each word is looked for separately so "opus-5 gateway" finds "claude-opus-5 acme-gateway". */
export function matchesAllQueryWords(haystack: string, normalizedQuery: string): boolean {
  const text = haystack.toLowerCase();
  return normalizedQuery.split(/\s+/).every((word) => text.includes(word));
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}
