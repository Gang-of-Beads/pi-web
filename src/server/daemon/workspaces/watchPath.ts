import { realpathSync } from "node:fs";

/**
 * The path a filesystem watch should be opened on.
 *
 * Windows hands out short (8.3) and differently-cased forms of the same
 * directory - the CI runner's temp directory is one - and libuv compares the
 * change notification's directory against the watched string, aborting the
 * process on a mismatch rather than reporting an error. Resolving the real
 * path first keeps both sides in the same spelling. A path that cannot be
 * resolved is handed back unchanged: the watch itself then fails as an
 * ordinary error, which the caller already tolerates.
 */
export function watchablePath(path: string, resolve: (value: string) => string = realpathSync.native): string {
  try {
    return resolve(path);
  } catch {
    return path;
  }
}
