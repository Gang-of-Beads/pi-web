// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { retryBlocked } from "./PromptEditor";

describe("retryBlocked", () => {
  it("names why a row's Retry cannot start, so the button never does nothing silently", () => {
    expect(retryBlocked(false, false, true)).toBe("offline");
    expect(retryBlocked(true, true, true)).toBe("busy");
    expect(retryBlocked(true, false, false)).toBe("gone");
  });

  it("lets the replay start only online, idle and with the message still held", () => {
    expect(retryBlocked(true, false, true)).toBeUndefined();
  });
});
