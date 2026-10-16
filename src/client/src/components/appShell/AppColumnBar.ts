import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { barKeyStyles } from "./panelHeaderStyles";
import { interactiveSurfaceStyles } from "../shared";
import { renderBackIcon, renderGridIcon, renderMenuIcon } from "../uiIcons";

/**
 * The bar of the column that shows pages beside the chat on the wide layout: it names the page,
 * in the chat title's type, so the three bars read as one row. Go to holds the window's top-right
 * corner, so while the column is on screen it stands here and folds the column away, list or page
 * (owner, 2026-10-16). Over a page, the column's top-left holds Back, which shows the Go to list
 * again (owner, 2026-10-16: a plugin page needs a way back to the menu). A page holding the whole
 * canvas hides the other bars, so over its list this bar carries the grid key too (cornerKeys).
 * One bar per column: the row under the app bar stays gone (96e054e1: two stacked rows looked
 * wrong).
 */
@customElement("app-column-bar")
export class AppColumnBar extends LitElement {
  @property({ type: String }) pageTitle = "";
  @property({ type: String }) leadingKey: "grid" | "back" | "none" = "none";
  @property({ type: Boolean }) goToKey = false;
  @property({ attribute: false }) onNavigationKey?: () => void;
  @property({ attribute: false }) onBack?: () => void;
  @property({ attribute: false }) onGoTo?: () => void;

  override render() {
    return html`<div class="column-bar">
      ${this.renderLeadingKey()}
      <span class="column-title">${this.pageTitle}</span>
      ${this.goToKey
        ? html`<button type="button" class="bar-key" data-corner-key="goTo" title="Close the page column" aria-label="Close the page column" aria-expanded="true" @click=${() => { this.onGoTo?.(); }}>${renderMenuIcon()}</button>`
        : html`<span class="key-space" aria-hidden="true"></span>`}
    </div>`;
  }

  private renderLeadingKey() {
    if (this.leadingKey === "back") return html`<button type="button" class="bar-key" data-corner-key="back" title="Back to Go to" aria-label="Back to Go to" @click=${() => { this.onBack?.(); }}>${renderBackIcon()}</button>`;
    if (this.leadingKey === "grid") return html`<button type="button" class="bar-key" data-corner-key="grid" title="Open navigation panel" aria-label="Open navigation panel" aria-expanded="false" @click=${() => { this.onNavigationKey?.(); }}>${renderGridIcon()}</button>`;
    return html`<span class="key-space" aria-hidden="true"></span>`;
  }

  static override styles = [interactiveSurfaceStyles, css`
    :host { flex: 0 0 auto; min-width: 0; display: block; -webkit-user-select: none; user-select: none; }
    .column-bar { box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; gap: var(--pi-space-5); padding: 0 var(--pi-chat-gutter); border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
    .column-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-text-bright, var(--pi-text)); font: var(--pi-weight-strong) var(--pi-text-base) var(--pi-font-ui); line-height: var(--pi-panel-header-control-height); text-align: center; }
  `, barKeyStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "app-column-bar": AppColumnBar;
  }
}
