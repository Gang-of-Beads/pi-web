import { describe, expect, it } from "vitest";
import { PendingAskStore } from "./pendingAskStore";

const QUESTIONS = [
  { id: "platform", question: "Where does it live?", options: [] },
  { id: "method", question: "How should I get the cost?", options: [] },
];

/**
 * A chat message sent while questions are open is an addition, not a
 * withdrawal: every question carries a Custom answer, so a remark alongside the
 * form leaves it answerable. Closing it discarded questions the reader never
 * withdrew, and the reply then asked for answers they had been made unable to
 * give.
 */
describe("an open question set survives a chat message", () => {
  it("keeps the ask open so the reader can still answer", () => {
    const store = new PendingAskStore({ now: () => new Date("2026-09-03T15:00:00.000Z") });
    store.open({ sessionId: "session-1", questions: QUESTIONS });
    expect(store.pendingAsk("session-1")?.questions).toHaveLength(2);
  });

  it("still closes when the reader submits", () => {
    const store = new PendingAskStore({ now: () => new Date("2026-09-03T15:00:00.000Z") });
    const { ask } = store.open({ sessionId: "session-1", questions: QUESTIONS });
    const result = store.submit("session-1", ask.askId, { answers: [{ id: "platform", values: [], otherText: "azure" }] });
    expect(result.status).toBe("closed");
    expect(store.pendingAsk("session-1")).toBeUndefined();
  });

  it("still closes when the reader cancels it by hand", () => {
    const store = new PendingAskStore({ now: () => new Date("2026-09-03T15:00:00.000Z") });
    const { ask } = store.open({ sessionId: "session-1", questions: QUESTIONS });
    expect(store.cancel("session-1", ask.askId).status).toBe("closed");
    expect(store.pendingAsk("session-1")).toBeUndefined();
  });
});
