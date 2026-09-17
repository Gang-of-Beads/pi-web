/**
 * What an empty quick-access menu means.
 *
 * "No sessions yet." was said for four different situations: sessions still
 * loading, a failed read, a search with no match, and a context path narrowed
 * to a scope that happens to hold nothing. Only the last of those is about
 * this scope, and only the first two are about not knowing - absence is not
 * negation, so each state is named and the one the reader can undo offers the
 * undo.
 */

export type SwitcherEmptyMeaning =
  | { kind: "loading"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "query"; message: string }
  | { kind: "scope"; message: string; widen: true }
  | { kind: "empty"; message: string }
  | { kind: "none" };

interface EmptyInput {
  loadError: string | undefined;
  loading: boolean;
  matchCount: number;
  query: string;
  /** Whether the context path narrows to something smaller than the machine. */
  scoped: boolean;
}

export function switcherEmptyMeaning(input: EmptyInput): SwitcherEmptyMeaning {
  if (input.loadError !== undefined) return { kind: "failed", message: input.loadError };
  if (input.loading) return { kind: "loading", message: "Loading sessions…" };
  if (input.matchCount > 0) return { kind: "none" };
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
