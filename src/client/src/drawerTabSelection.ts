import type { QualifiedContributionId } from "./plugins/ids";

/**
 * Which session-drawer tab is showing.
 *
 * The drawer used to hold a closed set of three, one of which - goals - is a
 * feature that belongs to a plugin. A contributed section names its tab by its
 * qualified contribution id, so the shell can carry any number of them without
 * learning what they are.
 *
 * The reader's own choice always wins, including a choice of a section that
 * currently has nothing in it: a tab someone opened deliberately must not be
 * taken away because its contents emptied. Only when nobody has chosen does
 * the drawer pick, and then work in flight outranks a section that changes
 * slowly.
 */

export type DrawerTab = "activity" | "notifications" | QualifiedContributionId;

export interface DrawerTabAvailability {
  activity: boolean;
  notifications: boolean;
  /** Contributed sections present on this machine, whether or not they hold anything. */
  sections: readonly QualifiedContributionId[];
  /** The subset that currently has something to show. */
  withContent: readonly QualifiedContributionId[];
}

export function selectedDrawerTab(available: DrawerTabAvailability, preferred: DrawerTab | undefined): DrawerTab {
  if (preferred !== undefined && isKnownTab(preferred, available)) return preferred;
  if (available.notifications) return "notifications";
  if (available.activity) return "activity";
  return available.withContent[0] ?? "activity";
}

function isKnownTab(tab: DrawerTab, available: DrawerTabAvailability): boolean {
  if (tab === "activity" || tab === "notifications") return true;
  return available.sections.includes(tab);
}
