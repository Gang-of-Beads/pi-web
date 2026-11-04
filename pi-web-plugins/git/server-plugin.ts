import { basename, resolve } from "node:path";
import type {
  PiWebServerPlugin,
  ProjectInput,
  ProviderClaim,
  ProviderRelocateContext,
  ProviderRemoveContext,
  ProviderRequestContext,
  ProviderWorkspace,
  ServerPluginActivationContext,
  ServerPluginExecFileResult,
  WorkspaceProvider,
  WorkspaceRemovePlan,
} from "@gang-of-beads/pi-web/server-plugin-api";
import { requestGitBackend } from "./git-backend.js";
import { repairMovedWorktrees, type LeftLink, type WorktreeRepairPorts } from "./worktreeRepair.js";

const GIT_LOCAL_ENV_VARS = Object.freeze([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_QUARANTINE_PATH",
  "GIT_WORK_TREE",
]);

interface GitWorktreeInfo {
  path: string;
  branch?: string;
  bare?: boolean;
  detached?: boolean;
  prunable?: boolean;
}

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Git",
  activate(context) {
    return { workspaceProvider: createGitWorkspaceProvider(context) };
  },
};

export default plugin;

export function createGitWorkspaceProvider(context: ServerPluginActivationContext): WorkspaceProvider {
  return Object.freeze({
    fallback: true,
    async probe(project: ProjectInput, signal: AbortSignal): Promise<ProviderClaim> {
      const result = await runGit(context, project.path, ["rev-parse", "--is-inside-work-tree"], signal);
      if (result.signal !== null) throw new Error(`git repository probe ended from signal ${result.signal}`);
      if (result.exitCode !== 0) return "pass";
      return result.stdout.trim() === "true" ? "claim" : "pass";
    },
    async list(project: ProjectInput, signal: AbortSignal): Promise<ProviderWorkspace[]> {
      const rootResult = await requireGit(
        runGit(context, project.path, ["rev-parse", "--show-toplevel"], signal),
        "resolve the Git worktree root",
      );
      const mainRootOutput = rootResult.stdout.trim();
      if (mainRootOutput === "") throw new Error("Git returned an empty worktree root");
      const mainRoot = resolve(mainRootOutput);
      const commonDirectoryResult = await requireGit(
        runGit(context, project.path, ["rev-parse", "--git-common-dir"], signal),
        "resolve the Git common directory",
      );
      const commonDirectoryOutput = commonDirectoryResult.stdout.trim();
      if (commonDirectoryOutput === "") throw new Error("Git returned an empty common directory");
      const commonDirectory = resolve(project.path, commonDirectoryOutput);

      const listResult = await requireGit(
        runGit(context, project.path, ["worktree", "list", "--porcelain", "-z"], signal),
        "list Git worktrees",
      );
      const worktrees = parseGitWorktreeList(listResult.stdout)
        .filter((worktree) => worktree.bare !== true)
        .map((worktree) => {
          const path = resolve(worktree.path);
          return { worktree: { ...worktree, path }, path };
        });
      // Prefer the checkout Git identifies for the registered project. A
      // submodule is the exception: its sole worktree record points at common
      // storage under the superproject instead of at --show-toplevel.
      const mainWorkspacePath = worktrees.some(({ path }) => path === mainRoot)
        ? mainRoot
        : commonDirectory;
      const selectable = worktrees
        .map(({ worktree, path }) => ({ worktree, path, isMain: path === mainWorkspacePath }))
        .filter(({ worktree, path, isMain }) => worktree.prunable !== true || isMain || path === project.path);
      if (selectable.length === 0) return [singleGitWorkspace(project)];

      return selectable.map(({ worktree, path, isMain }) => {
        const label = worktree.branch ?? (worktree.detached === true ? "detached" : basename(worktree.path) || worktree.path);
        return {
          key: path,
          path,
          label,
          isMain,
          data: {
            worktreePath: worktree.path,
            ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
          },
          publicMetadata: {
            isGitRepo: true,
            isGitWorktree: true,
            ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
            ...(worktree.detached === undefined ? {} : { detached: worktree.detached }),
          },
          ...(isMain ? {} : { removal: gitRemovalPresentation(label, path) }),
        };
      });
    },
    request: (request: ProviderRequestContext) => requestGitBackend(context, request),
    async prepareRemove({ project, workspace, signal }: ProviderRemoveContext): Promise<WorkspaceRemovePlan> {
      const privatePath = gitPrivateWorktreePath(workspace);
      if (resolve(privatePath) !== workspace.path) {
        throw new Error("Git workspace removal data no longer matches the current workspace path");
      }
      const listResult = await requireGit(
        runGit(context, project.path, ["worktree", "list", "--porcelain", "-z"], signal),
        "validate the Git worktree before removal",
      );
      const current = parseGitWorktreeList(listResult.stdout)
        .find((worktree) => resolve(worktree.path) === workspace.path);
      if (current === undefined || current.prunable === true) {
        throw new Error("Git worktree is no longer available for removal");
      }
      if (current.bare === true) throw new Error("A bare Git workspace cannot be removed as a linked worktree");
      return {
        title: `Delete workspace: ${workspace.label}`,
        command: `git worktree remove ${shellQuote(workspace.path)}`,
      };
    },
    /**
     * Git records a repository's linked worktrees, and each worktree its repository, by path,
     * absolute unless made relative, so a moved folder breaks the links of repositories and
     * worktrees inside it and of their partners elsewhere, whether they belong to a project or not
     * (owner, 2026-11-05: repair them all). `repairMovedWorktrees` reads the whole folder and
     * repairs the links the move broke where Git can do so without touching anyone else's; what it
     * leaves, such as a copy of a repository whose records name the original's worktrees, is named
     * in the log with its reason, also when a repair fails the move.
     */
    async relocate({ from, to, signal }: ProviderRelocateContext): Promise<void> {
      const left: LeftLink[] = [];
      const ports: WorktreeRepairPorts = {
        listWorktrees: async (repository) => {
          const listed = await askGit(context, repository, ["worktree", "list", "--porcelain", "-z"], signal);
          return listed?.signal === null && listed.exitCode === 0 ? parseGitWorktreeList(listed.stdout).map(({ path }) => resolve(path)) : undefined;
        },
        isBare: async (folder) => {
          const answer = await askGit(context, folder, ["rev-parse", "--is-bare-repository"], signal);
          return answer?.signal === null && answer.exitCode === 0 ? answer.stdout.trim() === "true" : undefined;
        },
        repair: async (cwd, paths) => {
          await requireGit(runGit(context, cwd, ["worktree", "repair", ...(paths.length === 0 ? [] : ["--", ...paths])], signal), "repair Git worktree links after the folder moved");
        },
        leave: (link) => { left.push(link); },
      };
      let failures: readonly unknown[];
      try {
        failures = await repairMovedWorktrees({ from, to }, ports, signal);
      } finally {
        if (left.length > 0) context.logger.warn("left Git links as they were after a folder moved", { from, to, count: left.length, left: left.slice(0, LEFT_LINKS_LOGGED).map(({ path, reason }) => ({ path, reason })) });
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, `${String(failures.length)} Git repositories could not be repaired: ${namedFailures(failures)}`);
    },
  });
}

