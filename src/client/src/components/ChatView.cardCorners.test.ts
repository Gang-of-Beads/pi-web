// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import "./ChatView";
import { ChatView } from "./ChatView";

/**
 * Five reports of broken card corners, one invariant: the card is the only
 * owner of its corner geometry. Every failed fix had a sticky child replicate
 * the card's curve, and one buried the radius in a shell token consumed by
 * bundle CSS. The parent clips; sticky children paint square; no corner
 * geometry lives in a second file. The review of the first fix found the
 * contract's own holes - first-match regexes that a later cascade override
 * slips past, and the shell file unguarded - so every rule occurrence is
 * checked and the shell is read from disk.
 */
function chatStyleText(): string {
  const styles: unknown = ChatView.styles;
  const list: unknown[] = Array.isArray(styles) ? styles : [styles];
  return list.map((sheet) => {
    if (typeof sheet === "object" && sheet !== null && "cssText" in sheet && typeof sheet.cssText === "string") return sheet.cssText;
    return "";
  }).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
}

function everyRule(selectorPattern: string): string[] {
  const pattern = new RegExp(`${selectorPattern}\\s*\\{[^}]*\\}`, "g");
  return chatStyleText().match(pattern) ?? [];
}

describe("message card corners have one owner", () => {
  it("clips children at the card border, and no card-family rule may undo it", () => {
    // The review defeated the first version with a compound-selector override
    // (.msg.user { overflow: visible }): filtering to rules that START with
    // .msg { left every sibling selector free to break the clip. Any rule
    // whose selector mentions .msg is held to it now, comma lists included.
    const cardFamily = everyRule("[^{}]*\\.msg(?![\\w-])[^{]*");
    const base = cardFamily.filter((rule) => /(^|,)\s*\.msg\s*\{/.test(rule));
    expect(base.length).toBeGreaterThan(0);
    expect(base.some((rule) => rule.includes("overflow: clip"))).toBe(true);
    for (const rule of cardFamily) {
      expect(rule).not.toMatch(/overflow: (visible|auto|scroll)/);
    }
  });

  it("degrades to hidden where clip is not parsed, so old browsers still clip", () => {
    const cardRules = everyRule("\\.msg").filter((rule) => rule.startsWith(".msg {"));
    expect(cardRules.some((rule) => rule.includes("overflow: hidden; overflow: clip"))).toBe(true);
  });

  it("keeps every sticky child of a card square - no replicated curve anywhere", () => {
    const stickyInCard = everyRule("\\.msg(?![\\w-])[^{,]*").filter((rule) => rule.includes("position: sticky"));
    expect(stickyInCard.length).toBeGreaterThan(0);
    for (const rule of stickyInCard) {
      expect(rule).not.toContain("border-radius");
    }
  });

  it("references no corner geometry outside this component", () => {
    expect(chatStyleText()).not.toContain("--pi-card-inner-radius");
    const shell = readFileSync(join(process.cwd(), "src/client/index.html"), "utf-8");
    expect(shell).not.toContain("--pi-card-inner-radius");
  });
});
