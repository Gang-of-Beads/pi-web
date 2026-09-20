import { describe, expect, it } from "vitest";
import { readPinnedProjectIds, togglePinnedProjectId, writePinnedProjectIds, PROJECT_PINS_STORAGE_KEY } from "./projectPins";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    read: (key: string) => map.get(key) ?? null,
  };
}

describe("project pins", () => {
  it("remembers a pin under the machine it was made on", () => {
    const storage = fakeStorage();
    writePinnedProjectIds("work", new Set(["p1"]), storage);
    expect([...readPinnedProjectIds("work", storage)]).toEqual(["p1"]);
    expect([...readPinnedProjectIds("local", storage)]).toEqual([]);
  });

  it("keeps other machines' pins when one machine's set is written", () => {
    const storage = fakeStorage({ [PROJECT_PINS_STORAGE_KEY]: JSON.stringify({ local: ["a"] }) });
    writePinnedProjectIds("work", new Set(["b"]), storage);
    expect([...readPinnedProjectIds("local", storage)]).toEqual(["a"]);
    expect([...readPinnedProjectIds("work", storage)]).toEqual(["b"]);
  });

  it("answers an empty set for anything it cannot read", () => {
    expect([...readPinnedProjectIds("local", fakeStorage({ [PROJECT_PINS_STORAGE_KEY]: "not json" }))]).toEqual([]);
    expect([...readPinnedProjectIds("local", fakeStorage({ [PROJECT_PINS_STORAGE_KEY]: "[\"a\"]" }))]).toEqual([]);
    expect([...readPinnedProjectIds("local", undefined)]).toEqual([]);
  });

  it("toggles a pin on and off", () => {
    expect([...togglePinnedProjectId(new Set(), "p1")]).toEqual(["p1"]);
    expect([...togglePinnedProjectId(new Set(["p1"]), "p1")]).toEqual([]);
  });
});
