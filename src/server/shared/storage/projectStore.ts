import { isRecord } from "../../../shared/unknownValues.js";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { piWebDataDir } from "../../../config.js";
import { replaceFile } from "./stateFiles.js";
import { randomUUID } from "node:crypto";
import type { Project } from "../types.js";
import { isNodeErrorWithCode } from "../workspaces/pathSafety.js";
import { orderedById } from "../../../shared/listOrder.js";

interface ProjectFile {
  projects: Project[];
}

function parseProjectFile(value: unknown): ProjectFile {
  if (!isRecord(value) || !Array.isArray(value["projects"])) throw new Error("Invalid project file");
  return { projects: value["projects"].map(parseProject) };
}

function parseProject(value: unknown): Project {
  if (!isRecord(value)) throw new Error("Invalid project");
  const id = value["id"];
  const name = value["name"];
  const path = value["path"];
  const createdAt = value["createdAt"];
  if (typeof id !== "string" || typeof name !== "string" || typeof path !== "string" || typeof createdAt !== "string") throw new Error("Invalid project");
  return { id, name, path, createdAt };
}

const CHANGE_ATTEMPTS = 3;

function parseStoredText(text: string | undefined): ProjectFile {
  if (text === undefined) return { projects: [] };
  const value: unknown = JSON.parse(text);
  return parseProjectFile(value);
}

export function defaultProjectStorePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return join(piWebDataDir(env, cwd), "projects.json");
}

export function projectStorePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configured = env["PI_WEB_PROJECTS_FILE"];
  if (configured === undefined || configured === "") return defaultProjectStorePath(env, cwd);
  return resolve(cwd, configured);
}

/** A project's name and folder, as a rename moves them. */
export interface ProjectPlace {
  readonly name: string;
  readonly path: string;
}

/** What one change decided: the answer to give back, and the file to leave behind. */
interface ProjectChange<T> {
  result: T;
  data?: ProjectFile;
}

export class ProjectStore {
  constructor(private readonly filePath = projectStorePath()) {}

  /**
   * The tail of the changes already accepted.
   *
   * Every change is read-modify-write, and two of them interleaved lose one of
   * the two: both read the same six projects, both append their own, and the
   * second write replaces the first - a project the user added is simply not
   * there any more. Queueing them means each one reads what the one before it
   * wrote.
   */
  private queue: Promise<unknown> = Promise.resolve();

  async list(): Promise<Project[]> {
    return (await this.read()).projects;
  }

  async add(input: { name?: string; path: string }): Promise<Project> {
    return this.change((data) => {
      const path = input.path;
      const existing = data.projects.find((p) => p.path === path);
      if (existing) return { result: existing };

      const trimmedName = input.name?.trim();
      const leafName = basename(path) || path;
      const project: Project = {
        id: randomUUID(),
        name: trimmedName !== undefined && trimmedName !== "" ? trimmedName : leafName,
        path,
        createdAt: new Date().toISOString(),
      };
      return { result: project, data: { projects: [...data.projects, project] } };
    });
  }

  /** The projects in the order the reader dragged them into (R11), applied as `orderedIds` does. */
  async reorder(order: readonly string[]): Promise<Project[]> {
    return this.change((data) => {
      const projects = orderedById(data.projects, order);
      return { result: projects, data: { projects } };
    });
  }

  /**
   * Give projects the name and folder a rename moved them to: the renamed project, and any project
   * whose folder was inside its folder. A project changes only while it is still at `from`'s
   * folder, so the same changes applied twice, or undone when they never applied, do nothing.
   */
  async relocate(changes: readonly { id: string; from: ProjectPlace; to: ProjectPlace }[]): Promise<void> {
    const byId = new Map(changes.map((change) => [change.id, change]));
    return this.change((data) => {
      const projects = data.projects.map((project) => {
        const change = byId.get(project.id);
        return change?.from.path === project.path ? { ...project, name: change.to.name, path: change.to.path } : project;
      });
      return projects.some((project, index) => project !== data.projects[index]) ? { result: undefined, data: { projects } } : { result: undefined };
    });
  }

  async get(id: string): Promise<Project | undefined> {
    return (await this.list()).find((p) => p.id === id);
  }

  async remove(id: string): Promise<boolean> {
    return this.change((data) => {
      const projects = data.projects.filter((p) => p.id !== id);
      if (projects.length === data.projects.length) return { result: false };
      return { result: true, data: { projects } };
    });
  }

  /**
   * Read, decide, write - with no other change of this store in between.
   *
   * The queue orders this process's changes. The web/API adds, orders and closes projects and the
   * session daemon renames them, so the file is read again just before it is replaced; when another
   * process changed it meanwhile the change is decided again on top of it, up to CHANGE_ATTEMPTS
   * times, and then written anyway. This narrows the window for a lost update; it is not a lock.
   */
  private change<T>(decide: (data: ProjectFile) => ProjectChange<T>): Promise<T> {
    const change = this.queue.then(async () => {
      for (let attempt = 1; ; attempt += 1) {
        const before = await this.readText();
        const outcome = decide(parseStoredText(before));
        if (outcome.data === undefined) return outcome.result;
        if (attempt < CHANGE_ATTEMPTS && await this.readText() !== before) continue;
        await this.write(outcome.data);
        return outcome.result;
      }
    });
    // A change that threw must not cancel the ones queued behind it.
    this.queue = change.catch(() => undefined);
    return change;
  }

  private async read(): Promise<ProjectFile> {
    return parseStoredText(await this.readText());
  }

  /** The file's text, or undefined when there is no file yet. */
  private async readText(): Promise<string | undefined> {
    try {
      return await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  /**
   * Written beside the file and moved onto it, because a reader can arrive
   * mid-write. Writing in place leaves the list truncated for as long as the
   * write takes, and a reader landing there gets invalid JSON - the project
   * list fails to load rather than showing what it had a moment ago. A rename
   * is a single step: a reader sees the old list or the new one.
   */
  private async write(data: ProjectFile): Promise<void> {
    await replaceFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`);
  }
}
