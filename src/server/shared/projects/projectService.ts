import { mkdir, realpath, stat } from "node:fs/promises";
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
    const resolved = await realpath(requestedPath);
    const s = await stat(resolved);
    if (!s.isDirectory()) throw new Error("Project path must be a directory");
    return this.store.add(input.name === undefined ? { path: resolved } : { name: input.name, path: resolved });
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
