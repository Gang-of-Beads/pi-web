import { describe, expect, it } from "vitest";
import { shouldPollSessionActivity } from "./sessionActivityPolling";

describe("shouldPollSessionActivity", () => {
  // The regression this guards: a subagent started inside the session already
  // on screen never appeared, because activity was only fetched on select.
  it("polls while a session is on screen", () => {
    expect(shouldPollSessionActivity({ hasSelectedSession: true, documentVisible: true })).toBe(true);
  });

  it("stops with the tab and with the session", () => {
    expect(shouldPollSessionActivity({ hasSelectedSession: true, documentVisible: false })).toBe(false);
    expect(shouldPollSessionActivity({ hasSelectedSession: false, documentVisible: true })).toBe(false);
  });
});
