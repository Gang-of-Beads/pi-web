import { lstat, readdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { isNodeErrorWithCode } from "../../shared/workspaces/pathSafety.js";

/**
 * What the rename asks the disk. Only "nothing is there" counts as absence: any other failure to
 * look (no permission, too many open files) is an error, because a rename that took "could not
 * look" for "nothing there" would move, or leave, the wrong things.
 */

/** The identity of a folder: the same folder under any name, and no other. */
export interface PathIdentity {
  readonly dev: string;
  readonly ino: string;
}

export function isAbsentPathError(error: unknown): boolean {
  return isNodeErrorWithCode(error, "ENOENT") || isNodeErrorWithCode(error, "ENOTDIR");
}

/** Whether anything is at `path`, a dangling link included. */
export async function pathExists(path: string): Promise<boolean> {
  return await identityOf(path) !== undefined;
}

/**
 * What is at `path`, or undefined when nothing is. Read as big integers: an NTFS or ReFS file id
 * can exceed what a JavaScript number holds exactly, and two folders would then look like one.
 */
export async function identityOf(path: string): Promise<PathIdentity | undefined> {
  try {
    const stats = await lstat(path, { bigint: true });
    return { dev: stats.dev.toString(), ino: stats.ino.toString() };
  } catch (error) {
    if (isAbsentPathError(error)) return undefined;
    throw error;
  }
}

export function sameIdentity(left: PathIdentity | undefined, right: PathIdentity | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * Whether two paths name one file: on a case-insensitive disk `MyApp` and `myapp` do, and a
 * rename that only changes the letter case finds its target already "there".
 */
export async function samePath(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([identityOf(left), identityOf(right)]);
  return sameIdentity(a, b);
}

/** Whether a folder itself, not a link to one, is at `path`. */
export async function isFolder(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch (error) {
    if (isAbsentPathError(error)) return false;
    throw error;
  }
}

/** Whether `target` is free for `source` to move onto: nothing there, or `source` itself under another case. */
export async function freeFor(target: string, source: string): Promise<boolean> {
  return !await pathExists(target) || await samePath(target, source);
}

/** Whether the folder that holds `path` lists it under exactly this name: on a case-insensitive disk both spellings of a name resolve, and only the listing tells which one it has. */
export async function listedUnderName(path: string): Promise<boolean> {
  try {
    return (await readdir(dirname(path))).includes(basename(path));
  } catch (error) {
    if (isAbsentPathError(error)) return false;
    throw error;
  }
}
