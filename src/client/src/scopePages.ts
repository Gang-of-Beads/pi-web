import type { GoToScope } from "./goToScope";

interface PageLike {
  readonly id: string;
  readonly pluginId: string;
}

/**
 * The pages a scope offers, in order (docs/design/go-to-scopes.md): the machine scope offers the
 * global pages; a project's scope offers its project pages, then the global pages of plugins that
 * bring no project page. One button per plugin page: a plugin with both kinds shows its project
 * page in a project's scope and its global page in the machine's.
 */
export function scopePages<P extends PageLike, G extends PageLike>(scope: GoToScope, projectPages: readonly P[], globalPages: readonly G[]): (P | G)[] {
  if (scope === "machine") return [...globalPages];
  const withProjectPage = new Set(projectPages.map((page) => page.pluginId));
  return [...projectPages, ...globalPages.filter((page) => !withProjectPage.has(page.pluginId))];
}
