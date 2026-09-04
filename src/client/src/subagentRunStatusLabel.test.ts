import { describe, expect, it } from "vitest";
import { subagentRunStatusExplanation, subagentRunStatusLabel } from "./subagentRunStatusLabel.js";
import type { SessionSubagentRunInfo } from "../../shared/apiTypes";

const ALL: SessionSubagentRunInfo["status"][] = ["running", "done", "failed", "lost", "unknown"];

describe("subagent run status", () => {
  it("labels a run that has not reported by what is true of it", () => {
    expect(subagentRunStatusLabel("unknown")).toBe("Running");
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

  it("gives every settled status a distinct label; the two live states share one word by ruling", () => {
    // Owner ruling 2026-09-04: a run that started but has written nothing is
    // shown as Running, not "No report yet" - the pill read as a problem. The
    // distinction survives in the explanations, which stay all-distinct.
    const labels = ALL.map(subagentRunStatusLabel);
    expect(new Set(labels).size).toBe(ALL.length - 1);
    expect(subagentRunStatusLabel("unknown")).toBe(subagentRunStatusLabel("running"));
    expect(new Set(ALL.map(subagentRunStatusExplanation)).size).toBe(ALL.length);
  });
});
