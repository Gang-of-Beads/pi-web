import { describe, expect, it } from "vitest";
import type { AskUserQuestion, PendingAskUser, PendingExtensionDialog } from "../../shared/apiTypes";
import { askCardNeedsRender, dialogCardNeedsRender } from "./askCardIdentity";

/** Built from the wire types: an untyped `{ id }` here hid that the ask carries `askId`. */
const question = (id: string, text: string, options = 0): AskUserQuestion => ({
  id,
  question: text,
  options: Array.from({ length: options }, (_, index) => ({ value: String(index), label: String(index) })),
});
const ask = (askId: string, questions: AskUserQuestion[]): PendingAskUser => ({ askId, askedAt: "2026-09-30T00:00:00.000Z", questions });

describe("askCardNeedsRender", () => {
  it("does not re-render for a fresh object carrying the same question", () => {
    expect(askCardNeedsRender(ask("a1", [question("q1", "Which one?", 2)]), ask("a1", [question("q1", "Which one?", 2)]))).toBe(false);
  });

  it("re-renders for a new ask, even one asking exactly the same questions", () => {
    expect(askCardNeedsRender(ask("a1", [question("q1", "Which one?", 2)]), ask("a2", [question("q1", "Which one?", 2)]))).toBe(true);
  });

  it("re-renders when a question's text or options change", () => {
    expect(askCardNeedsRender(ask("a1", [question("q1", "A")]), ask("a1", [question("q1", "B")]))).toBe(true);
    expect(askCardNeedsRender(ask("a1", [question("q1", "A", 1)]), ask("a1", [question("q1", "A", 2)]))).toBe(true);
  });

  it("re-renders when the card appears or goes away", () => {
    expect(askCardNeedsRender(undefined, ask("a1", []))).toBe(true);
    expect(askCardNeedsRender(ask("a1", []), undefined)).toBe(true);
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

  it("re-renders when the card appears or goes away", () => {
    expect(dialogCardNeedsRender(undefined, dialog())).toBe(true);
    expect(dialogCardNeedsRender(dialog(), undefined)).toBe(true);
  });
});
