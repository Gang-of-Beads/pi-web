/**
 * What the row menu offers, per kind of row.
 *
 * Every list row is one thing on the left and one control on the right: the
 * name, and the menu that acts on it. What "acting on it" means depends on the
 * kind, and naming those sets in one place keeps the page a dumb executor -
 * a row cannot grow an action the product never agreed to.
 */

export type NavigateRowKind = "session" | "project" | "machine";

export type NavigateRowActionId = "open" | "pin" | "unpin" | "rename" | "copy-path" | "close-project";

export interface NavigateRowAction {
  id: NavigateRowActionId;
  label: string;
}

export interface NavigateRowFacts {
  pinned?: boolean;
  renamable?: boolean;
  closable?: boolean;
  hasPath?: boolean;
}

const OPEN: Record<NavigateRowKind, string> = {
  session: "Open",
  project: "Open",
  machine: "Switch to this machine",
};

export function navigateRowActions(kind: NavigateRowKind, facts: NavigateRowFacts = {}): NavigateRowAction[] {
  const actions: NavigateRowAction[] = [{ id: "open", label: OPEN[kind] }];
  if (kind === "session") {
    actions.push(facts.pinned === true ? { id: "unpin", label: "Unpin" } : { id: "pin", label: "Pin to top" });
    if (facts.renamable === true) actions.push({ id: "rename", label: "Rename" });
  }
  if (kind === "project") {
    actions.push(facts.pinned === true ? { id: "unpin", label: "Unpin" } : { id: "pin", label: "Pin to top" });
    if (facts.hasPath === true) actions.push({ id: "copy-path", label: "Copy path" });
    if (facts.closable === true) actions.push({ id: "close-project", label: "Close project" });
  }
  return actions;
}
