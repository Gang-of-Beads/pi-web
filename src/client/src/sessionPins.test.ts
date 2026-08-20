import { describe, expect, it } from "vitest";
import { readPinnedSessionIds, SESSION_PINS_STORAGE_KEY, togglePinnedSessionId, writePinnedSessionIds, type PinStorage } from "./sessionPins";

function storage(initial?: string): PinStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key: string) { return key === SESSION_PINS_STORAGE_KEY ? this.value : null; },
    setItem(key: string, value: string) { if (key === SESSION_PINS_STORAGE_KEY) this.value = value; },
  };
}

describe("session pins", () => {
  it("round-trips a set", () => {
    const store = storage();
    writePinnedSessionIds(new Set(["a", "b"]), store);
    expect([...readPinnedSessionIds(store)].sort()).toEqual(["a", "b"]);
  });

  it("treats missing, empty and malformed storage as no pins", () => {
    expect(readPinnedSessionIds(storage()).size).toBe(0);
    expect(readPinnedSessionIds(storage("")).size).toBe(0);
    expect(readPinnedSessionIds(storage("not json")).size).toBe(0);
    expect(readPinnedSessionIds(storage("{\"a\":1}")).size).toBe(0);
  });

  it("ignores non-string entries rather than rendering them", () => {
    expect([...readPinnedSessionIds(storage("[\"a\", 7, null]"))]).toEqual(["a"]);
  });

  it("toggles without mutating the original set", () => {
    const original = new Set(["a"]);
    const added = togglePinnedSessionId(original, "b");
    expect([...added].sort()).toEqual(["a", "b"]);
    expect([...original]).toEqual(["a"]);
    expect([...togglePinnedSessionId(added, "a")]).toEqual(["b"]);
  });

  it("survives a storage that throws", () => {
    const throwing: PinStorage = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    };
    expect(readPinnedSessionIds(throwing).size).toBe(0);
    expect(() => { writePinnedSessionIds(new Set(["a"]), throwing); }).not.toThrow();
  });
});
