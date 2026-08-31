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
let unrepairable: string | undefined;

export function ensureSpawnHelperExecutable(prebuildsDir = resolvePrebuildsDir(), helpers?: readonly string[]): void {
  if (repaired) return;
  repaired = true;
  if (prebuildsDir === undefined) return;
  for (const helper of helpers ?? spawnHelperPaths(prebuildsDir)) {
    try {
      const stats = statSync(helper);
      if ((stats.mode & EXECUTE_BITS) === EXECUTE_BITS) continue;
      chmodSync(helper, stats.mode | EXECUTE_BITS);
    } catch (error) {
      // Repair is impossible on a read-only install (a nix store path, a
      // container layer), which is where this matters most: node-pty then
      // fails with "posix_spawnp failed." and names neither the file nor the
      // reason. Remember it so the terminal can say what actually happened
      // instead of leaving the reader to reverse-engineer it.
      unrepairable ??= spawnHelperDiagnostic(helper, error);
    }
  }
}

/**
 * Why terminals cannot start, when the cause is a helper this process could
 * not repair. `undefined` when there is nothing to report.
 */
export function spawnHelperFailureReason(): string | undefined {
  return unrepairable;
}

function spawnHelperDiagnostic(helper: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  // States what happened and leaves the cause to the error itself: a
  // read-only install is the usual reason, but a missing or replaced file
  // reaches here too, and naming the wrong cause sends the reader the wrong
  // way. The remedy is the same either way - the bit has to be set where the
  // files are produced, because this process cannot set it.
  return `node-pty's spawn-helper could not be made executable: ${helper}\n${detail}\n`
    + "Terminals cannot start without it. Set the execute bit where this install is built "
    + "(in the nix derivation, the Dockerfile, or the package that produced it) - "
    + "an install this process cannot write to cannot be repaired at runtime. "
    + "Upstream bug: microsoft/node-pty#850.";
}

/** Test seam: forget that this process already ran the repair. */
export function resetSpawnHelperRepairForTests(): void {
  unrepairable = undefined;
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
