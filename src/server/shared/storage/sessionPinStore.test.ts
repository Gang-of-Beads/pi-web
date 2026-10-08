import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adoptedPins, globalPin, SessionPinStore } from "./sessionPinStore";

async function store(): Promise<SessionPinStore> {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-pins-"));
  return new SessionPinStore(join(dir, "session-pins.json"));
}

describe("the machine's session pins", () => {
  it("reads an empty set before anything is pinned", async () => {
    expect(await (await store()).list()).toEqual([]);
  });

  it("pins, reads back, and unpins", async () => {
    const pins = await store();
    expect((await pins.apply(globalPin("s1", true))).global).toEqual(["s1"]);
    expect((await pins.apply(globalPin("s1", true))).global).toEqual(["s1"]);
    expect((await pins.apply(globalPin("s2", true))).global).toEqual(["s1", "s2"]);
    expect(await pins.list()).toEqual(["s1", "s2"]);
    expect((await pins.apply(globalPin("s1", false))).global).toEqual(["s2"]);
  });

  it("keeps both pins when two devices pin at the same moment", async () => {
    const pins = await store();
    const [first, second] = await Promise.all([pins.apply(globalPin("phone", true)), pins.apply(globalPin("desktop", true))]);
    expect(new Set([...first.global, ...second.global, ...(await pins.list())])).toEqual(new Set(["phone", "desktop"]));
    expect((await pins.list()).length).toBe(2);
  });

  it("adopts a device's existing pins without dropping the machine's", async () => {
    const pins = await store();
    await pins.apply(globalPin("already-here", true));
    expect(new Set((await pins.apply(adoptedPins(["already-here", "from-phone"]))).global)).toEqual(new Set(["already-here", "from-phone"]));
  });

  it("writes the global pins to the file as pinnedSessionIds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-pins-"));
    const path = join(dir, "session-pins.json");
    const pins = new SessionPinStore(path);
    await pins.apply(globalPin("s1", true));
    expect(JSON.parse(await readFile(path, "utf-8"))).toEqual({ pinnedSessionIds: ["s1"] });
  });
});
