/**
 * The interactive card: one generic kind of card an extension declares for its `ctx.ui.custom`
 * screen, which the browser draws natively instead of the terminal component (docs/design/
 * interactive-card.md).
 *
 * It replaced a card that could only ask questions and was named after one extension (owner,
 * 2026-10-12: "it does not have to be question / ask user; one generic kind of interactive card,
 * so every case that wants such a card can use it"). Core knows field types, never extensions.
 */

/** Largest field list one card may hold. */
export const CARD_FIELD_LIMIT = 20;
/** Largest option list one choice field may offer. */
export const CARD_OPTION_LIMIT = 12;
/** Length bound for ids: field ids and option values. */
export const CARD_ID_MAX_LENGTH = 128;
/** Length bound for short declared prose: the title, labels, option labels, button words, placeholders. */
export const CARD_LABEL_MAX_LENGTH = 1_000;
/** Length bound for the text the reader types into a field. */
export const CARD_TYPED_TEXT_MAX_LENGTH = 4_000;

/** The field types a card draws; a `Record` keyed by it makes an unhandled type a type error. */
export type CardFieldType = "text" | "choice" | "input" | "confirm";

/** One option of a choice field. */
export interface CardOption {
  /** Stable value reported back to the extension. */
  value: string;
  /** What the reader sees. */
  label: string;
  /** An optional clarifying line under the label. */
  detail?: string;
}

/** Read-only prose between fields; it has no value. */
export interface CardTextField {
  type: "text";
  id: string;
  text: string;
}

interface AnswerableField {
  id: string;
  label: string;
  detail?: string;
  /** The card does not move past the field, nor send, until it is filled. */
  required?: true;
}

/**
 * Options to pick from. `other` offers a typed answer too: `"choice"` as a Custom option that opens
 * a box, `"field"` as a box under the options typed into straight away; absent, no typed answer.
 */
export interface CardChoiceField extends AnswerableField {
  type: "choice";
  options: CardOption[];
  multiple?: true;
  other?: "choice" | "field";
}

/** A typed answer: one line, or a box with `multiline`. */
export interface CardInputField extends AnswerableField {
  type: "input";
  multiline?: true;
  placeholder?: string;
}

/** A yes-or-no answer, with the extension's words for the two ("Yes" and "No" when absent). */
export interface CardConfirmField extends AnswerableField {
  type: "confirm";
  confirm?: string;
  decline?: string;
}

export type CardField = CardTextField | CardChoiceField | CardInputField | CardConfirmField;
export type CardAnswerableField = Exclude<CardField, CardTextField>;

/** A declared card: what `ctx.ui.custom(factory, { web })` carries as `web`. */
export interface InteractiveCard {
  kind: "card";
  title?: string;
  /** The last step's button words ("Send" when absent). */
  submit?: string;
  fields: CardField[];
}

export interface CardChoiceValue { selected: string[]; other?: string }
export interface CardInputValue { text: string }
export interface CardConfirmValue { confirmed: boolean }
export type CardValue = CardChoiceValue | CardInputValue | CardConfirmValue;

/** What `custom()` resolves with: a value per filled field; an untouched field is absent. */
export interface CardSubmission {
  values: Record<string, CardValue>;
}

export function isAnswerableField(field: CardField): field is CardAnswerableField {
  return field.type !== "text";
}
