import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Workspace } from "../api";
import type { GlobalPanelContext, QualifiedContributionId, QualifiedGlobalPanelContribution, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { shownWorkspacePanel } from "../workspacePanelCanvas";
import { interactiveSurfaceStyles, workspacePanelStyles } from "./shared";

/**
 * What the panel says with no workspace to show. `unknown` says nothing: the
 * data it would describe has not answered yet, and absence is not negation
 * (B48); the app row speaks while the machine goes unanswered.
 */
export type WorkspacePanelEmptyState = { kind: "unknown" } | { kind: "message"; title: string; body?: string };

/**
 * A plugin's page under the app bar. It draws no row of its own: the app bar
 * already names the page ("Files · session"), and a title row under it was a
 * second bar the owner had removed (2026-10-01). A tool's own buttons
 * (Files: Upload, Refresh) show at the top of its page as they did inside the
 * old fold; a tool without buttons starts with its content. The content is a
 * region named for the tool: the row that carried its heading is gone, and
 * on the whole canvas the app bar that names it is hidden too. A global page
 * (docs/design/go-to-scopes.md) is drawn here as well and needs no workspace.
 */
@customElement("workspace-panel")
export class WorkspacePanel extends LitElement {
  @property({ attribute: false }) workspace: Workspace | undefined;
  @property({ attribute: false }) panelContext: WorkspacePanelContext | undefined;
  @property({ attribute: false }) emptyState: WorkspacePanelEmptyState | undefined;
  @property() tool: QualifiedContributionId = "core:workspace.files";
  @property({ attribute: false }) panels: QualifiedWorkspacePanelContribution[] = [];
  @property({ attribute: false }) globalPanels: QualifiedGlobalPanelContribution[] = [];
  @property({ attribute: false }) globalContext: GlobalPanelContext | undefined;

  override render() {
    const globalPanel = this.globalPanels.find((panel) => panel.id === this.tool);
    const globalContext = this.globalContext;
    if (globalPanel !== undefined && globalContext !== undefined) return this.renderGlobalPanel(globalContext, globalPanel);
    const workspace = this.workspace;
    if (workspace === undefined) return this.renderEmptyState(this.emptyState ?? {
      kind: "message",
      title: "Select a project",
      body: "Choose a project to use its tools.",
    });
    const context = this.panelContext;
    if (context === undefined) return this.renderEmptyState({
      kind: "message",
      title: "Project tools unavailable",
      body: "Try selecting the project again.",
    });
    const selectedPanel = shownWorkspacePanel(this.panels, this.tool);
    return html`
      ${selectedPanel === undefined ? this.renderEmptyState({
        kind: "message",
        title: "No project tools available",
        body: "No tools are available for this project.",
      }) : html`
        ${this.renderToolbar(context, selectedPanel)}
        <div class="panel-content" role="region" aria-label=${selectedPanel.title}>
          ${selectedPanel.render(context)}
        </div>
      `}
    `;
  }

  private renderGlobalPanel(context: GlobalPanelContext, panel: QualifiedGlobalPanelContribution): TemplateResult {
    return html`
      ${panel.toolbar === undefined ? null : html`<div class="workspace-tool-toolbar" role="toolbar" aria-label=${`${panel.title} controls`}>${panel.toolbar(context)}</div>`}
      <div class="panel-content" role="region" aria-label=${panel.title}>${panel.render(context)}</div>
    `;
  }

  private renderToolbar(context: WorkspacePanelContext, panel: QualifiedWorkspacePanelContribution): TemplateResult | null {
    if (panel.toolbar === undefined) return null;
    return html`<div class="workspace-tool-toolbar" role="toolbar" aria-label=${`${panel.title} controls`}>${panel.toolbar(context)}</div>`;
  }

  private renderEmptyState(state: WorkspacePanelEmptyState): TemplateResult {
    if (state.kind === "unknown") return html``;
    return html`
      <section class="empty-state" role="status">
        <h2>${state.title}</h2>
        ${state.body === undefined ? null : html`<p>${state.body}</p>`}
      </section>
    `;
  }

  static override styles = [interactiveSurfaceStyles, workspacePanelStyles];
}
