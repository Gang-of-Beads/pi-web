// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardField, CardOption } from "../../../shared/interactiveCard";
import type { OpenCard } from "../cardIdentity";
import { InteractiveCard, type InteractiveCardSubmitCallback } from "./InteractiveCard";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("interactive-card live form", () => {
  it("uses native labelled groups and updates progress for a keyboard-focusable single select", async () => {
    const card = await mountOpenCard(openCard([
      question("editor", "Choose an editor", [option("vim", "Vim"), option("code", "VS Code")], { detail: "Used for examples." }),
      question("platforms", "Target platforms", [option("web", "Web"), option("desktop", "Desktop")], { multiple: true }),
    ]));
    const root = renderRoot(card);
    expect(card).toBeInstanceOf(HTMLElement);
    expect(customElements.get("interactive-card")).toBe(InteractiveCard);
    const fieldsets = root.querySelectorAll("fieldset");
    const legends = root.querySelectorAll("legend");
    const vim = inputWithValue(root, "vim");
    const code = inputWithValue(root, "code");

    // One question is on screen at a time, so this step holds one fieldset.
    expect(fieldsets).toHaveLength(1);
    expect(legends[0]?.textContent).toContain("Choose an editor");
    expect(fieldsets[0]?.getAttribute("aria-describedby")).toBe("card-field-detail-0");
    expect(root.querySelector("#card-field-detail-0")?.textContent).toBe("Used for examples.");
    expect(vim.type).toBe("radio");
    expect(code.name).toBe(vim.name);
    expect(root.querySelector("[aria-live='polite']")?.textContent).toContain("1 of 2");

    // Focus and interaction run through the rendered native control rather than
    // extracting Lit handlers, so this exercises the form's browser boundary.
    vim.focus();
    expect(root.activeElement).toBe(vim);
    vim.click();
    await card.updateComplete;

    expect(vim.checked).toBe(true);
    expect(code.checked).toBe(false);
    expect(root.querySelector("[aria-live='polite']")?.textContent).toContain("1 answered");

    // The next question's controls are native too, on their own step. Lit
    // reuses nodes across renders, so the element must be looked up again
    // rather than compared against a reference captured on the last step.
    const vimName = vim.name;
    buttonWithText(root, "Next").click();
    await card.updateComplete;
    const web = inputWithValue(root, "web");
    expect(web.type).toBe("checkbox");
    expect(web.name).not.toBe(vimName);
  });

  it("accumulates several checkbox values for a multi-select question", async () => {
    const onSubmit = vi.fn<InteractiveCardSubmitCallback>();
    const card = await mountOpenCard(openCard([
      question("platforms", "Target platforms", [option("web", "Web"), option("desktop", "Desktop")], { multiple: true }),
    ]), onSubmit);
    const root = renderRoot(card);

    inputWithValue(root, "web").click();
    inputWithValue(root, "desktop").click();
    await card.updateComplete;

    expect(root.querySelector("[aria-live='polite']")?.textContent).toContain("1 of 1 answered");
    buttonWithText(root, "Send").click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith({ values: { platforms: { selected: ["web","desktop"] } } });
  });

  it("always offers and focuses a labelled custom field while preserving multi-select options", async () => {
    const onSubmit = vi.fn<InteractiveCardSubmitCallback>();
    const card = await mountOpenCard(openCard([
      question("stack", "Pick the stack", [option("lit", "Lit"), option("react", "React")], { multiple: true }),
    ]), onSubmit);
    const root = renderRoot(card);

    inputWithValue(root, "lit").click();
    inputWithValue(root, "__pi_web_other__").click();
    await card.updateComplete;
    await Promise.resolve();

    const textarea = requiredElement(root.querySelector("textarea"), "custom textarea");
    const label = requiredElement(textarea.closest("label"), "custom label");
    expect(label.textContent).toContain("Custom answer");
    expect(getComputedStyle(textarea).fontSize).toBe("16px");
    expect(root.activeElement).toBe(textarea);

    textarea.value = "Svelte";
    textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await card.updateComplete;
    buttonWithText(root, "Send").click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith({ values: { stack: { selected: ["lit"], other: "Svelte" } } });
  });

  it("shows and submits a typed field directly, labelled by the field", async () => {
    const onSubmit = vi.fn<InteractiveCardSubmitCallback>();
    const card = await mountOpenCard(openCard([
      question("notes", "Anything else?", []),
    ]), onSubmit);
    const root = renderRoot(card);
    const textarea = requiredElement(root.querySelector("textarea"), "custom textarea");

    expect(root.querySelector("input")).toBeNull();
    expect(textarea.getAttribute("aria-label")).toBe("Anything else?");
    textarea.value = "Keep the first version small.";
    textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await card.updateComplete;
    buttonWithText(root, "Send").click();
    await Promise.resolve();

    expect(onSubmit).toHaveBeenCalledWith({ values: { notes: { text: "Keep the first version small." } } });
  });

  it("grows the custom textarea with the answer when field-sizing is unavailable", async () => {
    const card = await mountOpenCard(openCard([
      question("notes", "Anything else?", []),
    ]));
    const root = renderRoot(card);
    const textarea = requiredElement(root.querySelector("textarea"), "custom textarea");

    // Safari < 18.4 has no CSS field-sizing, so a long answer on a phone
    // would stay trapped behind the three-line slot unless the input handler
    // sizes the box to its content itself.
    vi.stubGlobal("CSS", { supports: () => false });
    try {
      Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 240 });
      textarea.value = "A long answer that would wrap onto several lines in a narrow phone viewport.";
      textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    } finally {
      vi.unstubAllGlobals();
    }
    await card.updateComplete;
    expect(textarea.style.height).toBe("240px");

    // Where field-sizing exists, the handler delegates to CSS instead of
    // fighting it with an inline height.
    vi.stubGlobal("CSS", { supports: () => true });
    textarea.style.height = "";
    textarea.value = "Even longer.";
    textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    expect(textarea.style.height).toBe("");
    vi.unstubAllGlobals();
  });

  it("names unanswered questions before allowing a partial submit", async () => {
    const onSubmit = vi.fn<InteractiveCardSubmitCallback>();
    const card = await mountOpenCard(openCard([
      question("editor", "Choose an editor", [option("vim", "Vim")]),
      question("deploy", "Choose a deployment target", [option("cloud", "Cloud")]),
      question("notes", "Add implementation notes", []),
    ]), onSubmit);
    const root = renderRoot(card);

    inputWithValue(root, "vim").click();
    await card.updateComplete;
    // Submit lives on the last step, so the two later questions are left
    // unanswered by walking past them rather than by ignoring them in place.
    buttonWithText(root, "Next").click();
    await card.updateComplete;
    buttonWithText(root, "Next").click();
    await card.updateComplete;
    buttonWithText(root, "Send").click();
    await card.updateComplete;
    await Promise.resolve();

    const confirmation = requiredElement(root.querySelector("[aria-label='Confirm partial answers']"), "partial confirmation");
    expect(confirmation.textContent).toContain("Send without answering:");
    expect(confirmation.textContent).toContain("Choose a deployment target");
    expect(confirmation.textContent).toContain("Add implementation notes");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(root.activeElement).toBe(buttonWithText(root, "Send anyway"));

    buttonWithText(root, "Send anyway").click();
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith({ values: { editor: { selected: ["vim"] } } });
  });
});

