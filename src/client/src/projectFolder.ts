/**
 * A project whose folder is gone (owner, 2026-10-08): it stays in the project lists, greyed, after
 * the others, and "Close project" in its menu removes it from PI WEB. It is not hidden or closed by
 * itself: a folder can come back (a cleared /tmp, a drive not mounted yet), and closing a project
 * is the reader's choice. Before, it sat among the others as if nothing were wrong, and choosing it
 * only showed a red line.
 */
export type ProjectFolderState = "present" | "missing";

interface FolderFact {
  folderMissing?: boolean | undefined;
}

export function projectFolderState(project: FolderFact): ProjectFolderState {
  return project.folderMissing === true ? "missing" : "present";
}

const LIST_RANK: Readonly<Record<ProjectFolderState, number>> = { present: 0, missing: 1 };

/** Projects in list order: those whose folder is there first, each group in the order given. */
export function presentProjectsFirst<T extends FolderFact>(projects: readonly T[]): T[] {
  return [...projects].sort((left, right) => LIST_RANK[projectFolderState(left)] - LIST_RANK[projectFolderState(right)]);
}

const DETAIL: Readonly<Record<ProjectFolderState, (path: string) => string>> = {
  present: (path) => path,
  missing: (path) => `Folder missing · ${path}`,
};

const ROW_CLASS: Readonly<Record<ProjectFolderState, string>> = { present: "", missing: " folder-missing" };

/** The class a project row adds for its folder: greyed when the folder is gone. */
export function projectRowClass(project: FolderFact): string {
  return ROW_CLASS[projectFolderState(project)];
}

/** A project row's second line: its path, saying first when the folder is gone. */
export function projectDetail(project: FolderFact & { path?: string | undefined }): string | undefined {
  return project.path === undefined ? undefined : DETAIL[projectFolderState(project)](project.path);
}

const FOLDER_FLAG: Readonly<Record<ProjectFolderState, { folderMissing?: true }>> = { present: {}, missing: { folderMissing: true } };

/** The navigate-choice flag marking a project whose folder is gone. */
export function projectFolderFlag(project: FolderFact): { folderMissing?: true } {
  return FOLDER_FLAG[projectFolderState(project)];
}
