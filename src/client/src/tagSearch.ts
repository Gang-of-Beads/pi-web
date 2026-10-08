/**
 * `#` in the Navigate search (B42): the tag being typed, what it can still become, and the query
 * once one is picked. Pure, so the page only renders what this answers.
 */

export interface TagSuggestion {
  readonly tag: string;
  /** How many listed rows carry the tag, before the query narrows them. */
  readonly count: number;
}

const SUGGESTION_LIMIT = 8;

/** The tag the query ends in, without its `#`; undefined when the last term is not a tag. */
export function typedTag(query: string): string | undefined {
  const last = query.split(/\s+/u).at(-1) ?? "";
  return last.startsWith("#") ? last.slice(1).toLowerCase() : undefined;
}

/** The tags that have rows and contain what was typed, the most used first. */
export function tagSuggestions(counts: ReadonlyMap<string, number>, typed: string): TagSuggestion[] {
  return [...counts]
    .filter(([tag]) => tag.includes(typed))
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
    .slice(0, SUGGESTION_LIMIT);
}

/** The query with its last term replaced by the picked tag, ready for the next word. */
export function withTag(query: string, tag: string): string {
  const terms = query.split(/\s+/u);
  terms[terms.length - 1] = `#${tag}`;
  return `${terms.join(" ")} `;
}
