import { css, LitElement, html, unsafeCSS } from "lit";
import { renderDownIcon, renderUpIcon, uiIconStyle } from "./uiIcons.js";
import { customElement, property } from "lit/decorators.js";
import type { SessionStatus } from "../api";
import { sessionStatusLine } from "../sessionStatusLine.js";
import { formatCost, formatTokenCount } from "../utils/format";

const statusBarStyles = css`${unsafeCSS(uiIconStyle)}
  :host { display: block; color: var(--pi-muted); font: var(--pi-text-xs) var(--pi-font-mono); line-height: 1.3; }
  :host, :host * { -webkit-user-select: none; user-select: none; }
  .bar { box-sizing: border-box; display: flex; justify-content: flex-end; gap: var(--pi-space-6); align-items: center; line-height: 1.3; min-width: 0; min-height: calc(var(--pi-panel-header-height) * 4 / 9); padding: 0 var(--pi-bar-inset); border-top: 1px solid var(--pi-border); background: var(--pi-bg); white-space: nowrap; overflow: hidden; }
  span { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .muted { color: var(--pi-muted); }
  /* The numbers line, as the owner laid it out (2026-10-07): tokens in and out and the context on
     the left, the extensions' statuses after them in whatever room is left, the cost at the right
     edge. The numbers keep their room first; statuses are cut with an ellipsis, and when fewer than
     six characters would show they are left out, as pi's terminal leaves out what does not fit. */
  .bar.numbers { justify-content: flex-start; }
  .statuses { flex: 1 1 0; container-type: inline-size; margin-inline-start: calc(-1 * var(--pi-space-6)); }
  .statuses-text { display: block; padding-inline-start: var(--pi-space-6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @container (width < calc(6ch + var(--pi-space-6))) { .statuses-text { visibility: hidden; } }
  .cost { flex: 0 0 auto; }
  /* The bar draws a control now, so it owes the touch contract every other
     control-bearing component signs. */
  .status-retry { -webkit-tap-highlight-color: transparent; touch-action: manipulation; box-sizing: border-box; flex: 0 0 auto; min-height: var(--pi-control-height-compact, 24px); padding: 0 var(--pi-space-3); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-text); font: inherit; cursor: pointer; }
`;

@customElement("status-bar")
export class StatusBar extends LitElement {
  @property({ attribute: false }) status?: SessionStatus;
  /** Why the last read produced nothing, when it failed rather than not happening. */
  @property({ attribute: false }) failure?: string;
  @property({ attribute: false }) onRetry?: () => void;
  override render() {
    const status = this.status;
    const line = sessionStatusLine({ hasStatus: status !== undefined, failure: this.failure });
    if (line.kind === "unread") return html`<div class="bar muted">${line.text}</div>`;
    if (line.kind === "unavailable") {
      return html`<div class="bar muted">
        <span title=${this.failure ?? ""}>${line.text}</span>
        ${this.onRetry === undefined ? null : html`<button type="button" class="status-retry" @click=${() => { this.onRetry?.(); }}>Retry</button>`}
      </div>`;
    }
    if (status === undefined) return html`<div class="bar muted">${"No session status yet"}</div>`;
    const context = status.contextUsage;
    const contextText = context
      ? context.percent == null
        ? `ctx ${formatTokenCount(context.contextWindow)} window`
        : `ctx ${context.percent.toFixed(1)}% of ${formatTokenCount(context.contextWindow)}`
      : "ctx unknown";
    const tokens = status.tokens;
    const statuses = (status.extensionUi?.statuses ?? []).map((entry) => entry.text).join(" ");
    return html`
      <div class="bar numbers">
        <span>${renderUpIcon()} ${formatTokenCount(tokens.input)} tok</span>
        <span>${renderDownIcon()} ${formatTokenCount(tokens.output)} tok</span>
        <span class="context">${contextText}</span>
        <span class="statuses" title=${statuses}><span class="statuses-text">${statuses}</span></span>
        <span class="cost">${formatCost(status.cost)}</span>
      </div>
    `;
  }

  static override styles = statusBarStyles;
}
