import type { ReactiveController, ReactiveControllerHost } from "lit";

export const NAVIGATION_SECTION_ORDER = ["machines", "projects", "workspaces", "sessions"] as const;
export type NavigationSection = (typeof NAVIGATION_SECTION_ORDER)[number];
export type ExpandedNavigationSection = NavigationSection | "none" | undefined;

export interface NavigationSelectionState {
  selectedProject: object | undefined;
  selectedWorkspace: object | undefined;
}

/**
 * Section opened first on the mobile accordion.
 *
 * Sessions are the working surface, so a restored selection opens straight
 * there instead of replaying project → workspace → sessions. Only a genuinely
 * unselected context falls back to the section that still needs a choice.
 */
export function defaultNavigationSection(state: NavigationSelectionState): NavigationSection {
  if (state.selectedWorkspace !== undefined) return "sessions";
  if (state.selectedProject === undefined) return "projects";
  return "workspaces";
}

export function expandedNavigationSection(expanded: ExpandedNavigationSection, state: NavigationSelectionState): NavigationSection | undefined {
  if (expanded === "none") return undefined;
  return expanded ?? defaultNavigationSection(state);
}

/**
 * One section is open at a time, on every width.
 *
 * Desktop used to keep a second model - a set of independently collapsed
 * sections - so the sidebar stacked four scrolling lists. With the context row
 * naming machine, project and workspace above the body, a picker is only on
 * screen while it is being used, which is the same rule the phone already had.
 */
export function isNavigationSectionCollapsed(section: NavigationSection, options: { expanded: ExpandedNavigationSection; state: NavigationSelectionState }): boolean {
  return expandedNavigationSection(options.expanded, options.state) !== section;
}

export function toggleNavigationSection(expanded: ExpandedNavigationSection, section: NavigationSection, options: { state: NavigationSelectionState }): ExpandedNavigationSection {
  return expandedNavigationSection(expanded, options.state) === section ? "none" : section;
}

/**
 * Where to go after a project is chosen.
 *
 * A workspace is a git worktree, so that step earns its place when a project
 * has several. With exactly one, it lists a single option the app has already
 * selected, so stopping there asks for a tap that changes nothing. An unknown
 * count means the list has not loaded yet: the honest destination is the list
 * about to be filled, not a guess at its contents.
 */
export function sectionAfterProjectSelection(options: { workspaceCount: number | undefined }): NavigationSection {
  return options.workspaceCount === 1 ? "sessions" : "workspaces";
}

export function nextNavigationSection(section: NavigationSection): NavigationSection | undefined {
  return NAVIGATION_SECTION_ORDER[NAVIGATION_SECTION_ORDER.indexOf(section) + 1];
}

export class NavigationSectionsController implements ReactiveController {
  private expanded: ExpandedNavigationSection;

  hostConnected(): void {
    return;
  }

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly getState: () => NavigationSelectionState,
  ) {
    host.addController(this);
  }

  expandedSection(): NavigationSection | undefined {
    return expandedNavigationSection(this.expanded, this.getState());
  }

  isCollapsed(section: NavigationSection): boolean {
    return isNavigationSectionCollapsed(section, { expanded: this.expanded, state: this.getState() });
  }

  toggle(section: NavigationSection): void {
    this.setExpanded(toggleNavigationSection(this.expanded, section, { state: this.getState() }));
  }

  expand(section: NavigationSection): void {
    this.setExpanded(section);
  }

  advanceAfterSelection(section: NavigationSection, options?: { workspaceCount?: number | undefined }): void {
    const next = section === "projects"
      ? sectionAfterProjectSelection({ workspaceCount: options?.workspaceCount })
      : nextNavigationSection(section);
    if (next !== undefined) this.expand(next);
  }

  open(section: NavigationSection, openNavigationView: () => void): void {
    this.expand(section);
    openNavigationView();
  }

  private setExpanded(expanded: ExpandedNavigationSection): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.host.requestUpdate();
  }

}
