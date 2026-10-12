import { describe, expect, it } from "vitest";
import type { PendingExtensionDialog } from "../../shared/apiTypes";
import type { CardChoiceField } from "../../shared/interactiveCard";
import { dialogCardNeedsRender, interactiveCardNeedsRender, type OpenCard } from "./cardIdentity";

/** Built from the wire types: an untyped `{ id }` here once hid that the card carries its dialog's id. */
const choice = (id: string, label: string, options = 1): CardChoiceField => ({
  type: "choice",
  id,
  label,
  options: Array.from({ length: options }, (_, index) => ({ value: String(index), label: String(index) })),
});
const open = (dialogId: string, fields: CardChoiceField[]): OpenCard => ({ dialogId, card: { kind: "card", fields } });

describe("interactiveCardNeedsRender", () => {
  it("does not re-render for a fresh object carrying the same card", () => {
    expect(interactiveCardNeedsRender(open("a1", [choice("q1", "Which one?", 2)]), open("a1", [choice("q1", "Which one?", 2)]))).toBe(false);
  });

  it("re-renders for a new dialog, even one declaring exactly the same card", () => {
    expect(interactiveCardNeedsRender(open("a1", [choice("q1", "Which one?", 2)]), open("a2", [choice("q1", "Which one?", 2)]))).toBe(true);
  });

  it("re-renders when a field's label or options change", () => {
    expect(interactiveCardNeedsRender(open("a1", [choice("q1", "A")]), open("a1", [choice("q1", "B")]))).toBe(true);
    expect(interactiveCardNeedsRender(open("a1", [choice("q1", "A", 1)]), open("a1", [choice("q1", "A", 2)]))).toBe(true);
  });

  it("re-renders when the card appears or goes away", () => {
    expect(interactiveCardNeedsRender(undefined, open("a1", []))).toBe(true);
    expect(interactiveCardNeedsRender(open("a1", []), undefined)).toBe(true);
  });
});

describe("dialogCardNeedsRender", () => {
  const dialog = (over: Partial<PendingExtensionDialog> = {}): PendingExtensionDialog => ({
    dialogId: "d1",
    kind: "select",
    title: "Update now?",
    options: ["Yes", "No"],
    askedAt: "2026-09-30T00:00:00.000Z",
    runScoped: false,
    ...over,
  });

  it("does not re-render for the same dialog arriving again", () => {
    expect(dialogCardNeedsRender(dialog(), dialog())).toBe(false);
  });

  it("re-renders when the question, its choices or its deadline change", () => {
    expect(dialogCardNeedsRender(dialog(), dialog({ title: "Update later?" }))).toBe(true);
    expect(dialogCardNeedsRender(dialog(), dialog({ options: ["Yes"] }))).toBe(true);
    expect(dialogCardNeedsRender(dialog(), dialog({ timeoutAt: "2026-09-18T00:00:00.000Z" }))).toBe(true);
  });

  it("re-renders when a terminal screen redraws or a declared card changes", () => {
    const screen = dialog({ kind: "custom", options: [], lines: ["probe", "▸ first", "  second"] });
    expect(dialogCardNeedsRender(screen, { ...screen, lines: ["probe", "  first", "▸ second"] })).toBe(true);
    expect(dialogCardNeedsRender(screen, { ...screen, screen: { kind: "card", fields: [choice("q", "Pick")] } })).toBe(true);
  });

  it("re-renders when the card appears or goes away", () => {
    expect(dialogCardNeedsRender(undefined, dialog())).toBe(true);
    expect(dialogCardNeedsRender(dialog(), undefined)).toBe(true);
  });
});
