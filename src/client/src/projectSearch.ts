import type { Project } from "./api";
import { fuzzyRank, searchTokens } from "./fuzzyMatch";

/**
 * Project list filtering.
 *
 * A machine accumulates projects faster than sessions do, and on a phone the
 * list is a full screen well before it feels "long" on a desktop: ten entries
 * already push the workspace list out of view. Scrolling to find one is the
 * slowest step in reaching any session, so the list needs the same forgiving
 * search the session list has.
 *
 * Matching reuses the app's shared fuzzy rules — per-token, order-independent,
 * with an abbreviation fallback — so `web mob` finds `pi-web-mobile` and the
 * behaviour matches every other search surface.
 */

/** Minimum project count before the search field earns its vertical space. */
export const PROJECT_SEARCH_MIN_PROJECTS = 6;

export function projectSearchHaystack(project: Project): string {
  return `${project.name} ${project.path}`;
}

/**
 * Filter and rank projects. Ranked rather than merely filtered because a
 * forgiving match admits weak hits, and the obvious answer should stay on top.
 */
export function filterProjects(projects: readonly Project[], query: string): Project[] {
  return fuzzyRank(projects, query, projectSearchHaystack);
}

/**
 * Whether to show the search field. It appears once the list is long enough to
 * be a nuisance, and stays while a query is active so clearing it is always
 * possible — hiding the field with text still in it would strand the filter.
 */
export function shouldShowProjectSearch(projectCount: number, query: string): boolean {
  return projectCount >= PROJECT_SEARCH_MIN_PROJECTS || searchTokens(query).length > 0;
}
