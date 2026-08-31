import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { piWebDataDir } from "../../../config.js";
import { randomUUID } from "node:crypto";
import type { Project } from "../types.js";

interface ProjectFile {
  projects: Project[];
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function defaultProjectStorePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return join(piWebDataDir(env, cwd), "projects.json");
}

export function projectStorePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configured = env["PI_WEB_PROJECTS_FILE"];
  if (configured === undefined || configured === "") return defaultProjectStorePath(env, cwd);
  return resolve(cwd, configured);
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
      const leafName = path.split("/").filter((part) => part !== "").at(-1);
      const project: Project = {
        id: randomUUID(),
        name: trimmedName !== undefined && trimmedName !== "" ? trimmedName : leafName ?? path,
        path,
        createdAt: new Date().toISOString(),
      };
      return { result: project, data: { projects: [...data.projects, project] } };
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

  /** Read, decide, write - with no other change of this store in between. */
  private change<T>(decide: (data: ProjectFile) => ProjectChange<T>): Promise<T> {
    const change = this.queue.then(async () => {
      const outcome = decide(await this.read());
      if (outcome.data !== undefined) await this.write(outcome.data);
      return outcome.result;
    });
    // A change that threw must not cancel the ones queued behind it.
    this.queue = change.catch(() => undefined);
    return change;
  }

  private async read(): Promise<ProjectFile> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      return parseProjectFile(value);
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, "ENOENT")) return { projects: [] };
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
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid.toString()}-${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(tempPath, this.filePath);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}
