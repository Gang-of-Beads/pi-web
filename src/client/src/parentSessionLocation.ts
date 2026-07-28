import type { Project, SessionInfo, Workspace } from "./api";
import { normalizeSessionPath } from "./sessionPaths";

/**
 * Where a session's parent lives, when the parent is not in the current
 * workspace's session list.
 *
 * - `workspace`: the parent's cwd matches a workspace PI WEB knows about, so the
 *   browser can both name it and navigate to it.
 * - `path`: the parent's cwd is known but belongs to no loaded workspace (for
 *   example a project that is not open); it can be named but not navigated to.
 * - `unknown`: no parent cwd was reported, so nothing beyond "unavailable" can
 *   be said.
 */
export type ParentSessionLocation =
  | { kind: "workspace"; label: string; projectId: string; workspaceId: string; sessionId: string | undefined; cwd: string }
  | { kind: "path"; label: string; cwd: string }
  | { kind: "unknown" };

export interface ParentSessionLocationSources {
  /** Workspaces of the currently selected project. */
  workspaces: readonly Workspace[];
  /** Workspaces of every project loaded so far, keyed by project id. */
  workspacesByProjectId: Readonly<Record<string, readonly Workspace[]>>;
  projects: readonly Project[];
}

/**
 * Resolve a display label and navigation target for a session whose parent is
 * missing from the current list.
 *
 * The selected project's workspaces are searched first: `spawn_subsession`
 * constrains children to workspaces of the spawning session's own project, so
 * that lookup succeeds for the case this exists to explain — a child spawned
 * into a sibling worktree.
 */
export function resolveParentSessionLocation(session: SessionInfo, sources: ParentSessionLocationSources): ParentSessionLocation {
  const parentCwd = session.parentSessionCwd;
  if (parentCwd === undefined || parentCwd === "") return { kind: "unknown" };

  const currentProjectMatch = findWorkspaceByPath(sources.workspaces, parentCwd);
  if (currentProjectMatch !== undefined) {
    return workspaceLocation(currentProjectMatch, session.parentSessionId, undefined);
  }

  for (const [projectId, workspaces] of Object.entries(sources.workspacesByProjectId)) {
    const match = findWorkspaceByPath(workspaces, parentCwd);
    if (match === undefined) continue;
    const projectName = sources.projects.find((project) => project.id === projectId)?.name;
    return workspaceLocation(match, session.parentSessionId, projectName);
  }

  return { kind: "path", label: shortenPath(parentCwd), cwd: parentCwd };
}

/** Short user-facing text for the row indicator, e.g. `parent in feature/foo`. */
export function parentSessionLocationLabel(location: ParentSessionLocation): string {
  return location.kind === "unknown" ? "parent unavailable" : `parent in ${location.label}`;
}

/** Full detail for the row tooltip, where the whole path is useful. */
export function parentSessionLocationTitle(location: ParentSessionLocation): string {
  switch (location.kind) {
    case "workspace": return `Parent session is in ${location.label} (${location.cwd})`;
    case "path": return `Parent session is in ${location.cwd}`;
    case "unknown": return "Parent session is not available in this workspace";
  }
}

function workspaceLocation(workspace: Workspace, sessionId: string | undefined, projectName: string | undefined): ParentSessionLocation {
  const workspaceLabel = workspace.branch ?? workspace.label;
  return {
    kind: "workspace",
    label: projectName === undefined ? workspaceLabel : `${projectName} · ${workspaceLabel}`,
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    sessionId,
    cwd: workspace.path,
  };
}

function findWorkspaceByPath(workspaces: readonly Workspace[], cwd: string): Workspace | undefined {
  const target = normalizeSessionPath(cwd);
  return workspaces.find((workspace) => normalizeSessionPath(workspace.path) === target);
}

function shortenPath(path: string): string {
  const segments = normalizeSessionPath(path).split(/[/\\]/u).filter((segment) => segment !== "");
  const tail = segments.slice(-2);
  if (tail.length === 0) return path;
  return segments.length > tail.length ? `…/${tail.join("/")}` : tail.join("/");
}
