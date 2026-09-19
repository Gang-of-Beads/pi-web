import { describe, expect, it } from "vitest";
import { askCardNeedsRender, dialogCardNeedsRender } from "./askCardIdentity";

const ask = (id: string, questions: { id: string; question: string; options?: unknown[] }[]) => ({ id, questions });

describe("askCardNeedsRender", () => {
  it("does not re-render for a fresh object carrying the same question", () => {
    const first = ask("a1", [{ id: "q1", question: "Which one?", options: [1, 2] }]);
    const second = ask("a1", [{ id: "q1", question: "Which one?", options: [1, 2] }]);
    expect(askCardNeedsRender(first, second)).toBe(false);
  });

  it("re-renders when the ask itself changes", () => {
    expect(askCardNeedsRender(ask("a1", []), ask("a2", []))).toBe(true);
  });

  it("re-renders when a question's text or options change", () => {
    expect(askCardNeedsRender(ask("a1", [{ id: "q1", question: "A" }]), ask("a1", [{ id: "q1", question: "B" }]))).toBe(true);
    expect(askCardNeedsRender(ask("a1", [{ id: "q1", question: "A", options: [1] }]), ask("a1", [{ id: "q1", question: "A", options: [1, 2] }]))).toBe(true);
  });

  it("re-renders when the card appears or goes away", () => {
    expect(askCardNeedsRender(undefined, ask("a1", []))).toBe(true);
    expect(askCardNeedsRender(ask("a1", []), undefined)).toBe(true);
  });
});

describe("dialogCardNeedsRender", () => {
  const dialog = (over: Record<string, unknown> = {}) => ({ dialogId: "d1", kind: "confirm", title: "Update now?", options: ["Yes", "No"], ...over });

  it("does not re-render for the same dialog arriving again", () => {
    expect(dialogCardNeedsRender(dialog(), dialog())).toBe(false);
  });

  it("re-renders when the question, its choices or its deadline change", () => {
    expect(dialogCardNeedsRender(dialog(), dialog({ title: "Update later?" }))).toBe(true);
    expect(dialogCardNeedsRender(dialog(), dialog({ options: ["Yes"] }))).toBe(true);
    expect(dialogCardNeedsRender(dialog(), dialog({ expiresAt: "2026-09-18T00:00:00.000Z" }))).toBe(true);
  });

  it("re-renders when the card appears or goes away", () => {
    expect(dialogCardNeedsRender(undefined, dialog())).toBe(true);
    expect(dialogCardNeedsRender(dialog(), undefined)).toBe(true);
  });
});