/** Parse `git worktree list --porcelain -z` without path quoting or space loss. */
export function parseGitWorktreeList(stdout: string): GitWorktreeInfo[] {
  return stdout.split("\0\0").flatMap((record) => {
    if (record === "") return [];
    const info: GitWorktreeInfo = { path: "" };
    for (const field of record.split("\0")) {
      const separator = field.indexOf(" ");
      const key = separator === -1 ? field : field.slice(0, separator);
      const value = separator === -1 ? "" : field.slice(separator + 1);
      if (key === "worktree") info.path = value;
      else if (key === "branch") info.branch = value.replace(/^refs\/heads\//u, "");
      else if (key === "bare") info.bare = true;
      else if (key === "detached") info.detached = true;
      else if (key === "prunable") info.prunable = true;
    }
    return info.path === "" ? [] : [info];
  });
}

function singleGitWorkspace(project: ProjectInput): ProviderWorkspace {
  return {
    key: project.path,
    path: project.path,
    label: project.name,
    isMain: true,
    data: { worktreePath: project.path },
    publicMetadata: { isGitRepo: true, isGitWorktree: false },
  };
}

function gitRemovalPresentation(label: string, path: string): NonNullable<ProviderWorkspace["removal"]> {
  return {
    actionLabel: "Delete workspace",
    confirmation: `Delete workspace ${label}?\n\nThis will run git worktree remove and delete:\n${path}\n\nThe Git branch will not be deleted.`,
  };
}

function gitPrivateWorktreePath(workspace: ProviderWorkspace): string {
  const data = workspace.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Git workspace removal data is unavailable");
  }
  const path: unknown = Reflect.get(data, "worktreePath");
  if (typeof path !== "string" || path === "") throw new Error("Git worktree path is unavailable for removal");
  return path;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runGit(
  context: ServerPluginActivationContext,
  cwd: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<ServerPluginExecFileResult> {
  const result = await context.execFile({
    file: "git",
    // --no-optional-locks: `git status` otherwise refreshes .git/index, the
    // workspace watcher reports that write as a change, the client refetches the
    // tree and the status, and the whole thing runs forever at the watcher's
    // debounce - measured 13 requests in 4 seconds and 18 app renders a second
    // on an idle page, which is the shake the owner reported. The flag is a
    // global option and a no-op for the subcommands that take no optional lock.
    args: ["--no-optional-locks", "-C", cwd, ...args],
    unsetEnv: GIT_LOCAL_ENV_VARS,
    signal,
  });
  if (result.stdoutTruncated || result.stderrTruncated) {
    throw new Error(`git ${args.join(" ")} exceeded the host output limit`);
  }
  return result;
}

/**
 * Ask Git something whose answer may be "no answer": a Git that cannot start (not installed), runs
 * past the host's time limit or prints more than the host keeps answers nothing, which is logged
 * with its cause, instead of failing the caller; an aborted signal still throws.
 */
async function askGit(
  context: ServerPluginActivationContext,
  cwd: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<ServerPluginExecFileResult | undefined> {
  try {
    return await runGit(context, cwd, args, signal);
  } catch (error) {
    signal.throwIfAborted();
    context.logger.warn("Git gave no answer about a repository after a folder moved", { cwd, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

/** How many links left as they were the log names; it counts them all. */
const LEFT_LINKS_LOGGED = 20;
/** How many refused repairs a move's failure names; it counts the rest, so a dialog stays readable. */
const FAILURES_NAMED = 3;

function namedFailures(failures: readonly unknown[]): string {
  const named = failures.slice(0, FAILURES_NAMED).map((failure) => (failure instanceof Error ? failure.message : String(failure))).join("; ");
  return failures.length > FAILURES_NAMED ? `${named}; and ${String(failures.length - FAILURES_NAMED)} more` : named;
}

async function requireGit(
  resultPromise: Promise<ServerPluginExecFileResult>,
  action: string,
): Promise<ServerPluginExecFileResult> {
  const result = await resultPromise;
  if (result.signal === null && result.exitCode === 0) return result;
  const detail = result.stderr.trim();
  const outcome = result.signal === null ? `exit ${String(result.exitCode)}` : `signal ${result.signal}`;
  throw new Error(`Unable to ${action} (${outcome})${detail === "" ? "" : `: ${detail}`}`);
}
