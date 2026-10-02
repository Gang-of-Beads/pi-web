// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { AskUserOutcome, SessionStatus } from "../../../shared/apiTypes";
import type { ChatLine } from "./shared";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
});

const outcome: AskUserOutcome = {
  askId: "ask-1",
  reason: "submitted",
  askedAt: "2026-10-02T10:00:00.000Z",
  closedAt: "2026-10-02T10:00:05.000Z",
  questions: [{ question: { id: "db", question: "Which database?", options: [{ value: "pg", label: "Postgres" }] }, answered: true, values: ["pg"] }],
  answeredCount: 1,
  unansweredIds: [],
  summary: "Answered 1 of 1",
};

function status(queuedAnswers: AskUserOutcome[] | undefined): SessionStatus {
  return {
    sessionId: "s",
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    ...(queuedAnswers === undefined ? {} : { queuedAnswers }),
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

async function mount(messages: ChatLine[], queuedAnswers: AskUserOutcome[] | undefined): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "s";
  view.messages = messages;
  view.status = status(queuedAnswers);
  document.body.append(view);
  await view.updateComplete;
  return view;
}

const records = (view: ChatView) => [...(view.shadowRoot?.querySelectorAll("article.ask-user-record-shell") ?? [])].map((row) => ({
  queued: row.querySelector(".delivery-mark")?.textContent.includes("Queued") === true,
}));

/**
 * An answer vanished with its card and came back only once the agent read it, 23 s later in the
 * audit (B26, state-diagram D2 "An answer is a message").
 */
describe("ChatView: an answer the agent has not read yet", () => {
  it("shows the answers record marked Queued from the moment it is given", async () => {
    const view = await mount([{ role: "user", parts: [{ type: "text", text: "set it up" }] }], [outcome]);

    expect(records(view)).toEqual([{ queued: true }]);
  });

  it("shows it once, unmarked, when the agent has read it", async () => {
    const view = await mount([{ role: "system", parts: [{ type: "askUserRecord", outcome }] }], [outcome]);

    expect(records(view)).toEqual([{ queued: false }]);
  });
});
