/**
 * Restore the execute bit on node-pty's `spawn-helper`.
 *
 * node-pty publishes `prebuilds/<platform>/spawn-helper` with mode 644 instead
 * of 755 (microsoft/node-pty#850). Package managers that preserve tarball
 * permissions - pnpm, bun, and npm depending on version and cache state - then
 * install a helper that cannot be executed, and every PTY launch dies with
 * `Error: posix_spawnp failed.`, which in PI WEB means terminals simply do not
 * work while nothing explains why.
 *
 * Upstream fixed it in PRs #858/#866, but only on the `1.2.0-beta` line; the
 * `latest` tag is still the broken 1.1.0 (microsoft/node-pty#919), so a
 * released dependency cannot carry the fix yet. This runs on install, is
 * idempotent, and never fails an install: a repair that cannot be made is
 * reported, not thrown, because a missing terminal is better than a package
 * that refuses to install.
 *
 * Remove this script once node-pty ships a stable release with the fix and this
 * project's dependency range points at it.
 */
import { chmod, stat } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const EXECUTE_BITS = 0o111;

await main();

async function main() {
  try {
    const prebuilds = await prebuildsDir();
    if (prebuilds === undefined) return;
    const repaired = [];
    for (const helper of await spawnHelpers(prebuilds)) {
      if (await makeExecutable(helper)) repaired.push(helper);
    }
    for (const helper of repaired) console.log(`[pi-web] restored execute bit on ${helper}`);
  } catch (error) {
    // Never fail an install over this.
    console.warn(`[pi-web] could not check node-pty spawn-helper permissions: ${message(error)}`);
  }
}

/**
 * node-pty's prebuilds directory, or undefined when node-pty is not installed.
 *
 * Resolution starts at the install root (`npm` runs lifecycle scripts there,
 * and that is where a hoisted `node_modules` lives) and falls back to this
 * script's own location, which is what finds a nested copy when the script is
 * run by hand from somewhere else.
 */
async function prebuildsDir() {
  for (const base of [pathToFileURL(join(process.cwd(), "package.json")).href, import.meta.url]) {
    const packageJsonPath = resolveNodePty(base);
    if (packageJsonPath === undefined) continue;
    const dir = join(dirname(packageJsonPath), "prebuilds");
    if ((await statOrUndefined(dir))?.isDirectory() === true) return dir;
  }
  return undefined;
}

function resolveNodePty(base) {
  try {
    return createRequire(base).resolve("node-pty/package.json");
  } catch {
    return undefined;
  }
}

async function spawnHelpers(prebuilds) {
  const helpers = [];
  for (const entry of await readdir(prebuilds, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const helper = join(prebuilds, entry.name, "spawn-helper");
    if ((await statOrUndefined(helper))?.isFile() === true) helpers.push(helper);
  }
  return helpers;
}

/** Returns true when this call is what made the file executable. */
async function makeExecutable(path) {
  const stats = await statOrUndefined(path);
  if (stats === undefined) return false;
  if ((stats.mode & EXECUTE_BITS) === EXECUTE_BITS) return false;
  await chmod(path, stats.mode | EXECUTE_BITS);
  return true;
}

async function statOrUndefined(path) {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
