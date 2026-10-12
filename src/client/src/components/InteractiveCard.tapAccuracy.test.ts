// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { CardField, CardOption } from "../../../shared/interactiveCard";
import type { OpenCard } from "../cardIdentity";
import { InteractiveCard } from "./InteractiveCard";

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

function cardStyleText(card: InteractiveCard): string {
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




async function mount(questions: CardField[]): Promise<InteractiveCard> {
  const card = new InteractiveCard();
  card.open = openCard(questions);
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
    expect(sized).toContain("var(--pi-control-height-touch)");
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
    const style = cardStyleText(card);
    // Every .option already carries a 1px transparent border, so a computed
    // read of borderTopStyle is true with the divider deleted; the contract is
    // the drawn declaration itself.
    const otherRule = /\.other-option\s*\{[^}]*\}/.exec(style)?.[0] ?? "";
    // happy-dom serializes the shorthand into longhands (mangling the var
    // into each), so the trace of a declared top border is border-top-width.
    expect(otherRule).toContain("border-top-width:");
    expect(otherRule).toContain("padding-top:");
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

interface QuestionSettings { detail?: string; multiple?: boolean; custom?: boolean; customInput?: "field" }

function openCard(fields: CardField[]): OpenCard {
  return { dialogId: "ask-1", card: { kind: "card", fields } };
}

/** A choice field as a question once was: a Custom choice unless it takes no typed answer; no options is a typed field. */
function question(id: string, text: string, options: CardOption[], settings: QuestionSettings = {}): CardField {
  if (options.length === 0) return { type: "input", id, label: text, multiline: true, ...(settings.detail === undefined ? {} : { detail: settings.detail }) };
  const other = settings.custom === false ? undefined : settings.customInput === "field" ? "field" : "choice";
  return {
    type: "choice",
    id,
    label: text,
    options,
    ...(settings.detail === undefined ? {} : { detail: settings.detail }),
    ...(settings.multiple === true ? { multiple: true as const } : {}),
    ...(other === undefined ? {} : { other }),
  };
}

function option(value: string, label: string, extra: Partial<CardOption> = {}): CardOption {
  return { value, label, ...extra };
}
