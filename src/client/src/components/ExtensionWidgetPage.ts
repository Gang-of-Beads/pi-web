import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ExtensionWidgetStanding } from "../../../shared/apiTypes";
import { extensionWidgetPages, pageShowsNothing, type ExtensionWidgetPage as Page } from "../extensionWidgetPages";
import type { QualifiedWorkspacePanelContribution } from "../plugins/types";
import { interactiveSurfaceStyles } from "./shared";

/**
 * A pi extension's page in Go to: what it draws with `setWidget` in the session on screen, as the
 * terminal draws it above the composer, one block per widget key, following every update
 * (extension-keys-in-go-to.md). Nothing an extension draws goes in the conversation or around the
 * composer (owner, 2026-10-06 and 2026-10-07).
 */
@customElement("extension-widget-page")
export class ExtensionWidgetPage extends LitElement {
  @property({ attribute: false }) page: Page | undefined;

  override render() {
    const page = this.page;
    if (page === undefined) return nothing;
    if (pageShowsNothing(page)) return html`<p class="empty" role="status">${page.title} shows nothing in this session right now.</p>`;
    return html`<div class="widgets">
      ${page.widgets.filter((widget) => widget.lines.length > 0).map((widget) => html`<section class="widget" aria-label=${widget.key}>
        <header>${widget.key}</header>
        <pre>${widget.lines.join("\n")}</pre>
      </section>`)}
    </div>`;
  }

  static override styles = [interactiveSurfaceStyles, css`
    :host { display: block; padding: var(--pi-space-4) var(--pi-bar-inset); }
    .widgets { display: grid; gap: var(--pi-space-4); }
    .widget { min-width: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); overflow: hidden; }
    header { padding: var(--pi-space-2) var(--pi-space-4); border-bottom: 1px solid var(--pi-border); color: var(--pi-muted); font: var(--pi-text-xs) var(--pi-font-mono); }
    pre { margin: 0; padding: var(--pi-space-3) var(--pi-space-4); overflow-x: auto; color: var(--pi-text); font: var(--pi-text-xs) var(--pi-font-mono); line-height: 1.45; white-space: pre; }
    .empty { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-sm); }
  `];
}

/**
 * The extensions' pages as workspace pages, after every plugin's: the host draws them, as it draws
 * a notice or a status, because they are pi's `ctx.ui` and no plugin's.
 */
export function extensionWidgetPanels(widgets: readonly ExtensionWidgetStanding[] | undefined): QualifiedWorkspacePanelContribution[] {
  return extensionWidgetPages(widgets).map((page, index) => ({
    id: `core:extension.${page.id}`,
    pluginId: "core",
    localId: `extension.${page.id}`,
    title: page.title,
    order: 10_000 + index,
    render: () => html`<extension-widget-page .page=${page}></extension-widget-page>`,
  }));
}

declare global {
  interface HTMLElementTagNameMap {
    "extension-widget-page": ExtensionWidgetPage;
  }
}
