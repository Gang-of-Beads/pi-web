import { css, LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { scrollWhenSelected } from "./scrollWhenSelected";
import { type CompletionItem } from "./shared";

const autocompleteStyles = css`
  :host { display: block; }
  .menu { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); z-index: var(--pi-layer-raised); max-height: 260px; overflow: auto; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); box-shadow: 0 10px 30px var(--pi-shadow); }
  button { font: var(--pi-text-xs) var(--pi-font-ui); display: grid; grid-template-columns: minmax(120px, 1fr) auto; gap: var(--pi-space-2) var(--pi-space-5); width: 100%; border: 0; border-bottom: 1px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); text-align: left; cursor: pointer; }
  button:last-child { border-bottom: 0; }
  button.selected, button:hover { background: var(--pi-selection-bg); }
  span { color: var(--pi-muted); font-size: var(--pi-text-xs); }
  small { grid-column: 1 / -1; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

@customElement("autocomplete-menu")
export class AutocompleteMenu extends LitElement {
  @property({ attribute: false }) items: CompletionItem[] = [];
  @property({ type: Number }) selectedIndex = 0;
  @property({ attribute: false }) onPick?: (item: CompletionItem) => void;

  override render() {
    if (!this.items.length) return null;
    return html`
      <div class="menu">
        ${this.items.map((item, index) => html`
          <button class=${index === this.selectedIndex ? "selected" : ""} ${scrollWhenSelected(index === this.selectedIndex, item)} @mousedown=${(event: MouseEvent) => { event.preventDefault(); this.onPick?.(item); }}>
            <strong>${item.insertText}</strong>
            <span>${item.detail}</span>
            ${item.description !== undefined && item.description !== "" ? html`<small>${item.description}</small>` : null}
          </button>
        `)}
      </div>
    `;
  }

  static override styles = autocompleteStyles;
}
