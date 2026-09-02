// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { AskUserCard } from "./AskUserCard";

/**
 * The submit row has to be tappable, whatever the question's length.
 *
 * It was kept on screen by giving the card a height budget and scrolling the
 * questions inside it. When the budget was smaller than the card wanted - a
 * phone, a tall question, a raised keyboard - the footer was pushed out of the
 * viewport instead, and because the scrolling happened inside the card the
 * page would not move either: the reader could neither reach the buttons nor
 * scroll to them. The owner reported exactly that, twice.
 *
 * The card is a transcript row now, so length is free: the transcript scrolls
 * to the buttons. The footer stays in normal flow for the reason the extension
 * dialog already records - a footer held at the viewport bottom covers the
 * card's own rows, and in a question those rows are the options.
 */

function cardCss(): string {
  const styles = AskUserCard.styles;
  const sheets = Array.isArray(styles) ? styles : [styles];
  return sheets.map((sheet) => String(sheet)).join("\n");
}

function rule(name: string): string {
  const match = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`, "u").exec(cardCss());
  return match?.[1] ?? "";
}

describe("the submit row stays reachable", () => {
  it("reads from normal flow, so it covers none of the card's own options", () => {
    const actions = rule("form-footer");

    expect(actions).not.toContain("position: sticky");
    expect(actions).not.toContain("position: fixed");
  });

  it("does not trap the questions in a scroller of their own", () => {
    expect(rule("ask-form")).not.toContain("overflow-y: auto");
  });

  it("does not cap the card's height", () => {
    expect(rule("card")).not.toContain("max-height");
  });
});
