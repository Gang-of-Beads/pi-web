/**
 * The daemon side of the `ctx.ui.custom(factory, { web })` declaration contract.
 *
 * Reading a declaration defensively lives in src/shared/interactiveCardReader.ts, shared with the browser. This module holds what only the daemon does: it publishes the declarable kinds, summarises a refused declaration for the log, and validates a submitted card answer before `custom()` resolves (docs/design/interactive-card.md).
 */
import { isRecord } from "../../../shared/unknownValues.js";
import {
  CARD_TYPED_TEXT_MAX_LENGTH,
  isAnswerableField,
  type CardAnswerableField,
  type CardChoiceField,
  type CardSubmission,
  type CardValue,
  type InteractiveCard,
} from "../../../shared/interactiveCard.js";

/**
 * The declarations this host draws, published on the UI context as `ctx.ui.piWebScreens`.
 *
 * A headless host resolves `custom()` with `undefined` without drawing anything, and
 * so does this host when a declared card closes unanswered (timeout, Stop, session
 * end). An extension that falls back to `select`/`input` on `undefined` would ask the
 * reader a second time here; reading this list first tells it which `undefined` it got.
 */
export const DECLARABLE_SCREENS: readonly string[] = Object.freeze(["card"]);

/**
 * A one-line account of a declaration that did not fit, for the daemon log. A refused
 * declaration draws the terminal frame instead, which is the very thing declaring
 * avoids; without this line nothing said why.
 */
export function refusedDeclarationSummary(value: unknown): string {
  if (!isRecord(value)) return `web is ${typeof value}`;
  const fields = value["fields"];
  if (!Array.isArray(fields)) return `kind ${String(value["kind"])}, no fields list`;
  const sizes = fields.map((entry) => {
    if (!isRecord(entry)) return "junk";
    const options = entry["options"];
    return `${String(entry["type"])}${Array.isArray(options) ? ` with ${String(options.length)} options` : ""}`;
  });
  return `kind ${String(value["kind"])}, ${String(fields.length)} fields: ${sizes.join("; ")}`;
}

/**
 * The values a card's submission gives, checked against its fields. Throws on any value that does
 * not fit its field - an unknown or read-only field, an option the field lacks, several options
 * for a single-answer field, typed text where the field takes none, a required field left empty -
 * and the dialog store refuses the submission with that message. An untouched field and an empty
 * value are the same thing, so an empty value is left out rather than recorded as filled.
 */
export function validateCardSubmission(card: InteractiveCard, submission: CardSubmission): CardSubmission {
  const fieldsById = new Map(card.fields.filter(isAnswerableField).map((field) => [field.id, field]));
  const values: Record<string, CardValue> = {};
  for (const [id, value] of Object.entries(submission.values)) {
    const field = fieldsById.get(id);
    if (field === undefined) throw new Error(`The card has no field ${id} to fill`);
    const validated = validatedValue(field, value);
    if (validated !== undefined) values[id] = validated;
  }
  const missing = [...fieldsById.values()].find((field) => field.required === true && values[field.id] === undefined);
  if (missing !== undefined) throw new Error(`Field ${missing.id} is required`);
  return { values };
}

function validatedValue(field: CardAnswerableField, value: unknown): CardValue | undefined {
  if (!isRecord(value)) throw new Error(`Field ${field.id} has no value of its kind`);
  if (field.type === "input") return validatedInput(field.id, value);
  if (field.type === "confirm") return validatedConfirm(field.id, value);
  return validatedChoice(field, value);
}

function validatedInput(id: string, value: Record<string, unknown>): CardValue | undefined {
  const text = value["text"];
  if (typeof text !== "string") throw new Error(`Field ${id} takes text`);
  if (text.length > CARD_TYPED_TEXT_MAX_LENGTH) throw new Error(`Field ${id} exceeds its length limit`);
  return text.trim() === "" ? undefined : { text };
}

function validatedConfirm(id: string, value: Record<string, unknown>): CardValue {
  const confirmed = value["confirmed"];
  if (typeof confirmed !== "boolean") throw new Error(`Field ${id} takes a yes or a no`);
  return { confirmed };
}

function validatedChoice(field: CardChoiceField, value: Record<string, unknown>): CardValue | undefined {
  const selected = value["selected"];
  if (!Array.isArray(selected) || !selected.every((entry): entry is string => typeof entry === "string")) throw new Error(`Field ${field.id} takes a list of options`);
  const offered = new Set(field.options.map((option) => option.value));
  const picked: string[] = [];
  for (const entry of selected) {
    if (!offered.has(entry)) throw new Error(`Field ${field.id} has no option ${entry}`);
    if (picked.includes(entry)) throw new Error(`Option ${entry} of field ${field.id} is picked twice`);
    picked.push(entry);
  }
  const other = typedOther(field, value["other"]);
  const count = picked.length + (other === undefined ? 0 : 1);
  if (field.multiple !== true && count > 1) throw new Error(`Field ${field.id} takes a single answer`);
  if (count === 0) return undefined;
  return { selected: picked, ...(other === undefined ? {} : { other }) };
}

function typedOther(field: CardChoiceField, other: unknown): string | undefined {
  if (other === undefined) return undefined;
  if (typeof other !== "string") throw new Error(`Field ${field.id} takes its typed answer as text`);
  if (field.other === undefined) throw new Error(`Field ${field.id} takes no typed answer`);
  if (other.length > CARD_TYPED_TEXT_MAX_LENGTH) throw new Error(`The typed answer of field ${field.id} exceeds its length limit`);
  const trimmed = other.trim();
  return trimmed === "" ? undefined : trimmed;
}
