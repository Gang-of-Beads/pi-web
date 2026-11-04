import { mkdir, readdir, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renamePath } from "../../shared/storage/stateFiles.js";
import type { ArchivedPathsChange } from "../sessions/sessionArchiveStore.js";
import { relocateRuns } from "../sessions/interruptedRunStore.js";
import { rewriteSessionHeaderPaths, type SessionHeaderRewrite } from "../sessions/sessionHeaderRewrite.js";
import { afterMoves, type FolderMove } from "./folderMove.js";
import type { HeaderRewrite, MovedSession, StoreDirMove } from "./sessionStorePlan.js";
import { applyTrustMoves, undoTrustMoves } from "./trustMove.js";
import { RENAME_STEPS, type ProjectChange, type RenameJournal, type RenameStep } from "./renameJournal.js";
import { freeFor, identityOf, isAbsentPathError, isFolder, listedUnderName, pathExists, sameIdentity, samePath, type PathIdentity } from "./pathFacts.js";

/** What the steps change outside the files they move themselves. */
export interface RenameStepPorts {
  readonly agentDir: string;
  readonly runFiles: readonly string[];
  readonly archive: { relocate(changes: readonly ArchivedPathsChange[]): Promise<void> };
  readonly sessions: { relocateSessions(moves: readonly MovedSession[]): Promise<void> };
  readonly providers: { relocate(from: string, to: string): Promise<void> };
  readonly projects: { relocate(changes: readonly ProjectChange[]): Promise<void> };
}

interface StepExecutor {
  apply(journal: RenameJournal, ports: RenameStepPorts): Promise<void>;
  /** Put the step back, checking the disk first: safe for a step that never ran or ran halfway. */
  undo(journal: RenameJournal, ports: RenameStepPorts): Promise<void>;
}

/**
 * Something a put-back cannot restore, and trying again would not change: the folder is under
 * neither of its names, a session file changed while the folder moved, a provider could not
 * repair its links. It is told to the reader and logged, and does not keep the journal.
 */
export class CannotPutBack extends Error {
  override name = "CannotPutBack";
}

/**
 * One executor per step of RENAME_STEPS, applied in that order and undone in the reverse. The
 * provider step's undo does nothing: its tool's links can only be repaired for the old path once
 * the other steps are put back, so `undoStartedSteps` asks for that repair after every other undo.
 */
export const RENAME_STEP_EXECUTORS: Readonly<Record<RenameStep, StepExecutor>> = {
  folder: {
    apply: async ({ move }) => { await renamePath(move.from, move.to); },
    undo: async (journal) => { await putFolderBack(journal); },
  },
  provider: {
    apply: async ({ move }, ports) => { await ports.providers.relocate(move.from, move.to); },
    undo: () => Promise.resolve(),
  },
  storeDirs: {
    apply: async ({ dirMoves }) => { for (const dirMove of dirMoves) await applyDirMove(dirMove); },
    undo: async ({ dirMoves }) => { await eachSettled([...dirMoves].reverse(), undoDirMove); },
  },
  headers: {
    apply: async ({ rewrites }) => {
      for (const { file, before, after } of rewrites) {
        const outcome = await rewriteSessionHeaderPaths(file, before, after).catch(goneFile);
        if (outcome === "elsewhere") throw new Error(`The session file ${file} no longer has the header the rename planned for`);
      }
    },
    undo: async (journal) => { await eachSettled(journal.rewrites, (rewrite) => putHeaderBack(rewrite, journal)); },
  },
  archive: {
    apply: async ({ archived }, ports) => { await ports.archive.relocate(archived); },
    undo: async ({ archived }, ports) => { await ports.archive.relocate(archived.map(({ sessionId, from, to }) => ({ sessionId, from: to, to: from }))); },
  },
  sessions: {
    apply: async ({ sessions }, ports) => { await relocateSessionRecords(sessions, ports); },
    undo: async ({ sessions }, ports) => { await relocateSessionRecords(sessions.map(({ sessionId, from, to }) => ({ sessionId, from: to, to: from })), ports); },
  },
  trust: {
    apply: ({ trust }, ports) => {
      applyTrustMoves(ports.agentDir, trust);
      return Promise.resolve();
    },
    undo: async ({ trust }, ports) => { await undoTrustMoves(ports.agentDir, trust); },
  },
  projects: {
    apply: async ({ projects }, ports) => { await ports.projects.relocate(projects); },
    undo: async ({ projects }, ports) => { await ports.projects.relocate(projects.map(({ id, from, to }) => ({ id, from: to, to: from }))); },
  },
};

