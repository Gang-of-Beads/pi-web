import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { removeFile, renamePath } from "../../shared/storage/stateFiles.js";
import type { ArchivedPathsChange } from "../sessions/sessionArchiveStore.js";
import type { FolderMove } from "./folderMove.js";
import { isAbsentPathError, type PathIdentity } from "./pathFacts.js";
import type { HeaderRewrite, MovedSession, StoreDirMove } from "./sessionStorePlan.js";
import type { TrustKeyMove } from "./trustMove.js";

/** A project the rename names anew: the renamed one, and any project inside its folder. */
export interface ProjectChange {
  readonly id: string;
  readonly from: { readonly name: string; readonly path: string };
  readonly to: { readonly name: string; readonly path: string };
}

/** The rename's steps, in the order they run; recovery undoes the ones started, newest first. */
export const RENAME_STEPS = ["folder", "provider", "storeDirs", "headers", "archive", "sessions", "trust", "projects"] as const;

export type RenameStep = typeof RENAME_STEPS[number];

/**
 * Everything a rename is about to change, written before it changes anything.
 *
 * A rename touches the folder, Pi's session store, the daemon's records and Pi's trust file; a
 * daemon stopped halfway would leave them disagreeing. The journal holds what each step will do
 * and how far the rename got, so the next start can put the started steps back - each undo
 * checks what is on disk first, so undoing a step that never ran, or ran halfway, is safe. The
 * project list is written last and in one replace, so a rename whose last step started and whose
 * list names the new folder is done (`committed` says so sooner), and the journal only waits to go.
 */
export interface RenameJournal {
  readonly version: 1;
  readonly project: { readonly id: string; readonly name: string; readonly path: string };
  readonly move: FolderMove;
  /** The renamed folder itself, so putting it back can tell it from a folder made at its old name since. */
  readonly folder: PathIdentity;
  readonly projects: readonly ProjectChange[];
  readonly dirMoves: readonly StoreDirMove[];
  readonly rewrites: readonly HeaderRewrite[];
  readonly archived: readonly ArchivedPathsChange[];
  readonly sessions: readonly MovedSession[];
  readonly trust: readonly TrustKeyMove[];
  /** The last step started; absent until the first one starts. */
  readonly started?: RenameStep;
  readonly committed?: true;
}

export function renameJournalPath(dataDir: string): string {
  return join(dataDir, "project-rename.json");
}

/**
 * Write the journal so that it is on the disk before the step it guards starts: staged beside it,
 * flushed, moved onto it, and the folder that holds it flushed too where the system can. A power
 * cut right after the move must not leave an empty journal behind a half-moved folder.
 */
export async function writeRenameJournal(path: string, journal: RenameJournal): Promise<void> {
  const staged = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const file = await open(staged, "wx");
    try {
      await file.writeFile(`${JSON.stringify(journal)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await renamePath(staged, path);
  } finally {
    await rm(staged, { force: true }).catch(() => undefined);
  }
  await flushFolder(dirname(path));
}

/**
 * Flush the folder that holds the journal, so the move onto it survives a power cut, where the
 * system can: Windows cannot open a folder to flush it, and some file systems refuse to flush one.
 * There the flushed file is what the journal relies on, as every other state file does.
 */
async function flushFolder(folder: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(folder, "r").catch(() => undefined);
  await handle?.sync().catch(() => undefined);
  await handle?.close().catch(() => undefined);
}

/** The journal a stopped rename left, or undefined when there is none; one that cannot be read is an error, not guessed at. */
export async function readRenameJournal(path: string): Promise<RenameJournal | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isAbsentPathError(error)) return undefined;
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isJournal(parsed)) throw new Error(`The rename journal ${path} is not one this PI WEB wrote`);
  return parsed;
}

export async function clearRenameJournal(path: string): Promise<void> {
  await removeFile(path);
}

const STEPS: ReadonlySet<unknown> = new Set(RENAME_STEPS);

function isJournal(value: unknown): value is RenameJournal {
  if (typeof value !== "object" || value === null) return false;
  const move: unknown = Reflect.get(value, "move");
  const folder: unknown = Reflect.get(value, "folder");
  const started: unknown = Reflect.get(value, "started");
  const committed: unknown = Reflect.get(value, "committed");
  return Reflect.get(value, "version") === 1
    && hasStrings(Reflect.get(value, "project"), ["id", "name", "path"])
    && hasStrings(move, ["from", "to"])
    && hasStrings(folder, ["dev", "ino"])
    && (started === undefined || STEPS.has(started))
    && (committed === undefined || committed === true)
    && ["projects", "dirMoves", "rewrites", "archived", "sessions", "trust"].every((key) => Array.isArray(Reflect.get(value, key)));
}

function hasStrings(value: unknown, keys: readonly string[]): boolean {
  return typeof value === "object" && value !== null && keys.every((key) => typeof Reflect.get(value, key) === "string");
}
