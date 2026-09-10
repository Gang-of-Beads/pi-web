import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { AppState } from "../appState";

const PANEL_COLLAPSE_STORAGE_KEY = "pi-web-app-panel-collapse";

interface StoredPanelCollapse {
  navigationPanelCollapsed?: boolean;
  workspacePanelCollapsed?: boolean;
}

function readStoredPanelCollapse(): StoredPanelCollapse {
  try {
    const raw = window.localStorage.getItem(PANEL_COLLAPSE_STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const record: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) record[key] = value;
    return {
      ...(record["navigationPanelCollapsed"] === true ? { navigationPanelCollapsed: true } : {}),
      ...(record["workspacePanelCollapsed"] === true ? { workspacePanelCollapsed: true } : {}),
    };
  } catch {
    return {};
  }
}

export class PanelCollapseController implements ReactiveController {
  navigationPanelCollapsed: boolean;
  workspacePanelCollapsed: boolean;

  hostConnected(): void {
    return;
  }

  constructor(private readonly host: ReactiveControllerHost) {
    // The fold is a layout preference, so it survives reload - coming back to
    // a panel state the reader folded away last session is the "违和" this
    // exists to end. A global key: the fold is about the reader's screen, not
    // about a machine or workspace's data.
    const stored = readStoredPanelCollapse();
    this.navigationPanelCollapsed = stored.navigationPanelCollapsed ?? false;
    this.workspacePanelCollapsed = stored.workspacePanelCollapsed ?? false;
    host.addController(this);
  }

  private persist(): void {
    try {
      const state: StoredPanelCollapse = {
        ...(this.navigationPanelCollapsed ? { navigationPanelCollapsed: true } : {}),
        ...(this.workspacePanelCollapsed ? { workspacePanelCollapsed: true } : {}),
      };
      window.localStorage.setItem(PANEL_COLLAPSE_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage being unavailable (private mode, quota) costs nothing: the
      // fold simply stops surviving reloads.
    }
  }

  toggleNavigationPanel(): void {
    this.navigationPanelCollapsed = !this.navigationPanelCollapsed;
    this.persist();
    this.host.requestUpdate();
  }

  toggleWorkspacePanel(): void {
    this.workspacePanelCollapsed = !this.workspacePanelCollapsed;
    this.persist();
    this.host.requestUpdate();
  }

  expandNavigationPanel(): void {
    if (!this.navigationPanelCollapsed) return;
    this.navigationPanelCollapsed = false;
    this.persist();
    this.host.requestUpdate();
  }

  expandWorkspacePanel(): void {
    if (!this.workspacePanelCollapsed) return;
    this.workspacePanelCollapsed = false;
    this.persist();
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

/**
 * The phone hides the panel toggle exactly when the panel is the whole view:
 * a toggle would advertise closing the only surface. A tool view stacked above
 * the panel is not that state — there the toggle is the labeled exit.
 */
export function panelToggleHiddenState(options: { mobileLayout: boolean; displayView: AppState["mainView"] }): boolean {
  return options.mobileLayout && options.displayView === "navigation";
}
