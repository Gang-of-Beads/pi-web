import { describe, expect, it } from "vitest";
import { pendingPromptActions, type PendingPromptState } from "./pendingPromptActions";

/**
 * Owner report: "已经确认开始处理的消息，还怎么还可能有 retry/discard 呢？有些状态
 * 就不可能一起存在". A message on its way cannot be re-sent, and a message the
 * daemon confirmed is no longer an outbox row at all.
 */
describe("what an undelivered prompt offers", () => {
  it("offers only a withdrawal while the message is on its way", () => {
    expect(pendingPromptActions("in-flight")).toEqual({ state: "in-flight", label: "Sending", retry: false, discard: true });
  });

  it("offers a retry once the send has stopped", () => {
    expect(pendingPromptActions("unsent")).toEqual({ state: "unsent", label: "Unsent", retry: true, discard: true });
  });

  it("never offers a retry for a message that is still going", () => {
    expect(pendingPromptActions("in-flight").retry).toBe(false);
    expect(pendingPromptActions("unsent").retry).toBe(true);
  });

  it("answers every state it can be asked about", () => {
    const states: PendingPromptState[] = ["in-flight", "unsent"];
    for (const state of states) {
      const actions = pendingPromptActions(state);
      expect(actions.state).toBe(state);
      expect(actions.label).not.toBe("");
    }
  });
});
