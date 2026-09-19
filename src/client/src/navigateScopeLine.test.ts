import { describe, expect, it } from "vitest";
import { navigateScopeLine } from "./navigateScopeLine";

describe("navigateScopeLine", () => {
  it("says which project the list is narrowed to, and offers the widening", () => {
    expect(navigateScopeLine({ machineName: "hxd-work-mbp", projectName: "pi-web" }))
      .toEqual({ label: "Sessions in pi-web", widen: { label: "All on hxd-work-mbp" } });
  });

  it("says the whole machine is listed, with nothing to widen", () => {
    expect(navigateScopeLine({ machineName: "hxd-work-mbp", projectName: undefined }))
      .toEqual({ label: "All sessions on hxd-work-mbp", widen: undefined });
  });

  it("names an unknown machine rather than leaving the reach blank", () => {
    expect(navigateScopeLine({ machineName: undefined, projectName: undefined }).label).toBe("All sessions on this machine");
    expect(navigateScopeLine({ machineName: undefined, projectName: "pi-web" }).widen?.label).toBe("All on this machine");
  });
});
