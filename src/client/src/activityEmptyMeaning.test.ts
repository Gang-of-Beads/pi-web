import { describe, expect, it } from "vitest";
import { activityEmptyMeaning } from "./activityEmptyMeaning.js";

describe("what an empty activity list is allowed to claim", () => {
  it("does not claim the session is idle while the agent is working", () => {
    const meaning = activityEmptyMeaning({ isStreaming: true, isBashRunning: false });
    expect(meaning.kind).toBe("session-busy-elsewhere");
    expect(meaning.text).toContain("The agent is working");
  });

  it("does not claim the session is idle while a command runs", () => {
    const meaning = activityEmptyMeaning({ isStreaming: false, isBashRunning: true });
    expect(meaning.kind).toBe("session-busy-elsewhere");
    expect(meaning.text).toContain("A command is running");
  });

  it("says nothing is tracked only when the session is genuinely quiet", () => {
    expect(activityEmptyMeaning({ isStreaming: false, isBashRunning: false }).kind).toBe("nothing-tracked");
  });

  it("names the two things it actually knows about in every case", () => {
    const cases = [
      { isStreaming: true, isBashRunning: false },
      { isStreaming: false, isBashRunning: true },
      { isStreaming: false, isBashRunning: false },
    ];
    for (const input of cases) expect(activityEmptyMeaning(input).text).toContain("agent runs or tasks");
  });

  it("never says the bare present-tense claim the owner photographed", () => {
    const cases = [
      { isStreaming: true, isBashRunning: false },
      { isStreaming: false, isBashRunning: true },
      { isStreaming: false, isBashRunning: false },
    ];
    for (const input of cases) expect(activityEmptyMeaning(input).text).not.toBe("Nothing running right now.");
  });
});
