import { describe, expect, it } from "vitest";
import { toolExecutionDisplayStatus, ToolExecutionStatus } from "./shared";

describe("toolExecutionDisplayStatus", () => {
  it("shows a pending call as running while the turn streams", () => {
    expect(toolExecutionDisplayStatus(ToolExecutionStatus.Pending, true)).toBe(ToolExecutionStatus.Running);
  });

  it("calls a pending call interrupted once nothing is streaming", () => {
    expect(toolExecutionDisplayStatus(ToolExecutionStatus.Pending, false)).toBe("interrupted");
  });

  it("never displays a status the reader reads as not started", () => {
    const displayed = [true, false].flatMap((streaming) => Object.values(ToolExecutionStatus).map((status) => toolExecutionDisplayStatus(status, streaming)));
    expect(displayed).not.toContain("pending");
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