/**
 * What putting a rename back left undone. `failures` are PI WEB's and Pi's own records that could
 * not go back yet: they keep the journal, and the put-back is tried again. `unrestorable` is what
 * a put-back cannot restore (`CannotPutBack`, a provider's repair): told, and not tried again.
 */
export interface PutBackOutcome {
  readonly failures: readonly unknown[];
  readonly unrestorable: readonly unknown[];
}

/**
 * Undo every step the journal says started, newest first, then let the providers repair the old
 * path. Every undo runs even when one fails, and an undo of many files goes on past one that
 * fails: everything that can go back does.
 */
export async function undoStartedSteps(journal: RenameJournal, ports: RenameStepPorts): Promise<PutBackOutcome> {
  const started = journal.started === undefined ? -1 : RENAME_STEPS.indexOf(journal.started);
  const failures: unknown[] = [];
  const unrestorable: unknown[] = [];
  const sort = (error: unknown): void => {
    for (const each of eachError(error)) (each instanceof CannotPutBack ? unrestorable : failures).push(each);
  };
  for (const step of RENAME_STEPS.slice(0, started + 1).reverse()) {
    try {
      await RENAME_STEP_EXECUTORS[step].undo(journal, ports);
    } catch (error) {
      sort(error);
    }
  }
  if (started >= RENAME_STEPS.indexOf("provider")) {
    try {
      await ports.providers.relocate(journal.move.to, journal.move.from);
    } catch (error) {
      unrestorable.push(...eachError(error));
    }
  }
  return { failures, unrestorable };
}

function eachError(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(eachError) : [error];
}

