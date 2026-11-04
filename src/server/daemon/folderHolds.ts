import { resolve } from "node:path";
import { insideFolder } from "./workingDirectory.js";

interface Hold {
  readonly folders: readonly string[];
  readonly files: ReadonlySet<string>;
  readonly reason: string;
}

/**
 * Folders a daemon-wide operation is rewriting, which nothing may start inside meanwhile.
 *
 * A project rename moves a folder and every session file and record that names it. A session
 * opened or created in that folder halfway through would write under the old path - recreating
 * the session directory the rename just moved - or hold a runtime bound to a folder that is about
 * to stop existing. Session runtimes and terminals both ask here before they start, so the hold
 * covers every way in rather than the few the rename could enumerate when it began. A hold can
 * also name single session files outside the folder whose header the rename rewrites: a session
 * opened on one would append to the file being replaced.
 */
export class FolderHolds {
  private readonly holds = new Set<Hold>();

  /** Hold `folders` (and everything inside them) and `files` until the returned release is called. */
  hold(folders: readonly string[], reason: string, files: readonly string[] = []): () => void {
    const hold: Hold = { folders: [...folders], files: new Set(files.map((file) => resolve(file))), reason };
    this.holds.add(hold);
    return () => { this.holds.delete(hold); };
  }

  /** Why nothing may start in `cwd`, or on `file`, right now; undefined when both are free. */
  refusal(cwd: string, file?: string): string | undefined {
    const held = file === undefined || file === "" ? undefined : resolve(file);
    for (const hold of this.holds) {
      if (hold.folders.some((folder) => insideFolder(cwd, folder))) return hold.reason;
      if (held !== undefined && hold.files.has(held)) return hold.reason;
    }
    return undefined;
  }

  /** Throws the hold's reason when `cwd` or `file` is held. */
  assertFree(cwd: string, file?: string): void {
    const reason = this.refusal(cwd, file);
    if (reason !== undefined) throw new FolderHeldError(reason);
  }
}

export class FolderHeldError extends Error {
  override name = "FolderHeldError";
}
