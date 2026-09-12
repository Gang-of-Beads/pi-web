import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("conversation-meter")
export class ConversationMeter extends LitElement {
  @property({ type: Number }) positionPercent = 0;
  @property({ type: Number }) loadedPercent = 100;

  override render() {
    const position = clampPercent(this.positionPercent);
    const loaded = clampPercent(this.loadedPercent);
    const label = `Message position: about ${String(Math.round(position))}% through conversation. ${String(Math.round(loaded))}% of messages loaded.`;
    return html`
      <div
        class="meter"
        style=${`--position:${position.toFixed(2)}%;`}
        role="meter"
        aria-label=${label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${String(Math.round(position))}
        title=${label}
      >
        <div class="track" aria-hidden="true">
          <div class="progress"></div>
          <div class="marker"></div>
        </div>
      </div>
    `;
  }

  static override styles = css`
    /* The meter floats over the transcript's first visible line; at a bare
       58% opacity the scrolled text bled through and read as clipped stray
       lines (the owner's fifth-banner screenshot). The host now carries an
       opaque chat-background band, and only the indicator itself is
       translucent. */
    :host { position: absolute; top: calc(-1 * var(--pi-space-2)); left: var(--pi-chat-gutter, var(--pi-space-7)); right: var(--pi-chat-gutter, var(--pi-space-7)); z-index: 3; display: block; height: 14px; background: var(--pi-bg); border-radius: var(--pi-radius-pill); }
    .meter { height: 100%; opacity: .58; transition: opacity var(--pi-motion-fast) var(--pi-ease); }
    :host(:focus-within) .meter { opacity: .92; }
    @media (hover: hover) { :host(:hover) .meter { opacity: .92; } }
    .meter { height: 100%; }
    .track { position: relative; height: var(--pi-dot-xs); margin-top: var(--pi-space-2); border-radius: var(--pi-radius-pill); background: color-mix(in srgb, var(--pi-border-muted) 34%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--pi-bg) 55%, transparent); }
    .progress { position: absolute; left: 0; width: var(--position); top: 0; bottom: 0; border-radius: var(--pi-radius-pill); background: color-mix(in srgb, var(--pi-accent) 42%, var(--pi-border-muted)); }
    .marker { position: absolute; left: var(--position); top: 50%; width: var(--pi-dot-md); height: var(--pi-dot-md);  border-radius: 50%; background: var(--pi-accent); box-shadow: 0 0 0 2px var(--pi-bg), var(--pi-elevation-1); transform: translate(-50%, -50%); }
  `;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