async function mountOpenCard(ask: OpenCard, onSubmit?: InteractiveCardSubmitCallback): Promise<InteractiveCard> {
  const card = new InteractiveCard();
  card.open = ask;
  card.draftSessionId = "local:session-1";
  if (onSubmit !== undefined) card.onSubmit = onSubmit;
  document.body.append(card);
  await card.updateComplete;
  return card;
}

function renderRoot(card: InteractiveCard): ShadowRoot {
  return requiredElement(card.shadowRoot, "interactive-card shadow root");
}

function inputWithValue(root: ShadowRoot, value: string): HTMLInputElement {
  const input = [...root.querySelectorAll("input")].find((candidate) => candidate.value === value);
  return requiredElement(input, `input with value ${value}`);
}

function buttonWithText(root: ShadowRoot, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === text);
  return requiredElement(button, `button named ${text}`);
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}




describe("the step footer", () => {
  /**
   * The footer used to stick to the bottom of the viewport so the submit
   * control stayed in reach. Everything earlier in the flow then scrolled
   * underneath it: an option or a custom answer box could show its top edge
   * above the footer and its bottom edge below, with no scroll position that
   * showed it whole.
   */
  it("does not float over the options it sits below", () => {
    // Scroll margin was tried here first. It only moves programmatic scrolling,
    // so the reader's own scrolling still parked an option behind the footer.
    const rule = /\.form-footer\s*\{([^}]*)\}/u.exec(String(InteractiveCard.styles))?.[1] ?? "";

    expect(rule).not.toMatch(/position:\s*sticky/u);
  });

  /**
   * "Back" and "Next" are both steps through the same list. Letting one take
   * every spare pixel while the other shrinks to its text read as two
   * different kinds of control.
   */
  it("does not let the forward step swallow the row", () => {
    const sheet = String(InteractiveCard.styles);
    const primary = /\.step-actions\s+\.primary-action\s*\{([^}]*)\}/u.exec(sheet)?.[1] ?? "";

    expect(primary).not.toMatch(/flex:\s*1 1 auto/u);
  });
});

