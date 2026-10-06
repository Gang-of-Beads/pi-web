/**
 * Which pages Go to offers (docs/design/go-to-scopes.md, owner 2026-10-05). On a Navigate page,
 * its switch decides: "All projects" is no project, even while a workspace stays selected behind
 * it. Anywhere else Go to follows what is open (owner, ask `79cb2bc6`): a project's session or
 * page offers that project's pages; nothing open, or a global page, offers the global pages. The
 * desktop's navigation page only chooses what its list shows.
 */
export type GoToScope = "machine" | "workspace";

/** What a Navigate page lists when it asks for Go to: the whole machine, or one project. */
export type NavigateListScope = "machine" | "project";

/** The kind of the page on screen: a project's, a global one, or none. */
export type ShownPageKind = "project" | "global" | undefined;

export interface GoToScopeInput {
  readonly hasWorkspace: boolean;
  /** The Navigate page's switch when Go to was opened from one; undefined anywhere else. */
  readonly openedFrom: NavigateListScope | undefined;
  /** A project's session is open on screen (the phone's chat; the desktop's middle column). */
  readonly sessionOnScreen: boolean;
  readonly shownPage: ShownPageKind;
}

export function goToScope(input: GoToScopeInput): GoToScope {
  if (input.openedFrom !== undefined) return input.openedFrom === "project" && input.hasWorkspace ? "workspace" : "machine";
  if (!input.hasWorkspace) return "machine";
  if (input.sessionOnScreen) return "workspace";
  return input.shownPage === "project" ? "workspace" : "machine";
}
