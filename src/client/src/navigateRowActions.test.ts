import { describe, expect, it } from "vitest";
import { navigateRowActions } from "./navigateRowActions";

const ids = (kind: Parameters<typeof navigateRowActions>[0], facts?: Parameters<typeof navigateRowActions>[1]) =>
  navigateRowActions(kind, facts).map((action) => action.id);

describe("navigateRowActions", () => {
  it("always offers the thing the row is for", () => {
    expect(ids("session")[0]).toBe("open");
    expect(ids("project")[0]).toBe("open");
    expect(ids("machine")).toEqual(["open"]);
  });

  it("offers the pin state the row is not in", () => {
    expect(ids("session", { pinned: false })).toContain("pin");
    expect(ids("session", { pinned: true })).toContain("unpin");
    expect(ids("session", { pinned: true })).not.toContain("pin");
  });

  it("only offers what the host can actually do", () => {
    expect(ids("session", { renamable: false })).not.toContain("rename");
    expect(ids("session", { renamable: true })).toContain("rename");
    expect(ids("project", { hasPath: false, closable: false })).toEqual(["open", "pin"]);
    expect(ids("project", { pinned: true })).toContain("unpin");
    expect(ids("project", { hasPath: true, closable: true })).toEqual(["open", "pin", "copy-path", "close-project"]);
  });

  it("names the machine action for what it does", () => {
    expect(navigateRowActions("machine")[0]?.label).toBe("Switch to this machine");
  });
});
