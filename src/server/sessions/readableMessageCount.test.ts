import { describe, expect, it } from "vitest";

import { isReadableMessageEntry, readableMessageCount } from "./readableMessageCount";

/**
 * The shape `historyMessages` (piSessionService) walks to build the transcript.
 * Kept here so the count and the transcript are checked against one fixture:
 * they disagreed twice, both times because each was written from its own idea
 * of what a message is.
 */
const BRANCH = [
  { type: "message", message: { role: "user", content: "hello" } },
  { type: "thinking_level_change", level: "high" },
  { type: "message", message: { role: "assistant", content: "hi" } },
  { type: "custom_message", customType: "pi-goal-event", content: "<marker/>", display: false },
  { type: "custom_message", customType: "pi-goal-banner", content: "goal: ship it", display: true },
  { type: "summary", text: "compacted" },
  { type: "model_change", model: "claude-opus-5" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** What the transcript builder pushes, from the same branch. */
function renderedEntries(branch: readonly unknown[]): unknown[] {
  const rendered: unknown[] = [];
  for (const entry of branch) {
    if (!isRecord(entry)) continue;
    if (entry["type"] === "message") rendered.push(entry["message"]);
    else if (entry["type"] === "custom_message" && entry["display"] === true) rendered.push({ role: "custom" });
  }
  return rendered;
}

describe("how many messages a session is said to have", () => {
  /**
   * The list counted every line in the session file and the transcript counted
   * what it could show, both calling the result "messages": one live session
   * was described as 14451 messages in the sidebar and "of 14397" above the
   * conversation.
   */
  it("counts what a reader can actually open", () => {
    expect(readableMessageCount([
      { type: "message", message: { role: "user", content: "hello" } },
      { type: "thinking_level_change", level: "high" },
      { type: "message", message: { role: "assistant", content: "hi" } },
      { type: "summary", text: "compacted" },
    ])).toBe(2);
  });

  it("counts nothing in an empty session", () => {
    expect(readableMessageCount([])).toBe(0);
  });

  /**
   * The second disagreement. Excluding bookkeeping was right and not enough:
   * an extension's displayed message is drawn in the transcript, so leaving it
   * out put the sidebar exactly that many behind. Measured live at 14235
   * against 14414, a gap of 179 - the displayed custom entries on that branch.
   */
  it("counts an extension's message when the transcript shows it", () => {
    expect(readableMessageCount(BRANCH)).toBe(3);
  });

  it("still ignores the one the extension hid", () => {
    const hidden = BRANCH.filter((entry) => entry.type === "custom_message" && entry.display === false);

    expect(hidden).toHaveLength(1);
    expect(readableMessageCount(hidden)).toBe(0);
  });

  /**
   * The invariant the two surfaces kept breaking: the sidebar's number and the
   * transcript's length are the same number, because they are the same set.
   */
  it("agrees with what the transcript builds from the same branch", () => {
    expect(readableMessageCount(BRANCH)).toBe(renderedEntries(BRANCH).length);
  });

  it("decides membership through one predicate", () => {
    expect(isReadableMessageEntry({ type: "message" })).toBe(true);
    expect(isReadableMessageEntry({ type: "custom_message", display: true })).toBe(true);
    expect(isReadableMessageEntry({ type: "custom_message", display: false })).toBe(false);
    expect(isReadableMessageEntry({ type: "thinking_level_change" })).toBe(false);
    expect(isReadableMessageEntry(null)).toBe(false);
    expect(isReadableMessageEntry("message")).toBe(false);
  });
});
