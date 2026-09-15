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
    /* A thin rail on the transcript's right edge (owner's ruling): the top
       bar crossed the whole chat, could not be dragged and read as a broken
       scrollbar. This one only answers "where am I in the session", so it
       lives where a scrollbar would and stays out of the text's way. */
    :host { position: absolute; top: var(--pi-space-4); bottom: var(--pi-space-4); right: calc(2px + var(--pi-chat-scrollbar, 0px)); z-index: 3; display: block; width: 4px; }
    .meter { height: 100%; opacity: .6; transition: opacity var(--pi-motion-fast) var(--pi-ease); }
    :host(:focus-within) .meter { opacity: .95; }
    @media (hover: hover) { :host(:hover) .meter { opacity: .95; } }
    .track { position: relative; height: 100%; border-radius: var(--pi-radius-pill); background: color-mix(in srgb, var(--pi-border-muted) 40%, transparent); }
    .progress { position: absolute; left: 0; right: 0; top: 0; height: var(--position); border-radius: var(--pi-radius-pill); background: color-mix(in srgb, var(--pi-accent) 45%, var(--pi-border-muted)); }
    .marker { position: absolute; left: 50%; top: var(--position); width: var(--pi-dot-xs); height: var(--pi-dot-xs); transform: translate(-50%, -50%); border-radius: 50%; background: var(--pi-accent); box-shadow: 0 0 0 2px var(--pi-bg); }
  `;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
