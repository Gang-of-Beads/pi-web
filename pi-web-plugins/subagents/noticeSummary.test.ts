import { describe, expect, it } from "vitest";
import { noticeSummary } from "./noticeSummary";

describe("noticeSummary", () => {
  it("names the kind of notice", () => {
    expect(noticeSummary("subagent-notify", {}).title).toBe("Subagent finished");
    expect(noticeSummary("subagent_control_notice", {}).title).toBe("Subagent control");
  });

  it("falls back to a plain title for a tag it does not know", () => {
    expect(noticeSummary("subagent-something-new", {}).title).toBe("Subagent message");
  });

  it("says which run it came from when the frame carries one", () => {
    expect(noticeSummary("subagent-notify", { agent: "reviewer", status: "completed", runId: "r1" }).detail)
      .toBe("reviewer · completed · run r1");
  });

  it("says nothing rather than inventing a detail", () => {
    expect(noticeSummary("subagent-notify", undefined).detail).toBeUndefined();
  });
});
