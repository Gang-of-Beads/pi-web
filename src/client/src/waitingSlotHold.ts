import type { PendingAskUser, PendingExtensionDialog } from "../../shared/apiTypes";

/**
 * What the waiting slot draws (state-diagram D2, B22). While a press holds or settles, the cards
 * already drawn keep their places: a card still open is drawn live, from its current object; a
 * card that closed is drawn held, inert, so the tap that lands after it closed answers nothing; a
 * card that opened during the press joins at the end. Without a press the slot is the open cards.
 *
 * A card used to be held only once every card had closed: with a second card open, the closed one
 * vanished at once and the survivor slid under the finger, where the release answered it (review
 * b2c94ee9). Only the first of several open forms was held at all.
 */
export type CardPresence = "live" | "held";

export interface ShownCard<T> {
  readonly card: T;
  readonly presence: CardPresence;
}

export interface WaitingCards {
  readonly forms: readonly PendingAskUser[];
  readonly dialogs: readonly PendingExtensionDialog[];
}

export interface ShownWaiting {
  readonly forms: readonly ShownCard<PendingAskUser>[];
  readonly dialogs: readonly ShownCard<PendingExtensionDialog>[];
}

export function shownWaitingCards(drawn: WaitingCards | undefined, open: WaitingCards, holding: boolean): ShownWaiting {
  if (!holding || drawn === undefined) return { forms: open.forms.map(liveCard), dialogs: open.dialogs.map(liveCard) };
  return {
    forms: keepPlaces(drawn.forms, open.forms, (ask) => ask.askId),
    dialogs: keepPlaces(drawn.dialogs, open.dialogs, (dialog) => dialog.dialogId),
  };
}

/** The cards on screen, to be kept in place by the next render while a press holds. */
export function drawnWaitingCards(shown: ShownWaiting): WaitingCards | undefined {
  if (shown.forms.length === 0 && shown.dialogs.length === 0) return undefined;
  return { forms: shown.forms.map(({ card }) => card), dialogs: shown.dialogs.map(({ card }) => card) };
}

function keepPlaces<T>(drawn: readonly T[], open: readonly T[], idOf: (card: T) => string): ShownCard<T>[] {
  const openById = new Map(open.map((card) => [idOf(card), card]));
  const drawnIds = new Set(drawn.map(idOf));
  const kept = drawn.map((card): ShownCard<T> => {
    const current = openById.get(idOf(card));
    return current === undefined ? { card, presence: "held" } : liveCard(current);
  });
  return [...kept, ...open.filter((card) => !drawnIds.has(idOf(card))).map(liveCard)];
}

function liveCard<T>(card: T): ShownCard<T> {
  return { card, presence: "live" };
}
