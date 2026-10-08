/**
 * What the row menu offers, per kind of row.
 *
 * Every list row is one thing on the left and one control on the right: the
 * name, and the menu that acts on it. What "acting on it" means depends on the
 * kind, and naming those sets in one place keeps the page a dumb executor -
 * a row cannot grow an action the product never agreed to.
 */

export type NavigateRowKind = "session" | "project" | "machine";

export type NavigateRowActionId = "open" | "pin" | "unpin" | "pin-project" | "unpin-project" | "rename" | "archive" | "restore" | "delete-archived" | "copy-path" | "close-project";

export interface NavigateRowAction {
  id: NavigateRowActionId;
  label: string;
}

export interface NavigateRowFacts {
  pinned?: boolean;
  /** A session's pin in the project the list stands in (B49); undefined where none can be set. */
  projectPinned?: boolean | undefined;
  renamable?: boolean;
  /** The host can change this session's archive state: persisted, and on the machine it acts on. */
  archivable?: boolean;
  archived?: boolean;
  closable?: boolean;
  hasPath?: boolean;
  /** The session finished something the reader has not looked at. */
  unread?: boolean;
}

const OPEN: Record<NavigateRowKind, string> = {
  session: "Open",
  project: "Open",
  machine: "Switch to this machine",
};

/** The selectable groups of the Navigate page; a selection stays inside one (state diagram D9). */
export type NavigateBulkGroup = "live" | "archived" | "projects";

/** The bulk actions each group offers; the host's executors are keyed by these, so a missing one is a type error. */
export interface NavigateBulkActionIds {
  readonly live: "archive" | "pin" | "unpin" | "mark-read";
  readonly archived: "restore" | "delete-archived";
  readonly projects: "pin" | "unpin" | "close-project";
}

export type NavigateBulkActionId = NavigateBulkActionIds[NavigateBulkGroup];

export interface NavigateBulkAction {
  readonly id: NavigateBulkActionId;
  readonly label: string;
  /** The selected rows this action fits; it acts on these and no others. */
  readonly ids: readonly string[];
}

interface BulkRule<Id extends NavigateBulkActionId> {
  readonly id: Id;
  readonly label: string;
  readonly fits: (facts: NavigateRowFacts) => boolean;
}

/**
 * What a selection can do, per group (docs/design/bulk-selection.md; owner, 2026-10-09: the keys are verbs).
 * An action is offered when it fits at least one selected row and acts only on those, so a
 * mixed selection offers both Pin and Unpin instead of neither.
 */
const BULK_RULES: { readonly [Group in NavigateBulkGroup]: readonly BulkRule<NavigateBulkActionIds[Group]>[] } = {
  live: [
    { id: "archive", label: "Archive", fits: (facts) => facts.archivable === true },
    { id: "pin", label: "Pin", fits: (facts) => facts.pinned !== true },
    { id: "unpin", label: "Unpin", fits: (facts) => facts.pinned === true },
    { id: "mark-read", label: "Mark as read", fits: (facts) => facts.unread === true },
  ],
  archived: [
    { id: "restore", label: "Restore", fits: (facts) => facts.archivable === true },
    { id: "delete-archived", label: "Delete permanently", fits: (facts) => facts.archivable === true },
  ],
  projects: [
    { id: "pin", label: "Pin", fits: (facts) => facts.pinned !== true },
    { id: "unpin", label: "Unpin", fits: (facts) => facts.pinned === true },
    { id: "close-project", label: "Close project", fits: (facts) => facts.closable === true },
  ],
};

export function navigateBulkActions(group: NavigateBulkGroup, rows: readonly { readonly id: string; readonly facts: NavigateRowFacts }[]): NavigateBulkAction[] {
  const rules: readonly BulkRule<NavigateBulkActionId>[] = BULK_RULES[group];
  return rules.flatMap((rule) => {
    const ids = rows.filter((row) => rule.fits(row.facts)).map((row) => row.id);
    return ids.length === 0 ? [] : [{ id: rule.id, label: rule.label, ids }];
  });
}

export function navigateRowActions(kind: NavigateRowKind, facts: NavigateRowFacts = {}): NavigateRowAction[] {
  const actions: NavigateRowAction[] = [{ id: "open", label: OPEN[kind] }];
  if (kind === "session" && facts.archived === true) {
    if (facts.archivable === true) actions.push({ id: "restore", label: "Restore" }, { id: "delete-archived", label: "Delete permanently" });
    return actions;
  }
  if (kind === "session") {
    actions.push(facts.pinned === true ? { id: "unpin", label: "Unpin globally" } : { id: "pin", label: "Pin globally" });
    if (facts.projectPinned !== undefined) actions.push(facts.projectPinned ? { id: "unpin-project", label: "Unpin in this project" } : { id: "pin-project", label: "Pin in this project" });
    if (facts.renamable === true) actions.push({ id: "rename", label: "Rename" });
    if (facts.archivable === true) actions.push({ id: "archive", label: "Archive" });
  }
  if (kind === "project") {
    actions.push(facts.pinned === true ? { id: "unpin", label: "Unpin" } : { id: "pin", label: "Pin to top" });
    if (facts.hasPath === true) actions.push({ id: "copy-path", label: "Copy path" });
    if (facts.closable === true) actions.push({ id: "close-project", label: "Close project" });
  }
  return actions;
}
