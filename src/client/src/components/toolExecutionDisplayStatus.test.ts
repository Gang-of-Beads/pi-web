import { describe, expect, it } from "vitest";
import { toolExecutionDisplayStatus, ToolExecutionStatus } from "./shared";

describe("toolExecutionDisplayStatus", () => {
  it("keeps a pending call pending while the turn streams", () => {
    expect(toolExecutionDisplayStatus(ToolExecutionStatus.Pending, true)).toBe(ToolExecutionStatus.Pending);
  });

  it("calls a pending call interrupted once nothing is streaming", () => {
    expect(toolExecutionDisplayStatus(ToolExecutionStatus.Pending, false)).toBe("interrupted");
  });

  it("leaves a successful call alone whether or not the turn streams", () => {
    expect(toolExecutionDisplayStatus(ToolExecutionStatus.Success, false)).toBe(ToolExecutionStatus.Success);
    expect(toolExecutionDisplayStatus(ToolExecutionStatus.Success, true)).toBe(ToolExecutionStatus.Success);
  });

  it("leaves an errored call alone whether or not the turn streams", () => {
    expect(toolExecutionDisplayStatus(ToolExecutionStatus.Error, false)).toBe(ToolExecutionStatus.Error);
    expect(toolExecutionDisplayStatus(ToolExecutionStatus.Error, true)).toBe(ToolExecutionStatus.Error);
  });
});
