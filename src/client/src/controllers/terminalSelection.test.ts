import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "./sessionStorageMemory";
import { InMemoryTerminalSelectionMemory, SessionStorageTerminalSelectionMemory } from "./terminalSelection";


describe("terminal selection", () => {
  it("remembers terminal ids per workspace cwd", () => {
    const memory = new InMemoryTerminalSelectionMemory();
    memory.rememberTerminal("/repo", "t1");
    memory.rememberTerminal("/other", "t2");

    expect(memory.latestTerminalId("/repo")).toBe("t1");
    memory.forgetTerminal("t1");
    expect(memory.latestTerminalId("/repo")).toBeUndefined();
    expect(memory.latestTerminalId("/other")).toBe("t2");
  });

  it("persists terminal ids per workspace cwd", () => {
    const storage = memoryStorage();
    const memory = new SessionStorageTerminalSelectionMemory(storage);
    memory.rememberTerminal("local:/repo", "t1");
    memory.rememberTerminal("remote:/repo", "t2");

    const restored = new SessionStorageTerminalSelectionMemory(storage);

    expect(restored.latestTerminalId("local:/repo")).toBe("t1");
    restored.forgetTerminal("t1");
    expect(new SessionStorageTerminalSelectionMemory(storage).latestTerminalId("local:/repo")).toBeUndefined();
    expect(new SessionStorageTerminalSelectionMemory(storage).latestTerminalId("remote:/repo")).toBe("t2");
  });
});

function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}
