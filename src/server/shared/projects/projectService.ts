import { mkdir, realpath, stat } from "node:fs/promises";
import type { ProjectFolderRefusal } from "../../../shared/apiTypes.js";
import type { ProjectStore } from "../storage/projectStore.js";
import type { Project } from "../types.js";
import { expandUserPath } from "./directorySuggestions.js";


/**
 * The project id names no project on this machine. Routes answer 404 for this type; they used to
 * compare the message "Project not found" (B16).
 */
export class ProjectNotFoundError extends Error {
  override name = "ProjectNotFoundError";

  constructor() {
    super("Project not found");
  }
}

/** A folder that cannot become a project, and why; the add route answers 400 with the kind as its code (B16). */
export class ProjectFolderError extends Error {
  override name = "ProjectFolderError";

  constructor(readonly refusal: ProjectFolderRefusal, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/** The refusal behind a file-system error code; an error with none of these codes is not a folder refusal. */
const FOLDER_REFUSAL_BY_ERRNO: Readonly<Record<string, ProjectFolderRefusal>> = {
  ENOENT: "folder-missing",
  ENOTDIR: "not-a-folder",
  EACCES: "folder-unreadable",
  EPERM: "folder-unreadable",
};

function folderRefusal(error: unknown): ProjectFolderError | undefined {
  const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  const refusal = typeof code === "string" && Object.hasOwn(FOLDER_REFUSAL_BY_ERRNO, code) ? FOLDER_REFUSAL_BY_ERRNO[code] : undefined;
  return refusal === undefined ? undefined : new ProjectFolderError(refusal, error);
}

export class ProjectService {
  constructor(private readonly store: ProjectStore) {}

  list(): Promise<Project[]> {
    return this.store.list();
  }

  async add(input: { name?: string; path: string; create?: boolean }): Promise<Project> {
    // Trim so stray whitespace cannot diverge the stored path from the
    // trimmed key the trust lookup (projectTrustRoutes) previews decisions for.
    const requestedPath = expandUserPath(input.path.trim());
    if (input.create === true) await mkdir(requestedPath, { recursive: true });
    const resolved = await this.readableFolder(requestedPath);
    return this.store.add(input.name === undefined ? { path: resolved } : { name: input.name, path: resolved });
  }

  private async readableFolder(requestedPath: string): Promise<string> {
    try {
      const resolved = await realpath(requestedPath);
      const s = await stat(resolved);
      if (!s.isDirectory()) throw new ProjectFolderError("not-a-folder", "Project path must be a directory");
      return resolved;
    } catch (error) {
      throw error instanceof ProjectFolderError ? error : folderRefusal(error) ?? error;
    }
  }

  reorder(order: readonly string[]): Promise<Project[]> {
    return this.store.reorder(order);
  }

  async close(id: string): Promise<void> {
    if (!(await this.store.remove(id))) throw new ProjectNotFoundError();
  }

  async requireProject(id: string): Promise<Project> {
    const project = await this.store.get(id);
    if (!project) throw new ProjectNotFoundError();
    return project;
  }
}
