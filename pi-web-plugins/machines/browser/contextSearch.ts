import { fuzzyRank, searchTokens } from "./fuzzyMatch";

/**
 * Searching the machine fleet a reader picks from.
 *
 * Matching reuses the app's shared fuzzy rules: per token and
 * order-independent, so "dev box" finds "Dev Box".
 */

/** Below this many items a search field would outshout the list it narrows. */
const CONTEXT_SEARCH_MIN_ITEMS = 8;

export function filterMachines<M extends { name: string }>(machines: readonly M[], query: string): M[] {
  return fuzzyRank(machines, query, (machine) => machine.name);
}

export function shouldShowContextSearch(itemCount: number, query: string): boolean {
  return itemCount >= CONTEXT_SEARCH_MIN_ITEMS || searchTokens(query).length > 0;
}
