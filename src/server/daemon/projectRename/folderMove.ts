import { join, relative, resolve } from "node:path";
import { expandHomePath, insideFolder } from "../workingDirectory.js";

/** A folder that moved, and every path inside it with it. */
export interface FolderMove {
  readonly from: string;
  readonly to: string;
}

/** Where `path` is after `move`, or undefined when it was not inside the moved folder. */
export function movedPath(path: string, move: FolderMove): string | undefined {
  if (!insideFolder(path, move.from)) return undefined;
  const rest = relative(resolve(expandHomePath(move.from)), resolve(expandHomePath(path)));
  return rest === "" ? move.to : join(move.to, rest);
}

/** `path` after the first of `moves` it was inside, or itself. */
export function afterMoves(path: string, moves: readonly FolderMove[]): string {
  for (const move of moves) {
    const moved = movedPath(path, move);
    if (moved !== undefined) return moved;
  }
  return path;
}
