import { describe, expect, it } from "vitest";
import { parseSessionStatus } from "./parsers";
describe("the count of background runs a finished turn left behind", () => {
  /**
   * The server counts them and sends them; the list colours a session by them.
   * But this parser builds its result field by field, so a field it does not
   * name is dropped in silence - and this one was never named. The session row
   * saw undefined every time and showed the grey dot that means nothing is
   * happening, while the conversation itself said "idle · 3 background runs".
   *
   * This is the second feature lost to that same silence; the first was speech
   * input, which could not be enabled from the day it shipped.
   */
  it("keeps the count the server sent", () => {
    const status = parseSessionStatus({
      sessionId: "s1",
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      pendingMessageCount: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
      seq: 1,
      backgroundRunCount: 3,
    });

    expect(status.backgroundRunCount).toBe(3);
  });

  it("leaves it absent when the server did not send one", () => {
    const status = parseSessionStatus({
      sessionId: "s1",
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      pendingMessageCount: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
      seq: 1,
    });

    expect(status.backgroundRunCount).toBeUndefined();
  });
});
