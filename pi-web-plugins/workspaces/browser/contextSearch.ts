import { fuzzyRank, searchTokens } from "./fuzzyMatch";

/**
 * Searching the other two lists a reader picks from.
 *
 * Projects and sessions could be searched; machines and workspaces could not.
 * A project with dozens of worktrees listed every branch as a tile, and finding
 * one meant scrolling past all of them - the list where scrolling helps least,
 * because branch names differ in the middle rather than at the start.
 *
 * Matching reuses the app's shared fuzzy rules: per token and
 * order-independent, so "acp fac" finds "feat/acp-facade".
 */

/** Below this many items a search field would outshout the list it narrows. */
const CONTEXT_SEARCH_MIN_ITEMS = 8;

/** A workspace is told apart by its branch and by where it is checked out. */
export function workspaceSearchHaystack(workspace: { label: string; path: string }): string {
  return `${workspace.label}\n${workspace.path}`;
}

export function filterWorkspaces<W extends { label: string; path: string }>(
  workspaces: readonly W[],
  query: string,
): W[] {
  return fuzzyRank(workspaces, query, workspaceSearchHaystack);
}

export function shouldShowContextSearch(itemCount: number, query: string): boolean {
  return itemCount >= CONTEXT_SEARCH_MIN_ITEMS || searchTokens(query).length > 0;
}
