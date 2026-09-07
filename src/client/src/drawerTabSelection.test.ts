import { describe, expect, it } from "vitest";
import { selectedDrawerTab, type DrawerTabAvailability } from "./drawerTabSelection";

function availability(patch: Partial<DrawerTabAvailability> = {}): DrawerTabAvailability {
  return { sections: [], withContent: [], ...patch };
}

describe("which drawer section is showing", () => {
  it("keeps the section the reader chose", () => {
    expect(selectedDrawerTab(availability({ sections: ["goals:goals"] }), "goals:goals")).toBe("goals:goals");
    expect(selectedDrawerTab(availability({ sections: ["goals:goals", "terminal:terminal"] }), "terminal:terminal")).toBe("terminal:terminal");
  });

  it("keeps a chosen section even after its contents empty", () => {
    const chosen = selectedDrawerTab(availability({ sections: ["goals:goals"], withContent: [] }), "goals:goals");

    expect(chosen).toBe("goals:goals");
  });

  it("does not keep a section this machine does not have", () => {
    expect(selectedDrawerTab(availability({ sections: ["terminal:terminal"] }), "goals:goals")).toBe("terminal:terminal");
  });

  it("falls to a section with something in it when nothing was chosen", () => {
    expect(selectedDrawerTab(availability({ sections: ["goals:goals"], withContent: ["goals:goals"] }), undefined)).toBe("goals:goals");
  });

  it("prefers a section with content over one that is empty", () => {
    expect(selectedDrawerTab(availability({ sections: ["terminal:terminal", "goals:goals"], withContent: ["goals:goals"] }), undefined)).toBe("goals:goals");
  });

  it("lands on the first section even when nothing has content", () => {
    expect(selectedDrawerTab(availability({ sections: ["goals:goals", "terminal:terminal"] }), undefined)).toBe("goals:goals");
  });

  it("renders nothing when no section exists", () => {
    expect(selectedDrawerTab(availability(), undefined)).toBeUndefined();
  });
});
