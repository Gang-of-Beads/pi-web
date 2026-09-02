// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { AskUserOutcome } from "../../../shared/apiTypes";
import { AskUserCard } from "./AskUserCard";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
});

describe("ChatView open ask_user form", () => {
  it("puts a newly opened form last in the transcript, where scrolling to the bottom reaches it", async () => {
    const view = new ChatView();
    view.sessionId = "session-1";
    document.body.append(view);
    await view.updateComplete;
    let askStartScrolls = 0;
    if (!Reflect.set(view, "scrollToOpenAsk", () => { askStartScrolls += 1; })) throw new Error("Could not observe ChatView.scrollToOpenAsk");
    let bottomScrolls = 0;
    if (!Reflect.set(view, "scrollToBottom", () => { bottomScrolls += 1; })) throw new Error("Could not observe ChatView.scrollToBottom");

    view.pendingAsk = {
      askId: "ask-open",
      askedAt: "2026-07-20T10:00:00.000Z",
      questions: [{ id: "editor", question: "Which editor?", options: [{ value: "vim", label: "Vim" }] }],
    };
    await view.updateComplete;

    // The form is a transcript row, drawn after everything settled, so no
    // special scroll is needed to reveal it: following the tail already does,
    // and a reader who scrolled up reaches it by scrolling back down.
    expect(askStartScrolls).toBe(0);
    expect(bottomScrolls).toBeLessThanOrEqual(1);
    expect(view.shadowRoot?.querySelector(".chat ask-user-card")).not.toBeNull();
    const chat = view.shadowRoot?.querySelector(".chat");
    const rows = [...(chat?.children ?? [])];
    expect(rows.findIndex((row) => row.classList.contains("waiting-slot"))).toBe(rows.length - 1);
  });
});

describe("ChatView ask_user transcript records", () => {
  it("renders a projected outcome as the read-only question card with the machine-scoped draft key", async () => {
    const outcome: AskUserOutcome = {
      askId: "ask-1",
      reason: "submitted",
      askedAt: "2026-07-20T10:00:00.000Z",
      closedAt: "2026-07-20T10:05:00.000Z",
      questions: [
        {
          question: { id: "editor", question: "Which editor?", options: [{ value: "vim", label: "Vim" }] },
          answered: true,
          values: ["vim"],
        },
        {
          question: { id: "region", question: "Which region?", options: [{ value: "eu", label: "Europe" }] },
          answered: false,
          values: [],
        },
      ],
      answeredCount: 1,
      unansweredIds: ["region"],
      summary: "Answered 1 of 2; unanswered: region",
    };
    const view = new ChatView();
    view.sessionId = "session-1";
    view.askDraftSessionId = "remote-a:session-1";
    view.messages = [{ role: "system", parts: [{ type: "askUserRecord", outcome }] }];
    document.body.append(view);
    await view.updateComplete;

    const card = requiredElement(view.shadowRoot?.querySelector("ask-user-card"), "ask_user record card");
    expect(card).toBeInstanceOf(AskUserCard);
    expect(card.outcome).toEqual(outcome);
    expect(card.ask).toBeUndefined();
    expect(card.draftSessionId).toBe("remote-a:session-1");
    await card.updateComplete;

    const cardRoot = requiredElement(card.shadowRoot, "ask_user record shadow root");
    expect(cardRoot.textContent).toContain("Answers sent");
    expect(cardRoot.textContent).toContain("Vim");
    expect(cardRoot.textContent).toContain("Which region?");
    expect(cardRoot.textContent).toContain("Unanswered");
    expect(cardRoot.querySelector("input, textarea, button, select")).toBeNull();
    expect(view.shadowRoot?.querySelector("article.ask-user-record-shell .msg-header")).toBeNull();
  });
});

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
