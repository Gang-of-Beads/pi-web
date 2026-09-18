/**
 * How to spawn npm from a test or script on this platform.
 *
 * `execFileSync` does not go through a shell. On Windows npm is the `npm.cmd`
 * shim, and since Node 20 spawning a `.cmd` without a shell is refused with
 * EINVAL, so the command name and the shell flag have to travel together.
 */
export interface NpmInvocation {
  command: string;
  shell: boolean;
}

export function npmInvocation(platform: NodeJS.Platform = process.platform): NpmInvocation {
  return platform === "win32" ? { command: "npm.cmd", shell: true } : { command: "npm", shell: false };
}
