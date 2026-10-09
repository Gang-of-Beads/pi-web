/**
 * Which file changes in a workspace are news (object model §1.16).
 *
 * The watcher used to publish on any change anywhere under a workspace, so
 * git's own writes (objects, lock files), `node_modules` and the task logs a
 * background run appends every second each became a git status plus a tree
 * read: 74 % of 8504's requests on 2026-09-30, with the daemon at 99 % CPU.
 * The owner asked for the mature tools' answer first; this follows VS Code's
 * git extension and GitLens (research run 8f558e71):
 * - inside `.git`, only the files that move git state are news - HEAD, the
 *   index, refs, packed-refs, the in-progress operation markers and config -
 *   so a commit made in a terminal still shows at once;
 * - lock files, objects and logs are git's own churn and never news;
 * - a submodule's git directory (`.git/modules/<name>/`) follows the same rules;
 * - the working tree is news, except dependency folders, pi's own sessions
 *   (`.pi/sessions`), the directories the running plugins declare their
 *   extensions write background work into (`workPaths` under `cwd`, such as
 *   pi-background-tasks' `.pi/tasks`; core names none), each at any depth, and
 *   the git directories of nested clones. Build output is news on purpose:
 *   the tree and git panels show it, and a busy build publishes at most once
 *   per 2.5 s window.
 */
export type WorkspaceChange = "git-state" | "tree" | "noise";

const GIT_STATE_FILES = new Set(["HEAD", "index", "packed-refs", "config", "shallow"]);
const GIT_STATE_TREES = ["refs", "rebase-apply", "rebase-merge", "sequencer"];
const NOISE_SEGMENTS = new Set(["node_modules", "fsmonitor--daemon"]);
const PI_SESSIONS = [".pi", "sessions"];

export function classifyWorkspaceChange(relativePath: string | undefined, workPaths: readonly string[] = []): WorkspaceChange {
  if (relativePath === undefined || relativePath === "") return "tree";
  const path = relativePath.replaceAll("\\", "/");
  const segments = path.split("/");
  if (segments.some((segment) => NOISE_SEGMENTS.has(segment) || segment.startsWith(".watchman-cookie-"))) return "noise";
  if (segments[0] === ".git") return gitChange(segments.slice(1));
  if (segments.includes(".git")) return "noise";
  const runs = [PI_SESSIONS, ...workPaths.map(pathSegments)].filter((run) => run.length > 0);
  return runs.some((run) => containsRun(segments, run)) ? "noise" : "tree";
}

function pathSegments(path: string): string[] {
  return path.replaceAll("\\", "/").split("/").filter((segment) => segment !== "" && segment !== ".");
}

function containsRun(segments: readonly string[], run: readonly string[]): boolean {
  return segments.some((_, index) => run.every((part, offset) => segments[index + offset] === part));
}

function gitChange(inside: readonly string[]): WorkspaceChange {
  const name = inside.at(-1) ?? "";
  if (name.endsWith(".lock")) return "noise";
  if (inside.length === 1) return isGitStateFile(name) ? "git-state" : "noise";
  if (inside.join("/") === "info/exclude") return "git-state";
  if (inside[0] === "modules" && inside.length > 2) return gitChange(inside.slice(2));
  return GIT_STATE_TREES.includes(inside[0] ?? "") ? "git-state" : "noise";
}

function isGitStateFile(name: string): boolean {
  return GIT_STATE_FILES.has(name) || name.endsWith("_HEAD") || name.startsWith("MERGE_");
}
