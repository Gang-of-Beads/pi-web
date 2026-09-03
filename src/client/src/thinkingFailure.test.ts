import { describe, expect, it } from "vitest";
import { describeAssistantFailure, isUnreplayableThinkingFailure } from "./chatMessages";

const REAL = '400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.51.content.1: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response."}}';

describe("a branch that can no longer be replayed says so", () => {
  it("recognises the provider's refusal of a thinking block", () => {
    expect(isUnreplayableThinkingFailure(REAL)).toBe(true);
  });

  it("explains that every retry on this branch fails the same way", () => {
    const text = describeAssistantFailure(REAL, undefined);
    expect(text).toContain("interrupted while the model was thinking");
    expect(text).toContain("every retry on this branch fails the same way");
  });

  it("keeps the provider's own words", () => {
    expect(describeAssistantFailure(REAL, undefined)).toContain("cannot be modified");
  });

  it("does not claim it for an unrelated failure", () => {
    expect(isUnreplayableThinkingFailure("400 rate limit exceeded")).toBe(false);
    expect(describeAssistantFailure("400 rate limit exceeded", undefined)).toBe("400 rate limit exceeded");
  });

  it("does not claim it for a merely aborted turn", () => {
    expect(isUnreplayableThinkingFailure("request aborted")).toBe(false);
    expect(describeAssistantFailure("request aborted", undefined)).toContain("stopped before it finished");
  });

  it("does not claim it when thinking is only mentioned", () => {
    expect(isUnreplayableThinkingFailure("the model was thinking for a long time")).toBe(false);
  });
});
