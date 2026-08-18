/**
 * When the mobile quick-action row earns its height.
 *
 * The row is 65px of a 839px phone screen, and it sits below the context bar
 * and the tab strip, so the list only begins at y=199 — a fifth of the viewport
 * spent before any content. Two of its three buttons duplicate what the list
 * below already offers: once projects exist you pick one from the list, and
 * "Open session" is the same sheet the context bar's session chip opens.
 *
 * So the row is shown when it is genuinely the way forward — an empty app with
 * no projects yet — and when starting a session is possible but the sessions
 * list is not the visible section, which is the one case where "New session"
 * is not otherwise reachable.
 */
export interface QuickActionContext {
  projectCount: number;
  canStartSession: boolean;
  visibleSection: "machines" | "projects" | "workspaces" | "sessions";
}

export function shouldShowQuickActions(context: QuickActionContext): boolean {
  // Nothing to choose from yet: the row is the only way to add a project.
  if (context.projectCount === 0) return true;
  // The sessions list carries its own "+" affordance, so the row would repeat it.
  if (context.visibleSection === "sessions") return false;
  // Elsewhere, offer it only when it can actually do something.
  return context.canStartSession;
}
