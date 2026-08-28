export interface ShellLayout {
  isMobileNavigationLayout: boolean;
  navigationCollapsed: boolean;
}

/**
 * Whether the shell needs its own line naming the machine, project, workspace
 * and session. A phone always does; a desktop does once the panel that carried
 * that identity is collapsed.
 */
export function showsWhereAmIBar(layout: ShellLayout): boolean {
  return layout.isMobileNavigationLayout || layout.navigationCollapsed;
}
