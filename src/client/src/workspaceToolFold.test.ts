import { describe, expect, it } from "vitest";
import { createWorkspaceToolFoldStore, toggledFold, workspaceToolFoldVerdict } from "./workspaceToolFold";

describe("workspace tool fold", () => {
  it("enumerates every stored value: only an explicit open opens", () => {
    expect(workspaceToolFoldVerdict("open")).toBe("open");
    expect(workspaceToolFoldVerdict("collapsed")).toBe("collapsed");
    expect(workspaceToolFoldVerdict("anything")).toBe("collapsed");
    expect(workspaceToolFoldVerdict(null)).toBe("collapsed");
    expect(workspaceToolFoldVerdict(undefined)).toBe("collapsed");
  });

  it("toggles between the two states", () => {
    expect(toggledFold("open")).toBe("collapsed");
    expect(toggledFold("collapsed")).toBe("open");
  });

  it("remembers per tool and survives a broken store", () => {
    const backing = new Map<string, string>();
    const store = createWorkspaceToolFoldStore({ getItem: (key) => backing.get(key) ?? null, setItem: (key, value) => { backing.set(key, value); } });
    expect(store.read("git:workspace.git")).toBe("collapsed");
    store.write("git:workspace.git", "open");
    expect(store.read("git:workspace.git")).toBe("open");
    expect(store.read("files:files")).toBe("collapsed");

    const broken = createWorkspaceToolFoldStore({ getItem: () => { throw new Error("quota"); }, setItem: () => { throw new Error("quota"); } });
    expect(broken.read("x")).toBe("collapsed");
    expect(() => { broken.write("x", "open"); }).not.toThrow();
    expect(createWorkspaceToolFoldStore(undefined).read("x")).toBe("collapsed");
  });
});
