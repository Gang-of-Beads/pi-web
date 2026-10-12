import type { ExtensionDialogAnswer, ExtensionDialogScreen } from "./apiTypes.js";
import { isAnswerableField, type CardAnswerableField, type CardValue } from "./interactiveCard.js";

/**
 * An extension dialog's answer as the reader would say it: Yes/No, the chosen
 * text, or what an interactive card was filled with (an option's label, not its
 * value: the value is the extension's key, the label is what the reader chose).
 * Empty when a card was sent back with nothing filled.
 */
export function dialogAnswerText(screen: ExtensionDialogScreen | undefined, answer: ExtensionDialogAnswer): string {
  if (typeof answer === "boolean") return answer ? "Yes" : "No";
  if (typeof answer === "string") return answer;
  const fields = (screen?.fields ?? []).filter(isAnswerableField);
  return Object.entries(answer.values)
    .map(([id, value]) => valueText(fields.find((field) => field.id === id), value))
    .filter((part) => part !== "")
    .join("; ");
}

function valueText(field: CardAnswerableField | undefined, value: CardValue): string {
  if ("text" in value) return value.text;
  if ("confirmed" in value) return confirmWords(field?.type === "confirm" ? field : undefined, value.confirmed);
  const options = field?.type === "choice" ? field.options : [];
  const labels = value.selected.map((selected) => options.find((option) => option.value === selected)?.label ?? selected);
  return [...labels, ...(value.other === undefined ? [] : [value.other])].join(", ");
}

function confirmWords(field: Extract<CardAnswerableField, { type: "confirm" }> | undefined, confirmed: boolean): string {
  return confirmed ? field?.confirm ?? "Yes" : field?.decline ?? "No";
}
