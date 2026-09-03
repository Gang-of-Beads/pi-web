export interface ShellLayout {
  isMobileNavigationLayout: boolean;
  navigationCollapsed: boolean;
  workspaceToolTabsVisible: boolean;
}

/**
 * Whether the shell needs its own line naming the machine, project, workspace
 * and session, and carrying the route to the workspace tools.
 *
 * A phone always does; a desktop does once the panel that carried that identity
 * is collapsed. It also does whenever the workspace panel's own tab strip is
 * not on screen, because that strip is the only other way to reach a plugin
 * panel - tying the bar to the mobile threshold alone left a band of widths
 * where neither existed.
 */
export function showsWhereAmIBar(layout: ShellLayout): boolean {
  return layout.isMobileNavigationLayout || layout.navigationCollapsed || !layout.workspaceToolTabsVisible;
}
