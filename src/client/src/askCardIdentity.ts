/**
 * Whether a question card has to re-render.
 *
 * The pending ask arrives on every status frame as a fresh object, so a
 * streaming turn handed the card a new property many times a second. Lit then
 * rebuilt the form under the reader - the card visibly shook while the agent
 * was writing, and a control could move mid-tap. The card is defined by its
 * identity and the questions it asks; anything else in the frame is the same
 * question said again.
 */

interface AskLike {
  id?: string;
  requestId?: string;
  questions?: readonly { id?: string; question?: string; options?: readonly unknown[]; multiple?: boolean }[];
}

export function askCardFingerprint(ask: AskLike | undefined): string {
  if (ask === undefined) return "";
  const identity = ask.id ?? ask.requestId ?? "";
  const questions = (ask.questions ?? []).map((question) => [
    question.id ?? "",
    question.question ?? "",
    String(question.multiple === true),
    String((question.options ?? []).length),
  ].join("|"));
  return [identity, ...questions].join("\n");
}

export function askCardNeedsRender(previous: AskLike | undefined, next: AskLike | undefined): boolean {
  return askCardFingerprint(previous) !== askCardFingerprint(next);
}

interface DialogLike {
  dialogId?: string;
  kind?: string;
  title?: string;
  message?: string;
  placeholder?: string;
  options?: readonly string[];
  expiresAt?: string;
}

/**
 * The same reasoning for the extension dialog card, which sits in the same
 * waiting slot and arrives on the same status frames. Fixing only the ask card
 * would have left its sibling shaking.
 */
export function dialogCardFingerprint(dialog: DialogLike | undefined): string {
  if (dialog === undefined) return "";
  return [
    dialog.dialogId ?? "",
    dialog.kind ?? "",
    dialog.title ?? "",
    dialog.message ?? "",
    dialog.placeholder ?? "",
    dialog.expiresAt ?? "",
    (dialog.options ?? []).join("\u0001"),
  ].join("\n");
}

export function dialogCardNeedsRender(previous: DialogLike | undefined, next: DialogLike | undefined): boolean {
  return dialogCardFingerprint(previous) !== dialogCardFingerprint(next);
}
