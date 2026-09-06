import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Workspace } from "../api";
import type { QualifiedContributionId, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { workspacePanelStyles } from "./shared";

export interface WorkspacePanelEmptyState {
  title: string;
  body?: string;
}

@customElement("workspace-panel")
export class WorkspacePanel extends LitElement {
  @property({ attribute: false }) workspace: Workspace | undefined;
  @property({ attribute: false }) panelContext: WorkspacePanelContext | undefined;
  @property({ attribute: false }) emptyState: WorkspacePanelEmptyState | undefined;
  @property() tool: QualifiedContributionId = "core:workspace.files";
  @property({ attribute: false }) panels: QualifiedWorkspacePanelContribution[] = [];
  @property({ type: Boolean }) hideHeader = false;

  override render() {
    const workspace = this.workspace;
    if (workspace === undefined) return this.renderEmptyState(this.emptyState ?? {
      title: "Select a workspace",
      body: "Choose a workspace to use its tools.",
    });
    const context = this.panelContext;
    if (context === undefined) return this.renderEmptyState({
      title: "Workspace tools unavailable",
      body: "Try selecting the workspace again.",
    });
    const visiblePanels = this.panels;
    const selectedPanel = visiblePanels.find((panel) => panel.id === this.tool) ?? visiblePanels[0];
    return html`
      ${this.hideHeader ? null : this.renderHeader(context)}
      ${selectedPanel === undefined ? this.renderEmptyState({
        title: "No workspace tools available",
        body: "No tools are available for this workspace.",
      }) : html`
        <div class="panel-content">
          ${selectedPanel.render(context)}
        </div>
      `}
    `;
  }

  /**
   * The panel grid in the navigation sidebar is the one entrance to these
   * views, so the header carries only the expanded-view decision - a tab strip
   * here was a second entrance for the same six views.
   */
  private renderHeader(context: WorkspacePanelContext): TemplateResult {
    return html`
      <header>
        <div class="workspace-header-layout">
          ${this.renderFullscreenToggle(context)}
        </div>
      </header>
    `;
  }

  private renderFullscreenToggle(context: WorkspacePanelContext): TemplateResult {
    const expanded = context.host.workspacePanelFullscreen();
    const label = expanded ? "Exit expanded view" : "Expand panel";
    return html`
      <button
        type="button"
        class="workspace-fullscreen-toggle"
        title=${label}
        aria-label=${label}
        aria-pressed=${String(expanded)}
        @click=${() => { context.host.setWorkspacePanelFullscreen(!expanded); }}
      >${label}</button>
    `;
  }

  private renderEmptyState(state: WorkspacePanelEmptyState): TemplateResult {
    return html`
      <section class="empty-state" role="status">
        <h2>${state.title}</h2>
        ${state.body === undefined ? null : html`<p>${state.body}</p>`}
      </section>
    `;
  }

  static override styles = workspacePanelStyles;
}
