import { describe, expect, it } from "vitest";
import type { AskUserOutcome } from "../../shared/apiTypes";
import type { ChatLine } from "./components/shared";
import { isQueuedAnswer, withQueuedAnswers } from "./queuedAnswerRows";

const outcome = (askId: string, closedAt: string): AskUserOutcome => ({
  askId,
  reason: "submitted",
  askedAt: "2026-10-02T10:00:00.000Z",
  closedAt,
  questions: [],
  answeredCount: 0,
  unansweredIds: [],
  summary: "Answered 0 of 0",
});
const sent = (text: string, timestamp?: string): ChatLine => ({ role: "user", parts: [{ type: "text", text }], ...(timestamp === undefined ? {} : { meta: { timestamp } }) });
const labels = (rows: readonly ChatLine[]): string[] => rows.map((row) => {
  const part = row.parts[0];
  if (part?.type === "askUserRecord") return `${isQueuedAnswer(row) ? "queued " : ""}${part.outcome.askId}`;
  return part?.type === "text" ? part.text : "?";
});

describe("answers the agent has not read yet, among the pending rows (B26)", () => {
  it("adds nothing when no answer waits", () => {
    expect(labels(withQueuedAnswers([sent("a")], undefined, []))).toEqual(["a"]);
  });

  it("places an answer by when it was given, before messages sent after it", () => {
    const pending = [sent("before", "2026-10-02T10:00:01.000Z"), sent("after", "2026-10-02T10:00:09.000Z")];

    expect(labels(withQueuedAnswers(pending, [outcome("ask-1", "2026-10-02T10:00:05.000Z")], []))).toEqual(["before", "queued ask-1", "after"]);
  });

  it("puts an answer last when no pending message is known to be later", () => {
    expect(labels(withQueuedAnswers([sent("from the server queue")], [outcome("ask-1", "2026-10-02T10:00:05.000Z")], []))).toEqual(["from the server queue", "queued ask-1"]);
  });

  it("draws an answer the transcript already holds there, not twice", () => {
    const committed: ChatLine = { role: "system", parts: [{ type: "askUserRecord", outcome: outcome("ask-1", "2026-10-02T10:00:05.000Z") }] };

    expect(labels(withQueuedAnswers([], [outcome("ask-1", "2026-10-02T10:00:05.000Z")], [committed]))).toEqual([]);
  });

  it("keeps several answers in the order they were given", () => {
    const answers = [outcome("ask-1", "2026-10-02T10:00:05.000Z"), outcome("ask-2", "2026-10-02T10:00:06.000Z")];

    expect(labels(withQueuedAnswers([], answers, []))).toEqual(["queued ask-1", "queued ask-2"]);
  });
});
