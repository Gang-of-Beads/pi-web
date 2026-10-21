import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Workspace } from "../api";
import type { GlobalPanelContext, QualifiedContributionId, QualifiedGlobalPanelContribution, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { shownWorkspacePanel } from "../workspacePanelCanvas";
import { interactiveSurfaceStyles, pageScrollerStyles, workspacePanelStyles } from "./shared";

/**
 * What the panel says with no workspace to show. `unknown` says nothing: the
 * data it would describe has not answered yet, and absence is not negation
 * (B48); the app row speaks while the machine goes unanswered.
 */
export type WorkspacePanelEmptyState = { kind: "unknown" } | { kind: "message"; title: string; body?: string };

/**
 * A plugin's page. It draws no row of its own: on the phone and medium layouts
 * the app bar names the page ("Files · session"), on the wide layout the app
 * slots in the column's bar (`bar`, AppColumnBar) that names it, and a title
 * row under either was a second bar the owner had removed (2026-10-01). A tool's own buttons
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
  /** The Go to list covers the page (`cover`): the page under it takes no pointer, focus or reading until it goes. */
  @property({ type: Boolean }) covered = false;

  /**
   * The page, under the bar the app slots in on the wide layout (`bar`), with what covers it
   * (`cover`: the Go to list, which opens inside this column).
   */
  override render() {
    return html`<slot name="bar"></slot>${this.renderPage()}<slot name="cover"></slot>`;
  }

  /**
   * The cover's inert goes on while covered, including on a page swapped in under it, and comes off
   * once when the cover goes. Clearing it on every update took off the marks the modal registry
   * puts on the page's toolbar behind a dialog the page opened.
   */
  override updated(changed: PropertyValues<this>): void {
    if (!this.covered && !changed.has("covered")) return;
    for (const child of this.renderRoot.children) {
      if (child.tagName !== "SLOT" && child.tagName !== "STYLE") child.toggleAttribute("inert", this.covered);
    }
  }

  private renderPage() {
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
        <div class="panel-content page-scroller" role="region" aria-label=${selectedPanel.title}>
          ${selectedPanel.render(context)}
        </div>
      `}
    `;
  }

  private renderGlobalPanel(context: GlobalPanelContext, panel: QualifiedGlobalPanelContribution): TemplateResult {
    return html`
      ${panel.toolbar === undefined ? null : html`<div class="workspace-tool-toolbar" role="toolbar" aria-label=${`${panel.title} controls`}>${panel.toolbar(context)}</div>`}
      <div class="panel-content page-scroller" role="region" aria-label=${panel.title}>${panel.render(context)}</div>
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

  static override styles = [interactiveSurfaceStyles, workspacePanelStyles, pageScrollerStyles, css`:host { position: relative; }`];
}
