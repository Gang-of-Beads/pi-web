import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { Workspace } from "../api";
import type { QualifiedContributionId, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { scrollEdgeClasses, ScrollEdgeTracker } from "../scrollEdges";
import { workspacePanelStyles } from "./shared";

export interface WorkspacePanelEmptyState {
  title: string;
  body?: string;
}

type WorkspacePanelBadge = string | number | TemplateResult | undefined;

@customElement("workspace-panel")
export class WorkspacePanel extends LitElement {
  @property({ attribute: false }) workspace: Workspace | undefined;
  @property({ attribute: false }) panelContext: WorkspacePanelContext | undefined;
  @property({ attribute: false }) emptyState: WorkspacePanelEmptyState | undefined;
  @property() tool: QualifiedContributionId = "core:workspace.files";
  @property({ attribute: false }) panels: QualifiedWorkspacePanelContribution[] = [];
  @property({ type: Boolean }) hideToolTabs = false;
  @property({ attribute: false }) onSelectTool: (tool: QualifiedContributionId) => void = () => undefined;
  @query(".workspace-header-strip") private workspaceHeaderStrip?: HTMLElement | null;

  private readonly workspaceHeaderEdges = new ScrollEdgeTracker(() => { this.requestUpdate(); });
  private readonly onWorkspaceHeaderScroll = () => {
    this.workspaceHeaderEdges.refresh();
  };

  override updated(): void {
    this.workspaceHeaderEdges.observe(this.workspaceHeaderStripElement());
  }

  override disconnectedCallback(): void {
    this.workspaceHeaderEdges.dispose();
    super.disconnectedCallback();
  }

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
      ${this.hideToolTabs ? null : html`
        <header>
          <div class=${this.workspaceHeaderFrameClass()}>
            <div class="workspace-header-strip" @scroll=${this.onWorkspaceHeaderScroll}>
              <div class="tabs">
                ${visiblePanels.map((panel) => {
                  const selected = selectedPanel?.id === panel.id;
                  const badge = panel.badge?.(context);
                  const ariaLabel = this.panelTabAriaLabel(panel, badge);
                  return html`
                    <button class=${this.panelTabClass(panel, selected)} title=${ariaLabel} aria-label=${ariaLabel} aria-pressed=${String(selected)} @click=${() => { this.onSelectTool(panel.id); }}>
                      ${this.renderPanelTabContent(panel, badge)}
                    </button>
                  `;
                })}
              </div>
            </div>
          </div>
        </header>
      `}
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

  private panelTabClass(panel: QualifiedWorkspacePanelContribution, selected: boolean): string {
    return [
      ...(panel.icon === undefined ? [] : ["icon-tab"]),
      ...(selected ? ["selected"] : []),
    ].join(" ");
  }

  private panelTabAriaLabel(panel: QualifiedWorkspacePanelContribution, badge: WorkspacePanelBadge): string {
    if (typeof badge !== "string" && typeof badge !== "number") return panel.title;
    const trimmedBadge = String(badge).trim();
    return trimmedBadge === "" ? panel.title : `${panel.title}, ${trimmedBadge}`;
  }

  private renderPanelTabContent(panel: QualifiedWorkspacePanelContribution, badge: WorkspacePanelBadge): TemplateResult {
    return html`
      ${panel.icon === undefined ? null : html`<span class="tab-custom-icon" aria-hidden="true">${panel.icon}</span>`}
      <span class="tab-label">${panel.title}</span>
      ${this.isEmptyBadge(badge) ? null : html`<span class="tab-badge">${badge}</span>`}
    `;
  }

  private isEmptyBadge(badge: WorkspacePanelBadge): boolean {
    return badge === undefined || badge === "";
  }

  private renderEmptyState(state: WorkspacePanelEmptyState): TemplateResult {
    return html`
      <section class="empty-state" role="status">
        <h2>${state.title}</h2>
        ${state.body === undefined ? null : html`<p>${state.body}</p>`}
      </section>
    `;
  }

  private workspaceHeaderFrameClass(): string {
    return `workspace-header-scroll-frame${scrollEdgeClasses(this.workspaceHeaderEdges.edges)}`;
  }



  private workspaceHeaderStripElement(): HTMLElement | undefined {
    const strip = this.workspaceHeaderStrip;
    return strip instanceof HTMLElement ? strip : undefined;
  }

  static override styles = workspacePanelStyles;
}
