import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { barKeyStyles } from "./panelHeaderStyles";
import { interactiveSurfaceStyles } from "../shared";
import { renderGridIcon, renderMenuIcon } from "../uiIcons";

/**
 * The bar of the column that shows pages beside the chat on the wide layout: it names the page,
 * in the chat title's type, so the three bars read as one row. Go to holds the window's top-right
 * corner (owner, 2026-10-16), so while the column is on screen it stands here and folds the column
 * away; the page's name opens and closes the Go to list over the page, so switching pages does not
 * fold the column first. A page holding the whole canvas hides the other bars, so this bar then
 * carries the grid key too (cornerKeys). One bar per column: the row under the app bar stays gone
 * (96e054e1: two stacked rows looked wrong).
 */
@customElement("app-column-bar")
export class AppColumnBar extends LitElement {
  @property({ type: String }) pageTitle = "";
  /** Whether the Go to list covers the page. */
  @property({ type: Boolean }) listOpen = false;
  @property({ type: Boolean }) navigationKey = false;
  @property({ type: Boolean }) goToKey = false;
  @property({ attribute: false }) onNavigationKey?: () => void;
  @property({ attribute: false }) onGoTo?: () => void;
  @property({ attribute: false }) onTitle?: () => void;

  override render() {
    return html`<div class="column-bar">
      ${this.navigationKey
        ? html`<button type="button" class="bar-key" title="Open navigation panel" aria-label="Open navigation panel" aria-expanded="false" @click=${() => { this.onNavigationKey?.(); }}>${renderGridIcon()}</button>`
        : html`<span class="key-space" aria-hidden="true"></span>`}
      ${this.pageTitle === ""
        ? html`<span class="column-title"></span>`
        : html`<button type="button" class="column-title" title=${this.listOpen ? `Back to ${this.pageTitle}` : "Go to another view"} aria-expanded=${String(this.listOpen)} @click=${() => { this.onTitle?.(); }}>${this.pageTitle}</button>`}
      ${this.goToKey
        ? html`<button type="button" class="bar-key" title="Close the page column" aria-label="Close the page column" aria-expanded="true" @click=${() => { this.onGoTo?.(); }}>${renderMenuIcon()}</button>`
        : html`<span class="key-space" aria-hidden="true"></span>`}
    </div>`;
  }

  static override styles = [interactiveSurfaceStyles, css`
    :host { flex: 0 0 auto; min-width: 0; display: block; -webkit-user-select: none; user-select: none; }
    .column-bar { box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; gap: var(--pi-space-5); padding: 0 var(--pi-bar-inset); border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
    @media not ((pointer: coarse) or (max-width: 760px)) {
      .column-bar { padding-inline: var(--pi-chat-gutter); }
    }
    .column-title { flex: 1 1 auto; min-width: 0; min-height: var(--pi-panel-header-control-height); box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; padding: 0; background: none; color: var(--pi-text-bright, var(--pi-text)); font: var(--pi-weight-strong) var(--pi-text-base) var(--pi-font-ui); line-height: var(--pi-panel-header-control-height); text-align: center; }
    button.column-title { cursor: pointer; }
    button.column-title:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    @media (hover: hover) { button.column-title:hover { color: var(--pi-accent); } }
  `, barKeyStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "app-column-bar": AppColumnBar;
  }
}
