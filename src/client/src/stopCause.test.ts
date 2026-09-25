import { afterEach, describe, expect, it } from "vitest";
import { forgetStopCause, noteStopCause, recentStopCause, stopCauseSuffix } from "./stopCause";

/**
 * Owner report: "看不出来是interrupted还是什么问题" - an aborted turn read as
 * "Request was aborted" plus an account footer, with nothing saying who stopped
 * it. The cause is recorded when the stop happens and read when the row is
 * built, a moment later.
 */
afterEach(() => { forgetStopCause(); });

describe("naming who stopped a turn", () => {
  it("remembers a stop for the failure that follows", () => {
    noteStopCause("you", 1_000);

    expect(recentStopCause(3_000)).toBe("you");
  });

  it("forgets one that is older than the failure it belongs to", () => {
    noteStopCause("another-device", 1_000);

    expect(recentStopCause(1_000 + 61_000)).toBeUndefined();
  });

  it("says nothing when no stop was recorded", () => {
    expect(recentStopCause(5_000)).toBeUndefined();
    expect(stopCauseSuffix(undefined)).toBeUndefined();
  });

  it("words each cause as the reader sees it", () => {
    expect(stopCauseSuffix("you")).toBe("you stopped it");
    expect(stopCauseSuffix("another-device")).toBe("stopped from another device");
    expect(stopCauseSuffix("reload")).toBe("the session was reloaded");
    expect(stopCauseSuffix("closed")).toBe("the session was closed");
  });
});
