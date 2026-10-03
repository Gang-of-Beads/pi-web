import { describe, expect, it } from "vitest";
import type { PendingAskUser, PendingExtensionDialog } from "../../shared/apiTypes";
import { drawnWaitingCards, shownWaitingCards, type ShownWaiting, type WaitingCards } from "./waitingSlotHold";

const ask = (askId: string): PendingAskUser => ({ askId, questions: [{ id: "q", question: askId, options: [{ value: "a", label: "A" }] }], askedAt: "2026-10-03T00:00:00.000Z" });
const dialog = (dialogId: string): PendingExtensionDialog => ({ dialogId, kind: "select", title: dialogId, message: "", options: ["A"], askedAt: "2026-10-03T00:00:00.000Z", runScoped: false });
const cards = (forms: string[], dialogs: string[]): WaitingCards => ({ forms: forms.map(ask), dialogs: dialogs.map(dialog) });
const shape = (shown: ShownWaiting) => ({
  forms: shown.forms.map(({ card, presence }) => `${card.askId}:${presence}`),
  dialogs: shown.dialogs.map(({ card, presence }) => `${card.dialogId}:${presence}`),
});

/** D2, B22: every state of the slot under a press, enumerated. */
describe("what the waiting slot draws", () => {
  const cases: [string, WaitingCards | undefined, WaitingCards, boolean, { forms: string[]; dialogs: string[] }][] = [
    ["no press: the open cards, live", cards(["a1"], ["d1"]), cards([], ["d2"]), false, { forms: [], dialogs: ["d2:live"] }],
    ["a press before anything was drawn: the open cards, live", undefined, cards(["a1"], ["d1"]), true, { forms: ["a1:live"], dialogs: ["d1:live"] }],
    ["a press while nothing changed: the same cards, live", cards(["a1"], ["d1"]), cards(["a1"], ["d1"]), true, { forms: ["a1:live"], dialogs: ["d1:live"] }],
    ["one of two dialogs closed under a press: it keeps its place, held, beside the open one", cards([], ["d1", "d2"]), cards([], ["d2"]), true, { forms: [], dialogs: ["d1:held", "d2:live"] }],
    ["every card closed under a press: all held, in place", cards(["a1", "a2"], ["d1"]), cards([], []), true, { forms: ["a1:held", "a2:held"], dialogs: ["d1:held"] }],
    ["a card opened during a press: it joins at the end, live", cards([], ["d1"]), cards([], ["d1", "d2"]), true, { forms: [], dialogs: ["d1:live", "d2:live"] }],
    ["a card closed while another opened: held in place, the new one after it", cards(["a1"], []), cards(["a2"], []), true, { forms: ["a1:held", "a2:live"], dialogs: [] }],
    ["the second of two forms closed under a press: the first stays live, the second held", cards(["a1", "a2"], []), cards(["a1"], []), true, { forms: ["a1:live", "a2:held"], dialogs: [] }],
  ];

  it.each(cases)("%s", (_name, drawn, open, holding, expected) => {
    expect(shape(shownWaitingCards(drawn, open, holding))).toEqual(expected);
  });

  it("draws an open card from its current object, not the one drawn before", () => {
    const before = dialog("d1");
    const now = { ...dialog("d1"), lines: ["redrawn"] };

    const shown = shownWaitingCards({ forms: [], dialogs: [before] }, { forms: [], dialogs: [now] }, true);

    expect(shown.dialogs[0]?.card).toBe(now);
  });

  it("keeps what is on screen, held cards included, and nothing when the slot is empty", () => {
    const shown = shownWaitingCards(cards([], ["d1", "d2"]), cards([], ["d2"]), true);

    expect({ drawn: drawnWaitingCards(shown)?.dialogs.map((entry) => entry.dialogId), empty: drawnWaitingCards({ forms: [], dialogs: [] }) }).toEqual({ drawn: ["d1", "d2"], empty: undefined });
  });
});
