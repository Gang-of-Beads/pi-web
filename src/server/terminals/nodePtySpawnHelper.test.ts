import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureSpawnHelperExecutable, resetSpawnHelperRepairForTests, spawnHelperPaths } from "./nodePtySpawnHelper";

const dirs: string[] = [];

afterEach(async () => {
  resetSpawnHelperRepairForTests();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A prebuilds directory shaped like the one node-pty publishes. */
async function prebuilds(mode: number): Promise<{ dir: string; helper: string }> {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-prebuilds-"));
  dirs.push(dir);
  mkdirSync(join(dir, "darwin-arm64"), { recursive: true });
  const helper = join(dir, "darwin-arm64", "spawn-helper");
  writeFileSync(helper, "#!/bin/sh\nexit 0\n");
  chmodSync(helper, mode);
  return { dir, helper };
}

function isExecutable(path: string): boolean {
  return (statSync(path).mode & 0o111) === 0o111;
}

describe("ensureSpawnHelperExecutable", () => {
  // Without this a terminal dies with node-pty's opaque "posix_spawnp failed",
  // and install hooks cannot be relied on: npm 12 does not run a package's own
  // lifecycle scripts unless the installing user allows them.
  it("restores the execute bit the published helper is missing", async () => {
    const { dir, helper } = await prebuilds(0o644);

    ensureSpawnHelperExecutable(dir);

    expect(isExecutable(helper)).toBe(true);
  });

  it("runs once per process", async () => {
    const { dir, helper } = await prebuilds(0o644);
    ensureSpawnHelperExecutable(dir);
    chmodSync(helper, 0o644);

    ensureSpawnHelperExecutable(dir);

    expect(isExecutable(helper)).toBe(false);
  });

  it("tolerates a missing prebuilds directory", () => {
    expect(() => { ensureSpawnHelperExecutable(join(tmpdir(), "pi-web-absent-prebuilds")); }).not.toThrow();
    expect(spawnHelperPaths(join(tmpdir(), "pi-web-absent-prebuilds"))).toEqual([]);
  });
});
