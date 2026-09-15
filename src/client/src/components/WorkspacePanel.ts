import { LitElement, css, html, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Workspace } from "../api";
import type { QualifiedContributionId, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { browserWorkspaceToolFoldStore, toggledFold, type WorkspaceToolFoldState, type WorkspaceToolFoldStore } from "../workspaceToolFold";
import { disclosureIconStyle, renderDisclosureIcon } from "./disclosureIcon";
import { panelHeaderStyles } from "./appShell/panelHeaderStyles";
import { interactiveSurfaceStyles, workspacePanelStyles } from "./shared";

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
  /** The desktop-only expand control; the title row itself shows everywhere. */
  @property({ type: Boolean }) hideHeader = false;
  @property({ attribute: false }) foldStore: WorkspaceToolFoldStore = browserWorkspaceToolFoldStore();
  @state() private foldRevision = 0;

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
      ${selectedPanel === undefined ? null : this.renderHeader(context, selectedPanel)}
      ${selectedPanel === undefined ? this.renderEmptyState({
        title: "No workspace tools available",
        body: "No tools are available for this workspace.",
      }) : html`
        ${this.renderToolbarFold(context, selectedPanel)}
        <div class="panel-content">
          ${selectedPanel.render(context)}
        </div>
      `}
    `;
  }

  /**
   * One header for every tool: its title and summary, the fold that holds
   * its controls, and on wide screens the expand control. The panel grid in
   * the navigation sidebar is the one entrance to these views, so no tab
   * strip lives here. A panel never stacks a bar of its own under this one;
   * that was the owner's complaint on the phone, and the fold is the answer.
   */
  private renderHeader(context: WorkspacePanelContext, panel: QualifiedWorkspacePanelContribution): TemplateResult {
    const summary = panel.summary?.(context);
    const fold = this.foldState(panel.id);
    const hasToolbar = panel.toolbar !== undefined;
    return html`
      <header class="panel-header">
        <div class="panel-header-title" role="heading" aria-level="2">
          <span class="workspace-tool-title">${panel.title}</span>
          ${summary === undefined || summary === "" ? null : html`<span class="workspace-tool-summary" dir="auto"> · ${summary}</span>`}
        </div>
        <div class="workspace-header-actions">
          ${hasToolbar ? html`
            <button
              type="button"
              class="panel-header-action workspace-tool-fold"
              title=${fold === "open" ? "Hide tool controls" : "Show tool controls"}
              aria-label=${fold === "open" ? "Hide tool controls" : "Show tool controls"}
              aria-expanded=${fold === "open" ? "true" : "false"}
              @click=${() => { this.toggleFold(panel.id); }}
            >${renderDisclosureIcon(fold !== "open")}</button>
          ` : null}
          ${this.hideHeader ? null : this.renderFullscreenToggle(context)}
        </div>
      </header>
    `;
  }

  private renderToolbarFold(context: WorkspacePanelContext, panel: QualifiedWorkspacePanelContribution): TemplateResult | null {
    if (panel.toolbar === undefined || this.foldState(panel.id) !== "open") return null;
    return html`<div class="workspace-tool-toolbar" role="toolbar" aria-label=${`${panel.title} controls`}>${panel.toolbar(context)}</div>`;
  }

  private foldState(toolId: string): WorkspaceToolFoldState {
    void this.foldRevision;
    return this.foldStore.read(toolId);
  }

  private toggleFold(toolId: string): void {
    this.foldStore.write(toolId, toggledFold(this.foldStore.read(toolId)));
    this.foldRevision += 1;
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

  static override styles = [interactiveSurfaceStyles, panelHeaderStyles, workspacePanelStyles, css`${unsafeCSS(disclosureIconStyle)}`];
}
