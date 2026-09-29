import type { AppState } from "./appState";
import type { QualifiedContributionId } from "./plugins/ids";

/**
 * The tool the workspace panel shows once a route is restored.
 *
 * A route names the view on screen (`view`) and the panel's tool (`tool`) separately. A link
 * with `view=<tool>` and no `tool=` - the shape the phone deep-link probe uses - put the view
 * on that tool while the panel kept whatever it showed before: the header said Files, the
 * named panel never rendered, and its read never ran (reads F5). A view that is a tool names
 * the panel's tool, whatever `tool` says: a hand-written link naming two different tools
 * otherwise put the header on one and the panel on the other. The chat and the navigation
 * view leave the panel on the route's tool, or on the one it had.
 */
export function routedWorkspaceTool(tool: QualifiedContributionId | undefined, mainView: AppState["mainView"], current: QualifiedContributionId): QualifiedContributionId {
  if (mainView !== "navigation" && mainView !== "chat") return mainView;
  return tool ?? current;
}
