import { describe, expect, it } from "vitest";
import { selectedDrawerTab, type DrawerTabAvailability } from "./drawerTabSelection";

function availability(patch: Partial<DrawerTabAvailability> = {}): DrawerTabAvailability {
  return { activity: false, notifications: false, sections: [], withContent: [], ...patch };
}

describe("which drawer tab is showing", () => {
  it("keeps the tab the reader chose", () => {
    expect(selectedDrawerTab(availability({ notifications: true }), "activity")).toBe("activity");
    expect(selectedDrawerTab(availability({ activity: true }), "notifications")).toBe("notifications");
  });

  it("keeps a chosen section even after its contents empty", () => {
    const chosen = selectedDrawerTab(availability({ activity: true, sections: ["goals:goals"], withContent: [] }), "goals:goals");

    expect(chosen).toBe("goals:goals");
  });

  it("does not keep a section this machine does not have", () => {
    expect(selectedDrawerTab(availability({ activity: true }), "goals:goals")).toBe("activity");
  });

  it("prefers work in flight over a section that changes slowly", () => {
    expect(selectedDrawerTab(availability({ notifications: true, activity: true, sections: ["goals:goals"], withContent: ["goals:goals"] }), undefined)).toBe("notifications");
    expect(selectedDrawerTab(availability({ activity: true, sections: ["goals:goals"], withContent: ["goals:goals"] }), undefined)).toBe("activity");
  });

  it("falls to a section with something in it rather than an empty built-in", () => {
    expect(selectedDrawerTab(availability({ sections: ["goals:goals"], withContent: ["goals:goals"] }), undefined)).toBe("goals:goals");
  });

  it("lands on activity when nothing anywhere has content", () => {
    expect(selectedDrawerTab(availability({ sections: ["goals:goals"] }), undefined)).toBe("activity");
  });
});
