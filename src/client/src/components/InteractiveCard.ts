import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";
import { acceptsOptionChange } from "../cardStepGuard";
import { interactiveCardNeedsRender, type OpenCard } from "../cardIdentity";
import {
  CARD_TYPED_TEXT_MAX_LENGTH,
  type CardAnswerableField,
  type CardChoiceField,
  type CardConfirmField,
  type CardInputField,
  type CardSubmission,
  type CardTextField,
  type CardValue,
  type InteractiveCard as InteractiveCardDeclaration,
} from "../../../shared/interactiveCard";
import {
  answerableFields,
  filledCount,
  filledValue,
  loadCardDraft,
  saveCardDraft,
  toCardSubmission,
  unfilledFields,
  type CardDraft,
} from "../cardDrafts";

export type InteractiveCardSubmitCallback = (submission: CardSubmission) => void | Promise<void>;

/**
 * One step of the card: the answerable field on screen, with the read-only text that leads up to
 * it. A card's trailing text, or a card of text alone, is a last step with no field.
 */
interface CardStep {
  readonly texts: readonly CardTextField[];
  readonly field?: CardAnswerableField;
}

function cardSteps(card: InteractiveCardDeclaration): CardStep[] {
  const steps: CardStep[] = [];
  let texts: CardTextField[] = [];
  for (const field of card.fields) {
    if (field.type === "text") {
      texts.push(field);
      continue;
    }
    steps.push({ texts, field });
    texts = [];
  }
  if (texts.length > 0 || steps.length === 0) steps.push({ texts });
  return steps;
}

/**
 * Resize a textarea to its content.
 *
 * A fallback for browsers without CSS `field-sizing`: the three-line box made
 * every longer answer a peephole. The height is read back from `scrollHeight`
 * after clearing the inline height, and the CSS `max-height` still bounds it.
 */
function growToFit(input: HTMLTextAreaElement): void {
  if (typeof CSS !== "undefined" && CSS.supports("field-sizing", "content")) return;
  input.style.height = "auto";
  input.style.height = `${String(input.scrollHeight)}px`;
}

/**
 * An interactive card an extension declared (docs/design/interactive-card.md). It owns only
 * browser-local draft state; the daemon remains the source of truth for whether the card is open.
 */
@customElement("interactive-card")
export class InteractiveCard extends LitElement {
  @property({ attribute: false }) open?: OpenCard;

