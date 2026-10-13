import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * The bar of the column that shows pages beside the chat on the wide layout: it names the page,
 * in the chat title's type, so the three bars read as one row. Go to stays on the chat bar's right
 * edge, mirroring the grid key on its left (owner, 2026-10-14: each key opens the column on its
 * side), and the list opens inside this column. One bar per column: the row under the app bar
 * stays gone (96e054e1: two stacked rows looked wrong).
 */
@customElement("app-column-bar")
export class AppColumnBar extends LitElement {
  @property({ type: String }) pageTitle = "";

  override render() {
    return html`<div class="column-bar"><span class="column-title">${this.pageTitle}</span></div>`;
  }

  static override styles = css`
    :host { flex: 0 0 auto; min-width: 0; display: block; -webkit-user-select: none; user-select: none; }
    .column-bar { box-sizing: border-box; min-height: var(--pi-panel-header-height); display: flex; align-items: center; justify-content: center; padding: 0 var(--pi-bar-inset); border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
    .column-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-text-bright, var(--pi-text)); font: var(--pi-weight-strong) var(--pi-text-base) var(--pi-font-ui); line-height: var(--pi-panel-header-control-height); }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "app-column-bar": AppColumnBar;
  }
}
