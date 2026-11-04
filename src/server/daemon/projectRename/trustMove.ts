import { realpathSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, join, posix, resolve, win32 } from "node:path";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../../../shared/unknownValues.js";
import type { FolderMove } from "./folderMove.js";
import { isAbsentPathError } from "./pathFacts.js";

/** One saved trust decision that follows the folder it was made for. */
export interface TrustKeyMove {
  readonly from: string;
  readonly to: string;
  readonly trusted: boolean;
  /** What the new path held before, put back if the rename is. */
  readonly previous: boolean | undefined;
}

/**
 * The decisions in Pi's `trust.json` saved for the moved folder or a folder inside it. Pi looks a
 * decision up by the folder's path, so one left under the old path would make the renamed project
 * untrusted (or trusted) by accident of a default.
 *
 * Pi keys a decision by the folder's real path (links resolved) and, on Windows, compares keys
 * without regard to case; a key matches the moved folder the same way. A folder that is itself a
 * link is renamed as a link: the folder it points at, which the decisions name, does not move.
 */
export async function planTrustMoves(agentDir: string, move: FolderMove): Promise<TrustKeyMove[]> {
  if ((await lstat(move.from)).isSymbolicLink()) return [];
  const decisions = await readDecisions(agentDir);
  const roots = movedRoots(move);
  const moves: TrustKeyMove[] = [];
  for (const [key, trusted] of Object.entries(decisions)) {
    if (typeof trusted !== "boolean") continue;
    const to = roots.map((root) => movedKey(key, root)).find((moved) => moved !== undefined);
    if (to === undefined) continue;
    const previous = Object.entries(decisions).find(([other]) => comparisonKey(other) === comparisonKey(to))?.[1];
    moves.push({ from: key, to, trusted, previous: typeof previous === "boolean" ? previous : undefined });
  }
  return moves;
}

/** Write the moves under Pi's own lock, one change of the file. */
export function applyTrustMoves(agentDir: string, moves: readonly TrustKeyMove[]): void {
  if (moves.length === 0) return;
  new ProjectTrustStore(agentDir).setMany(moves.flatMap(({ from, to, trusted }) => [
    { path: from, decision: null },
    { path: to, decision: trusted },
  ]));
}

/** Put the decisions back where they were, and the new path's own back as it was; a file that already holds them is left alone. */
export async function undoTrustMoves(agentDir: string, moves: readonly TrustKeyMove[]): Promise<void> {
  if (moves.length === 0) return;
  const decisions = await readDecisions(agentDir);
  const holds = (path: string): unknown => Object.entries(decisions).find(([key]) => comparisonKey(key) === comparisonKey(path))?.[1];
  if (moves.every(({ from, to, trusted, previous }) => holds(from) === trusted && holds(to) === previous)) return;
  new ProjectTrustStore(agentDir).setMany(moves.flatMap(({ from, to, trusted, previous }) => [
    { path: to, decision: previous ?? null },
    { path: from, decision: trusted },
  ]));
}

/** The moved folder as a key can name it: its real path, and the path as given for a key saved before the folder existed. */
function movedRoots(move: FolderMove): FolderMove[] {
  const given = resolve(move.from);
  const real = realPath(given);
  const roots = [{ from: real, to: join(dirname(real), basename(move.to)) }, { from: given, to: resolve(move.to) }];
  return roots.filter((root, index) => roots.findIndex((other) => comparisonKey(other.from) === comparisonKey(root.from)) === index);
}

function movedKey(key: string, root: FolderMove): string | undefined {
  const keyed = comparisonKey(key);
  const from = comparisonKey(root.from);
  if (keyed === from) return root.to;
  const separator = process.platform === "win32" ? win32.sep : posix.sep;
  if (!keyed.startsWith(from.endsWith(separator) ? from : `${from}${separator}`)) return undefined;
  return join(root.to, resolve(key).slice(resolve(root.from).length));
}

/** Pi's own comparison: the resolved path, case-folded on Windows. */
function comparisonKey(path: string): string {
  return process.platform === "win32" ? win32.resolve(path).toLowerCase() : posix.resolve(path);
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

async function readDecisions(agentDir: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(join(resolve(agentDir), "trust.json"), "utf8");
  } catch (error) {
    if (isAbsentPathError(error)) return {};
    throw error;
  }
  const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
  if (!isRecord(parsed)) throw new Error(`Pi's trust store ${join(resolve(agentDir), "trust.json")} is not an object`);
  return parsed;
}
