/**
 * Reading an interactive card declaration, shared by the daemon (which reads it from extension
 * code, where junk is not an error) and the browser (which reads it from the daemon). One reader,
 * so the two can never disagree about what a card is; `undefined` means it is not one.
 */
import { isRecord } from "./unknownValues.js";
import { EXTENSION_SCREEN_DETAIL_MAX_LENGTH } from "./apiTypes.js";
import {
  CARD_FIELD_LIMIT,
  CARD_ID_MAX_LENGTH,
  CARD_LABEL_MAX_LENGTH,
  CARD_OPTION_LIMIT,
  type CardField,
  type CardFieldType,
  type CardOption,
  type InteractiveCard,
} from "./interactiveCard.js";

export function readInteractiveCard(value: unknown): InteractiveCard | undefined {
  if (!isRecord(value) || value["kind"] !== "card") return undefined;
  const fields = listOf(value["fields"], CARD_FIELD_LIMIT, declaredField);
  if (fields === undefined || fields.length === 0 || !unique(fields.map((field) => field.id))) return undefined;
  const title = optionalText(value["title"], CARD_LABEL_MAX_LENGTH);
  const submit = optionalText(value["submit"], CARD_LABEL_MAX_LENGTH);
  if (title === null || submit === null) return undefined;
  return { kind: "card", ...(title === undefined ? {} : { title }), ...(submit === undefined ? {} : { submit }), fields };
}

/** One reader per field type: a declared type without one is junk, and a new type without one is a type error. */
const FIELD_READERS: Readonly<Record<CardFieldType, (record: Record<string, unknown>, id: string) => CardField | undefined>> = {
  text: (record, id) => {
    const text = boundedText(record["text"], EXTENSION_SCREEN_DETAIL_MAX_LENGTH);
    return text === undefined ? undefined : { type: "text", id, text };
  },
  choice: (record, id) => {
    const base = answerableBase(record);
    const options = listOf(record["options"], CARD_OPTION_LIMIT, declaredOption);
    if (base === undefined || options === undefined || options.length === 0 || !unique(options.map((option) => option.value))) return undefined;
    const other = record["other"];
    if (other !== undefined && other !== "choice" && other !== "field") return undefined;
    return {
      type: "choice",
      id,
      ...base,
      options,
      ...(record["multiple"] === true ? { multiple: true as const } : {}),
      ...(other === undefined ? {} : { other }),
    };
  },
  input: (record, id) => {
    const base = answerableBase(record);
    const placeholder = optionalText(record["placeholder"], CARD_LABEL_MAX_LENGTH);
    if (base === undefined || placeholder === null) return undefined;
    return { type: "input", id, ...base, ...(record["multiline"] === true ? { multiline: true as const } : {}), ...(placeholder === undefined ? {} : { placeholder }) };
  },
  confirm: (record, id) => {
    const base = answerableBase(record);
    const confirm = optionalText(record["confirm"], CARD_LABEL_MAX_LENGTH);
    const decline = optionalText(record["decline"], CARD_LABEL_MAX_LENGTH);
    if (base === undefined || confirm === null || decline === null) return undefined;
    return { type: "confirm", id, ...base, ...(confirm === undefined ? {} : { confirm }), ...(decline === undefined ? {} : { decline }) };
  },
};

function declaredField(value: unknown): CardField | undefined {
  if (!isRecord(value)) return undefined;
  const type = value["type"];
  const id = boundedText(value["id"], CARD_ID_MAX_LENGTH);
  if (!isCardFieldType(type) || id === undefined) return undefined;
  return FIELD_READERS[type](value, id);
}

function isCardFieldType(value: unknown): value is CardFieldType {
  return typeof value === "string" && Object.hasOwn(FIELD_READERS, value);
}

function answerableBase(record: Record<string, unknown>): { label: string; detail?: string; required?: true } | undefined {
  const label = boundedText(record["label"], CARD_LABEL_MAX_LENGTH);
  const detail = optionalText(record["detail"], EXTENSION_SCREEN_DETAIL_MAX_LENGTH);
  if (label === undefined || detail === null) return undefined;
  return { label, ...(detail === undefined ? {} : { detail }), ...(record["required"] === true ? { required: true as const } : {}) };
}

function declaredOption(value: unknown): CardOption | undefined {
  if (!isRecord(value)) return undefined;
  const optionValue = boundedText(value["value"], CARD_ID_MAX_LENGTH);
  const label = boundedText(value["label"], CARD_LABEL_MAX_LENGTH);
  const detail = optionalText(value["detail"], CARD_LABEL_MAX_LENGTH);
  if (optionValue === undefined || label === undefined || detail === null) return undefined;
  return { value: optionValue, label, ...(detail === undefined ? {} : { detail }) };
}

/** Every entry read, or `undefined` when the list is missing, too long, or any entry is junk. */
function listOf<T>(value: unknown, limit: number, read: (entry: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value) || value.length > limit) return undefined;
  const entries = value.map(read);
  return entries.every((entry): entry is T => entry !== undefined) ? entries : undefined;
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) return undefined;
  return value;
}

/** `undefined` when absent, `null` when present but unusable. */
function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  return boundedText(value, max) ?? null;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

