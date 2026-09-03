import { describe, expect, it } from "vitest";
import { subagentRunStatusExplanation, subagentRunStatusLabel } from "./subagentRunStatusLabel.js";
import type { SessionSubagentRunInfo } from "../../shared/apiTypes";

const ALL: SessionSubagentRunInfo["status"][] = ["running", "done", "failed", "lost", "unknown"];

describe("subagent run status", () => {
  it("labels a run that has not reported by what is true of it", () => {
    expect(subagentRunStatusLabel("unknown")).toBe("No report yet");
  });

  it("separates a lost run from one that has simply not reported", () => {
    expect(subagentRunStatusLabel("lost")).not.toBe(subagentRunStatusLabel("unknown"));
    expect(subagentRunStatusExplanation("lost")).not.toBe(subagentRunStatusExplanation("unknown"));
  });

  it("gives every status a label", () => {
    for (const status of ALL) expect(subagentRunStatusLabel(status)).not.toBe("");
  });

  it("gives every status an explanation", () => {
    for (const status of ALL) expect(subagentRunStatusExplanation(status)).not.toBe("");
  });

  it("gives every status a distinct label", () => {
    expect(new Set(ALL.map(subagentRunStatusLabel)).size).toBe(ALL.length);
  });
});