describe("where the step buttons sit", () => {
  /**
   * On the first question there is no Back, and the row packs from the left,
   * so Next sat alone at the left edge - in the spot Back occupies on every
   * later question. The advancing action keeps to the right; the left is
   * Back's whether Back is there or not.
   */
  it("pins the advancing button to the right even when Back is absent", () => {
    const sheet = String(InteractiveCard.styles);
    const rule = /\.step-actions \.primary-action\s*\{([^}]*)\}/u.exec(sheet)?.[1] ?? "";

    expect(rule).toMatch(/margin-left:\s*auto/u);
  });
});

describe("interactive-card geometry", () => {
  // The concern this replaces is real and unchanged: a tall question must not
  // put the submit control out of a thumb's reach. It was answered by capping
  // the questions and scrolling them inside the card, which moved the problem
  // rather than solving it - when the cap was smaller than the card wanted,
  // the footer went off screen and the page would not scroll to it either,
  // because the scrolling was internal. The card is a transcript row now: the
  // transcript is the scroller, the card may be any height, and scrolling down
  // reaches the footer. Nothing inside the card floats, so nothing covers the
  // options.
  it("does not trap the questions in a scroller of their own", async () => {
    const card = await mountOpenCard(openCard([
      question("geom", "Pick one", [option("a", "A", { detail: "long".repeat(60) }), option("b", "B", { detail: "long".repeat(60) }), option("c", "C", { detail: "long".repeat(60) })], { detail: "Long detail text".repeat(40) }),
    ]));

    const questions = card.shadowRoot?.querySelector<HTMLElement>(".fields");
    if (questions === null || questions === undefined) throw new Error("Expected the questions area");
    // happy-dom returns "" for a property no rule sets, so both the unset and
    // the explicit "none" spellings mean the same thing here: no cap.
    const style = getComputedStyle(questions);
    expect(style.overflowY).not.toBe("auto");
    expect(["", "none"]).toContain(style.maxHeight);
  });

  it("keeps the submit control in the card, reachable by scrolling the transcript", async () => {
    const card = await mountOpenCard(openCard([
      question("geom", "Pick one", [option("a", "A"), option("b", "B")]),
    ]));

    const footer = card.shadowRoot?.querySelector<HTMLElement>(".form-footer");
    expect(footer).toBeDefined();
    expect(footer?.querySelector("button") ?? null).not.toBeNull();
  });

  it("does not float the footer over the card's own options", async () => {
    const card = await mountOpenCard(openCard([
      question("geom", "Pick one", [option("a", "A"), option("b", "B")]),
    ]));

    const footer = card.shadowRoot?.querySelector<HTMLElement>(".form-footer");
    if (footer === null || footer === undefined) throw new Error("Expected the footer");
    const position = getComputedStyle(footer).position;
    expect(position).not.toBe("sticky");
    expect(position).not.toBe("fixed");
  });
});

describe("a new question set", () => {
  it("opens on its first question, not on the step the previous set was left at", async () => {
    const card = await mountOpenCard(openCard([question("a", "First?", [option("x", "X")]), question("b", "Second?", [option("y", "Y")])]));
    buttonWithText(renderRoot(card), "Next").click();
    await card.updateComplete;
    card.open = { ...openCard([question("c", "Third?", [option("z", "Z")]), question("d", "Fourth?", [option("w", "W")])]), dialogId: "ask-2" };
    await card.updateComplete;

    expect(renderRoot(card).querySelector("legend")?.textContent).toContain("Third?");
  });

  it("starts clean even when it asks exactly what the previous set asked", async () => {
    const questions = [question("a", "First?", [option("x", "X")]), question("b", "Second?", [option("y", "Y")])];
    const card = await mountOpenCard(openCard(questions));
    inputWithValue(renderRoot(card), "x").click();
    buttonWithText(renderRoot(card), "Next").click();
    await card.updateComplete;
    card.open = { ...openCard(questions), dialogId: "ask-2" };
    await card.updateComplete;

    expect(renderRoot(card).querySelector("legend")?.textContent).toContain("First?");
    expect(inputWithValue(renderRoot(card), "x").checked).toBe(false);
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
