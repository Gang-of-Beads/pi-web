/**
 * The npm executable's name on this platform.
 *
 * `execFileSync` does not go through a shell, and on Windows the shim is
 * `npm.cmd`; spawning bare "npm" there fails with ENOENT, which is how the
 * Windows release check first went red.
 */
export function npmCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}
