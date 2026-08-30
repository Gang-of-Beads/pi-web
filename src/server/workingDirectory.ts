import { homedir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";

/**
 * Working-directory normalization boundaries.
 *
 * Cwd strings reach the server from three kinds of sources with different trust:
 *
 * 1. HTTP requests (web UI, federation proxies): normalize strictly with
 *    `normalizeRequestCwd` at route parsing. Relative paths are rejected instead
 *    of being silently resolved against the daemon's own working directory.
 * 2. Data pi-web writes itself (archive store records): canonicalized on write
 *    and on load with `canonicalizeStoredCwd`, so internal `===` comparisons are
 *    safe by construction.
 * 3. Data other writers own (Pi session file headers via the SDK): canonicalized
 *    on read at the gateway, and compared tolerantly with `cwdPathsEqual` where a
 *    raw value can still appear (e.g. runtime cwd of sessions opened from files).
 *
 * Inside these boundaries, plain string equality on cwd values is safe.
 */

/**
 * Expand a leading "~" to the daemon user's home directory, so "~/code" and
 * "/Users/me/code" address the same directory. Used at the request boundary
 * and on stored data: clients address their own machine, and session file
 * headers written by external tools frequently shorten the path. Values that
 * do not start with "~" pass through unchanged.
 */
export function expandHomePath(path: string): string {
  if (path === "~" || path === "~/") return homedir();
  if (path.startsWith("~")) return resolve(homedir(), path.slice(2));
  return path;
}

/**
 * Strictly normalize a client-supplied working directory at an HTTP boundary.
 * Throws for non-string, empty, or relative input; returns the resolved
 * (separator- and trailing-slash-normalized) absolute path otherwise. A
 * leading "~" is expanded before the absolute check, so clients may address
 * their own machine either way.
 */
export function normalizeRequestCwd(cwd: unknown): string {
  if (typeof cwd !== "string" || cwd === "") throw new Error("cwd is required");
  const expanded = expandHomePath(cwd);
  if (!isAbsolute(expanded)) throw new Error("cwd must be an absolute path");
  return resolve(expanded);
}

/**
 * Leniently canonicalize a working directory loaded from stored data.
 * Absolute paths (after "~" expansion) are resolved to canonical form;
 * anything else (legacy empty or relative values) is preserved as-is so a
 * single bad record cannot fail a whole load, and never silently resolves
 * against this process's working directory.
 */
export function canonicalizeStoredCwd(cwd: string): string {
  const expanded = expandHomePath(cwd);
  return isAbsolute(expanded) ? resolve(expanded) : cwd;
}

/** Compare two working-directory paths, tolerating separator, "~" and normalization differences (e.g. Windows backslash vs forward slash, a leading home shorthand, or trailing slashes). */
export function cwdPathsEqual(a: string, b: string): boolean {
  return resolve(expandHomePath(a)) === resolve(expandHomePath(b));
}

/** Whether `candidate` is `dir` itself or a descendant of it (directory-tree containment, separator-safe). */
export function cwdInsideDirectory(candidate: string, dir: string): boolean {
  const c = resolve(expandHomePath(candidate));
  const d = resolve(expandHomePath(dir));
  if (c === d) return true;
  return c.startsWith(d.endsWith(sep) ? d : d + sep);
}
