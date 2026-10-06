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
import type { PendingAskUser, PendingExtensionDialog } from "../../shared/apiTypes";

/**
 * Picked from the wire types, not restated: a hand-written shape read `id` while the
 * ask carries `askId`, so two sets asking the same questions looked like one and the
 * second opened on the first one's step and answers. The compiler now owns the names.
 */
type AskLike = Pick<PendingAskUser, "askId" | "questions">;

export function askCardFingerprint(ask: AskLike | undefined): string {
  if (ask === undefined) return "";
  const questions = ask.questions.map((question) => [
    question.id,
    question.question,
    String(question.multiple === true),
    String(question.options.length),
  ].join("|"));
  const identity = ask.askId;
  return [identity, ...questions].join("\n");
}

export function askCardNeedsRender(previous: AskLike | undefined, next: AskLike | undefined): boolean {
  return askCardFingerprint(previous) !== askCardFingerprint(next);
}

type DialogLike = Pick<PendingExtensionDialog, "dialogId" | "kind" | "title" | "message" | "placeholder" | "prefill" | "prefillCut" | "options" | "timeoutAt" | "lines" | "screen">;

/**
 * The same reasoning for the extension dialog card, which sits in the same
 * waiting slot and arrives on the same status frames. Fixing only the ask card
 * would have left its sibling shaking. A terminal screen's redrawn lines and a
 * declared screen are rendered fields too: left out, the card kept marking the
 * option the cursor had left, and a tap walked from where it used to be
 * (state-diagram D2; found probing the extension screen, 2026-10-02).
 */
export function dialogCardFingerprint(dialog: DialogLike | undefined): string {
  if (dialog === undefined) return "";
  return [
    dialog.dialogId,
    dialog.kind,
    dialog.title,
    dialog.message ?? "",
    dialog.placeholder ?? "",
    dialog.prefill ?? "",
    String(dialog.prefillCut ?? ""),
    dialog.timeoutAt ?? "",
    (dialog.options ?? []).join("\u0001"),
    (dialog.lines ?? []).join("\u0001"),
    dialog.screen === undefined ? "" : JSON.stringify(dialog.screen),
  ].join("\n");
}

export function dialogCardNeedsRender(previous: DialogLike | undefined, next: DialogLike | undefined): boolean {
  return dialogCardFingerprint(previous) !== dialogCardFingerprint(next);
}
