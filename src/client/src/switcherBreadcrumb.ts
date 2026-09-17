/**
 * The quick-access menu's context path.
 *
 * The menu used to offer one flat row of chips that mixed machines, projects
 * and folders: the owner tapped a project and a folder chip appeared beside
 * the project chips, with nothing saying which kind each one was. A path says
 * what the levels are and which value each one currently holds, so the reader
 * can read their position before changing it.
 *
 * Levels are named for what the reader sees, not for how they are stored: the
 * third level is a folder on disk. Whether that folder is a git worktree is
 * the git plugin's business, contributed as a label, and this module has no
 * opinion about it.
 */

export type BreadcrumbLevel = "machine" | "project" | "folder";

export interface BreadcrumbOption {
  id: string;
  label: string;
  detail?: string;
  current: boolean;
}

export interface BreadcrumbSegment {
  level: BreadcrumbLevel;
  /** What the level is called when nothing is chosen, e.g. "All projects". */
  label: string;
  options: BreadcrumbOption[];
  /** Whether a value is chosen here, as opposed to the "everything" state. */
  chosen: boolean;
}

interface BreadcrumbInput {
  machines: readonly { id: string; name: string }[];
  machineId: string;
  projects: readonly { id: string; name: string; path?: string }[];
  projectId: string | undefined;
  folders: readonly { id: string; label: string; path: string; projectId?: string }[];
  folderPath: string | undefined;
}

export function switcherBreadcrumb(input: BreadcrumbInput): BreadcrumbSegment[] {
  const segments: BreadcrumbSegment[] = [];
  if (input.machines.length > 1) {
    const current = input.machines.find((machine) => machine.id === input.machineId);
    segments.push({
      level: "machine",
      label: current?.name ?? "Machine",
      chosen: current !== undefined,
      options: input.machines.map((machine) => ({ id: machine.id, label: machine.name, current: machine.id === input.machineId })),
    });
  }

  const project = input.projects.find((entry) => entry.id === input.projectId);
  segments.push({
    level: "project",
    label: project?.name ?? "All projects",
    chosen: project !== undefined,
    options: input.projects.map((entry) => ({
      id: entry.id,
      label: entry.name,
      ...(entry.path === undefined ? {} : { detail: entry.path }),
      current: entry.id === input.projectId,
    })),
  });

  const folders = foldersInScope(input);
  if (folders.length > 0) {
    const folder = folders.find((entry) => entry.path === input.folderPath);
    segments.push({
      level: "folder",
      label: folder?.label ?? "All folders",
      chosen: folder !== undefined,
      options: folders.map((entry) => ({ id: entry.path, label: entry.label, detail: entry.path, current: entry.path === input.folderPath })),
    });
  }
  return segments;
}

/**
 * Folders offered under the chosen project. Without a chosen project the level
 * would list every folder on the machine, which is a flat list of unrelated
 * directories rather than a step in a path.
 */
function foldersInScope(input: BreadcrumbInput): BreadcrumbInput["folders"] {
  if (input.projectId === undefined) return [];
  return input.folders.filter((folder) => folder.projectId === input.projectId);
}
