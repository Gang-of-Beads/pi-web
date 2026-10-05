/**
 * Which pages Go to offers (docs/design/go-to-scopes.md, owner 2026-10-05): the scope the reader
 * is looking at, not the selection behind it. A Navigate page widened to the machine ("All
 * projects") is no project, even while a workspace stays selected behind it, and a plugin page
 * that needs a project has no button there.
 */
export type GoToScope = "machine" | "workspace";

/** What a Navigate page lists when it asks for Go to: the whole machine, or one project. */
export type NavigateListScope = "machine" | "project";

export interface GoToScopeInput {
  readonly hasWorkspace: boolean;
  /** The Navigate page's scope when Go to was opened from one; undefined from a chat or plugin page. */
  readonly openedFrom: NavigateListScope | undefined;
}

export function goToScope(input: GoToScopeInput): GoToScope {
  if (!input.hasWorkspace) return "machine";
  return input.openedFrom === "machine" ? "machine" : "workspace";
}