/** Run `undo` for every item, past the ones that fail; their failures, if any, come back together. */
async function eachSettled<T>(items: readonly T[], undo: (item: T) => Promise<void>): Promise<void> {
  const errors: unknown[] = [];
  for (const item of items) {
    try {
      await undo(item);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, `${String(errors.length)} could not be put back`);
}

/**
 * A header back as it was, wherever its file is now: at the path the plan moved it to, or back
 * at its old one when its store directory went back before an earlier try reached the header.
 */
async function putHeaderBack(rewrite: HeaderRewrite, journal: RenameJournal): Promise<void> {
  const { before, after } = rewrite;
  const places = headerFilePlaces(rewrite, journal);
  const outcomes: SessionHeaderRewrite[] = [];
  for (const place of places) outcomes.push(await rewriteSessionHeaderPaths(place, after, before).catch(goneFile));
  if (outcomes.includes("rewritten") || outcomes.every((outcome) => outcome === "unchanged")) return;
  if (outcomes.includes("elsewhere")) throw new CannotPutBack(`${rewrite.file} changed while the folder was renamed, so its header was left as it is`);
}

/** Where a rewritten session file can be while its rename is put back: where the plan moved it, and where it was. */
export function headerFilePlaces({ file }: HeaderRewrite, { dirMoves, move }: RenameJournal): string[] {
  const unmoved: FolderMove[] = [...dirMoves.map(({ from, to }) => ({ from: to, to: from })), { from: move.to, to: move.from }];
  return [...new Set([file, afterMoves(file, unmoved)])];
}

async function relocateSessionRecords(moves: readonly MovedSession[], ports: RenameStepPorts): Promise<void> {
  await ports.sessions.relocateSessions(moves);
  for (const file of ports.runFiles) await relocateRuns(moves, file);
}

async function applyDirMove({ from, to, entries }: StoreDirMove): Promise<void> {
  if (entries === undefined) {
    await renamePath(from, to);
    return;
  }
  await mkdir(to, { recursive: true });
  for (const entry of entries) await renamePath(join(from, entry), join(to, entry));
}

/**
 * A store directory back where it was: whole when it moved whole, entry by entry when it was
 * emptied into one already there. A session started at the old path between tries makes Pi create
 * the directory there again, and `moveBack` then merges the moved entries in beside the new ones.
 */
async function undoDirMove({ from, to, entries }: StoreDirMove): Promise<void> {
  if (entries === undefined) {
    await moveBack(to, from);
    return;
  }
  await mkdir(from, { recursive: true });
  await eachSettled(entries, (entry) => moveBack(join(to, entry), join(from, entry)));
}

/**
 * Where the renamed folder is, as putting it back sees it.
 * - `back`: something is at the old name only, or the folder at the old name is ours: nothing to do.
 *   A folder made at the old name by hand while ours was moved away is taken for ours too: once a
 *   reboot may have changed the identity, nothing tells the two apart.
 * - `at-new`: the old name is free and something is at the new one: it goes back. A folder's identity
 *   can change across a reboot (removable drives, some mounts), so it decides only when both names
 *   are taken, and the folder's recorded disk only whether one under neither name is on a disk
 *   that is not mounted yet.
 * - `case-only`: one folder under both names, a rename that changed only the letter case: the
 *   folder's own listing says which name it has.
 * - `both`: ours at the new name and something else at the old, or two folders neither of which is
 *   known to be ours: nothing is moved over, and the put-back is tried again once one is moved away.
 * - `unmounted`: neither name, and the folder that holds them is missing or on another disk than
 *   the renamed folder was: a volume not mounted yet, or its empty mount point.
 * - `gone`: neither name, in the folder that held them on the same disk: moved away outside PI WEB.
 */
type FolderPlace = "back" | "at-new" | "case-only" | "both" | "unmounted" | "gone";

function folderPlace(atNew: PathIdentity | undefined, atOld: PathIdentity | undefined, folder: PathIdentity, parentOnItsDisk: boolean): FolderPlace {
  if (atOld === undefined) {
    if (atNew !== undefined) return "at-new";
    return parentOnItsDisk ? "gone" : "unmounted";
  }
  if (sameIdentity(atNew, atOld)) return "case-only";
  if (atNew === undefined || sameIdentity(atOld, folder)) return "back";
  return "both";
}

const FOLDER_PUT_BACK: Readonly<Record<FolderPlace, (move: FolderMove) => Promise<void>>> = {
  back: () => Promise.resolve(),
  "at-new": async (move) => { await renamePath(move.to, move.from); },
  "case-only": async (move) => { if (await listedUnderName(move.to)) await renamePath(move.to, move.from); },
  both: (move) => Promise.reject(new Error(`Both ${move.from} and ${move.to} exist, so the folder stays at ${move.to}; move the one that is not the project away`)),
  unmounted: (move) => Promise.reject(new Error(`Neither ${move.to} nor ${move.from} is there, and the disk that held them is not mounted; the put-back waits for it`)),
  gone: (move) => Promise.reject(new CannotPutBack(`The folder is no longer at ${move.to} or ${move.from}: it was moved outside PI WEB`)),
};

async function putFolderBack({ move, folder }: RenameJournal): Promise<void> {
  const [atNew, atOld, parent] = await Promise.all([identityOf(move.to), identityOf(move.from), identityOf(dirname(move.from))]);
  await FOLDER_PUT_BACK[folderPlace(atNew, atOld, folder, parent?.dev === folder.dev)](move);
}

/**
 * Move `moved` back to `original`: nothing to do when it is not there. A folder at both - one made
 * again at the old place since, such as a store directory or an extension's artifacts folder in it -
 * takes the moved one's entries back one by one, folders both hold merged the same way, and the
 * emptied folder goes unless something was written into it meanwhile. Anything else under one
 * name on both sides (an extension's marker file written again) stays where it was moved and is
 * not put back: no later try would change it, and trying again forever would stop every rename.
 */
async function moveBack(moved: string, original: string): Promise<void> {
  if (!await pathExists(moved)) return;
  if (!await freeFor(original, moved)) {
    if (!await isFolder(moved) || !await isFolder(original)) throw new CannotPutBack(`${original} is there already, so ${moved} stays where it is`);
    await eachSettled(await readdir(moved), (entry) => moveBack(join(moved, entry), join(original, entry)));
    await rmdir(moved).catch(() => undefined);
    return;
  }
  if (await samePath(original, moved) && !await listedUnderName(moved)) return;
  await renamePath(moved, original);
}

/** A session file gone since the plan has nothing left to rewrite. */
function goneFile(error: unknown): "unchanged" {
  if (isAbsentPathError(error)) return "unchanged";
  throw error;
}
