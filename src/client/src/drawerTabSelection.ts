import type { QualifiedContributionId } from "./plugins/ids";

/**
 * Which session-drawer tab is showing. The drawer's own content is all
 * contributed now: activity and notifications moved out to plugins, so a tab
 * is a contributed section's qualified id and nothing else.
 *
 * The reader's own choice always wins, including a choice of a section that
 * currently has nothing in it: a tab someone opened deliberately must not be
 * taken away because its contents emptied. Only when nobody has chosen does
 * the drawer pick, and then a section that currently has something to show
 * outranks one that changes slowly.
 */

export type DrawerTab = QualifiedContributionId;

export interface DrawerTabAvailability {
  /** Contributed sections present on this machine, whether or not they hold anything. */
  sections: readonly QualifiedContributionId[];
  /** The subset that currently has something to show. */
  withContent: readonly QualifiedContributionId[];
}

export function selectedDrawerTab(available: DrawerTabAvailability, preferred: DrawerTab | undefined): DrawerTab | undefined {
  if (preferred !== undefined && available.sections.includes(preferred)) return preferred;
  return available.withContent[0] ?? available.sections[0];
}
