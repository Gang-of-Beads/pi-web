import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { renderCrossIcon, uiIconStyle } from "./uiIcons.js";
import { customElement, property, state } from "lit/decorators.js";
import type { CommandOption } from "../api";
import { keyBelongsToInputMethod, keyboardEventOriginatesFromNativeActivationControl } from "./keyboardEventTarget";
import "./ModalSurface";
import { scrollWhenSelected } from "./scrollWhenSelected";
import { interactiveSurfaceStyles } from "./shared";

@customElement("command-picker")
export class CommandPicker extends LitElement {
  @property() override title = "Select";
  @property({ attribute: false }) options: CommandOption[] = [];
  @property({ attribute: false }) selectedValue?: string;
  @property({ attribute: false }) onPick?: (value: string) => void;
  @property({ attribute: false }) onCancel?: () => void;
  @state() private selectedIndex = 0;

  override render() {
    const options = this.options;
    return html`
      <modal-surface
        .onClose=${() => this.onCancel?.()}
        .initialFocus=${".options"}
        .label=${this.title}
        @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}
      >
        <header>
          <strong>${this.title}</strong>
          <button aria-label="Close" @click=${() => this.onCancel?.()}>${renderCrossIcon()}</button>
        </header>
        <div class="options" tabindex="0">
          ${options.map((option, index) => html`
            <button
              class=${index === this.selectedIndex ? "selected" : ""}
              aria-current=${index === this.selectedIndex ? "true" : nothing}
              ${scrollWhenSelected(index === this.selectedIndex, option.value)}
              @focus=${() => { this.selectedIndex = index; }}
              @click=${() => this.onPick?.(option.value)}
            >
              <span>${option.label}</span>
              ${option.description !== undefined && option.description !== "" ? html`<small>${option.description}</small>` : null}
            </button>
          `)}
          ${options.length === 0 ? html`<div class="empty">No options</div>` : null}
        </div>
      </modal-surface>
    `;
  }

  override firstUpdated() {
    this.selectInitialValue();
  }

  private selectInitialValue(): void {
    if (this.selectedValue === undefined) return;
    const index = this.options.findIndex((option) => option.value === this.selectedValue);
    if (index >= 0) this.selectedIndex = index;
  }

  // Escape and backdrop presses are owned by the modal surface (routed to
  // `onCancel`). List-container keys retain the broadened option navigation
  // idiom, while focused native buttons keep their own semantics.
  private handleKeyDown(event: KeyboardEvent) {
    if (keyBelongsToInputMethod(event) || keyboardEventOriginatesFromNativeActivationControl(event)) return;
    const options = this.options;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (options.length > 0) this.selectedIndex = (this.selectedIndex + 1) % options.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length > 0) this.selectedIndex = (this.selectedIndex - 1 + options.length) % options.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[this.selectedIndex];
      if (option) this.onPick?.(option.value);
    }
  }

  /** Opened from inside a dialog, a picker is a child of it and must paint
   *  above it: the layer tokens rank kinds of surface, so a popover opened
   *  over a dialog dimmed the backdrop and then rendered underneath it. */
  @property({ type: Boolean, reflect: true }) aboveDialog = false;

  static override styles = [css`${unsafeCSS(uiIconStyle)}`, interactiveSurfaceStyles, css`
    :host { position: fixed; inset: 0; z-index: var(--pi-layer-popover); color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui, system-ui, sans-serif); line-height: inherit; }
    :host([abovedialog]) { z-index: calc(var(--pi-layer-dialog) + 1); }
    modal-surface { --modal-surface-width: min(720px, calc(100vw - 40px)); --modal-surface-max-height: min(640px, calc(100vh - 40px)); }
    header { display: flex; align-items: center; justify-content: space-between; padding: var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
    .options { min-height: 0; overflow: auto; outline: none; }
    /* The container takes focus (tabindex=0) for arrow-key navigation, so it
       needs a visible ring of its own when reached by keyboard. */
    .options:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    button { border: 0; background: transparent; color: var(--pi-text); cursor: pointer; }
    header button { font: inherit; display: grid; place-items: center; box-sizing: border-box; width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); padding: 0; font-size: var(--pi-text-xl); line-height: 1; color: var(--pi-muted); }
    .options button { display: block; box-sizing: border-box; width: 100%; font: var(--pi-text-sm)/1.25 var(--pi-font-ui); line-height: inherit; padding: var(--pi-space-5) var(--pi-space-6); border-bottom: 1px solid var(--pi-border-muted); text-align: left; }
    .options button.selected { background: var(--pi-selection-bg); border-color: var(--pi-accent); }
    .options button.selected small { color: var(--pi-text-secondary, var(--pi-text)); }
    @media (hover: hover) { .options button:hover { background: var(--pi-surface-hover); } }
    small { display: block; margin-top: var(--pi-space-2); color: var(--pi-muted); font-size: var(--pi-text-2xs); }
    .empty { padding: var(--pi-space-9); color: var(--pi-muted); text-align: center; }
    /* Coarse pointers get the comfort floor across the picker chrome: the
       close control and every option row are touch targets
       on a phone. Declared after every base rule it raises. */
    @media (pointer: coarse) {
      header button { width: var(--pi-control-height-touch, 44px); height: var(--pi-control-height-touch, 44px); }
      .options button { min-height: var(--pi-control-height-touch, 44px); }
    }
  `];
}
