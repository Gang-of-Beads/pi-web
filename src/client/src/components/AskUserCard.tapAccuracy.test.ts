// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { AskUserQuestion, PendingAskUser } from "../../../shared/apiTypes";
import { AskUserCard } from "./AskUserCard";

/**
 * The owner's phone delivered option taps to the Custom row often enough to be
 * the normal case. Two causes: the card moved under a resting finger while the
 * transcript streamed (fixed by the waiting slot being a real layout row), and
 * rows small enough that a few pixels of thumb drift landed in the adjacent
 * row - Custom sits directly under the last option. This pins the geometry
 * contract so drift has distance to cross, and pins that a tap maps 1:1 to the
 * row pressed.
 */

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

function cardStyleText(card: AskUserCard): string {
  const sheets = card.shadowRoot?.adoptedStyleSheets ?? [];
  const text = sheets.map((sheet) => {
    const rules = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
    return rules;
  }).join("\n");
  if (text !== "") return text;
  // happy-dom may not expose adopted sheet rules; fall back to the source of
  // truth the component ships with.
  return card.constructor.toString();
}

function openAsk(questions: AskUserQuestion[]): PendingAskUser {
  return { askId: "ask-1", askedAt: "2026-07-20T10:00:00.000Z", questions };
}

function question(id: string, text: string, options: AskUserQuestion["options"]): AskUserQuestion {
  return { id, question: text, options };
}

function option(value: string, label: string): AskUserQuestion["options"][number] {
  return { value, label };
}

async function mount(questions: AskUserQuestion[]): Promise<AskUserCard> {
  const card = new AskUserCard();
  card.ask = openAsk(questions);
  card.draftSessionId = "local:session-1";
  document.body.append(card);
  await card.updateComplete;
  return card;
}

describe("ask option hit targets", () => {
  it("meets the coarse-pointer floor on every option row", async () => {
    const card = await mount([question("editor", "Choose an editor", [option("vim", "Vim"), option("code", "VS Code")])]);
    const style = cardStyleText(card);
    const optionRules = style.match(/[^{}]*\.option[^{}]*\{[^}]*\}/g) ?? [];
    if (optionRules.length === 0) throw new Error("no .option rules in the card stylesheet");
    const sized = optionRules.find((rule) => rule.includes("min-height"));
    if (sized === undefined) throw new Error("no .option rule sets a min-height");
    expect(sized).toContain("44px");
  });

  it("keeps the tap-delay and zoom heuristics off the option labels", async () => {
    const card = await mount([question("editor", "Choose an editor", [option("vim", "Vim")])]);
    expect(cardStyleText(card)).toMatch(/touch-action: manipulation/);
    const label = card.shadowRoot?.querySelector<HTMLElement>(".option");
    if (label === null || label === undefined) throw new Error("no option rendered");
    // The label, not the radio dot, is what a thumb actually hits.
    expect(getComputedStyle(label).touchAction).toBe("manipulation");
  });

  it("separates Custom from the last real option", async () => {
    const card = await mount([question("editor", "Choose an editor", [option("vim", "Vim"), option("code", "VS Code")])]);
    const other = card.shadowRoot?.querySelector<HTMLElement>(".other-option");
    if (other === null || other === undefined) throw new Error("no Custom option rendered");
    const style = getComputedStyle(other);
    // A drawn divider, not just spacing: spacing is invisible at tap speed.
    expect(style.borderTopStyle).toBe("solid");
    expect(parseInt(style.paddingTop, 10)).toBeGreaterThan(7);
  });

  it("delivers a tap to exactly the row pressed", async () => {
    const card = await mount([question("editor", "Choose an editor", [option("vim", "Vim"), option("code", "VS Code")])]);
    const root = card.shadowRoot;
    if (root === null) throw new Error("no shadow root");
    const vim = [...root.querySelectorAll<HTMLInputElement>("input")].find((input) => input.value === "vim");
    const custom = [...root.querySelectorAll<HTMLInputElement>("input")].find((input) => input.value === "__pi_web_other__");
    if (vim === undefined || custom === undefined) throw new Error("options did not render");
    vim.click();
    await card.updateComplete;
    expect(vim.checked).toBe(true);
    expect(custom.checked).toBe(false);
    const code = [...root.querySelectorAll<HTMLInputElement>("input")].find((input) => input.value === "code");
    if (code === undefined) throw new Error("second option did not render");
    code.click();
    await card.updateComplete;
    expect(code.checked).toBe(true);
    expect(custom.checked).toBe(false);
  });
});
