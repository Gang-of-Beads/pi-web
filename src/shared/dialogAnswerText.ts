import type { AskUserQuestion, ExtensionDialogAnswer, ExtensionDialogScreen } from "./apiTypes.js";

/**
 * An extension dialog's answer as the reader would say it: Yes/No, the chosen
 * text, or the labels of a questions screen (the option value is the extension's
 * key, the label is what the reader chose). Empty when a questions screen was
 * sent back unanswered.
 */
export function dialogAnswerText(screen: ExtensionDialogScreen | undefined, answer: ExtensionDialogAnswer): string {
  if (typeof answer === "boolean") return answer ? "Yes" : "No";
  if (typeof answer === "string") return answer;
  const questions: readonly AskUserQuestion[] = screen?.questions ?? [];
  return answer.answers
    .map((entry) => {
      const options = questions.find((question) => question.id === entry.id)?.options ?? [];
      const labels = entry.values.map((value) => options.find((option) => option.value === value)?.label ?? value);
      return [...labels, ...(entry.otherText === undefined ? [] : [entry.otherText])].join(", ");
    })
    .filter((part) => part !== "")
    .join("; ");
}
