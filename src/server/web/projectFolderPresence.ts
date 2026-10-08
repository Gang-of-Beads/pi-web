import { stat } from "node:fs/promises";
import type { Project } from "../../shared/apiTypes.js";

/**
 * The project list says which projects' folders are gone (owner, 2026-10-08: such a project is
 * greyed and listed last, and the reader may close it). Only a folder that is certainly absent
 * counts: a path that does not exist, or one that is not a directory. Any other failure (a
 * permission error, a mount that answered strangely) is not proof of absence, so the project is
 * listed as usual. The stat is asynchronous, so a slow mount does not hold up the web process.
 */
export async function withFolderPresence(projects: readonly Project[]): Promise<Project[]> {
  return Promise.all(projects.map(async (project) => ((await folderMissing(project.path)) ? { ...project, folderMissing: true } : project)));
}

const ABSENT_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR"]);

async function folderMissing(path: string): Promise<boolean> {
  try {
    return !(await stat(path)).isDirectory();
  } catch (error: unknown) {
    return ABSENT_CODES.has(errorCode(error));
  }
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return typeof error.code === "string" ? error.code : "";
}
