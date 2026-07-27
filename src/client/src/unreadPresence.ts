import type { Project, Workspace } from "./api";
import type { SessionUnreadProjectionView } from "./sessionUnread";

/**
 * Bubble-up unread *presence* (booleans, never counts) derived from
 * `SessionUnreadController` projections, following the charter mapping chain
 * cwd → workspace → project → machine:
 *
 * - A machine has presence when its projection carries ANY unread summary,
 *   including cwds that map to no known workspace — the honest catch-all.
 * - A workspace has presence when an unread cwd equals its path exactly.
 * - A project has presence only when one of its known workspaces has presence;
 *   a cwd matching no known workspace lights the machine dot only, never a
 *   project or workspace row (even when it sits under the project path).
 * - An undefined projection (unsupported/unknown capability or not yet
 *   loaded) yields no presence. Stale-but-present data still counts, the same
 *   tolerance `SessionUnreadController.unreadSessionIds` applies.
 *
 * Workspace/project presence can only be derived for the machine whose
 * projects and workspaces are loaded — the selected one.
 */

export interface UnreadPresence {
  readonly machines: ReadonlySet<string>;
  readonly projects: ReadonlySet<string>;
  readonly workspaces: ReadonlySet<string>;
}

/** Shared empty value; consumers must treat it as immutable. */
export const EMPTY_UNREAD_PRESENCE: UnreadPresence = {
  machines: new Set(),
  projects: new Set(),
  workspaces: new Set(),
};

export interface UnreadPresenceInputs {
  readonly machineIds: readonly string[];
  readonly projectionFor: (machineId: string) => SessionUnreadProjectionView | undefined;
  readonly selectedMachineId: string;
  readonly projects: readonly Project[];
  /** Visible workspace rows (the selected project's workspaces). */
  readonly workspaces: readonly Workspace[];
  readonly workspacesByProjectId: Record<string, readonly Workspace[]>;
}

export function deriveUnreadPresence(input: UnreadPresenceInputs): UnreadPresence {
  const cwds = unreadCwds(input.projectionFor(input.selectedMachineId));
  return {
    machines: machineUnreadPresence(input.machineIds, input.projectionFor),
    projects: projectUnreadPresence(input.projects, input.workspacesByProjectId, cwds),
    workspaces: workspaceUnreadPresence(input.workspaces, cwds),
  };
}

export function hasUnreadSessions(projection: Pick<SessionUnreadProjectionView, "sessions"> | undefined): boolean {
  return projection !== undefined && projection.sessions.length > 0;
}

export function unreadCwds(projection: Pick<SessionUnreadProjectionView, "sessions"> | undefined): ReadonlySet<string> {
  if (projection === undefined || projection.sessions.length === 0) return EMPTY_CWDS;
  return new Set(projection.sessions.map((summary) => summary.cwd));
}

export function machineUnreadPresence(
  machineIds: readonly string[],
  projectionFor: (machineId: string) => SessionUnreadProjectionView | undefined,
): ReadonlySet<string> {
  const present = new Set<string>();
  for (const machineId of machineIds) {
    if (hasUnreadSessions(projectionFor(machineId))) present.add(machineId);
  }
  return present;
}

export function workspaceUnreadPresence(workspaces: readonly Workspace[], cwds: ReadonlySet<string>): ReadonlySet<string> {
  const present = new Set<string>();
  for (const workspace of workspaces) {
    if (cwds.has(workspace.path)) present.add(workspace.id);
  }
  return present;
}

export function projectUnreadPresence(
  projects: readonly Project[],
  workspacesByProjectId: Record<string, readonly Workspace[]>,
  cwds: ReadonlySet<string>,
): ReadonlySet<string> {
  const present = new Set<string>();
  for (const project of projects) {
    const workspaces = workspacesByProjectId[project.id] ?? [];
    if (workspaces.some((workspace) => cwds.has(workspace.path))) present.add(project.id);
  }
  return present;
}

export function sameUnreadPresence(left: UnreadPresence, right: UnreadPresence): boolean {
  return sameStringSet(left.machines, right.machines)
    && sameStringSet(left.projects, right.projects)
    && sameStringSet(left.workspaces, right.workspaces);
}

const EMPTY_CWDS: ReadonlySet<string> = new Set();

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
