import { css, html, LitElement, nothing } from "lit";
import { property } from "lit/decorators.js";
import { adoptTerminalHostStyles } from "./hostUi.js";
import { extraKeySequence, NO_MODIFIERS, TERMINAL_EXTRA_KEY_ROWS, type TerminalExtraKey, type TerminalModifier, type TerminalModifiers } from "./terminalExtraKeys.js";
import type { TerminalModesSnapshot } from "./terminalKeys.js";

/** Android's long-press timeout and Termux's extra-keys repeat interval. */
const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 80;
const SYNTHETIC_CLICK_SUPPRESSION_MS = 500;

export interface TerminalSoftKeyInputOptions {
  refocus: boolean;
}

interface HeldKey {
  readonly pointerId: number;
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
}

/**
 * The two fixed rows of extra keys docked at the bottom of the terminal, which
 * the app shell keeps right above the phone's keyboard.
 *
 * A key acts on pointerdown and the default is prevented, so the terminal's
 * hidden textarea keeps focus and the keyboard stays open under the row.
 * Arrows and page keys repeat while held. CTRL and ALT only arm; the panel
 * owns the armed state because the next key may come from the phone's
 * keyboard, which this row never sees.
 */
export class TerminalSoftKeys extends LitElement {
  @property({ attribute: false }) modes: TerminalModesSnapshot | undefined;
  @property({ attribute: false }) modifiers: TerminalModifiers = NO_MODIFIERS;
  @property({ type: Boolean }) refocusOnClick = true;
  @property({ attribute: false }) onInput: (data: string, options: TerminalSoftKeyInputOptions) => void = () => undefined;
  @property({ attribute: false }) onModifier: (which: TerminalModifier) => void = () => undefined;

  private held: HeldKey | undefined;
  private lastPointerAt = Number.NEGATIVE_INFINITY;

  override disconnectedCallback(): void {
    this.release();
    super.disconnectedCallback();
  }

  private press(key: TerminalExtraKey, options: TerminalSoftKeyInputOptions): string | undefined {
    if (key.kind === "modifier") {
      this.onModifier(key.id);
      return undefined;
    }
    const data = extraKeySequence(key.id, this.modifiers, this.modes);
    this.onInput(data, options);
    return key.repeats ? data : undefined;
  }

  private onPointerDown(event: PointerEvent, key: TerminalExtraKey): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    this.release();
    this.lastPointerAt = Date.now();
    const repeated = this.press(key, { refocus: event.pointerType === "mouse" });
    if (repeated !== undefined) this.holdFor(event.pointerId, repeated, REPEAT_DELAY_MS);
  }

  private holdFor(pointerId: number, data: string, delay: number): void {
    this.held = {
      pointerId,
      timer: globalThis.setTimeout(() => {
        this.onInput(data, { refocus: false });
        this.holdFor(pointerId, data, REPEAT_INTERVAL_MS);
      }, delay),
    };
  }

  private onPointerEnd(event: PointerEvent): void {
    if (this.held?.pointerId === event.pointerId) this.release();
    this.lastPointerAt = Date.now();
  }

  private release(): void {
    if (this.held !== undefined) globalThis.clearTimeout(this.held.timer);
    this.held = undefined;
  }

  private onClick(event: MouseEvent, key: TerminalExtraKey): void {
    if (Date.now() - this.lastPointerAt < SYNTHETIC_CLICK_SUPPRESSION_MS) {
      event.preventDefault();
      return;
    }
    this.press(key, { refocus: this.refocusOnClick });
  }

  private renderKey(key: TerminalExtraKey) {
    const armed = key.kind === "modifier" ? this.modifiers[key.id] : undefined;
    return html`
      <button
        type="button"
        class=${armed === true ? "modifier armed" : key.kind}
        aria-label=${key.ariaLabel}
        aria-pressed=${armed === undefined ? nothing : String(armed)}
        @pointerdown=${(event: PointerEvent) => { this.onPointerDown(event, key); }}
        @pointerup=${(event: PointerEvent) => { this.onPointerEnd(event); }}
        @pointercancel=${(event: PointerEvent) => { this.onPointerEnd(event); }}
        @pointerleave=${(event: PointerEvent) => { this.onPointerEnd(event); }}
        @click=${(event: MouseEvent) => { this.onClick(event, key); }}
      >${key.label}</button>
    `;
  }

  override render() {
    return html`
      <div class="extra-keys" role="toolbar" aria-label="Terminal keys">
        ${TERMINAL_EXTRA_KEY_ROWS.flat().map((key) => this.renderKey(key))}
      </div>
    `;
  }

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) adoptTerminalHostStyles(root);
    return root;
  }

  static override styles = [css`
    :host { flex: 0 0 auto; display: block; }
    .extra-keys { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid var(--pi-border-muted); background: var(--pi-bg); touch-action: none; }
    .extra-keys button { box-sizing: border-box; display: grid; place-items: center; min-width: 0; height: var(--pi-control-height-touch); margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--pi-text); font: var(--pi-text-xs) var(--pi-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); line-height: 1; white-space: nowrap; cursor: pointer; touch-action: none; -webkit-touch-callout: none; user-select: none; }
    .extra-keys button.modifier { color: var(--pi-muted); }
    .extra-keys button.armed { background: var(--pi-accent); color: var(--pi-on-accent); }
    .extra-keys button:active { background: var(--pi-surface); }
    .extra-keys button.armed:active { background: var(--pi-accent); }
    .extra-keys button:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
  `];
}

if (customElements.get("terminal-soft-keys") === undefined) customElements.define("terminal-soft-keys", TerminalSoftKeys);
