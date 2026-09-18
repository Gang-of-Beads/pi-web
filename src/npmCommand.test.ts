import { describe, expect, it } from "vitest";
import { npmInvocation } from "./npmCommand";

describe("npmInvocation", () => {
  it("uses the Windows shim through a shell, which is the only way Node will run a .cmd", () => {
    expect(npmInvocation("win32")).toEqual({ command: "npm.cmd", shell: true });
  });

  it("uses the plain name without a shell everywhere else", () => {
    expect(npmInvocation("darwin")).toEqual({ command: "npm", shell: false });
    expect(npmInvocation("linux")).toEqual({ command: "npm", shell: false });
  });
});
