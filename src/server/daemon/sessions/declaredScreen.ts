/**
 * What an extension declared its `ctx.ui.custom` screen to be, read defensively.
 *
 * `ctx.ui.custom(factory, { web })` is pi-web's addition; pi ignores the unknown
 * key and keeps running the TUI factory. A screen declared as questions is drawn
 * by the browser's Questions card and its terminal component is never mounted,
 * which is what stops the reader from seeing the same dialog twice (the owner had
 * to cancel a terminal dump before the native cards appeared). The declaration
 * comes from extension code, so junk is not an error: anything that does not fit
 * reads as undeclared and the screen falls back to its drawn lines.
 */
import { isRecord } from "../../../shared/unknownValues.js";
import {
  ASK_USER_ID_MAX_LENGTH,
  ASK_USER_OPTION_LIMIT,
  ASK_USER_OTHER_TEXT_MAX_LENGTH,
  ASK_USER_QUESTION_LIMIT,
  ASK_USER_TEXT_MAX_LENGTH,
  EXTENSION_SCREEN_DETAIL_MAX_LENGTH,
  type AskUserAnswer,
  type AskUserQuestion,
  type AskUserQuestionOption,
  type AskUserSubmission,
  type ExtensionDialogScreen,
} from "../../../shared/apiTypes.js";

/**
 * The declarations this host draws, published on the UI context as `ctx.ui.piWebScreens`.
 *
 * A headless host resolves `custom()` with `undefined` without drawing anything, and
 * so does this host when a declared card closes unanswered (timeout, Stop, session
 * end). An extension that falls back to `select`/`input` on `undefined` would ask the
 * reader a second time here; reading this list first tells it which `undefined` it got.
 */
export const DECLARABLE_SCREENS: readonly string[] = Object.freeze(["questions"]);

export function declaredScreen(value: unknown): ExtensionDialogScreen | undefined {
  if (!isRecord(value) || value["kind"] !== "questions") return undefined;
  const questions = listOf(value["questions"], ASK_USER_QUESTION_LIMIT, declaredQuestion);
  if (questions === undefined || questions.length === 0 || !unique(questions.map((question) => question.id))) return undefined;
  const title = text(value["title"], ASK_USER_TEXT_MAX_LENGTH);
  return { kind: "questions", ...(title === undefined ? {} : { title }), questions };
}

/**
 * A one-line account of a declaration that did not fit, for the daemon log. A refused
 * declaration draws the terminal frame instead, which is the very thing declaring
 * avoids; without this line nothing said why.
 */
export function refusedDeclarationSummary(value: unknown): string {
  if (!isRecord(value)) return `web is ${typeof value}`;
  const questions = value["questions"];
  if (!Array.isArray(questions)) return `kind ${String(value["kind"])}, no questions list`;
  const sizes = questions.map((entry) => {
    if (!isRecord(entry)) return "junk";
    const options = entry["options"];
    const detail = entry["detail"];
    return `${Array.isArray(options) ? String(options.length) : "?"} options, detail ${typeof detail === "string" ? String(detail.length) : "none"}`;
  });
  return `kind ${String(value["kind"])}, ${String(questions.length)} questions: ${sizes.join("; ")}`;
}

function declaredQuestion(value: unknown): AskUserQuestion | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value["id"], ASK_USER_ID_MAX_LENGTH);
  const question = text(value["question"], ASK_USER_TEXT_MAX_LENGTH);
  const options = listOf(value["options"] ?? [], ASK_USER_OPTION_LIMIT, declaredOption);
  if (id === undefined || question === undefined || options === undefined || !unique(options.map((option) => option.value))) return undefined;
  if (options.length === 0 && value["custom"] === false) return undefined;
  const detail = optionalText(value["detail"], EXTENSION_SCREEN_DETAIL_MAX_LENGTH);
  if (detail === null) return undefined;
  return {
    id,
    question,
    ...(detail === undefined ? {} : { detail }),
    options,
    ...(value["multiple"] === true ? { multiple: true } : {}),
    ...(value["custom"] === false ? { custom: false } : {}),
    ...(value["customInput"] === "field" && value["custom"] !== false ? { customInput: "field" as const } : {}),
  };
}

function declaredOption(value: unknown): AskUserQuestionOption | undefined {
  if (!isRecord(value)) return undefined;
  const optionValue = text(value["value"], ASK_USER_ID_MAX_LENGTH);
  const label = text(value["label"], ASK_USER_TEXT_MAX_LENGTH);
  const detail = optionalText(value["detail"], ASK_USER_TEXT_MAX_LENGTH);
  if (optionValue === undefined || label === undefined || detail === null) return undefined;
  return { value: optionValue, label, ...(detail === undefined ? {} : { detail }) };
}

/** Every entry read, or `undefined` when the list is missing, too long, or any entry is junk. */
function listOf<T>(value: unknown, limit: number, read: (entry: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value) || value.length > limit) return undefined;
  const entries = value.map(read);
  return entries.every((entry): entry is T => entry !== undefined) ? entries : undefined;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) return undefined;
  return value;
}

/** `undefined` when absent, `null` when present but unusable. */
function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  return text(value, max) ?? null;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/**
 * The answers a declared questions screen's submission gives, keyed by question id. Throws on
 * any answer that does not fit its question - an unknown id, an option the question lacks,
 * several answers to a single-answer question, typed text where the extension declared none -
 * and the dialog store refuses the submission with that message. An untouched question and an
 * explicitly empty answer are the same thing, so an empty answer is left out rather than
 * recorded as answered.
 */
export function validateSubmission(questions: readonly AskUserQuestion[], submission: AskUserSubmission): Map<string, AskUserAnswer> {
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const answers = new Map<string, AskUserAnswer>();
  for (const answer of submission.answers) {
    const question = questionsById.get(answer.id);
    if (question === undefined) throw new Error(`Unknown question id ${answer.id}`);
    if (answers.has(answer.id)) throw new Error(`Duplicate answer for question ${answer.id}`);
    const validated = validateAnswer(question, answer);
    if (validated !== undefined) answers.set(answer.id, validated);
  }
  return answers;
}

function validateAnswer(question: AskUserQuestion, answer: AskUserAnswer): AskUserAnswer | undefined {
  const optionValues = new Set(question.options.map((option) => option.value));
  const values: string[] = [];
  for (const value of answer.values) {
    if (!optionValues.has(value)) throw new Error(`Question ${question.id} has no option ${value}`);
    if (values.includes(value)) throw new Error(`Duplicate value ${value} for question ${question.id}`);
    values.push(value);
  }
  const otherText = normalizeOtherText(question, answer.otherText);
  const selectionCount = values.length + (otherText === undefined ? 0 : 1);
  if (question.multiple !== true && selectionCount > 1) throw new Error(`Question ${question.id} accepts a single answer`);
  if (selectionCount === 0) return undefined;
  return { id: question.id, values, ...(otherText === undefined ? {} : { otherText }) };
}

function normalizeOtherText(question: AskUserQuestion, otherText: string | undefined): string | undefined {
  if (otherText === undefined) return undefined;
  if (question.custom === false) throw new Error(`Question ${question.id} takes no typed answer`);
  if (otherText.length > ASK_USER_OTHER_TEXT_MAX_LENGTH) throw new Error(`Other text of question ${question.id} exceeds its length limit`);
  const trimmed = otherText.trim();
  return trimmed === "" ? undefined : trimmed;
}

