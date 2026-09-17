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
    writePinnedSessionIds("local", new Set(["a", "b"]), store);
    expect([...readPinnedSessionIds("local", store)].sort()).toEqual(["a", "b"]);
  });

  it("treats missing, empty and malformed storage as no pins", () => {
    expect(readPinnedSessionIds("local", storage()).size).toBe(0);
    expect(readPinnedSessionIds("local", storage("")).size).toBe(0);
    expect(readPinnedSessionIds("local", storage("not json")).size).toBe(0);
    expect(readPinnedSessionIds("local", storage("{\"a\":1}")).size).toBe(0);
  });

  it("ignores non-string entries rather than rendering them", () => {
    expect([...readPinnedSessionIds("local", storage("[\"a\", 7, null]"))]).toEqual(["a"]);
  });

  it("toggles without mutating the original set", () => {
    const original = new Set(["a"]);
    const added = togglePinnedSessionId(original, "b");
    expect([...added].sort()).toEqual(["a", "b"]);
    expect([...original]).toEqual(["a"]);
    expect([...togglePinnedSessionId(added, "a")]).toEqual(["b"]);
  });

  it("keeps each machine's pins apart", () => {
    const store = storage();
    writePinnedSessionIds("local", new Set(["a"]), store);
    writePinnedSessionIds("remote", new Set(["b"]), store);
    expect([...readPinnedSessionIds("local", store)]).toEqual(["a"]);
    expect([...readPinnedSessionIds("remote", store)]).toEqual(["b"]);
  });

  it("reads a legacy flat list as the local machine's pins only", () => {
    const legacy = storage("[\"a\"]");
    expect([...readPinnedSessionIds("local", legacy)]).toEqual(["a"]);
    expect(readPinnedSessionIds("remote", legacy).size).toBe(0);
  });

  it("migrates a legacy flat list without losing it on the next write", () => {
    const legacy = storage("[\"a\"]");
    writePinnedSessionIds("remote", new Set(["b"]), legacy);
    expect([...readPinnedSessionIds("local", legacy)]).toEqual(["a"]);
    expect([...readPinnedSessionIds("remote", legacy)]).toEqual(["b"]);
  });

  it("survives a storage that throws", () => {
    const throwing: PinStorage = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    };
    expect(readPinnedSessionIds("local", throwing).size).toBe(0);
    expect(() => { writePinnedSessionIds("local", new Set(["a"]), throwing); }).not.toThrow();
  });
});
