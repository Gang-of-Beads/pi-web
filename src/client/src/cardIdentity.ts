/**
 * Whether a card has to re-render.
 *
 * A pending dialog arrives on every status frame as a fresh object, so a streaming turn handed
 * the card a new property many times a second. Lit then rebuilt the form under the reader - the
 * card visibly shook while the agent was writing, and a control could move mid-tap. A card is
 * defined by its identity and what it declares; anything else in the frame is the same card said
 * again.
 */
import type { PendingExtensionDialog } from "../../shared/apiTypes";
import type { InteractiveCard } from "../../shared/interactiveCard";

/** What an interactive card is drawn from: the dialog that opened it and the card it declared. */
export interface OpenCard {
  readonly dialogId: string;
  readonly card: InteractiveCard;
}

export function interactiveCardFingerprint(open: OpenCard | undefined): string {
  return open === undefined ? "" : `${open.dialogId}\n${JSON.stringify(open.card)}`;
}

export function interactiveCardNeedsRender(previous: OpenCard | undefined, next: OpenCard | undefined): boolean {
  return interactiveCardFingerprint(previous) !== interactiveCardFingerprint(next);
}

type DialogLike = Pick<PendingExtensionDialog, "dialogId" | "kind" | "title" | "message" | "placeholder" | "prefill" | "prefillCut" | "options" | "timeoutAt" | "lines" | "screen">;

/**
 * The same reasoning for the extension dialog card, which draws the interactive card in the
 * waiting slot and arrives on the same status frames. A terminal screen's redrawn lines and a
 * declared card are rendered fields too: left out, the card kept marking the option the cursor
 * had left, and a tap walked from where it used to be (state-diagram D2; found probing the
 * extension screen, 2026-10-02).
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