  /**
   * A streaming turn re-delivers the same open card many times a second as a fresh object;
   * rebuilding the form for each one shook the card under the reader. Only a change to the card
   * itself is a reason to render.
   */
  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    if (changed.size !== 1 || !changed.has("open")) return true;
    return interactiveCardNeedsRender(changed.get("open"), this.open);
  }
  /** Machine-scoped session cache key used by the draft store. */
  @property({ attribute: false }) draftSessionId = "";
  @property({ attribute: false }) onSubmit?: InteractiveCardSubmitCallback;
  /** The card's heading when the card declares no title. */
  @property({ attribute: false }) heading = "Extension";
  /** Close without answering: the extension's `custom()` resolves with nothing. Absent, the card offers no Cancel. */
  @property({ attribute: false }) onCancel?: () => void | Promise<void>;

  @state() private draft: CardDraft = {};
  /**
   * Which step is on screen. A card that laid every field out at once put the field being typed
   * into below a phone's keyboard: the answer could not be read without dismissing the keyboard,
   * scrolling, and opening it again. One field per step keeps each step above the keyboard.
   */
  @state() private step = 0;
  @state() private confirmingPartialSubmit = false;
  @state() private submitting = false;
  private modelIdentity: string | undefined;
  /** When the step last moved; see `cardStepGuard`. */
  private stepChangedAt: number | undefined;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("open") && !changed.has("draftSessionId")) return;
    const identity = this.open === undefined ? undefined : `open:${this.draftSessionId}:${this.open.dialogId}`;
    if (identity === this.modelIdentity) return;
    this.modelIdentity = identity;
    this.draft = this.open === undefined || this.draftSessionId === "" ? {} : loadCardDraft(this.draftSessionId, this.open.dialogId);
    this.step = 0;
    this.confirmingPartialSubmit = false;
    this.submitting = false;
  }

  override render(): TemplateResult | null {
    return this.open === undefined ? null : this.renderCard(this.open.card);
  }

  private renderCard(card: InteractiveCardDeclaration): TemplateResult {
    const steps = cardSteps(card);
    const index = this.stepIndex(steps);
    const step = steps[index];
    const answerable = answerableFields(card.fields);
    const unfilled = unfilledFields(card.fields, this.draft);
    return html`
      <article class="card open-card" aria-labelledby="interactive-card-heading">
        <header class="card-header">
          <h2 id="interactive-card-heading">${card.title ?? this.heading}</h2>
          ${answerable.length === 0 ? nothing : html`<span class="header-status" role="status" aria-live="polite" aria-atomic="true">
            ${steps.length > 1
              ? html`${index + 1} of ${steps.length} · ${filledCount(card.fields, this.draft)} answered`
              : html`${filledCount(card.fields, this.draft)} of ${answerable.length} answered`}
          </span>`}
        </header>
        <form class="card-form" @submit=${(event: SubmitEvent) => { this.handleSubmit(event, card); }}>
          <div class="fields">
            ${step === undefined ? nothing : this.renderStep(step, index)}
          </div>
          <footer class="form-footer">
            ${this.confirmingPartialSubmit && unfilled.length > 0
              ? this.renderPartialSubmitConfirmation(card, unfilled)
              : this.renderStepActions(card, steps, index)}
          </footer>
        </form>
      </article>
    `;
  }

  private renderStep(step: CardStep, index: number): TemplateResult {
    return html`
      ${step.texts.map((text) => html`<p class="card-text">${text.text}</p>`)}
      ${step.field === undefined ? nothing : this.renderField(step.field, index)}
    `;
  }

  private renderField(field: CardAnswerableField, index: number): TemplateResult {
    const filled = filledValue(field, this.draft[field.id]) !== undefined;
    const detailId = field.detail === undefined ? undefined : `card-field-detail-${String(index)}`;
    return html`
      <fieldset id=${this.fieldsetId(index)} class=${`field${filled ? " answered" : ""}`} aria-describedby=${ifDefined(detailId)} tabindex="-1">
        <legend>
          <span class="field-mark">${String(index + 1)}.</span>
          <span>${field.label}${field.required === true ? html`<span class="required" aria-label="required"> *</span>` : nothing}</span>
        </legend>
        ${field.detail === undefined ? nothing : html`<p class="field-detail" id=${ifDefined(detailId)}>${field.detail}</p>`}
        ${this.fieldControls(field, index)}
      </fieldset>
    `;
  }

  private fieldControls(field: CardAnswerableField, index: number): TemplateResult {
    if (field.type === "choice") return this.renderChoice(field, index);
    if (field.type === "input") return this.renderInput(field, index);
    return this.renderConfirm(field);
  }

  private renderChoice(field: CardChoiceField, index: number): TemplateResult {
    const entry = this.choiceEntry(field);
    const inputType = field.multiple === true ? "checkbox" : "radio";
    const otherOpen = field.other === "field" || (field.other === "choice" && this.otherChosen(field, entry));
    return html`
      <div class="options">
        ${field.options.map((option) => html`
          <label class="option">
            <input type=${inputType} name=${this.groupName(field)} value=${option.value} .checked=${live(entry.selected.includes(option.value))} @change=${(event: Event) => { this.changeOption(field, option.value, event); }} />
            <span class="option-copy">
              <span class="option-label">${option.label}</span>
              ${option.detail === undefined ? nothing : html`<span class="option-detail">${option.detail}</span>`}
            </span>
          </label>
        `)}
        ${field.other === "choice" ? html`
          <label class="option other-option">
            <input type=${inputType} name=${this.groupName(field)} value="__pi_web_other__" .checked=${live(otherOpen)} @change=${(event: Event) => { this.changeOther(field, index, event); }} />
            <span class="option-copy"><span class="option-label">Custom</span></span>
          </label>
        ` : nothing}
        ${otherOpen ? html`
          <label class="other-answer" for=${this.typedId(index)}>
            <span>Custom answer</span>
            <textarea id=${this.typedId(index)} rows="2" maxlength=${String(CARD_TYPED_TEXT_MAX_LENGTH)} .value=${live(entry.other ?? "")} @input=${(event: Event) => { this.changeOtherText(field, event); }}></textarea>
          </label>
        ` : nothing}
      </div>
    `;
  }

  private renderInput(field: CardInputField, index: number): TemplateResult {
    const entry = this.draft[field.id];
    const text = entry !== undefined && "text" in entry ? entry.text : "";
    return field.multiline === true
      ? html`<textarea class="typed" id=${this.typedId(index)} aria-label=${field.label} rows="3" maxlength=${String(CARD_TYPED_TEXT_MAX_LENGTH)} placeholder=${ifDefined(field.placeholder)} .value=${live(text)} @input=${(event: Event) => { this.changeText(field, event); }}></textarea>`
      : html`<input class="typed" type="text" id=${this.typedId(index)} aria-label=${field.label} maxlength=${String(CARD_TYPED_TEXT_MAX_LENGTH)} placeholder=${ifDefined(field.placeholder)} .value=${live(text)} @input=${(event: Event) => { this.changeText(field, event); }} />`;
  }

  private renderConfirm(field: CardConfirmField): TemplateResult {
    const entry = this.draft[field.id];
    const confirmed = entry !== undefined && "confirmed" in entry ? entry.confirmed : undefined;
    const choice = (value: boolean, label: string) => html`
      <label class="option">
        <input type="radio" name=${this.groupName(field)} .checked=${live(confirmed === value)} @change=${() => { if (this.acceptsChange()) this.setValue(field, { confirmed: value }); }} />
        <span class="option-copy"><span class="option-label">${label}</span></span>
      </label>
    `;
    return html`<div class="options">${choice(true, field.confirm ?? "Yes")}${choice(false, field.decline ?? "No")}</div>`;
  }

  private stepIndex(steps: readonly CardStep[]): number {
    return Math.min(Math.max(this.step, 0), Math.max(steps.length - 1, 0));
  }

  /** A required field on screen that is not filled holds the card on its step. */
  private stepBlocked(step: CardStep | undefined): boolean {
    const field = step?.field;
    return field?.required === true && filledValue(field, this.draft[field.id]) === undefined;
  }

  /** Back and Next only exist when there is somewhere to go; the last step sends. */
  private renderStepActions(card: InteractiveCardDeclaration, steps: readonly CardStep[], index: number): TemplateResult {
    const isLast = index >= steps.length - 1;
    const blocked = this.stepBlocked(steps[index]);
    return html`
      <div class="step-actions">
        ${this.onCancel === undefined ? nothing : html`<button class="secondary-action" type="button" ?disabled=${this.submitting} @click=${() => { void this.onCancel?.(); }}>Cancel</button>`}
        ${index > 0 ? html`<button class="secondary-action" type="button" @click=${() => { this.goToStep(steps, index - 1); }}>Back</button>` : nothing}
        ${isLast
          ? html`<button class="primary-action" type="submit" ?disabled=${this.submitting || blocked}>${this.submitting ? "Sending…" : card.submit ?? "Send"}</button>`
          : html`<button class="primary-action" type="button" ?disabled=${blocked} @click=${() => { this.goToStep(steps, index + 1); }}>Next</button>`}
      </div>
    `;
  }

  private goToStep(steps: readonly CardStep[], next: number): void {
    this.stepChangedAt = Date.now();
    this.step = Math.min(Math.max(next, 0), Math.max(steps.length - 1, 0));
    this.focusStep(this.step);
  }

  private renderPartialSubmitConfirmation(card: InteractiveCardDeclaration, unfilled: readonly CardAnswerableField[]): TemplateResult {
    const steps = cardSteps(card);
    return html`
      <div class="partial-confirmation" role="group" aria-label="Confirm partial answers">
        <p>
          <strong>Send without answering:</strong>
          ${unfilled.map((field, index) => html`${index === 0 ? " " : ", "}<button class="field-jump" type="button" @click=${() => { this.goToStep(steps, steps.findIndex((step) => step.field === field)); }}>${field.label}</button>`)}?
        </p>
        <div class="confirmation-actions">
          <button class="secondary-action" type="button" @click=${() => { this.keepEditing(steps, unfilled); }}>Keep editing</button>
          <button class="primary-action send-anyway" type="button" ?disabled=${this.submitting} @click=${() => { this.submitCard(card); }}>${this.submitting ? "Sending…" : "Send anyway"}</button>
        </div>
      </div>
    `;
  }

  private choiceEntry(field: CardChoiceField): { selected: string[]; other?: string } {
    const entry = this.draft[field.id];
    return entry !== undefined && "selected" in entry ? entry : { selected: [] };
  }

  private otherChosen(field: CardChoiceField, entry: { selected: string[]; other?: string }): boolean {
    if (entry.other === undefined) return false;
    return field.multiple === true || entry.selected.length === 0;
  }

  private acceptsChange(): boolean {
    return acceptsOptionChange({ now: Date.now(), stepChangedAt: this.stepChangedAt });
  }

  private changeOption(field: CardChoiceField, value: string, event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    if (!this.acceptsChange()) { input.checked = false; return; }
    const current = this.choiceEntry(field);
    if (field.multiple !== true) {
      if (input.checked) this.setValue(field, { selected: [value] });
      return;
    }
    const selected = input.checked ? [...new Set([...current.selected, value])] : current.selected.filter((picked) => picked !== value);
    this.setValue(field, { selected, ...(current.other === undefined ? {} : { other: current.other }) });
  }

  private changeOther(field: CardChoiceField, index: number, event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    if (!this.acceptsChange()) { input.checked = false; return; }
    const current = this.choiceEntry(field);
    if (field.multiple === true) this.setValue(field, { selected: [...current.selected], ...(input.checked ? { other: current.other ?? "" } : {}) });
    else if (input.checked) this.setValue(field, { selected: [], other: this.otherChosen(field, current) ? current.other ?? "" : "" });
    if (input.checked) void this.focusTyped(index);
  }

  private changeOtherText(field: CardChoiceField, event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLTextAreaElement)) return;
    growToFit(input);
    const current = this.choiceEntry(field);
    const keepsPicks = field.multiple === true;
    this.setValue(field, { selected: keepsPicks ? [...current.selected] : [], other: input.value.slice(0, CARD_TYPED_TEXT_MAX_LENGTH) });
  }

  private changeText(field: CardInputField, event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) return;
    if (input instanceof HTMLTextAreaElement) growToFit(input);
    this.setValue(field, { text: input.value.slice(0, CARD_TYPED_TEXT_MAX_LENGTH) });
  }

  private setValue(field: CardAnswerableField, value: CardValue): void {
    const next: CardDraft = filledValue(field, value) === undefined && !("other" in value)
      ? Object.fromEntries(Object.entries(this.draft).filter(([id]) => id !== field.id))
      : { ...this.draft, [field.id]: value };
    this.draft = next;
    this.confirmingPartialSubmit = false;
    if (this.open !== undefined && this.draftSessionId !== "") saveCardDraft(this.draftSessionId, this.open.dialogId, next);
  }

  private handleSubmit(event: SubmitEvent, card: InteractiveCardDeclaration): void {
    event.preventDefault();
    if (this.submitting) return;
    const unfilled = unfilledFields(card.fields, this.draft);
    const required = unfilled.find((field) => field.required === true);
    if (required !== undefined) {
      const steps = cardSteps(card);
      this.goToStep(steps, steps.findIndex((step) => step.field === required));
      return;
    }
    if (unfilled.length > 0) {
      void this.showPartialSubmitConfirmation();
      return;
    }
    this.submitCard(card);
  }

  private submitCard(card: InteractiveCardDeclaration): void {
    if (this.submitting || this.open === undefined) return;
    const callback = this.onSubmit;
    if (callback === undefined) return;
    this.submitting = true;
    const dialogId = this.open.dialogId;
    void Promise.resolve()
      .then(() => callback(toCardSubmission(card.fields, this.draft)))
      .catch(() => undefined)
      .finally(() => {
        if (this.open?.dialogId === dialogId) this.submitting = false;
      });
  }

  private async showPartialSubmitConfirmation(): Promise<void> {
    this.confirmingPartialSubmit = true;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(".send-anyway")?.focus();
  }

  private keepEditing(steps: readonly CardStep[], unfilled: readonly CardAnswerableField[]): void {
    this.confirmingPartialSubmit = false;
    const first = unfilled[0];
    if (first !== undefined) this.goToStep(steps, steps.findIndex((step) => step.field === first));
  }

  private focusStep(index: number): void {
    if (index < 0) return;
    void this.updateComplete.then(() => {
      const fieldset = this.renderRoot.querySelector<HTMLElement>(`#${this.fieldsetId(index)}`);
      const firstControl = fieldset?.querySelector<HTMLElement>("input, textarea");
      (firstControl ?? fieldset)?.focus();
    });
  }

  private async focusTyped(index: number): Promise<void> {
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>(`#${this.typedId(index)}`)?.focus();
  }

  private groupName(field: CardAnswerableField): string {
    return `card:${this.open?.dialogId ?? ""}:${field.id}`;
  }

  private fieldsetId(index: number): string {
    return `card-field-${String(index)}`;
  }

  private typedId(index: number): string {
    return `card-typed-${String(index)}`;
  }

  static override styles = css`
    /* This card is its own shadow root, so the transcript's tap rules do not
       reach it: without these, the option buttons stay eligible for the
       browser's double-tap-zoom click delay and paint the platform's rectangular
       tap highlight. The option label is the real hit target - the input is
       only its dot - so it belongs in this list too. */
    button, [role="button"], input, select, summary, .option { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    :host {
      display: block;
      box-sizing: border-box;
      width: 100%;
      margin: 0 0 var(--pi-space-7);
      color: var(--pi-text);
      font: var(--pi-text-base) var(--pi-font-ui, system-ui, sans-serif); line-height: inherit;
      container-type: inline-size;
    }
    /* One corner owner: the card clips, children paint square (the .msg
       contract; a child replicating the curve is what broke the corners). */
    .card {
      border: 1px solid var(--pi-border);
      border-radius: var(--pi-radius-lg);
      overflow: hidden;
      overflow: clip;
      background: var(--pi-surface-raised);
      box-shadow: var(--pi-elevation-3);
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .card-header {
      position: sticky;
      top: var(--pi-chat-sticky-top, 0px);
      z-index: 6;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--pi-space-6);
      min-height: 22px;
      padding: var(--pi-space-4) var(--pi-space-7) var(--pi-space-3);
      border-bottom: 1px solid var(--pi-border-muted);
      background: var(--pi-surface-raised);
      box-shadow: var(--pi-elevation-2);
    }
    h2, h3, p { margin-top: 0; }
    h2 {
      margin-bottom: 0;
      color: var(--pi-accent);
      font: var(--pi-text-xs) var(--pi-font-mono); line-height: inherit;
      line-height: 1.3;
    }
    .header-status { flex: 0 1 auto; color: var(--pi-muted); font-size: var(--pi-text-2xs); text-align: end; }
    /* The hue rides a mark; the word stays body text. Success, warning and
       accent all measure under 4.5:1 on the raised card at 11px, and the
       palette is the owner's to change. */
    .header-status { color: var(--pi-text); display: inline-flex; align-items: center; gap: var(--pi-space-3); }
    .header-status::before { content: ""; width: var(--pi-dot-sm); height: var(--pi-dot-sm); border-radius: 50%; background: currentColor; }
    .fields {
      display: grid;
      padding-top: var(--pi-space-4);
      align-content: start;
    }
    fieldset.field {
      min-width: 0;
      margin: 0;
      border: 0;
      border-top: 1px solid var(--pi-border-muted);
      padding: var(--pi-space-7);
      background: transparent;
    }
    fieldset.field:first-child { border-top: 0; }
    fieldset.field:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    legend {
      box-sizing: border-box;
      width: 100%;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: start;
      gap: var(--pi-space-3);
      color: var(--pi-text);
      padding: 0;
      font-weight: var(--pi-weight-strong);
      line-height: 1.35;
    }
    .field-mark { color: var(--pi-muted); }
    fieldset.field.answered .field-mark { color: var(--pi-success); }
    .field-detail {
      margin: var(--pi-space-2) 0 var(--pi-space-5);
      color: var(--pi-muted);
      font-size: var(--pi-text-xs);
      line-height: 1.4;
    }
    .options { display: grid; gap: var(--pi-space-4); }
    .card-text { margin: 0; padding: var(--pi-space-5) var(--pi-space-7) var(--pi-space-2); color: var(--pi-text); line-height: 1.45; white-space: pre-wrap; }
    .card-text + fieldset.field, .card-text + .card-text { border-top: 0; }
    .required { color: var(--pi-danger); }
    input.typed { height: auto; min-height: var(--pi-control-height-touch); max-height: none; resize: none; }
    button:disabled:not([type="button"].secondary-action) { cursor: not-allowed; }
    .option {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: var(--pi-space-4);
      border: 1px solid transparent;
      border-radius: var(--pi-radius-md);
      padding: var(--pi-space-4) var(--pi-space-4);
      cursor: pointer;
      /* The coarse-pointer floor this project already holds everywhere else.
         A thumb drifting a few pixels on a 36px row surrounded by 7px gaps
         lands in the next row - reported as Custom answers appearing from
         option taps, because Custom sits directly under the last option. */
      min-height: var(--pi-control-height-touch);
      box-sizing: border-box;
    }
    .other-option { border-top: 1px solid var(--pi-border-muted); padding-top: var(--pi-space-6); }
    @media (hover: hover) { .option:hover { border-color: var(--pi-border-muted); background: var(--pi-surface-hover); } }
    .option:has(input:checked) { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    /* An unsized native control renders at the UA size (13px here), which put
       a tick box beside 24px ones in the next card. */
    input { flex: 0 0 auto; box-sizing: border-box; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); margin: 0; accent-color: var(--pi-accent); }
    input:focus-visible, textarea:focus-visible, button:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
    .option-copy { min-width: 0; display: grid; gap: var(--pi-space-1); }
    .option-label { line-height: 1.35; }
    .option-detail { color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: 1.35; }
    .other-answer { display: grid; gap: var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-xs); padding: var(--pi-space-2) var(--pi-space-4) var(--pi-space-2) calc(1px + var(--pi-space-4) + var(--pi-checkbox-size) + var(--pi-space-4)); }
    .other-answer:only-child { padding-left: 0; padding-right: 0; }
    /* Grows with the answer instead of keeping a long reply behind a
       three-line slot: field-sizing handles it natively where it exists and
       the input handler resizes it everywhere else. The cap keeps a very long
       answer from pushing the submit button off screen. */
    textarea, input.typed {
      box-sizing: border-box;
      width: 100%;
      min-height: 68px;
      max-height: 40vh;
      field-sizing: content;
      overflow-y: auto;
      resize: vertical;
      border: 1px solid var(--pi-border);
      border-radius: var(--pi-radius-md);
      background: var(--pi-bg);
      color: var(--pi-text);
      padding: var(--pi-space-4);
      font: var(--pi-control-font-size, 16px)/1.4 var(--pi-control-font-family, system-ui, sans-serif); line-height: inherit;
    }
    /* Back sits beside the forward action rather than under it: the pair is
       one decision, and a phone keyboard leaves little height to spend. */
    .step-actions { display: flex; gap: var(--pi-space-4); width: 100%; }
    .step-actions .primary-action { flex: 0 1 auto; min-width: 140px; margin-left: auto; }
    .step-actions .secondary-action { flex: 0 1 auto; min-width: 96px; }
    .card-form {
      display: flex;
      flex-direction: column;
    }
    .form-footer {
      /* Normal flow, like the extension dialog's footer and for the same
         measured reason: a bottom-sticky footer is held over the card's own
         earlier rows, and in a choice field those rows are the options. Reaching
         the wrong answer is worse than scrolling to the right one. The slot
         keeps the card within reach; the card covers nothing. */
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--pi-space-6);
      border-top: 1px solid var(--pi-border-muted);
      background: var(--pi-surface);
      box-shadow: 0 -8px 18px var(--pi-shadow-soft);
      padding: var(--pi-space-6) var(--pi-space-7);
    }
    button { box-sizing: border-box; min-height: var(--pi-control-height-touch);
      border: 1px solid var(--pi-border);
      border-radius: var(--pi-radius-md);
      background: var(--pi-surface);
      color: var(--pi-text);
      padding: var(--pi-space-4) var(--pi-space-5);
      font: inherit;
      cursor: pointer;
    }
    @media (hover: hover) { button:hover:not(:disabled) { background: var(--pi-surface-hover); } }
    button:active:not(:disabled) { background: var(--pi-surface-active); }
    button:disabled { cursor: wait; opacity: var(--pi-disabled-opacity); }
    .primary-action { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); font-weight: var(--pi-weight-strong); }
    @media (hover: hover) { .primary-action:hover:not(:disabled) { background: color-mix(in srgb, var(--pi-accent) 86%, white); } }
    .primary-action:active:not(:disabled) { background: color-mix(in srgb, var(--pi-accent) 86%, white); }
    .partial-confirmation { min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: var(--pi-space-5); }
    .partial-confirmation p { min-width: 0; margin: 0; color: var(--pi-warning); font-size: var(--pi-text-xs); line-height: 1.4; }
    .field-jump {
      display: inline;
      border: 0;
      border-radius: var(--pi-radius-xs);
      background: transparent;
      color: inherit;
      padding: 0;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .confirmation-actions { flex: 0 0 auto; display: flex; gap: var(--pi-space-4); }
    @container (max-width: 580px) {
      fieldset.field { padding: var(--pi-space-7) var(--pi-space-6); }
      /* Stacking made every action its own row, which on a phone with the
         keyboard open is height the step needs. Back and Next are one
         decision and stay on one row. */
      .form-footer { align-items: stretch; flex-direction: column; padding: var(--pi-space-5) var(--pi-space-6); }
      .form-footer .step-actions { flex-direction: row; }
      fieldset.field { padding: var(--pi-space-5) var(--pi-space-6); }
      .partial-confirmation { align-items: stretch; flex-direction: column; }
      .confirmation-actions { justify-content: flex-end; }
    }
    /* The floor is pointer-scoped by policy, not width-scoped: a tablet in
       landscape is a coarse pointer inside a wide container, and this card's
       own option rows already carry 44px unconditionally. */
    @media (pointer: coarse) {
      .primary-action, .secondary-action { min-height: var(--pi-control-height-touch); }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "interactive-card": InteractiveCard;
  }
}
