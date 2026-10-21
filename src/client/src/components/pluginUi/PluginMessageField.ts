import { css, html, LitElement, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import { renderSendIcon } from "../promptEditorIcons";
import { keyBelongsToInputMethod } from "../keyboardEventTarget";
import type { PluginMessageField } from "../../../../shared/pluginApiTypes";

const IDLE_FIELD: PluginMessageField = { label: "", placeholder: "", send: () => Promise.resolve(false) };

/**
 * One line of text for a plugin, with the composer's send key at its far right. Enter sends unless
 * an input method is composing (Enter then picks the candidate). Nothing is sent while the trimmed
 * text is empty or a send is in flight; the field stays editable meanwhile. The field never says
 * why words were kept: that is the plugin's to say. The draft lives in the element, so it survives
 * re-renders but not the element going away. The field and its key draw 36px on every pointer, the
 * height of the host's buttons beside them; on a coarse pointer both reach 44px without growing the
 * drawn box. The key reaches through its ::after, inset past its 1px border to the touch height.
 * A replaced input cannot carry an ::after, so the input sits in a label whose band reaches 4px
 * above and below it: a tap in the band focuses the input, and the band paints and hit-tests under
 * the input so a tap on the text still places the caret.
 */
export class PluginMessageFieldElement extends LitElement {
  @property({ attribute: false }) field: PluginMessageField = IDLE_FIELD;
  @state() private draft = "";
  @state() private sending = false;

  static override styles = [interactiveSurfaceStyles, css`
    :host { display: flex; min-width: 0; gap: var(--pi-space-3); color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui); }
    label { position: relative; z-index: 0; display: flex; flex: 1 1 auto; min-width: 0; }
    input { box-sizing: border-box; flex: 1 1 auto; min-width: 0; height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: inherit; }
    input:focus-visible { border-color: var(--pi-accent); outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    input:disabled { opacity: var(--pi-disabled-opacity); }
    button { position: relative; box-sizing: border-box; flex: 0 0 auto; display: inline-grid; place-items: center; width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface-raised); color: var(--pi-accent, var(--pi-text)); cursor: pointer; }
    button:disabled { color: var(--pi-muted); opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    button:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .prompt-action-icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    @media (pointer: coarse) {
      label::after { content: ""; position: absolute; inset: calc((var(--pi-control-height-comfort) - var(--pi-control-height-touch)) / 2) 0; z-index: -1; }
      button::after { content: ""; position: absolute; inset: calc((var(--pi-control-height-comfort) - var(--pi-control-height-touch)) / 2 - 1px); }
    }
  `];

  override render() {
    const field = this.field;
    const disabled = field.disabled === true;
    return html`
      <label><input type="text" enterkeyhint="send" autocomplete="off"
        aria-label=${field.label}
        placeholder=${field.placeholder}
        ?disabled=${disabled}
        .value=${this.draft}
        @input=${this.onInput}
        @keydown=${this.onKeyDown}
      ></label>
      <button type="button" aria-label=${field.sendLabel ?? "Send"} title=${field.sendLabel ?? "Send"} ?disabled=${disabled || this.sending || this.draft.trim() === ""} @click=${() => { void this.send(); }}>${renderSendIcon()}</button>
    `;
  }

  private readonly onInput = (event: Event): void => {
    if (event.target instanceof HTMLInputElement) this.draft = event.target.value;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" || keyBelongsToInputMethod(event)) return;
    event.preventDefault();
    void this.send();
  };

  private async send(): Promise<void> {
    const sent = this.draft;
    const text = sent.trim();
    if (text === "" || this.sending || this.field.disabled === true) return;
    this.sending = true;
    const field = this.field;
    const taken = await Promise.resolve().then(() => field.send(text)).catch((error: unknown) => {
      console.error("PI WEB plugin message field send failed; the words stay in the field", error);
      return false;
    });
    this.sending = false;
    if (taken && this.draft === sent) this.draft = "";
  }
}

if (customElements.get("pi-web-plugin-message-field") === undefined) customElements.define("pi-web-plugin-message-field", PluginMessageFieldElement);

export function renderPluginMessageField(field: PluginMessageField): TemplateResult {
  return html`<pi-web-plugin-message-field .field=${field}></pi-web-plugin-message-field>`;
}
