import { chmodSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureSpawnHelperExecutable, resetSpawnHelperRepairForTests, spawnHelperPaths, spawnHelperFailureReason } from "./nodePtySpawnHelper";

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

describe("a helper that cannot be repaired", () => {
  it("remembers why, so a dead terminal can say more than posix_spawnp failed", async () => {
    // The case the earlier version missed. On the deployment that matters -
    // a read-only nix store - chmod fails outright, and the previous guard
    // swallowed that, leaving node-pty to report "posix_spawnp failed." with
    // neither the file nor the reason. A helper that cannot even be read
    // stands in for it here: an owner can chmod their own file whatever the
    // parent directory says, so a "read-only" fixture built out of
    // permissions would repair itself and prove nothing. The read-only case
    // itself was checked on the machine, against the store path.
    // A helper the repair pass will find and then fail to change. Permissions
    // alone cannot express this - an owner may always chmod their own file,
    // whatever the directory says - so the file is removed after it has been
    // listed and before it is repaired, which is the same shape of failure a
    // read-only install produces: present when checked, unwritable when
    // changed. The read-only case itself was verified on the machine against
    // the nix store path, which no unit test can create.
    const { dir, helper } = await prebuilds(0o444);
    const listed = spawnHelperPaths(dir);
    expect(listed).toContain(helper);
    rmSync(helper);

    ensureSpawnHelperExecutable(dir, listed);

    const reason = spawnHelperFailureReason();
    expect(reason).toBeDefined();
    expect(reason).toContain(helper);
    expect(reason).toContain("node-pty#850");
    // Reports what failed rather than asserting a cause it cannot know.
    expect(reason).toMatch(/ENOENT/u);
  });

  it("reports nothing when the repair worked", async () => {
    const { dir } = await prebuilds(0o444);
    ensureSpawnHelperExecutable(dir);
    expect(spawnHelperFailureReason()).toBeUndefined();
  });
});
