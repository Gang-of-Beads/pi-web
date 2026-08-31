import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ProjectStore, projectStorePath } from "./projectStore.js";

async function storeFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "pi-web-project-store-")), "projects.json");
}

describe("projectStorePath", () => {
  it("uses PI_WEB_DATA_DIR by default", () => {
    expect(projectStorePath({ PI_WEB_DATA_DIR: "demo-data" }, "/tmp/pi-web")).toBe(resolve("/tmp/pi-web", "demo-data", "projects.json"));
  });

  it("uses PI_WEB_PROJECTS_FILE when configured", () => {
    expect(projectStorePath({ PI_WEB_PROJECTS_FILE: "demo/projects.json" }, "/tmp/pi-web")).toBe(resolve("/tmp/pi-web", "demo/projects.json"));
  });
});

describe("keeping every project that was added", () => {
  /**
   * Adding is read, decide, write. Two adds that overlap both read the same
   * list, both append their own project, and the second write replaces the
   * first - so a project the user added is simply gone, with nothing in any log
   * to say it ever arrived.
   */
  it("loses neither of two projects added at the same time", async () => {
    const store = new ProjectStore(await storeFile());

    await Promise.all([
      store.add({ path: "/work/first" }),
      store.add({ path: "/work/second" }),
    ]);

    expect((await store.list()).map((project) => project.path).sort()).toEqual(["/work/first", "/work/second"]);
  });

  it("keeps the projects already on disk when one more is added", async () => {
    const path = await storeFile();
    const store = new ProjectStore(path);
    await store.add({ path: "/work/kept" });

    await Promise.all([store.add({ path: "/work/a" }), store.add({ path: "/work/b" }), store.remove("missing-id")]);

    expect((await store.list())).toHaveLength(3);
  });

  it("answers the same project for a path added twice at once", async () => {
    const store = new ProjectStore(await storeFile());

    const [left, right] = await Promise.all([store.add({ path: "/work/same" }), store.add({ path: "/work/same" })]);

    expect(left.id).toBe(right.id);
    expect(await store.list()).toHaveLength(1);
  });
});

describe("what a reader can find mid-write", () => {
  /**
   * Writing in place empties the file first, so a reader arriving during the
   * write parses a truncated document and the whole list fails to load. Two
   * processes share this file - the web server and the session daemon - so
   * that reader is not hypothetical.
   */
  it("replaces the file in one step and leaves nothing behind", async () => {
    const path = await storeFile();
    const store = new ProjectStore(path);

    await store.add({ path: "/work/only" });

    const entries = await readdir(join(path, ".."));
    expect(entries).toEqual(["projects.json"]);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ projects: [{ path: "/work/only" }] });
  });

  it("reports a file it cannot understand instead of reporting no projects", async () => {
    const path = await storeFile();
    await writeFile(path, "{\"projects\": [{\"id\": 1}]}", "utf8");

    await expect(new ProjectStore(path).list()).rejects.toThrow("Invalid project");
  });
});
