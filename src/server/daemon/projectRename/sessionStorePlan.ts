import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runWithConcurrency } from "../../../shared/concurrency.js";
import type { ArchivedPathsChange, ArchivedSessionPaths, ArchivedSessionRecord } from "../sessions/sessionArchiveStore.js";
import { readSessionHeader, type SessionHeaderSummary } from "../sessions/sessionFileHeader.js";
import type { SessionHeaderPaths } from "../sessions/sessionHeaderRewrite.js";
import { sessionDirInDefaultPiStore } from "../sessions/piSessionManagerGateway.js";
import { canonicalizeStoredCwd, cwdPathsEqual, folderKey, insideFolder } from "../workingDirectory.js";
import { afterMoves, movedPath, type FolderMove } from "./folderMove.js";
import { freeFor, isAbsentPathError, pathExists } from "./pathFacts.js";

/** How many session files are read at once; a store can hold thousands. */
const HEADER_READS_AT_ONCE = 16;

/** A directory of Pi's session store that follows the folder: renamed whole, or emptied entry by entry into one already there. */
export interface StoreDirMove {
  readonly from: string;
  readonly to: string;
  /** Present when `to` existed: the entries moved one by one. */
  readonly entries?: readonly string[];
}

export interface HeaderRewrite {
  /** Where the file is once every directory has moved. */
  readonly file: string;
  readonly before: SessionHeaderPaths;
  readonly after: SessionHeaderPaths;
}

/** A session whose working directory moved with the folder. */
export interface MovedSession {
  readonly sessionId: string;
  readonly from: string;
  readonly to: string;
}

export type SessionStorePlan =
  | {
    readonly kind: "ready";
    readonly dirMoves: readonly StoreDirMove[];
    readonly rewrites: readonly HeaderRewrite[];
    readonly sessions: readonly MovedSession[];
    readonly archived: readonly ArchivedPathsChange[];
  }
  | { readonly kind: "unmovable"; readonly reason: string };

export interface SessionStorePlanInput {
  readonly move: FolderMove;
  /** Pi's default store: one directory per working directory. */
  readonly storeRoot: string;
  /** Session directories the configuration names instead; their files stay where they are. */
  readonly configuredDirs: readonly string[];
  readonly archived: readonly ArchivedSessionRecord[];
  /** Files of sessions open outside the folder: being written, so their parent link keeps the old path. */
  readonly openSessionFiles: ReadonlySet<string>;
}

interface StoredFile {
  readonly file: string;
  readonly header: SessionHeaderSummary;
}

/**
 * Which of Pi's session files follow a renamed folder, and how.
 *
 * Pi keeps a session in the store directory named after the folder it ran in and writes that
 * folder into the file's first line; both must follow the folder, or the sessions stay listed under
 * a folder that no longer exists. A store directory moves whole when every session in it ran in
 * the moved folder (its sub-agent runs and artifacts beside the sessions move with it). One that
 * also holds another folder's sessions - Pi's directory names fold `/` and `-` together, so two
 * folders can share one - cannot be split safely, and the rename is refused rather than guessed.
 * A session elsewhere whose parent moved keeps its link by having the parent's new file written in,
 * unless it is open: its file is being written, and its link keeps the old path.
 */
