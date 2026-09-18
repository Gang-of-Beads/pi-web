import { describe, expect, it } from "vitest";
import { toolTargetPlacement } from "./toolTargetPlacement";

describe("toolTargetPlacement", () => {
  it("keeps a one-line target beside the tool name", () => {
    expect(toolTargetPlacement("npm test")).toBe("inline");
    expect(toolTargetPlacement(undefined)).toBe("inline");
  });

  it("ignores a trailing newline, which is not a second line", () => {
    expect(toolTargetPlacement("npm test\n")).toBe("inline");
  });

  it("drops a multi-line target onto its own row", () => {
    expect(toolTargetPlacement("cd repo\nnpm test")).toBe("block");
  });
});
