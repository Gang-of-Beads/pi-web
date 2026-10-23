import { LitElement, css, html, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Workspace } from "../api";
import type { ShownPage } from "../plugins/registry";
import type { GlobalPanelContext, QualifiedContributionId, QualifiedGlobalPanelContribution, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { shownWorkspacePanel } from "../workspacePanelCanvas";
import { MachineListPresenceController } from "./appShell/machineListPresenceController";
import { interactiveSurfaceStyles, pageScrollerStyles, workspacePanelStyles } from "./shared";

/**
 * What the panel says with no workspace to show. `unknown` says nothing: the
 * data it would describe has not answered yet, and absence is not negation
 * (B48); the app row speaks while the machine goes unanswered.
 */
export type WorkspacePanelEmptyState = { kind: "unknown" } | { kind: "message"; title: string; body?: string };

/** The page this panel draws: a global page, or a workspace page with the workspace's context. */
type DrawnPage =
  | { kind: "global"; panel: QualifiedGlobalPanelContribution; context: GlobalPanelContext }
  | { kind: "workspace"; panel: QualifiedWorkspacePanelContribution; context: WorkspacePanelContext };

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
 *
 * It is the one owner of "is the page on screen" (r151): the app keeps the selected page drawn
 * while the phone shows the chat, so a render is not a look. The page it draws counts as shown
 * while the document is visible, this panel is on screen, no modal covers it and the Go to list
 * does not cover it, the rules the Machines list's presence follows; `onShownPageChange` hears the
 * page, or `undefined`, on every update, and the registry keeps and announces the changes.
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
  /** One of the app's full-screen pages (Navigate, a machine access request) is drawn over this one: the page is not shown, though it keeps its pointer and focus wiring. */
  @property({ type: Boolean }) behindPage = false;
  @property({ attribute: false }) onShownPageChange: (page: ShownPage | undefined) => void = () => undefined;
  private onScreen = false;

  /**
   * The controller answers what only a look can tell (tab, rectangle, modal layers); `covered` and
   * `behindPage` are this element's own properties, applied as the update that changes them reports,
   * so a page chosen from the Go to list starts shown instead of flipping one draw later.
   */
  constructor() {
    super();
    new MachineListPresenceController(this, () => true, (visible) => {
      this.onScreen = visible;
      this.reportShownPage();
    });
  }

  /**
   * The page drawn next is reported before it draws, so a page element that reads `host.shown()`
   * when it connects already reads its own answer, not the page's it replaces.
   */
  override willUpdate(): void {
    this.reportShownPage();
  }

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

  private reportShownPage(): void {
    const page = this.onScreen && !this.covered && !this.behindPage ? this.drawnPage() : undefined;
    this.onShownPageChange(page === undefined ? undefined : {
      pageId: page.panel.id,
      pluginId: page.panel.pluginId,
      machineId: page.context.machine.id,
      workspaceId: page.kind === "workspace" ? page.context.workspace.id : undefined,
    });
  }

  private drawnPage(): DrawnPage | undefined {
    const globalPanel = this.globalPanels.find((panel) => panel.id === this.tool);
    const globalContext = this.globalContext;
    if (globalPanel !== undefined && globalContext !== undefined) return { kind: "global", panel: globalPanel, context: globalContext };
    const context = this.panelContext;
    if (this.workspace === undefined || context === undefined) return undefined;
    const panel = shownWorkspacePanel(this.panels, this.tool);
    return panel === undefined ? undefined : { kind: "workspace", panel, context };
  }

  private renderPage() {
    const page = this.drawnPage();
    if (page?.kind === "global") return this.renderGlobalPanel(page.context, page.panel);
    if (page?.kind === "workspace") return html`
      ${this.renderToolbar(page.context, page.panel)}
      <div class="panel-content page-scroller" role="region" aria-label=${page.panel.title}>
        ${page.panel.render(page.context)}
      </div>
    `;
    if (this.workspace === undefined) return this.renderEmptyState(this.emptyState ?? {
      kind: "message",
      title: "Select a project",
      body: "Choose a project to use its tools.",
    });
    if (this.panelContext === undefined) return this.renderEmptyState({
      kind: "message",
      title: "Project tools unavailable",
      body: "Try selecting the project again.",
    });
    return this.renderEmptyState({
      kind: "message",
      title: "No project tools available",
      body: "No tools are available for this project.",
    });
  }

  private renderGlobalPanel(context: GlobalPanelContext, panel: QualifiedGlobalPanelContribution): TemplateResult {
    return html`
      ${renderToolbarRow(panel.title, panel.toolbar?.(context))}
      <div class="panel-content page-scroller" role="region" aria-label=${panel.title}>${panel.render(context)}</div>
    `;
  }

  private renderToolbar(context: WorkspacePanelContext, panel: QualifiedWorkspacePanelContribution): TemplateResult | null {
    return renderToolbarRow(panel.title, panel.toolbar?.(context));
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

/** A page's controls row, or none for a page without controls or whose plugin's `toolbar` failed. */
function renderToolbarRow(title: string, controls: TemplateResult | undefined): TemplateResult | null {
  if (controls === undefined) return null;
  return html`<div class="workspace-tool-toolbar" role="toolbar" aria-label=${`${title} controls`}>${controls}</div>`;
}
