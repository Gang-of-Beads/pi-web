import { describe, expect, it } from "vitest";
import { readInteractiveCard } from "./interactiveCardReader.js";
import { refusedDeclarationSummary } from "../server/daemon/sessions/declaredScreen.js";

const choice = { type: "choice", id: "q1", label: "Which?", options: [{ value: "a", label: "A", detail: "first" }, { value: "b", label: "B" }] };

describe("readInteractiveCard", () => {
  it("reads a card, keeping only what the card draws", () => {
    expect(readInteractiveCard({ kind: "card", title: "Goal", fields: [{ ...choice, multiple: true, other: "field", extra: 1 }] })).toEqual({
      kind: "card",
      title: "Goal",
      fields: [{ ...choice, multiple: true, other: "field" }],
    });
  });

  it("lets a field's detail carry a whole proposal, far past the 8000-character prose bound", () => {
    const card = readInteractiveCard({ kind: "card", fields: [{ ...choice, detail: "x".repeat(32_000) }] });
    expect(card?.fields[0]?.type === "choice" ? card.fields[0].detail : undefined).toHaveLength(32_000);
  });

  it.each([
    ["no declaration", undefined],
    ["another kind", { kind: "menu", options: ["a"] }],
    ["no fields", { kind: "card", fields: [] }],
    ["duplicate field ids", { kind: "card", fields: [choice, choice] }],
    ["duplicate option values", { kind: "card", fields: [{ ...choice, options: [{ value: "a", label: "A" }, { value: "a", label: "B" }] }] }],
    ["a blank label", { kind: "card", fields: [{ ...choice, options: [{ value: "a", label: " " }] }] }],
    ["a junk field", { kind: "card", fields: [choice, "q2"] }],
    ["an oversized detail", { kind: "card", fields: [{ ...choice, detail: "x".repeat(32_001) }] }],
    ["a choice without options", { kind: "card", fields: [{ ...choice, options: [] }] }],
  ])("reads %s as undeclared, so the drawn screen stands", (_name, value) => {
    expect(readInteractiveCard(value)).toBeUndefined();
  });

  it("summarizes a refused declaration for the log", () => {
    expect(refusedDeclarationSummary({ kind: "card", fields: [{ ...choice, detail: "x".repeat(32_001) }, "q2"] })).toBe("kind card, 2 fields: choice with 2 options; junk");
  });
});
