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
    :host { position: absolute; top: -4px; left: 16px; right: 16px; z-index: 6; display: block; height: 12px; opacity: .58; transition: opacity .15s ease; }
    :host(:focus-within) { opacity: .92; }
    @media (hover: hover) { :host(:hover) { opacity: .92; } }
    .meter { height: 100%; }
    .track { position: relative; height: 4px; margin-top: 4px; border-radius: 999px; background: color-mix(in srgb, var(--pi-border-muted) 34%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--pi-bg) 55%, transparent); }
    .progress { position: absolute; left: 0; width: var(--position); top: 0; bottom: 0; border-radius: 999px; background: color-mix(in srgb, var(--pi-accent) 42%, var(--pi-border-muted)); }
    .marker { position: absolute; left: var(--position); top: 50%; width: 10px; height: 10px; border: 2px solid var(--pi-bg); border-radius: 50%; background: var(--pi-accent); box-shadow: 0 2px 8px var(--pi-shadow); transform: translate(-50%, -50%); }
  `;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
