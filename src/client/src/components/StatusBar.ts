import { css, LitElement, html, unsafeCSS } from "lit";
import { renderDownIcon, renderUpIcon, uiIconStyle } from "./uiIcons.js";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionStatus } from "../api";
import { sessionStatusLine } from "../sessionStatusLine.js";
import { formatCost, formatTokenCount } from "../utils/format";

const statusBarStyles = css`${unsafeCSS(uiIconStyle)}
  :host { display: block; color: var(--pi-muted); font: var(--pi-text-xs) var(--pi-font-mono); line-height: 1.3; }
  :host, :host * { -webkit-user-select: none; user-select: none; }
  .bar { box-sizing: border-box; display: flex; justify-content: flex-end; gap: var(--pi-space-6); align-items: center; line-height: 1.3; min-width: 0; min-height: calc(var(--pi-panel-header-height) * 4 / 9); padding: 0 var(--pi-bar-inset); border-top: 1px solid var(--pi-border); background: var(--pi-bg); white-space: nowrap; overflow: hidden; }
  span { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .muted { color: var(--pi-muted); }
  /* Extension statuses have a line of their own above the session's numbers, as pi's footer gives
     them one (the numbers alone fill a phone's line): each is cut at STATUS_CHARS, the line ends in
     an ellipsis, and a tap opens every status in full, one per line. */
  .extension-statuses { -webkit-tap-highlight-color: transparent; touch-action: manipulation; box-sizing: border-box; display: block; width: 100%; min-height: var(--pi-control-height-compact, 24px); padding: 0 var(--pi-bar-inset); border: 0; border-top: 1px solid var(--pi-border); background: var(--pi-bg); color: inherit; font: inherit; text-align: start; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
  .extension-statuses.open { padding-block: var(--pi-space-2); white-space: normal; overflow-wrap: anywhere; }
  .status-line { display: block; }
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
  @state() private statusesOpen = false;

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
    const statuses = status.extensionUi?.statuses ?? [];
    return html`
      ${statuses.length === 0 ? null : html`<button type="button" class=${this.statusesOpen ? "extension-statuses open" : "extension-statuses"} aria-expanded=${this.statusesOpen ? "true" : "false"} title=${statuses.map((entry) => entry.text).join(" ")} @click=${() => { this.statusesOpen = !this.statusesOpen; }}>${this.statusesOpen
        ? statuses.map((entry) => html`<span class="status-line">${entry.text}</span>`)
        : statuses.map((entry) => clipStatus(entry.text)).join("  ")}</button>`}
      <div class="bar">
        <span>${renderUpIcon()} ${formatTokenCount(tokens.input)} tok</span>
        <span>${renderDownIcon()} ${formatTokenCount(tokens.output)} tok</span>
        <span class="context">${contextText}</span>
        <span>${formatCost(status.cost)}</span>
      </div>
    `;
  }

  static override styles = statusBarStyles;
}

/** An extension status on the footer line: at most STATUS_CHARS characters (extension-ui-counterpart.md). */
const STATUS_CHARS = 40;

function clipStatus(text: string): string {
  return text.length <= STATUS_CHARS ? text : `${text.slice(0, STATUS_CHARS - 1)}…`;
}
