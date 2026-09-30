import type { BoardAnswer } from "./sync/sessionBoard";

/**
 * What an empty quick-access menu means.
 *
 * "No sessions yet." was said for situations that were not about emptiness:
 * sessions still being read, a failed read, a search with no match, and a
 * context path narrowed to a scope that holds nothing. Absence is not
 * negation (B48, P1 slice 5): while any source of the board has not answered,
 * a missing row may be in it, so the menu says nothing - it retries by itself
 * and never says it is reading or that it failed. Once every source answered,
 * each empty state is named, and the one the reader can undo offers the undo.
 */

export type SwitcherEmptyMeaning =
  | { kind: "unknown" }
  | { kind: "query"; message: string }
  | { kind: "scope"; message: string; widen: true }
  | { kind: "empty"; message: string }
  | { kind: "none" };

interface EmptyInput {
  answer: BoardAnswer;
  matchCount: number;
  query: string;
  /** Whether the context path narrows to something smaller than the machine. */
  scoped: boolean;
}

export function switcherEmptyMeaning(input: EmptyInput): SwitcherEmptyMeaning {
  if (input.matchCount > 0) return { kind: "none" };
  if (input.answer !== "complete") return { kind: "unknown" };
  const query = input.query.trim();
  if (query !== "") return { kind: "query", message: `No sessions match “${query}”.` };
  if (input.scoped) return { kind: "scope", message: "No sessions in this part of the path.", widen: true };
  return { kind: "empty", message: "No sessions yet." };
}

/**
 * Why the list can be wider than the path says.
 *
 * Workspaces load per project, so a project chosen before its response lands
 * has no known folders, and filtering against nothing would hide every
 * session including the open one. The list therefore stays unfiltered - and
 * then the path claims a scope the list is not keeping. Rather than pick
 * between a wrong list and a wrong path, the menu says which one is provisional.
 */
export function switcherScopeNotice(input: { projectId: string | undefined; knownFolderCount: number }): string | undefined {
  if (input.projectId === undefined || input.knownFolderCount > 0) return undefined;
  return "Folders for this project are still loading, so every session is listed.";
}
