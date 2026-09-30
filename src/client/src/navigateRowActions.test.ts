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

  it("offers Archive on a session that can be archived (owner, 2026-09-30)", () => {
    expect(ids("session", { archivable: true })).toContain("archive");
    expect(ids("session", { archivable: false })).not.toContain("archive");
  });

  it("offers an archived session Restore and Delete permanently, and nothing that edits it", () => {
    expect(ids("session", { archived: true, pinned: false, renamable: true, archivable: true })).toEqual(["open", "restore", "delete-archived"]);
    expect(navigateRowActions("session", { archived: true, archivable: true }).find((action) => action.id === "delete-archived")?.label).toBe("Delete permanently");
    expect(ids("session", { archived: true, archivable: false })).toEqual(["open"]);
  });

  it("names the machine action for what it does", () => {
    expect(navigateRowActions("machine")[0]?.label).toBe("Switch to this machine");
  });
});
