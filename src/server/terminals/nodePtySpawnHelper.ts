import { chmodSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Make node-pty's `spawn-helper` executable before the first PTY is spawned.
 *
 * node-pty publishes `prebuilds/<platform>/spawn-helper` with mode 644 instead
 * of 755 (microsoft/node-pty#850, still unfixed on the `latest` tag). Package
 * managers that preserve tarball permissions then install a helper that cannot
 * be executed, and every terminal dies with `Error: posix_spawnp failed.` while
 * nothing on screen explains why.
 *
 * The repair lives here, at the moment of use, rather than only in an install
 * hook, because install hooks are not dependable: npm 12 refuses to run a
 * package's own lifecycle scripts unless the installing user allows them, which
 * this project's own packaged-install smoke test demonstrates. Checking one
 * file's mode once per process is cheap enough to pay every startup and works
 * no matter how the package arrived.
 *
 * Delete this once node-pty ships a stable release with the fix and the
 * dependency range requires it.
 */
const EXECUTE_BITS = 0o111;

let repaired = false;

export function ensureSpawnHelperExecutable(prebuildsDir = resolvePrebuildsDir()): void {
  if (repaired) return;
  repaired = true;
  if (prebuildsDir === undefined) return;
  for (const helper of spawnHelperPaths(prebuildsDir)) {
    try {
      const stats = statSync(helper);
      if ((stats.mode & EXECUTE_BITS) === EXECUTE_BITS) continue;
      chmodSync(helper, stats.mode | EXECUTE_BITS);
    } catch {
      // A helper that cannot be repaired here fails loudly at spawn time with
      // node-pty's own error; a terminal service that refuses to start would be
      // worse than one whose terminals report why they cannot start.
    }
  }
}

/** Test seam: forget that this process already ran the repair. */
export function resetSpawnHelperRepairForTests(): void {
  repaired = false;
}

export function spawnHelperPaths(prebuildsDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(prebuildsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
  return entries
    .map((name) => join(prebuildsDir, name, "spawn-helper"))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });
}

function resolvePrebuildsDir(): string | undefined {
  try {
    return join(dirname(createRequire(import.meta.url).resolve("node-pty/package.json")), "prebuilds");
  } catch {
    return undefined;
  }
}
