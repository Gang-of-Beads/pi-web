// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskUserQuestion, PendingAskUser } from "../api";
import { AskUserCard } from "./AskUserCard";

afterEach(() => { document.body.replaceChildren(); });

/**
 * The card laid every question out at once. On a phone that made it taller
 * than the screen, and the answer field a user was typing into sat below the
 * virtual keyboard: the only way to read your own answer was to dismiss the
 * keyboard, scroll, and open it again to keep editing.
 *
 * One question at a time keeps each step short enough that the field stays
 * above the keyboard, and turns a long form into a sequence with an obvious
 * end.
 */
describe("the question card asks one question at a time", () => {
  it("shows only the current question", async () => {
    const card = await mount(ask([question("q1", "First"), question("q2", "Second")]));

    expect(text(card)).toContain("First");
    expect(text(card)).not.toContain("Second");
  });

  it("says where you are in the set", async () => {
    const card = await mount(ask([question("q1", "First"), question("q2", "Second")]));

    expect(text(card)).toMatch(/1\s*(of|\/)\s*2/u);
  });

  it("moves forward and back without losing an answer", async () => {
    const card = await mount(ask([question("q1", "First"), question("q2", "Second")]));

    answerCurrent(card, "first answer");
    await click(card, "Next");
    expect(text(card)).toContain("Second");

    await click(card, "Back");
    expect(text(card)).toContain("First");
    expect(currentField(card).value).toBe("first answer");
  });

  it("offers Back only after the first question", async () => {
    const card = await mount(ask([question("q1", "First"), question("q2", "Second")]));

    expect(buttonNames(card)).not.toContain("Back");
    await click(card, "Next");
    expect(buttonNames(card)).toContain("Back");
  });

  it("ends with submit rather than another step", async () => {
    const card = await mount(ask([question("q1", "First"), question("q2", "Second")]));

    await click(card, "Next");
    expect(buttonNames(card)).toContain("Send answers");
    expect(buttonNames(card)).not.toContain("Next");
  });

  it("submits every answer collected across the steps", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const card = await mount(ask([question("q1", "First"), question("q2", "Second")]), onSubmit);

    answerCurrent(card, "one");
    await click(card, "Next");
    answerCurrent(card, "two");
    await click(card, "Send answers");

    expect(onSubmit).toHaveBeenCalledOnce();
    // The callback takes (askId, submission); the answers are the second one.
    const submitted: unknown = onSubmit.mock.calls[0]?.[1];
    expect(JSON.stringify(submitted)).toContain("one");
    expect(JSON.stringify(submitted)).toContain("two");
  });

  /**
   * Lit reuses DOM nodes across renders of the same template shape, so the
   * radio the reader ticked on one step is literally the same element as the
   * radio for the next question. Element identity has to follow the question,
   * or a tick made on one step shows up pre-made on the next.
   */
  it("does not carry a chosen option over to the next question", async () => {
    const card = await mount(ask([
      choice("q1", "First", ["a", "b"]),
      choice("q2", "Second", ["c", "d"]),
    ]));

    const first = card.shadowRoot?.querySelector<HTMLInputElement>("input[type='radio']");
    first?.click();
    await card.updateComplete;
    await click(card, "Next");

    const checked = [...card.shadowRoot?.querySelectorAll<HTMLInputElement>("input[type='radio']") ?? []]
      .filter((input) => input.checked);
    expect(checked).toHaveLength(0);
  });

  it("keeps a single question on one step with no navigation", async () => {
    const card = await mount(ask([question("q1", "Only")]));

    expect(buttonNames(card)).toContain("Send answers");
    expect(buttonNames(card)).not.toContain("Next");
    expect(buttonNames(card)).not.toContain("Back");
  });
});

function text(card: AskUserCard): string {
  return card.shadowRoot?.textContent ?? "";
}

function buttonNames(card: AskUserCard): string[] {
  return [...card.shadowRoot?.querySelectorAll("button") ?? []].map((b) => b.textContent.trim());
}

function currentField(card: AskUserCard): HTMLInputElement | HTMLTextAreaElement {
  const field = card.shadowRoot?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input[type='text'], textarea");
  if (field === null || field === undefined) throw new Error("Expected an answer field");
  return field;
}

function answerCurrent(card: AskUserCard, value: string): void {
  const field = currentField(card);
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

async function click(card: AskUserCard, name: string): Promise<void> {
  const button = [...card.shadowRoot?.querySelectorAll("button") ?? []]
    .find((b) => b.textContent.trim() === name);
  if (button === undefined) throw new Error(`Expected a ${name} button, saw ${buttonNames(card).join(", ")}`);
  button.click();
  await card.updateComplete;
}

async function mount(pending: PendingAskUser, onSubmit?: AskUserCard["onSubmit"]): Promise<AskUserCard> {
  const card = new AskUserCard();
  card.ask = pending;
  card.draftSessionId = "local:session-1";
  if (onSubmit !== undefined) card.onSubmit = onSubmit;
  document.body.append(card);
  await card.updateComplete;
  return card;
}

function ask(questions: AskUserQuestion[]): PendingAskUser {
  return { askId: "ask-1", askedAt: "2026-08-26T10:00:00.000Z", questions };
}

function question(id: string, prompt: string): AskUserQuestion {
  return { id, question: prompt, options: [] };
}

function choice(id: string, prompt: string, values: string[]): AskUserQuestion {
  return { id, question: prompt, options: values.map((v) => ({ value: v, label: v.toUpperCase() })) };
}
