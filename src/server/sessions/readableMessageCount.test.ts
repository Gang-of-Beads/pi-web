import { describe, expect, it } from "vitest";

import { readableMessageCount } from "./readableMessageCount";

describe("how many messages a session is said to have", () => {
  /**
   * The list counted every line in the session file and the transcript counted
   * what it could show, both calling the result "messages": one live session
   * was described as 14451 messages in the sidebar and "of 14397" above the
   * conversation.
   */
  it("counts what a reader can actually open", () => {
    const branch = [
      { type: "message", message: { role: "user", content: "hello" } },
      { type: "thinking_level_change", level: "high" },
      { type: "message", message: { role: "assistant", content: "hi" } },
      { type: "summary", text: "compacted" },
    ];

    expect(readableMessageCount(branch)).toBe(2);
  });

  it("counts nothing in an empty session", () => {
    expect(readableMessageCount([])).toBe(0);
  });
});
