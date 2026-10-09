import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";

/**
 * The `footerData` pi hands a `setFooter` factory (pi-insertion-points.md slice 5): the git branch,
 * the extensions' statuses and how many providers have models. pi's `FooterDataProvider` is not
 * exported (the package's `exports` map blocks the deep import), so its answers are mirrored here.
 * The branch is read again at each call instead of watched: a footer is drawn when it asks or once
 * its drawing is a second old (standingWidgets.ts), so a branch change shows at its next drawing and
 * `onBranchChange` has nothing to report.
 */
export function extensionFooterData(source: {
  readonly cwd: string;
  readonly statuses: () => ReadonlyMap<string, string>;
  readonly providerCount: () => number;
}): ReadonlyFooterDataProvider {
  return {
    getGitBranch: () => gitBranch(source.cwd),
    getExtensionStatuses: source.statuses,
    getAvailableProviderCount: source.providerCount,
    onBranchChange: () => unsubscribeNothing,
  };
}

const BRANCH_REF = "ref: refs/heads/";
/** What a reftable repository's HEAD file names; its branch is only known to git itself. */
const REFTABLE_PLACEHOLDER = ".invalid";
const GIT_ANSWER_MS = 2_000;

const unsubscribeNothing = (): void => undefined;

/** pi's answer: null outside a repository, "detached" on a detached HEAD, else the branch's name. */
function gitBranch(cwd: string): string | null {
  const paths = gitPaths(cwd);
  if (paths === undefined) return null;
  try {
    const head = readFileSync(paths.headPath, "utf8").trim();
    if (!head.startsWith(BRANCH_REF)) return "detached";
    const branch = head.slice(BRANCH_REF.length);
    return branch === REFTABLE_PLACEHOLDER ? branchFromGit(paths.repoDir) ?? "detached" : branch;
  } catch {
    return null;
  }
}

/** pi's `findGitPaths`: the nearest `.git` up from `cwd`, a directory or a worktree's `gitdir:` file. */
function gitPaths(cwd: string): { readonly repoDir: string; readonly headPath: string } | undefined {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) return repositoryAt(dir, gitPath);
    if (dirname(dir) === dir) return undefined;
  }
}

function repositoryAt(repoDir: string, gitPath: string): { readonly repoDir: string; readonly headPath: string } | undefined {
  try {
    const gitDir = statSync(gitPath).isDirectory() ? gitPath : linkedGitDir(repoDir, gitPath);
    if (gitDir === undefined) return undefined;
    const headPath = join(gitDir, "HEAD");
    return existsSync(headPath) ? { repoDir, headPath } : undefined;
  } catch {
    return undefined;
  }
}

function linkedGitDir(repoDir: string, gitFile: string): string | undefined {
  const content = readFileSync(gitFile, "utf8").trim();
  return content.startsWith("gitdir: ") ? resolve(repoDir, content.slice("gitdir: ".length).trim()) : undefined;
}

/** As pi asks git for a reftable repository's branch; bounded, since it runs on the daemon's loop. */
function branchFromGit(repoDir: string): string | undefined {
  try {
    const branch = execFileSync("git", ["--no-optional-locks", "symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_ANSWER_MS,
    }).trim();
    return branch === "" ? undefined : branch;
  } catch {
    return undefined;
  }
}
