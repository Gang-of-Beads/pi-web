import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { AppState } from "../appState";

export class PanelCollapseController implements ReactiveController {
  navigationPanelCollapsed = false;
  workspacePanelCollapsed = false;

  hostConnected(): void {
    return;
  }

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  toggleNavigationPanel(): void {
    this.navigationPanelCollapsed = !this.navigationPanelCollapsed;
    this.host.requestUpdate();
  }

  toggleWorkspacePanel(): void {
    this.workspacePanelCollapsed = !this.workspacePanelCollapsed;
    this.host.requestUpdate();
  }

  expandNavigationPanel(): void {
    if (!this.navigationPanelCollapsed) return;
    this.navigationPanelCollapsed = false;
    this.host.requestUpdate();
  }

  expandWorkspacePanel(): void {
    if (!this.workspacePanelCollapsed) return;
    this.workspacePanelCollapsed = false;
    this.host.requestUpdate();
  }

  shellClass(mainView: AppState["mainView"], hasWorkspace = true): string {
    return [
      "shell",
      mainViewClass(mainView),
      ...(this.navigationPanelCollapsed ? ["navigation-panel-collapsed"] : []),
      ...(workspacePanelTakesSpace(this.workspacePanelCollapsed, hasWorkspace) ? [] : ["workspace-panel-collapsed"]),
    ].join(" ");
  }
}

/**
 * Whether the workspace panel should occupy its column.
 *
 * It is sized `minmax(360px, 42vw)`, which on a 1280px desktop is 538px — wider
 * than the chat it sits beside. Spending that on a panel whose only content is
 * "Select a project" leaves the conversation in 400px while half the window
 * shows an empty state, so the column is given up until there is a workspace to
 * put in it. An explicit collapse still wins: the user's choice is not
 * second-guessed once made.
 */
export function workspacePanelTakesSpace(collapsed: boolean, hasWorkspace: boolean): boolean {
  if (collapsed) return false;
  return hasWorkspace;
}

export function mainViewClass(mainView: AppState["mainView"]): "navigation-view" | "chat-view" | "workspace-view" {
  if (mainView === "navigation") return "navigation-view";
  if (mainView === "chat") return "chat-view";
  return "workspace-view";
}
