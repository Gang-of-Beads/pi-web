import { describe, expect, it } from "vitest";
import { pendingPromptActions } from "./pendingPromptActions";

describe("pendingPromptActions", () => {
  it("offers only a withdrawal while the message is on its way", () => {
    expect(pendingPromptActions({ sending: true })).toEqual({ state: "sending", label: "Sending", retry: false, discard: true });
  });

  it("offers a retry once the send has stopped", () => {
    expect(pendingPromptActions({ sending: false })).toEqual({ state: "unsent", label: "Unsent", retry: true, discard: true });
  });
});
