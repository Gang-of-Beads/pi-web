import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPluginScopedStorage, pluginStorageDirectory, PluginStorageKeyError } from "./pluginScopedStorage";

async function storage(pluginId = "voice") {
  const base = await mkdtemp(join(tmpdir(), "pi-web-plugin-storage-"));
  return { base, store: createPluginScopedStorage(base, pluginId) };
}

describe("plugin scoped storage", () => {
  it("round-trips a document", async () => {
    const { store } = await storage();

    await store.write("state", { queued: 2 });

    expect(await store.read("state")).toEqual({ queued: 2 });
  });

  it("answers undefined for a key that was never written", async () => {
    const { store } = await storage();

    expect(await store.read("state")).toBeUndefined();
  });

  it("answers undefined for a corrupt document rather than throwing", async () => {
    const { base, store } = await storage();
    await store.write("state", { ok: true });
    await writeFile(join(pluginStorageDirectory(base, "voice"), "state.json"), "{ not json", "utf8");

    expect(await store.read("state")).toBeUndefined();
  });

  it("keeps each plugin in its own directory", async () => {
    const { base } = await storage();
    const voice = createPluginScopedStorage(base, "voice");
    const goals = createPluginScopedStorage(base, "goals");

    await voice.write("state", { who: "voice" });
    await goals.write("state", { who: "goals" });

    expect(await voice.read("state")).toEqual({ who: "voice" });
    expect(await goals.read("state")).toEqual({ who: "goals" });
  });

  it("refuses keys that would escape the plugin directory", async () => {
    const { store } = await storage();

    await expect(store.write("../escape", { bad: true })).rejects.toBeInstanceOf(PluginStorageKeyError);
    await expect(store.read("nested/key")).rejects.toBeInstanceOf(PluginStorageKeyError);
  });

  it("leaves no staged file behind after a write", async () => {
    const { base, store } = await storage();

    await store.write("state", { ok: true });

    expect((await readdir(pluginStorageDirectory(base, "voice"))).filter((name) => name.includes("staged"))).toEqual([]);
  });

  it("removing a key makes it unknown again", async () => {
    const { store } = await storage();
    await store.write("state", { ok: true });

    await store.remove("state");

    expect(await store.read("state")).toBeUndefined();
  });
});
