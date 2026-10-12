import { browserLocalStorage } from "./browserLocalStorage";
import {
  CARD_TYPED_TEXT_MAX_LENGTH,
  isAnswerableField,
  type CardAnswerableField,
  type CardChoiceField,
  type CardField,
  type CardSubmission,
  type CardValue,
} from "../../shared/interactiveCard";

/**
 * What the reader has entered into an interactive card but not sent yet, keyed by field id. Kept
 * in the browser because the daemon owns "there is an open card" while the browser owns "what I
 * have entered so far". An entry has the shape of its field's value, untrimmed.
 */
export type CardDraft = Record<string, CardValue>;

const draftStoragePrefix = "pi-web:card-draft:";

function draftStorageKey(sessionId: string, cardId: string): string {
  return `${draftStoragePrefix}${sessionId}:${cardId}`;
}

/**
 * Read the stored draft. Any unreadable or malformed payload yields an empty draft: a half-filled
 * card is a convenience, never a reason to fail drawing the card.
 */
export function loadCardDraft(sessionId: string, cardId: string, storage = browserLocalStorage()): CardDraft {
  try {
    const stored = storage?.getItem(draftStorageKey(sessionId, cardId));
    return stored === null || stored === undefined ? {} : draftFromJson(stored);
  } catch {
    return {};
  }
}

export function saveCardDraft(sessionId: string, cardId: string, draft: CardDraft, storage = browserLocalStorage()): void {
  try {
    const entries = Object.entries(draft).filter(([, value]) => saysSomething(value));
    if (entries.length === 0) storage?.removeItem(draftStorageKey(sessionId, cardId));
    else storage?.setItem(draftStorageKey(sessionId, cardId), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    return;
  }
}

export function clearCardDraft(sessionId: string, cardId: string, storage = browserLocalStorage()): void {
  try {
    storage?.removeItem(draftStorageKey(sessionId, cardId));
  } catch {
    return;
  }
}

/** An entry worth keeping: a pick, a yes or a no, or typed text. */
function saysSomething(value: CardValue): boolean {
  if ("confirmed" in value) return true;
  if ("text" in value) return value.text !== "";
  return value.selected.length > 0 || (value.other ?? "") !== "";
}

function draftFromJson(stored: string): CardDraft {
  const parsed: unknown = JSON.parse(stored);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const draft: CardDraft = {};
  for (const [id, value] of Object.entries(parsed)) {
    const entry = draftValue(value);
    if (entry !== undefined) draft[id] = entry;
  }
  return draft;
}

function draftValue(value: unknown): CardValue | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record: Record<string, unknown> = { ...value };
  if (typeof record["confirmed"] === "boolean") return { confirmed: record["confirmed"] };
  if (typeof record["text"] === "string") return { text: record["text"] };
  const selected = record["selected"];
  const other = record["other"];
  if (!Array.isArray(selected) || !selected.every((entry): entry is string => typeof entry === "string")) return undefined;
  if (other !== undefined && typeof other !== "string") return undefined;
  return { selected: [...selected], ...(other === undefined ? {} : { other }) };
}

/**
 * The value a field sends for the current draft, or `undefined` when it says nothing. The draft is
 * browser-local storage that an older app, another tab or a person could have left in a shape the
 * field no longer takes, so a value of the wrong shape says nothing, options the field does not
 * offer are dropped, and a single-answer choice keeps its first pick rather than sending a
 * submission the daemon would refuse as a whole.
 */
export function filledValue(field: CardAnswerableField, entry: CardValue | undefined): CardValue | undefined {
  if (entry === undefined) return undefined;
  if (field.type === "confirm") return "confirmed" in entry ? { confirmed: entry.confirmed } : undefined;
  if (field.type === "input") return "text" in entry && entry.text.trim() !== "" ? { text: entry.text.slice(0, CARD_TYPED_TEXT_MAX_LENGTH) } : undefined;
  return "selected" in entry ? filledChoice(field, entry.selected, entry.other) : undefined;
}

function filledChoice(field: CardChoiceField, selected: readonly string[], other: string | undefined): CardValue | undefined {
  const offered = new Set(field.options.map((option) => option.value));
  const picked = [...new Set(selected)].filter((value) => offered.has(value));
  const typed = field.other === undefined ? undefined : trimmedTyped(other);
  if (field.multiple !== true && picked.length + (typed === undefined ? 0 : 1) > 1) {
    const first = picked[0];
    if (first !== undefined) return { selected: [first] };
  }
  if (picked.length === 0 && typed === undefined) return undefined;
  return { selected: picked, ...(typed === undefined ? {} : { other: typed }) };
}

function trimmedTyped(other: string | undefined): string | undefined {
  const trimmed = other?.trim().slice(0, CARD_TYPED_TEXT_MAX_LENGTH);
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/** The answerable fields, in the card's order. */
export function answerableFields(fields: readonly CardField[]): CardAnswerableField[] {
  return fields.filter(isAnswerableField);
}

/** How many fields the draft fills, counted exactly as {@link toCardSubmission} sends them. */
export function filledCount(fields: readonly CardField[], draft: CardDraft): number {
  return answerableFields(fields).filter((field) => filledValue(field, draft[field.id]) !== undefined).length;
}

/** The fields left untouched, in the card's order. */
export function unfilledFields(fields: readonly CardField[], draft: CardDraft): CardAnswerableField[] {
  return answerableFields(fields).filter((field) => filledValue(field, draft[field.id]) === undefined);
}

/** The submission for the current draft: one value per filled field, nothing for the untouched ones. */
export function toCardSubmission(fields: readonly CardField[], draft: CardDraft): CardSubmission {
  const values: Record<string, CardValue> = {};
  for (const field of answerableFields(fields)) {
    const value = filledValue(field, draft[field.id]);
    if (value !== undefined) values[field.id] = value;
  }
  return { values };
}