export async function planSessionStore(input: SessionStorePlanInput): Promise<SessionStorePlan> {
  const { move } = input;
  const storeDirs: { dir: string; files: StoredFile[] }[] = [];
  for (const name of await storeDirNames(input.storeRoot)) {
    const dir = join(input.storeRoot, name);
    storeDirs.push({ dir, files: await sessionFilesIn(dir) });
  }
  const dirMoves: StoreDirMove[] = [];
  const staying: StoredFile[] = [];
  const moving: StoredFile[] = [];
  const targets = new Set<string>();
  for (const { dir, files } of storeDirs) {
    const inside = files.filter(({ header }) => header.cwd !== undefined && insideFolder(header.cwd, move.from));
    if (inside.length === 0) {
      staying.push(...files);
      continue;
    }
    const outside = files.filter(({ header }) => header.cwd !== undefined && !insideFolder(header.cwd, move.from));
    const folders = new Map(inside.map(({ header }) => [folderKey(header.cwd ?? ""), canonicalizeStoredCwd(header.cwd ?? "")]));
    const [folder] = [...folders.values()];
    if (outside.length > 0 || folders.size !== 1 || folder === undefined) {
      return { kind: "unmovable", reason: `Pi's session directory ${dir} also holds sessions of other folders` };
    }
    const to = sessionDirInDefaultPiStore(input.storeRoot, movedPath(folder, move) ?? folder);
    if (targets.has(to)) return { kind: "unmovable", reason: `Two of Pi's session directories would both become ${to}` };
    targets.add(to);
    const dirMove = await storeDirMove(dir, to);
    if (dirMove === undefined) return { kind: "unmovable", reason: `Pi's session directory ${to} already holds a file of the same name as one in ${dir}` };
    dirMoves.push(dirMove);
    moving.push(...files);
  }

  const pathMoves: FolderMove[] = [...dirMoves.map(({ from, to }) => ({ from, to })), move];
  const configured: StoredFile[] = [];
  for (const dir of input.configuredDirs) configured.push(...await sessionFilesIn(dir));
  const insideConfigured = configured.filter(({ header }) => header.cwd !== undefined && insideFolder(header.cwd, move.from));
  const rewrites: HeaderRewrite[] = [];
  const sessions: MovedSession[] = [];
  for (const stored of [...moving, ...insideConfigured]) {
    const cwd = stored.header.cwd;
    const after = { cwd: cwd === undefined ? undefined : movedPath(cwd, move) ?? cwd, parentSession: movedParent(stored.header.parentSession, pathMoves) };
    rewrites.push({ file: afterMoves(stored.file, pathMoves), before: headerPaths(stored.header), after });
    if (cwd !== undefined) sessions.push({ sessionId: stored.header.id, from: canonicalizeStoredCwd(cwd), to: canonicalizeStoredCwd(after.cwd ?? cwd) });
  }
  const linked = [...staying, ...configured.filter((stored) => !insideConfigured.includes(stored))];
  for (const stored of linked) {
    const parentSession = movedParent(stored.header.parentSession, pathMoves);
    if (parentSession === stored.header.parentSession || input.openSessionFiles.has(stored.file)) continue;
    rewrites.push({ file: stored.file, before: headerPaths(stored.header), after: { cwd: stored.header.cwd, parentSession } });
  }

  const archived: ArchivedPathsChange[] = [];
  for (const record of input.archived) {
    const after = archivedPathsAfter(record, move, pathMoves);
    if (after === undefined) continue;
    archived.push({ sessionId: record.sessionId, from: archivedPaths(record), to: after });
    if (record.archivePath !== undefined) {
      const header = await readSessionHeader(record.archivePath);
      if (header !== undefined) {
        rewrites.push({
          file: record.archivePath,
          before: headerPaths(header),
          after: { cwd: header.cwd === undefined ? undefined : movedPath(header.cwd, move) ?? header.cwd, parentSession: movedParent(header.parentSession, pathMoves) },
        });
      }
    }
    if (!cwdPathsEqual(after.cwd, record.cwd)) sessions.push({ sessionId: record.sessionId, from: record.cwd, to: after.cwd });
  }
  return { kind: "ready", dirMoves, rewrites: rewrites.filter(changesHeader), sessions: uniqueSessions(sessions), archived };
}

function changesHeader(rewrite: HeaderRewrite): boolean {
  return rewrite.before.cwd !== rewrite.after.cwd || rewrite.before.parentSession !== rewrite.after.parentSession;
}

function headerPaths(header: SessionHeaderSummary): SessionHeaderPaths {
  return { cwd: header.cwd, parentSession: header.parentSession };
}

function movedParent(parentSession: string | undefined, moves: readonly FolderMove[]): string | undefined {
  return parentSession === undefined ? undefined : afterMoves(parentSession, moves);
}

function archivedPaths(record: ArchivedSessionRecord): ArchivedSessionPaths {
  return {
    cwd: record.cwd,
    ...(record.originalPath === undefined ? {} : { originalPath: record.originalPath }),
    ...(record.parentSessionPath === undefined ? {} : { parentSessionPath: record.parentSessionPath }),
  };
}

function archivedPathsAfter(record: ArchivedSessionRecord, move: FolderMove, pathMoves: readonly FolderMove[]): ArchivedSessionPaths | undefined {
  const cwd = movedPath(record.cwd, move) ?? record.cwd;
  const originalPath = record.originalPath === undefined ? undefined : afterMoves(record.originalPath, pathMoves);
  const parentSessionPath = movedParent(record.parentSessionPath, pathMoves);
  if (cwd === record.cwd && originalPath === record.originalPath && parentSessionPath === record.parentSessionPath) return undefined;
  return {
    cwd,
    ...(originalPath === undefined ? {} : { originalPath }),
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

function uniqueSessions(sessions: readonly MovedSession[]): MovedSession[] {
  return [...new Map(sessions.map((session) => [session.sessionId, session])).values()];
}

async function storeDirMove(from: string, to: string): Promise<StoreDirMove | undefined> {
  if (await freeFor(to, from)) return { from, to };
  const entries = await readdir(from);
  for (const entry of entries) {
    if (await pathExists(join(to, entry))) return undefined;
  }
  return { from, to, entries };
}

/** The store's directories; a store not made yet has none, and one that cannot be read is an error. */
async function storeDirNames(storeRoot: string): Promise<string[]> {
  return (await listDir(storeRoot)).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function sessionFilesIn(dir: string): Promise<StoredFile[]> {
  const files = (await listDir(dir)).filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => join(dir, entry.name));
  const read: StoredFile[] = [];
  await runWithConcurrency(files.map((file) => async () => {
    const header = await readSessionHeader(file);
    if (header !== undefined) read.push({ file, header });
  }), HEADER_READS_AT_ONCE);
  return read;
}

async function listDir(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isAbsentPathError(error)) return [];
    throw error;
  }
}

