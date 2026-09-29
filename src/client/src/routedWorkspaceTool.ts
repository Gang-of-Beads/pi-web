import type { AppState } from "./appState";
import type { QualifiedContributionId } from "./plugins/ids";

/**
 * The tool the workspace panel shows once a route is restored.
 *
 * A route names the view on screen (`view`) and the panel's tool (`tool`) separately. A link
 * with `view=<tool>` and no `tool=` - the shape the phone deep-link probe uses - put the view
 * on that tool while the panel kept whatever it showed before: the header said Files, the
 * named panel never rendered, and its read never ran (reads F5). The view names the tool when
 * the route does not.
 */
export function routedWorkspaceTool(tool: QualifiedContributionId | undefined, mainView: AppState["mainView"], current: QualifiedContributionId): QualifiedContributionId {
  if (tool !== undefined) return tool;
  if (mainView === "navigation" || mainView === "chat") return current;
  return mainView;
}
