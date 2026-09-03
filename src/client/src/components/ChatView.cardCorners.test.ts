// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import "./ChatView";
import { ChatView } from "./ChatView";

/**
 * Five reports of broken card corners, one invariant: the card is the only
 * owner of its corner geometry. Every failed fix had the header replicate the
 * card's curve - an inner-radius token in the app shell coordinated with
 * component CSS in the bundle, so a stale cached shell (the phone's PWA)
 * dropped the token and squared the header. The parent clips; children paint
 * square; nothing about the corner lives in a second file.
 */
function chatStyleText(): string {
  const styles: unknown = ChatView.styles;
  const list: unknown[] = Array.isArray(styles) ? styles : [styles];
  return list.map((sheet) => {
    if (typeof sheet === "object" && sheet !== null && "cssText" in sheet && typeof sheet.cssText === "string") return sheet.cssText;
    return "";
  }).join("\n");
}

describe("message card corners have one owner", () => {
  it("clips children at the card border instead of trusting them", () => {
    const msgRule = /\.msg\s*\{[^}]*\}/.exec(chatStyleText())?.[0] ?? "";
    expect(msgRule).toContain("overflow: clip");
  });

  it("keeps the sticky header square, with no replicated curve", () => {
    const style = chatStyleText();
    const headerRule = /\.msg > \.msg-header\s*\{[^}]*\}/.exec(style)?.[0] ?? "";
    expect(headerRule).not.toBe("");
    expect(headerRule).toContain("position: sticky");
    expect(headerRule).not.toContain("border-radius");
  });

  it("references no corner geometry outside this component", () => {
    expect(chatStyleText()).not.toContain("--pi-card-inner-radius");
  });
});
