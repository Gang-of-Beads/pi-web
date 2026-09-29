import { describe, expect, it } from "vitest";
import { declaredScreen, refusedDeclarationSummary } from "./declaredScreen.js";

const question = { id: "q1", question: "Which?", options: [{ value: "a", label: "A", detail: "first" }, { value: "b", label: "B" }] };

describe("declaredScreen", () => {
  it("reads questions, keeping only the fields the Questions card draws", () => {
    expect(declaredScreen({ kind: "questions", title: "Goal", questions: [{ ...question, multiple: true, custom: false, extra: 1 }] })).toEqual({
      kind: "questions",
      title: "Goal",
      questions: [{ ...question, multiple: true, custom: false }],
    });
  });

  it("lets a question's detail carry a whole proposal", () => {
    expect(declaredScreen({ kind: "questions", questions: [{ ...question, detail: "x".repeat(8_000) }] })?.questions[0]?.detail).toHaveLength(8_000);
  });

  it.each([
    ["no declaration", undefined],
    ["another kind", { kind: "menu", options: ["a"] }],
    ["no questions", { kind: "questions", questions: [] }],
    ["duplicate question ids", { kind: "questions", questions: [question, question] }],
    ["duplicate option values", { kind: "questions", questions: [{ ...question, options: [{ value: "a", label: "A" }, { value: "a", label: "B" }] }] }],
    ["a blank label", { kind: "questions", questions: [{ ...question, options: [{ value: "a", label: " " }] }] }],
    ["a junk question", { kind: "questions", questions: [question, "q2"] }],
    ["an oversized detail", { kind: "questions", questions: [{ ...question, detail: "x".repeat(8_001) }] }],
    ["a question that can be answered neither by option nor by text", { kind: "questions", questions: [{ ...question, options: [], custom: false }] }],
  ])("reads %s as undeclared, so the drawn screen stands", (_name, value) => {
    expect(declaredScreen(value)).toBeUndefined();
  });

  it("summarizes a refused declaration for the log", () => {
    expect(refusedDeclarationSummary({ kind: "questions", questions: [{ ...question, detail: "x".repeat(8_001) }, "q2"] })).toBe("kind questions, 2 questions: 2 options, detail 8001; junk");
  });
});
