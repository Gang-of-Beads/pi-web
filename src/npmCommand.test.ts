import { describe, expect, it } from "vitest";
import { npmCommand } from "./npmCommand";

describe("npmCommand", () => {
  it("uses the Windows shim where there is no shell to find it", () => {
    expect(npmCommand("win32")).toBe("npm.cmd");
  });

  it("uses the plain name everywhere else", () => {
    expect(npmCommand("darwin")).toBe("npm");
    expect(npmCommand("linux")).toBe("npm");
  });
});
