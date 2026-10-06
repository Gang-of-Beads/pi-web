/**
 * Which pages Go to offers (docs/design/go-to-scopes.md, owner 2026-10-05). On a Navigate page,
 * its switch decides: "All projects" is no project, even while a workspace stays selected behind
 * it. Anywhere else Go to follows what is open (owner, ask `79cb2bc6`): a project's session or
 * page offers that project's pages; nothing open, or a global page, offers the global pages. The
 * desktop's navigation page only chooses what its list shows.
 */
export type GoToScope = "machine" | "workspace";

/**
 * What a Navigate page lists when it asks for Go to: the whole machine, or one project, named, so
 * a project still loading behind the page cannot borrow the last one's pages (review triage,
 * go-to-global-pages).
 */
export type NavigateListScope = { readonly kind: "machine" } | { readonly kind: "project"; readonly projectId: string };

/** The kind of the page on screen: a project's, a global one, or none. */
export type ShownPageKind = "project" | "global" | undefined;

export interface GoToScopeInput {
  /** The project of the selected workspace; undefined with no workspace selected. */
  readonly workspaceProjectId: string | undefined;
  /** The Navigate page's switch when Go to was opened from one; undefined anywhere else. */
  readonly openedFrom: NavigateListScope | undefined;
  /** A project's session is open on screen (the phone's chat; the desktop's middle column). */
  readonly sessionOnScreen: boolean;
  readonly shownPage: ShownPageKind;
}

export function goToScope(input: GoToScopeInput): GoToScope {
  const openedFrom = input.openedFrom;
  if (openedFrom !== undefined) return openedFrom.kind === "project" && openedFrom.projectId === input.workspaceProjectId ? "workspace" : "machine";
  if (input.workspaceProjectId === undefined) return "machine";
  if (input.sessionOnScreen) return "workspace";
  return input.shownPage === "project" ? "workspace" : "machine";
}
