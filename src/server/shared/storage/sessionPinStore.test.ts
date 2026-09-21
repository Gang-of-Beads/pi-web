import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionPinStore } from "./sessionPinStore";

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
    expect(await pins.pin("s1")).toEqual(["s1"]);
    expect(await pins.pin("s1")).toEqual(["s1"]);
    expect(await pins.pin("s2")).toEqual(["s1", "s2"]);
    expect(await pins.list()).toEqual(["s1", "s2"]);
    expect(await pins.unpin("s1")).toEqual(["s2"]);
  });

  it("keeps both pins when two devices pin at the same moment", async () => {
    const pins = await store();
    const [first, second] = await Promise.all([pins.pin("phone"), pins.pin("desktop")]);
    expect(new Set([...first, ...second, ...(await pins.list())])).toEqual(new Set(["phone", "desktop"]));
    expect((await pins.list()).length).toBe(2);
  });

  it("adopts a device's existing pins without dropping the machine's", async () => {
    const pins = await store();
    await pins.pin("already-here");
    expect(new Set(await pins.adopt(["already-here", "from-phone"]))).toEqual(new Set(["already-here", "from-phone"]));
  });

  it("answers an empty set for a file it cannot parse rather than inventing pins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-pins-"));
    const path = join(dir, "session-pins.json");
    const pins = new SessionPinStore(path);
    await pins.pin("s1");
    expect(JSON.parse(await readFile(path, "utf-8"))).toEqual({ pinnedSessionIds: ["s1"] });
  });
});
