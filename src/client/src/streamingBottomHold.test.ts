import { describe, expect, it } from "vitest";
import { streamingBottomHold, type StreamingBottomHoldInput } from "./streamingBottomHold";

const base: StreamingBottomHoldInput = {
  sessionLive: true,
  pinnedToBottom: true,
  userScrolling: false,
  distanceFromBottom: 0,
};

describe("holding the bottom while an answer streams", () => {
  it("pulls the bottom back when growth above pushed it away", () => {
    expect(streamingBottomHold({ ...base, distanceFromBottom: 120 })).toBe("hold-bottom");
  });

  it("ignores the sub-pixel slack fractional scales leave behind", () => {
    expect(streamingBottomHold({ ...base, distanceFromBottom: 1 })).toBe("leave-alone");
  });

  it("stops watching once the turn is over", () => {
    expect(streamingBottomHold({ ...base, sessionLive: false, distanceFromBottom: 400 })).toBe("stop-watching");
  });

  it("stops watching a reader who scrolled away", () => {
    expect(streamingBottomHold({ ...base, pinnedToBottom: false, distanceFromBottom: 400 })).toBe("stop-watching");
  });

  it("never fights a gesture in flight", () => {
    expect(streamingBottomHold({ ...base, userScrolling: true, distanceFromBottom: 400 })).toBe("leave-alone");
  });

  it("answers every state it can be asked about", () => {
    const answers = new Set<string>();
    for (const sessionLive of [true, false]) {
      for (const pinnedToBottom of [true, false]) {
        for (const userScrolling of [true, false]) {
          for (const distanceFromBottom of [0, 500]) {
            answers.add(streamingBottomHold({ sessionLive, pinnedToBottom, userScrolling, distanceFromBottom }));
          }
        }
      }
    }
    expect([...answers].sort()).toEqual(["hold-bottom", "leave-alone", "stop-watching"]);
  });
});
