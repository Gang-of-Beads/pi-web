import { statSync } from "node:fs";
import { stat } from "node:fs/promises";

/** Whether a folder is there, certainly gone, or could not be looked at (a permission refusal, a dead mount). */
export type FolderPresence = "present" | "gone" | "unknown";

const GONE_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR"]);

/**
 * A folder that could not be looked at is not a folder that is gone: absence is not negation, and a
 * dead network mount answered as 'missing' moved its sessions to Archived and offered to copy them
 * (review of the folder-gone copy, round 2, P3). Both processes read this one rule - the session
 * listing, a copy's target and cleanup in the session daemon, the project list and each project's
 * folders in the web process - since a workspace stamped gone while its sessions listed as live
 * refused "+ New session" with a false sentence (round 3, P3).
 */
export function folderPresence(path: string): FolderPresence {
  try {
    return statSync(path).isDirectory() ? "present" : "gone";
  } catch (error) {
    return presenceAfter(error);
  }
}

const MISSING_FOLDER: Readonly<Record<FolderPresence, ((path: string) => string) | undefined>> = {
  present: undefined,
  gone: (path) => `Workspace folder does not exist: ${path}`,
  unknown: (path) => `Workspace folder could not be looked at: ${path}`,
};

/**
 * The refusal to work in a folder that is not there, by what is known of it; undefined while it is
 * there. A folder that could not be looked at was refused as one that does not exist (review of the
 * folder-gone copy, round 4, P3).
 */
export function missingFolderRefusal(path: string): string | undefined {
  return MISSING_FOLDER[folderPresence(path)]?.(path);
}

/** `folderPresence` without holding up the web process on a slow mount. */
export async function folderPresenceAsync(path: string): Promise<FolderPresence> {
  try {
    return (await stat(path)).isDirectory() ? "present" : "gone";
  } catch (error) {
    return presenceAfter(error);
  }
}

function presenceAfter(error: unknown): FolderPresence {
  const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" && GONE_CODES.has(code) ? "gone" : "unknown";
}
