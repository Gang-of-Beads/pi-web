import { css, html, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ExtensionUiStanding } from "../../../shared/apiTypes";
import { interactiveSurfaceStyles } from "./shared";

type Widget = NonNullable<ExtensionUiStanding["widgets"]>[number];

/** Lines a widget shows before "Show all": pi's terminal cap on desktop, fewer on a phone. */
const WIDGET_LINES = { phone: 6, desktop: 10 } as const;

/**
 * An extension's `ctx.ui.setWidget` blocks at one placement, above or below the composer
 * (extension-ui-counterpart.md, "Many writers, little room"). A widget longer than its cap shows
 * its first lines and "Show all"; the area scrolls inside itself, so the transcript never moves for
 * it, and together the two placements take at most a third of the viewport (`share`).
 */
@customElement("extension-widgets")
export class ExtensionWidgets extends LitElement {
  @property({ attribute: false }) widgets: readonly Widget[] = [];
  /** The session the widgets belong to; a widget opened in one session is not open in another. */
  @property({ attribute: false }) sessionKey = "";
  @property({ type: Boolean }) compact = false;
  /** The share of the third of the viewport this placement may take: 1, or 0.5 beside the other placement. */
  @property({ attribute: false }) share = 1;
  @state() private open: ReadonlySet<string> = new Set();

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("sessionKey")) this.open = new Set();
  }

  override render() {
    if (this.widgets.length === 0) return nothing;
    const cap = this.compact ? WIDGET_LINES.phone : WIDGET_LINES.desktop;
    return html`<div class="widgets" style=${`max-height: calc(33dvh * ${String(this.share)})`}>
      ${this.widgets.map((widget) => this.renderWidget(widget, cap))}
    </div>`;
  }

  private renderWidget(widget: Widget, cap: number) {
    const all = this.open.has(widget.key);
    const lines = all ? widget.lines : widget.lines.slice(0, cap);
    return html`<section class="widget">
      <pre>${lines.join("\n")}</pre>
      ${widget.lines.length <= cap ? nothing : html`<button type="button" class="more" aria-expanded=${all ? "true" : "false"} @click=${() => { this.toggle(widget.key); }}>${all ? "Show less" : `Show all (${String(widget.lines.length)} lines)`}</button>`}
    </section>`;
  }

  private toggle(key: string): void {
    const next = new Set(this.open);
    if (!next.delete(key)) next.add(key);
    this.open = next;
  }

  static override styles = [interactiveSurfaceStyles, css`
    :host { display: block; }
    .widgets { overflow: auto; overscroll-behavior: contain; display: grid; gap: var(--pi-space-2); padding: var(--pi-space-2) var(--pi-bar-inset); border-top: 1px solid var(--pi-border); background: var(--pi-bg); }
    .widget { display: grid; justify-items: start; gap: var(--pi-space-1); min-width: 0; }
    pre { margin: 0; max-width: 100%; color: var(--pi-text-secondary); font: var(--pi-text-xs) var(--pi-font-mono); line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
    .more { box-sizing: border-box; min-height: var(--pi-control-height-compact, 24px); padding: 0 var(--pi-space-3); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-text); font: var(--pi-text-xs) var(--pi-font-ui); cursor: pointer; }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "extension-widgets": ExtensionWidgets;
  }
}
