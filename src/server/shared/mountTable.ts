/**
 * The mount table of the process's mount namespace (`/proc/self/mountinfo` on
 * Linux), as far as PI WEB reasons about it: which mount holds a path, its
 * filesystem type, and whether it is read-only.
 *
 * Both processes and the CLI read it: the session daemon describes a Docker
 * deployment's persistent paths to agents, and `pi-web doctor` warns when a
 * state directory would not survive a container being recreated.
 */

import { readFileSync } from "node:fs";

/** One entry of the mount table, as far as PI WEB needs it. */
export interface ContainerMount {
  readonly target: string;
  readonly fsType: string;
  readonly readOnly: boolean;
}

export const MOUNT_INFO_PATH = "/proc/self/mountinfo";

/**
 * Read the mount table.
 *
 * Throws when the table cannot be read (no `/proc`, as on macOS and Windows);
 * the caller decides whether missing facts should be reported or fatal.
 */
export function readContainerMounts(path: string = MOUNT_INFO_PATH): ContainerMount[] {
  return parseContainerMounts(readFileSync(path, "utf8"));
}

/**
 * Parse `/proc/self/mountinfo` content.
 *
 * Fields before the ` - ` separator are `id parent major:minor root mountPoint
 * options [optional fields]`; the separator is followed by `fsType source
 * superOptions`. Unparsable lines are skipped: a mount PI WEB cannot describe
 * simply produces no fact.
 */
export function parseContainerMounts(mountInfo: string): ContainerMount[] {
  const mounts: ContainerMount[] = [];
  for (const line of mountInfo.split("\n")) {
    const separator = line.indexOf(" - ");
    if (separator === -1) continue;
    const head = line.slice(0, separator).split(" ");
    const target = head[4];
    const options = head[5];
    const fsType = line.slice(separator + 3).split(" ")[0];
    if (target === undefined || options === undefined || fsType === undefined || fsType === "") continue;
    mounts.push({
      target: unescapeMountField(target),
      fsType,
      readOnly: options.split(",").includes("ro"),
    });
  }
  return mounts;
}

/**
 * The mount that holds an absolute path: the one with the longest target that
 * is the path or one of its parents. When a target is mounted over more than
 * once, the table lists the visible mount last, so a later entry wins a tie.
 */
export function mountContaining(path: string, mounts: readonly ContainerMount[]): ContainerMount | undefined {
  let found: ContainerMount | undefined;
  for (const mount of mounts) {
    if (!isWithinOrAt(path, mount.target)) continue;
    if (found === undefined || mount.target.length >= found.target.length) found = mount;
  }
  return found;
}

function isWithinOrAt(path: string, target: string): boolean {
  if (target === "/") return path.startsWith("/");
  return path === target || path.startsWith(`${target}/`);
}

/** Mount fields escape space, tab, newline, and backslash as octal sequences. */
function unescapeMountField(value: string): string {
  return value.replace(/\\(040|011|012|134)/g, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 8)));
}
