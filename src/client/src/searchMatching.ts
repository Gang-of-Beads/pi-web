/**
 * Word-wise matching for the app's search boxes.
 *
 * Every picker here — models, the action palette, auth providers — used to ask
 * whether the searchable text contained the query as one unbroken run of
 * characters. That reads fine for a single word and fails the moment someone
 * types two, because the words they type are rarely neighbours in the text:
 * "claude-opus-5 anthropic-merchant" does not contain "opus-5 merchant", and
 * "Clean Up Sessions" does not contain "cleanup sessions".
 *
 * Asking for each word on its own makes word order and whatever sits between
 * them stop mattering, which is how people expect to narrow a list: name the
 * model, then name the provider. A one-word query behaves exactly as before,
 * and each further word can only narrow the result.
 */
export function matchesAllQueryWords(haystack: string, normalizedQuery: string): boolean {
  const text = haystack.toLowerCase();
  return normalizedQuery.split(/\s+/).every((word) => text.includes(word));
}

/** The query as the matcher wants it: trimmed and lowercased. Empty means "no filter". */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}
