import { describe, expect, it, vi } from "vitest";
import { watchablePath } from "./watchPath";

describe("watchablePath", () => {
  it("watches the resolved spelling of the directory", () => {
    expect(watchablePath("C:\\Users\\RUNNER~1\\Temp", () => "C:\\Users\\runneradmin\\Temp")).toBe("C:\\Users\\runneradmin\\Temp");
  });

  it("hands back a path it cannot resolve, so the watch fails as an ordinary error", () => {
    const resolve = vi.fn(() => { throw new Error("ENOENT"); });
    expect(watchablePath("/gone", resolve)).toBe("/gone");
  });
});
